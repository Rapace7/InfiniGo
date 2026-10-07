/* 复现「KataGo 选点不显示 + 棋盘上方『计算中… 数字』定住不动」。
 *
 * 用户报的症状（2026-10-06 晚，两次描述）：
 *   ① 有时候推荐选点整块不显示；
 *   ② 棋盘上方那行「计算中… 320」定在一个数字上，一直不动；
 *   ③ 好像跟悔棋有关；
 *   ④ ★ 补充：出现卡死之前**点过前面的手数**（回看历史局面），还有悔棋。
 *
 * 症状对应的代码事实（先钉死，免得瞎猜）：
 *   · 「计算中… N」画在 draw() 里，条件是 `state.showHints && !hintsFresh`，
 *     N = state.rootVisits（只在 applyAnalysis 里更新）。
 *   · hintsFresh = (state.candAt === state.viewAt) —— 选点跟上了就不画「计算中」。
 *   · 「定住不动」= applyAnalysis 再没被调用 / 或调用了但 totalV < 20 提前返回。
 *   · 唯一能整体挡住 applyAnalysis 的是「单飞」闸门 anaBusy：它一卡住，
 *     分析队列就不再推进 —— 选点不刷新、rootVisits 不涨，两条症状同时成立。
 *
 * 场景（对应 ④ 的时序）：
 *   A 回看旧手 → 回最新 → 悔棋 → 再下
 *   B 回看旧手（多次连点） → 直接悔棋
 *   C 落子 → 悔棋 → 回看旧手 → 悔棋
 *   D 快速连点手数列表（分析请求被反复打断）
 *
 *   node _cdp_stuck.mjs [场景] [轮数]
 */
const PORT = 9333;
/* ⚠️ 参数走**环境变量**，不走 argv —— _rtest.py 的调用约定是
     `_rtest.py <测试脚本> <截图名> <第二段脚本> <第二张截图名>`，
   第 2 个位置参数会被它当成截图文件名的前缀，传不进脚本里。 */
const SCEN = (process.env.STUCK_SCEN || 'A').toUpperCase();
const ROUNDS = parseInt(process.env.STUCK_ROUNDS || '20', 10);

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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 120000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const PROBE = `
window.__stuck = () => ({
  moves: state.moves.length, viewAt: state.viewAt, noGame: !!state.noGame,
  candAt: state.candAt, shownAt: shownAt, rootVisits: state.rootVisits,
  cands: state.candidates.length, hintsFresh: state.candAt === state.viewAt,
  busy: anaBusy, force: anaForceCur, q: JSON.stringify(anaQueue),
  histLen: state.history.length, gen: gameGen, reqGen: anaReqGen,
  engReady: engineReady, scoreBusy: scoreBusy, reviewBusy: reviewBusy,
  mode: settings.mode,
});
/* 看门狗：每 150ms 采一次，盯着 anaBusy。它一旦连续 busyMs 超过 6 秒就是**请求没回来**，
   这是「卡死」最硬的证据（不是慢，是永远不回来）。顺手把当时的局面记下来。 */
window.__watch = { start() {
  if (this.t) return;
  this.hist = []; this.stuck = [];
  this.t = setInterval(() => {
    const s = window.__stuck();
    this.hist.push(Date.now() + ':' + s.busy + '/' + s.viewAt + '/' + s.candAt + '/' + s.rootVisits);
    if (this.hist.length > 400) this.hist.shift();
    if (s.busy) {
      if (!this.busySince) { this.busySince = Date.now(); this.busySnap = s; }
      if (Date.now() - this.busySince > 6000) {
        this.stuck.push({ 持续毫秒: Date.now() - this.busySince, 卡住时: s, 最后20条: this.hist.slice(-20) });
        this.busySince = 0;
      }
    } else this.busySince = 0;
  }, 150);
}, stop() { clearInterval(this.t); this.t = null; return { 卡住次数: this.stuck.length, 明细: this.stuck }; } };
'watch ok'`;

const p0 = await js(PROBE, 15000);
if (p0 !== 'watch ok') { console.log('探针注入失败: ' + p0); ws.close(); process.exit(1); }

