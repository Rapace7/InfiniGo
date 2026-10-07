/* 本轮改动的综合回归 + 验收。
 *
 * 覆盖：
 *   R1 悔棋（用户怀疑和卡死有关）：悔棋后选点必须跟上新局面、搜索量要涨
 *   R2 回看旧手 → 回最新 → 悔棋（用户描述的卡死前置动作）之后，分析仍要收敛
 *   R3 涨跌数字：刚落显示「…」，收敛后出数字且此后不变
 *   R4 刷新按钮：正常/卡住两种情况下都要可用
 *   R5 界面一致性：手数列表条数 = 手数、候选点数、帮助面板新增条目都在
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
  const shown = () => Array.from(document.querySelectorAll('#movelist li')).map(li => li.querySelector('.dl')?.textContent || '—').join(' ');
  const snap = () => ({ 手数: state.moves.length, 看: state.viewAt, candAt: state.candAt, rv: state.rootVisits,
                        busy: anaBusy, q: anaQueue.length, 点: state.candidates.length });
  /* 等选点追上当前局面（上限 ms），返回等了多久 */
  const waitHints = async (ms) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (state.candAt === state.viewAt && !anaBusy) return Math.round(performance.now() - t0);
      await sleep(30);
    }
    return null;
  };
  const out = {};

  settings.mode = 'setup'; settings.size = 19; settings.handicap = 0;
  settings.rules = 'chinese'; settings.visits = 500; state.showHints = true;
  applyNewGame(); await sleep(900);

  /* ---- R1 落 8 手 → 悔棋 3 次，每次都要跟上 ---- */
  for (let k = 0; k < 8; k++) { drop(); await sleep(900); }
  await waitHints(8000);
  const beforeUndo = snap();
  out.R1 = [];
  for (let k = 0; k < 3; k++) {
    const rvBefore = state.rootVisits;
    $('btn-undo').click();
    const took = await waitHints(12000);
    out.R1.push({ 悔棋后手数: state.moves.length, 选点跟上耗时: took,
                  搜索量变了: state.rootVisits !== rvBefore,
                  选点新鲜: state.candAt === state.viewAt,
                  列表条数: document.querySelectorAll('#movelist li').length,
                  history长度: state.history.length });
    await sleep(500);
  }
  out.R1悔棋前 = beforeUndo;

  /* ---- R2 回看旧手 → 回最新 → 悔棋（用户描述的卡死前置动作）---- */
  out.R2 = [];
  for (let round = 0; round < 3; round++) {
    for (let k = 0; k < 4; k++) { drop(); await sleep(700); }
    gotoView(1); await sleep(300);
    gotoView(2); await sleep(250);
    gotoView(state.moves.length); await sleep(250);
    $('btn-undo').click();
    $('btn-undo').click();
    const took = await waitHints(15000);
    out.R2.push({ 手数: state.moves.length, 看: state.viewAt, 收敛耗时: took,
                  选点新鲜: state.candAt === state.viewAt, 搜索量: state.rootVisits,
                  busy: anaBusy, 欠账: anaQueue.length, 卡住: (took === null) ? '★ 是' : '否' });
    while (state.moves.length > 3) { $('btn-undo').click(); await sleep(150); }
    await sleep(400);
  }

  /* ---- R3 涨跌数字稳定性 ---- */
  applyNewGame(); await sleep(900);
  out.R3 = [];
  for (let k = 0; k < 4; k++) {
    drop(); await sleep(600);
    const early = shown().trim().split(' ').pop();
    await sleep(4500);
    const base = shown();
    const late = base.trim().split(' ').pop();
    const samples = [];
    for (let t = 0; t < 5; t++) { await sleep(400); samples.push(shown()); }
    out.R3.push({ 手: state.moves.length, 刚落: early, 收敛后: late,
                  此后不变: samples.every(s => s === base) ? '✓' : '★' });
  }

  /* ---- R4 刷新按钮 ---- */
  {
    const btn = document.getElementById('btn-engine-refresh');
    const ok1 = !!btn;
    /* (a) 正常点 */
    btn.click(); await sleep(2200);
    const normal = { 重算了: state.candAt === state.viewAt && anaQueue.length === 0, busy: anaBusy };
    /* (b) 卡住点 */
    anaBusy = true; anaBusySince = Date.now() - 20000; anaQueue.push(0, 1); anaForceCur = false;
    btn.click();
    const sync = { q: anaQueue.length, force: anaForceCur };
    await sleep(2200);
    out.R4 = { 按钮存在: ok1, 正常点可用: normal.重算了 && !normal.busy,
               卡住点后清队列: sync.q === 0 && sync.force === true,
               恢复: state.candAt === state.viewAt && state.rootVisits > 0 };
  }

  /* ---- R5 界面一致性 ---- */
  out.R5 = {
    手数列表条数: document.querySelectorAll('#movelist li').length,
    实际手数: state.moves.length,
    候选点数: state.candidates.length,
    进度条上限: document.getElementById('slider').max,
    帮助里提到刷新: document.getElementById('help').innerHTML.indexOf('刷新引擎状态') >= 0,
    帮助里提到自检: document.getElementById('help').innerHTML.indexOf('分析自检') >= 0,
    帮助里提到省略号: document.getElementById('help').innerHTML.indexOf('手数后面的「…」') >= 0,
    帮助里提到计算深度实测: document.getElementById('help').innerHTML.indexOf('推荐点出现的快慢几乎一样') >= 0,
  };
  return out;
})()`, 900000);

if (typeof run === 'string') { console.log('运行失败: ' + run); ws.close(); process.exit(1); }

console.log('\nR1 悔棋 ×3（悔棋前：' + JSON.stringify(run.R1悔棋前) + '）');
for (const r of run.R1) console.log('   ' + JSON.stringify(r));
console.log('\nR2 回看 → 回最新 → 连悔两次 ×3');
for (const r of run.R2) console.log('   ' + JSON.stringify(r));
console.log('\nR3 涨跌数字');
for (const r of run.R3) console.log('   第' + r.手 + '手 刚落=' + r.刚落 + ' 收敛后=' + r.收敛后 + ' 此后不变 ' + r.此后不变);
console.log('\nR4 刷新按钮 ' + JSON.stringify(run.R4));
console.log('\nR5 界面一致性 ' + JSON.stringify(run.R5));
ws.close();
