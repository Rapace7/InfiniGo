/* 量「手数列表的胜亏（补账）会不会拖慢棋盘上的推荐选点」。
 *
 * 疑点（用户 2026-10-06 晚提问）：这两件事共用**同一个 KataGo 分析引擎** ——
 *   · 选点上屏：runAnalysisOnce(state.viewAt)，但要用 analyze 拿结果；
 *   · 涨跌补账：runAnalysisOnce(旧手)，同一个引擎、同一个「单飞」闸门（anaBusy）。
 * 主进程里每个新请求都会 `terminateId` 掐掉上一个，所以两者必然互相打断。
 *
 * 量什么：落子之后，**推荐点刷成新局面**要多久（选点延迟）。
 * 三种负载对比：
 *   A 基线：正常下棋，落一手等一手（队列里没有欠账）
 *   B 有欠账：连点式快速落子（每手只等 250ms），攒下一堆补账，再落一手
 *   C 关掉补账：把补账队列在落子后立刻清空（模拟"不补历史"），同样快速落子
 * 计时口径：从 tryPlay 返回（局面已变）到 state.candAt === state.viewAt（选点已刷新）。
 */
const PORT = 9333;

async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) { }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('连不上调试端口');
}
const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise(res => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr, tmo) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 300000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const load = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  if (engineReady) return { 已就绪: true };
  await window.api.engine.load('analyze');
  const t0 = Date.now();
  while (!engineReady && Date.now() - t0 < 180000) await sleep(1000);
  return { 就绪: engineReady, 等了秒: Math.round((Date.now()-t0)/1000) };
})()`, 200000);
console.log('引擎 ' + JSON.stringify(load));
if (!load || !load.就绪) { ws.close(); process.exit(1); }

const run = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const free = () => {
    const b = boardAt(state.moves.length), out = [];
    for (let y = 2; y < 17; y++) for (let x = 2; x < 17; x++) if (!b[y*N+x]) out.push([x,y]);
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); const t = out[i]; out[i] = out[j]; out[j] = t; }
    return out;
  };
  const drop = () => { const f = free(); for (let i = 0; i < 12 && i < f.length; i++) if (tryPlay(f[i][0], f[i][1])) return true; return false; };
  /* 落一手 → 量「选点刷新到新局面」用了多久（超时 30 秒算失败） */
  const dropAndTime = async () => {
    const t0 = performance.now();
    if (!drop()) return null;
    const want = state.viewAt;
    while (state.candAt !== want && performance.now() - t0 < 30000) await sleep(15);
    return Math.round(performance.now() - t0);
  };
  const reset = async () => {
    settings.mode = 'setup'; settings.size = 19; settings.handicap = 0;
    settings.rules = 'chinese'; state.showHints = true;
    applyNewGame(); await sleep(900);
  };

  const out = {};

  /* ---- A 基线：正常节奏（落一手等一手，队列里没有欠账） ---- */
  settings.visits = 500;
  await reset();
  out.A = [];
  for (let k = 0; k < 8; k++) { const ms = await dropAndTime(); if (ms !== null) out.A.push(ms); await sleep(1200); }

  /* ---- B 有欠账：快速落 6 手（每手 250ms，攒欠账），然后量下一手的选点延迟 ---- */
  out.B = []; out.B_队列 = [];
  for (let r = 0; r < 3; r++) {
    await reset();
    for (let k = 0; k < 6; k++) { drop(); await sleep(250); }
    const qLen = anaQueue.length;
    const ms = await dropAndTime();
    out.B_队列.push(qLen + '→' + anaQueue.length);
    if (ms !== null) out.B.push(ms);
    await sleep(2500);
  }

  /* ---- C 不补账：同样快速落子，但落子后立刻清空补账队列 ---- */
  out.C = []; out.C_队列 = [];
  for (let r = 0; r < 3; r++) {
    await reset();
    for (let k = 0; k < 6; k++) { drop(); await sleep(250); }
    anaQueue.length = 0;                      // ★ 唯一差别：不给历史补账
    const qLen = anaQueue.length;
    const ms = await dropAndTime();
    out.C_队列.push(qLen + '→' + anaQueue.length);
    if (ms !== null) out.C.push(ms);
    await sleep(2500);
  }

  /* ---- D 计算深度 200 vs 500：看降低深度对选点延迟的收益 ---- */
  out.D = {};
  for (const v of [200, 500, 1000]) {
    settings.visits = v;
    await reset();
    const arr = [];
    for (let k = 0; k < 6; k++) { const ms = await dropAndTime(); if (ms !== null) arr.push(ms); await sleep(1200); }
    out.D[v] = arr;
  }
  settings.visits = 500;
  return out;
})()`, 900000);

if (typeof run === 'string') { console.log('运行失败: ' + run); ws.close(); process.exit(1); }

const stat = a => { if (!a.length) return '无数据'; const s = a.slice().sort((x, y) => x - y); return '中位 ' + s[Math.floor(s.length/2)] + 'ms  最小 ' + s[0] + '  最大 ' + s[s.length-1] + '  (' + a.join(', ') + ')'; };
console.log('\n===== 落子后「推荐选点刷新到新局面」的耗时 =====');
console.log('A 基线（正常节奏、无欠账）      ' + stat(run.A));
console.log('B 有欠账（先连落 6 手攒账）      ' + stat(run.B) + '   队列 ' + run.B_队列.join(' / '));
console.log('C 清空补账（其余完全相同）       ' + stat(run.C) + '   队列 ' + run.C_队列.join(' / '));
console.log('\n===== 「计算深度」不同档位的选点延迟 =====');
for (const k of Object.keys(run.D)) console.log('  深度 ' + k.padStart(4) + '：' + stat(run.D[k]));
ws.close();
