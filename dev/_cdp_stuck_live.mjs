/* 在**独立调试实例**（端口 9350）上复现「AI 落子后马上悔棋 → 候选点不显示」，
   卡住时把分析链路所有内部变量打出来。
 *
 * 与 _cdp_undo_ai2.mjs 的区别：
 *   · 连的是一个**长期开着**的实例（不是每次新起），所以能连着捶很多轮；
 *   · 判据更严：不只看 candAt，还要求**候选点真的有**（原来只比 candAt === viewAt，
 *     而用户截图里正是"没圈"却还在算，所以必须看 state.candidates.length）；
 *   · 卡住时打印 anaDiag（链路埋点）+ 完整的分析相关变量。 */
const PORT = 9350;
async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) { }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('连不上调试端口 ' + PORT);
}
const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise(res => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr, tmo) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 900000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

console.log('① 加载两个引擎…');
console.log('   ' + await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  if (!engineReady) await window.api.engine.load('analyze');
  if (!engineReadyPlay) await window.api.engine.load('play');
  const t0 = Date.now();
  while ((!engineReady || !engineReadyPlay) && Date.now() - t0 < 240000) await sleep(1000);
  return JSON.stringify({ 分析: engineReady, 对弈: engineReadyPlay, 秒: Math.round((Date.now()-t0)/1000) });
})()`, 300000));

console.log('\n② 反复「我落子 → AI 落子 → 极短延迟悔棋」，直到卡住或跑满 40 轮');
const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = [];
  const free = () => {
    const b = boardAt(state.moves.length), o = [];
    for (let y = 3; y < 16; y++) for (let x = 3; x < 16; x++) if (!b[y*N+x]) o.push([x, y]);
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); const t = o[i]; o[i] = o[j]; o[j] = t; }
    return o;
  };
  const drop = () => { const f = free(); for (let i = 0; i < 12 && i < f.length; i++) if (tryPlay(f[i][0], f[i][1])) return true; return false; };

  /* ★ 卡住判据：不光看 candAt，还要求**真有候选点** */
  const 选点齐全 = () => state.candAt === state.viewAt && state.candidates.length > 0 && !anaBusy;
  const 该有选点 = () => !state.noGame && state.moves.length > 0 && state.viewAt === state.moves.length
    && state.showHints && (settings.mode !== 'play' || isMyTurn());
  const 详单 = () => ({
    手数: state.moves.length, 看: state.viewAt, 轮谁: sideToMove(state.viewAt), 该我: isMyTurn(),
    noGame: state.noGame, showHints: state.showHints, mode: settings.mode,
    该有选点: 该有选点(),
    candAt: state.candAt, cands: state.candidates.length, rv: state.rootVisits,
    busy: anaBusy, q: anaQueue.length, force: anaForceCur, shownAt: shownAt,
    eng: engineReady, play: engineReadyPlay, 数子: scoreBusy, 复盘: reviewBusy,
    lastEval: state.lastEval ? +state.lastEval.blackWin.toFixed(3) : null,
    histLen: state.history.length,
    链路: anaDiag.start + '/成功' + anaDiag.okCount + '/空跑' + anaDiag.failOnce,
    空跑: JSON.stringify(anaDiag.failEarly),
    中断: anaDiag.lastFailWhy + ' @' + (anaDiag.lastAt ? new Date(anaDiag.lastAt).toLocaleTimeString() : '-'),
  });

  settings.mode = 'play'; settings.size = 19; settings.myColor = 'b'; settings.color = 'b';
  settings.handicap = 0; settings.rules = 'chinese'; settings.visits = 500; settings.level = 'rank_3d';
  applyNewGame(); await sleep(1500);
  /* 打开推荐点（用户截图里是开着的） */
  const chk = document.getElementById('chk-show');
  if (!chk.checked) { chk.checked = true; chk.onchange({ target: chk }); }
  await sleep(300);

  let 卡住 = false;
  for (let round = 1; round <= 40 && !卡住; round++) {
    let g = 0;
    while (state.moves.length < 4 && g++ < 30) {
      if (isMyTurn()) drop();
      const n = state.moves.length, t = Date.now();
      while (state.moves.length === n && Date.now() - t < 20000) await sleep(40);
    }
    if (!isMyTurn()) { const n = state.moves.length, t = Date.now(); while (state.moves.length === n && Date.now() - t < 20000) await sleep(40); }
    if (!drop()) break;
    const myLen = state.moves.length;
    /* 等 AI 应手 */
    const t0 = Date.now();
    while (state.moves.length === myLen && Date.now() - t0 < 60000) await sleep(20);
    if (state.moves.length === myLen) { R.push({ 轮: round, 说明: 'AI 没应手' }); break; }
    /* ★ 极短延迟悔棋 */
    const d = [0, 0, 0, 20, 50, 100, 200][Math.floor(Math.random() * 7)];
    await sleep(d);
    if (state.viewAt === state.moves.length) $('btn-undo').click();
    /* 等选点齐全 */
    const t1 = Date.now();
    let took = null;
    while (Date.now() - t1 < 25000) {
      if (选点齐全() || !该有选点()) { took = Date.now() - t1; break; }
      await sleep(25);
    }
    if (took === null && 该有选点()) {
      卡住 = true;
      const 当时 = 详单();
      await sleep(15000);                       // 再等 15 秒看会不会自愈
      R.push({ 轮: round, 判定: '卡住了', 悔棋延迟ms: d, 卡住当时: 当时, 再等15秒: 详单() });
      break;
    }
    if (round % 8 === 0) R.push({ 轮: round, 恢复ms: took, 快照: 详单() });
    /* 收拾：退到 3 手附近别退空 */
    let g2 = 0;
    while (state.moves.length > 3 && g2++ < 40) { $('btn-undo').click(); await sleep(70); }
    await sleep(300);
  }
  return { 卡住: 卡住, 明细: R, 最终埋点: { start: anaDiag.start, ok: anaDiag.okCount, failOnce: anaDiag.failOnce,
    空跑: anaDiag.failEarly, 中断原因: anaDiag.breakAt, 跳越界: anaDiag.skipHuge,
    最近中断: anaDiag.lastFailWhy } };
})()`, 1500000);

if (typeof out === 'string') { console.log('运行失败: ' + out); }
else {
  console.log('   卡住 = ' + out.卡住);
  for (const r of out.明细) console.log('   ' + JSON.stringify(r, null, 1).replace(/\n\s*/g, ' '));
  console.log('\n   埋点：' + JSON.stringify(out.最终埋点));
}
ws.close();
