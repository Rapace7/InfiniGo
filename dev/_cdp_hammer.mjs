/* 猛捶版复现：在**带完整日志**的调试实例上，用最暴力的时序撞「选点卡住」。
 *
 * 与前面几版的区别（前面都是"礼貌地等它恢复"，撞不出竞态）：
 *   · 落子与悔棋的间隔随机到 **0~50ms**（人类手速的极限）
 *   · 一半的轮次**在 AI 思考中途**就悔棋（不等它落子）
 *   · 穿插「连点悔棋」「回看再回最新」「切显示开关」等操作
 *   · 全程不等待恢复 —— 撞的就是"请求在飞的时候局面又变"
 * 卡住判据：该有选点时 candAt !== viewAt 且连续 25 秒没恢复（空盘/非我回合不算）。 */
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
  throw new Error('连不上 ' + PORT);
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

console.log('\n② 猛捶 80 轮（间隔 0~50ms，一半在 AI 思考中悔棋）');
const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = [];
  const free = () => { const b = boardAt(state.moves.length), o = []; for (let y = 3; y < 16; y++) for (let x = 3; x < 16; x++) if (!b[y*N+x]) o.push([x, y]); return o; };
  const drop = () => { const f = free(); for (let i = 0; i < 12 && i < f.length; i++) if (tryPlay(f[i][0], f[i][1])) return true; return false; };
  const 该有选点 = () => !state.noGame && state.moves.length > 0 && state.viewAt === state.moves.length
    && state.showHints && (settings.mode !== 'play' || isMyTurn());
  const 快照 = () => ({ 手数: state.moves.length, 看: state.viewAt, 轮谁: sideToMove(state.viewAt), 该我: isMyTurn(),
    candAt: state.candAt, cands: state.candidates.length, rv: state.rootVisits, busy: anaBusy, q: anaQueue.length,
    force: anaForceCur, shownAt: shownAt, 自愈次: anaStallTries, 自愈监视: anaStallWatched,
    链路: anaDiag.start + '/成功' + anaDiag.okCount + '/空跑' + anaDiag.failOnce, 中断: anaDiag.lastFailWhy });

  settings.mode = 'play'; settings.size = 19; settings.myColor = 'b'; settings.color = 'b';
  settings.handicap = 0; settings.rules = 'chinese'; settings.visits = 500; settings.level = 'rank_3d';
  applyNewGame(); await sleep(1200);
  const chk = document.getElementById('chk-show');
  if (!chk.checked) { chk.checked = true; chk.onchange({ target: chk }); }
  const chkTerr = document.getElementById('chk-terr');
  if (!chkTerr.checked) { chkTerr.checked = true; chkTerr.onchange({ target: chkTerr }); }   // 开形势（多一条数据流）
  await sleep(400);

  let 卡住 = false;
  for (let round = 1; round <= 80 && !卡住; round++) {
    /* 保证有 4 手以上 */
    let g = 0;
    while (state.moves.length < 4 && g++ < 30) {
      if (isMyTurn()) drop();
      const n = state.moves.length, t = Date.now();
      while (state.moves.length === n && Date.now() - t < 20000) await sleep(30);
    }
    if (!isMyTurn()) { const n = state.moves.length, t = Date.now(); while (state.moves.length === n && Date.now() - t < 20000) await sleep(30); }
    if (!drop()) break;
    const myLen = state.moves.length;
    const 模式 = round % 4;
    if (模式 === 0 || 模式 === 3) {
      /* ★ 不等 AI：随机 0~50ms 就悔棋（AI 多半还在思考） */
      await sleep(Math.floor(Math.random() * 50));
      if (state.viewAt === state.moves.length && state.moves.length > 0) $('btn-undo').click();
      await sleep(Math.floor(Math.random() * 50));
      if (state.viewAt === state.moves.length && state.moves.length > 0) $('btn-undo').click();
    } else {
      /* 等 AI 落子，然后 0~50ms 内悔棋 */
      const t0 = Date.now();
      while (state.moves.length === myLen && Date.now() - t0 < 40000) await sleep(10);
      await sleep(Math.floor(Math.random() * 50));
      if (state.viewAt === state.moves.length && state.moves.length > 0) $('btn-undo').click();
      if (模式 === 1) { $('btn-undo').click(); }     // 连悔两次
    }
    /* 再随机穿插：回看一手 → 回最新 */
    if (round % 5 === 0 && state.moves.length > 2) {
      const v = Math.max(1, state.moves.length - 2);
      gotoView(v); await sleep(20); gotoView(state.moves.length);
    }
    /* 检查是否卡住（该有选点时，25 秒内没恢复） */
    const t1 = Date.now();
    let took = null;
    while (Date.now() - t1 < 25000) {
      if (!该有选点() || state.candAt === state.viewAt) { took = Date.now() - t1; break; }
      await sleep(25);
    }
    if (took === null && 该有选点()) {
      卡住 = true;
      R.push({ 轮: round, 判定: '★★ 卡住（25 秒未恢复）', 快照: 快照() });
      await sleep(20000);
      R.push({ 轮: round, 判定: '再等 20 秒后', 快照: 快照() });
      break;
    }
    if (round % 20 === 0) R.push({ 轮: round, 判定: 'ok', 恢复ms: took, 快照: 快照() });
    let g2 = 0;
    while (state.moves.length > 3 && g2++ < 40) { $('btn-undo').click(); await sleep(40); }
    await sleep(150);
  }
  return { 卡住: 卡住, 明细: R };
})()`, 1800000);

if (typeof out === 'string') { console.log('运行失败: ' + out); }
else {
  console.log('   卡住 = ' + out.卡住);
  for (const r of out.明细) console.log('   ' + JSON.stringify(r));
}
ws.close();