const load = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  if (engineReady) return { 已就绪: true };
  await window.api.engine.load('analyze');
  const t0 = Date.now();
  while (!engineReady && Date.now() - t0 < 180000) await sleep(1000);
  return { 就绪: engineReady, 等了秒: Math.round((Date.now()-t0)/1000) };
})()`, 200000);
console.log('引擎 ' + JSON.stringify(load));
if (!load || !load.就绪) { console.log('引擎没起来，放弃'); ws.close(); process.exit(1); }

const body = {
  /* A：回看旧手 → 回最新 → 悔棋 → 再下（最贴近用户的描述） */
  A: `
    for (let r = 0; r < ROUNDS; r++) {
      for (let k = 0; k < 5; k++) { drop(); await sleep(320); }
      await sleep(500);
      gotoView(2); await sleep(260);          // 回看第 2 手
      gotoView(1); await sleep(200);          // 再往前点
      gotoView(state.moves.length); await sleep(260);  // 回到最新
      $('btn-undo').click(); await sleep(400);         // 悔棋
      $('btn-undo').click(); await sleep(400);         // 再悔棋
      await sleep(1200);
      while (state.moves.length > 3) $('btn-undo').click();
      await sleep(400);
    }`,
  /* B：★ 用**真实点击**手数列表（用户说的「点以前的手数看局面」就是点这里）
        → 再点悔棋按钮。列表 li 的 onclick 绑在 renderMoveList 里，点它走 gotoView。 */
  B: `
    const clickMove = n => {
      const li = document.querySelector('#movelist li[data-n="' + n + '"]');
      if (li) li.click();
      return !!li;
    };
    for (let r = 0; r < ROUNDS; r++) {
      for (let k = 0; k < 6; k++) { drop(); await sleep(300); }
      await sleep(400);
      clickMove(2); await sleep(240);              // 点第 2 手
      clickMove(1); await sleep(200);              // 再点第 1 手
      clickMove(3); await sleep(220);
      $('btn-undo').click(); await sleep(180);     // 回看中悔棋（应提示「先跳到最新」）
      clickMove(state.moves.length); await sleep(260);  // 点最后一手＝回最新
      $('btn-undo').click(); await sleep(500);
      clickMove(1); await sleep(160);
      clickMove(state.moves.length); await sleep(200);
      $('btn-undo').click(); await sleep(900);
      while (state.moves.length > 3) $('btn-undo').click();
      await sleep(400);
    }`,
  /* C：落子 → 悔棋 → 点旧手 → 悔棋（混合） */
  C: `
    const clickMove = n => {
      const li = document.querySelector('#movelist li[data-n="' + n + '"]');
      if (li) li.click();
      return !!li;
    };
    for (let r = 0; r < ROUNDS; r++) {
      for (let k = 0; k < 4; k++) { drop(); await sleep(280); }
      $('btn-undo').click(); await sleep(240);
      clickMove(1); await sleep(240);
      clickMove(state.moves.length); await sleep(200);
      $('btn-undo').click(); await sleep(240);
      clickMove(Math.max(1, state.moves.length - 2)); await sleep(200);
      clickMove(state.moves.length); await sleep(220);
      $('btn-undo').click(); await sleep(800);
      while (state.moves.length > 3) $('btn-undo').click();
      await sleep(400);
    }`,
  /* D：★ 用滑块（input 事件）+ 手数列表狂点，再悔棋 —— 最暴力的打断方式 */
  D: `
    const slide = v => {
      const s = document.getElementById('slider');
      s.value = String(v);
      s.dispatchEvent(new Event('input', { bubbles: true }));
    };
    for (let r = 0; r < ROUNDS; r++) {
      for (let k = 0; k < 6; k++) { drop(); await sleep(240); }
      const n = state.moves.length;
      for (let k = 0; k < 30; k++) { slide(1 + (k % Math.max(1, n))); await sleep(40); }
      slide(n); await sleep(280);
      $('btn-undo').click(); await sleep(200);
      slide(1); await sleep(110);
      slide(n); await sleep(200);
      $('btn-undo').click(); await sleep(1300);
      while (state.moves.length > 3) $('btn-undo').click();
      await sleep(400);
    }`,
  /* E：人机对弈模式（AI 会同时抢引擎）+ 回看 + 悔棋 —— 最接近用户真实用法 */
  E: `
    const clickMove = n => {
      const li = document.querySelector('#movelist li[data-n="' + n + '"]');
      if (li) li.click();
    };
    settings.mode = 'play'; settings.myColor = 'b'; settings.color = 'b';
    settings.visits = 500;
    applyNewGame(); await sleep(600);
    for (let r = 0; r < Math.max(3, Math.floor(ROUNDS/2)); r++) {
      drop();                                   // 我落一手 → AI 应当应手
      const t = Date.now();
      const want = state.moves.length + 1;
      while (state.moves.length < want && Date.now() - t < 40000) await sleep(200);
      await sleep(600);
      if (state.moves.length >= 2) { clickMove(1); await sleep(220); }
      clickMove(state.moves.length); await sleep(240);
      $('btn-undo').click(); await sleep(500);   // 悔棋（人机模式下会连撤到轮我）
      await sleep(1200);
      if (state.moves.length > 6) { while (state.moves.length > 4) { $('btn-undo').click(); await sleep(200); } }
      await sleep(400);
    }`,
}[SCEN];

if (!body) { console.log('未知场景 ' + SCEN); ws.close(); process.exit(1); }

const run = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ROUNDS = ${ROUNDS};
  window.__watch.start();
  settings.mode = 'setup'; settings.size = 19; settings.handicap = 0;
  settings.rules = 'chinese'; settings.visits = 500; state.showHints = true;
  applyNewGame();
  await sleep(800);
  /* 随机取样落子：固定取 f[0] 会让棋子挤成一团、互相提吃，局面容易变成打劫禁着点，
     于是 tryPlay 反复失败、手数不涨 —— 那样根本测不到分析链路。取 1/3 处的点更分散。 */
  const free = () => {
    const b = boardAt(state.moves.length), out = [];
    for (let y = 2; y < 17; y++) for (let x = 2; x < 17; x++) if (!b[y*N+x]) out.push([x,y]);
    /* 打乱（Fisher-Yates）后返回 —— 保证每次落点都不一样、且不重复落在同一处 */
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); const t = out[i]; out[i] = out[j]; out[j] = t; }
    return out;
  };
  /* 落一手（失败就换点重试，最多 12 次）；返回是否真的落上了 */
  const drop = () => {
    const f = free();
    for (let i = 0; i < Math.min(12, f.length); i++) { if (tryPlay(f[i][0], f[i][1])) return true; }
    return false;
  };
  const marks = [];
  try {
    ${body}
  } catch (e) { marks.push('循环抛错: ' + e.message); }
  /* 停手 15 秒，看它能不能自己收敛 */
  const before = window.__stuck();
  const t0 = Date.now();
  let recovered = null;
  while (Date.now() - t0 < 15000) {
    await sleep(500);
    const s = window.__stuck();
    if (s.candAt === s.viewAt && s.rootVisits > 0 && !s.busy) { recovered = Math.round((Date.now()-t0)/1000); break; }
  }
  const after = window.__stuck();
  const w = window.__watch.stop();
  return { marks, before, after, 收敛秒: recovered, 看门狗: w };
})()`, 900000);

if (typeof run === 'string') { console.log('运行失败: ' + run); ws.close(); process.exit(1); }

console.log('\n场景 ' + SCEN + ' 轮数 ' + ROUNDS);
console.log('异常标记: ' + JSON.stringify(run.marks));
console.log('停手前  ' + JSON.stringify(run.before));
console.log('停手15s ' + JSON.stringify(run.after));
console.log('收敛耗时: ' + (run.收敛秒 === null ? '★ 没收敛（卡死）' : run.收敛秒 + ' 秒'));
console.log('看门狗  : 卡住 ' + run.看门狗.卡住次数 + ' 次');
for (const s of run.看门狗.明细) {
  console.log('  ── 持续 ' + s.持续毫秒 + 'ms  ' + JSON.stringify(s.卡住时));
  console.log('     最后20条 ' + s.最后20条.join(' '));
}
ws.close();
