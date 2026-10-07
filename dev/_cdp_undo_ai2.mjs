/* 用**竞态压力**复现「AI 落子后马上悔棋 → 选点卡住」，并读分析链路的埋点定位。
 *
 * 为什么这么测：标准时序（等 AI 落完 → 立刻悔棋）跑了 10 轮**全都不卡**（0.74~0.92 秒恢复）。
 * 用户说"有时候会有时候不会" = 竞态。所以这里用更暴力的时序：
 *   · 悔棋延迟随机（0 / 30 / 80 / 150 / 300ms，覆盖"AI 刚落完"到"AI 思考中"）
 *   · 同时在 AI 思考期间插入「悔棋 / 再来一手 / 回看」等操作
 *   · 每轮都读 anaDiag（分析链路埋点）看它卡在哪一步
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

console.log('\n② 竞态压力：60 轮，悔棋延迟随机 0~400ms');
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
  const snap = () => ({
    手数: state.moves.length, 看: state.viewAt, noGame: !!state.noGame,
    candAt: state.candAt, rv: state.rootVisits, 点: state.candidates.length,
    busy: anaBusy, q: anaQueue.length, force: anaForceCur, ai: aiBusy,
    引擎: engineReady, 对弈: engineReadyPlay, 数子: scoreBusy, 复盘: reviewBusy,
    连: anaDiag.start + '/' + anaDiag.okCount + '/' + anaDiag.failOnce,
    中断: anaDiag.lastFailWhy,
    空跑: JSON.stringify(anaDiag.failEarly),
    跳越界: anaDiag.skipHuge,
  });
  settings.mode = 'play'; settings.size = 19; settings.myColor = 'b'; settings.color = 'b';
  settings.handicap = 0; settings.rules = 'chinese'; settings.visits = 500; settings.level = 'rank_5k';
  applyNewGame(); await sleep(1200);

  let stuck = 0;
  for (let round = 1; round <= 60; round++) {
    /* 保证局面有 4 手以上（别退到空盘） */
    let g = 0;
    while (state.moves.length < 4 && g++ < 24) {
      if (isMyTurn()) drop();
      const n = state.moves.length, t = Date.now();
      while (state.moves.length === n && Date.now() - t < 20000) await sleep(50);
    }
    if (!isMyTurn()) { const n = state.moves.length, t = Date.now(); while (state.moves.length === n && Date.now() - t < 20000) await sleep(50); }
    if (!drop()) break;
    const myLen = state.moves.length;
    /* 等 AI（有时故意只等一半就动手，制造"AI 还在想"的时序） */
    const delayMode = round % 3;
    if (delayMode === 2) {
      /* 等 AI 落子**之前**就悔棋（AI 思考中） */
      await sleep(200 + Math.random() * 300);
      if (state.moves.length === myLen) { $('btn-undo').click(); }
    } else {
      const t = Date.now();
      while (state.moves.length === myLen && Date.now() - t < 30000) await sleep(30);
      const d = [0, 0, 30, 80, 150, 300, 400][Math.floor(Math.random() * 7)];
      await sleep(d);
      if (state.viewAt === state.moves.length && state.moves.length > 0) $('btn-undo').click();
    }
    /* 等它恢复 */
    const t1 = Date.now();
    let took = null;
    while (Date.now() - t1 < 20000) {
      if ((state.candAt === state.viewAt && !anaBusy) || state.moves.length === 0 || state.noGame) { took = Date.now() - t1; break; }
      await sleep(30);
    }
    const 空盘 = (state.moves.length === 0 || state.noGame);
    if (took === null && !空盘) {
      stuck++;
      const before = snap();
      await sleep(12000);                       // 再等 12 秒看会不会自己好
      R.push({ 轮: round, 判定: '★ 卡住', 恢复ms: null, 卡住时: before, 再等12秒后: snap() });
    } else if (round % 10 === 0) {
      R.push({ 轮: round, 判定: 空盘 ? '（空盘）' : 'ok', 恢复ms: took, 快照: snap() });
    }
    /* 收拾：退到 3 手左右，别退空 */
    let g2 = 0;
    while (state.moves.length > 3 && g2++ < 40) { $('btn-undo').click(); await sleep(80); }
    await sleep(400);
  }
  return { 卡住轮数: stuck, 明细: R, 最终埋点: { start: anaDiag.start, ok: anaDiag.okCount, failOnce: anaDiag.failOnce,
    空跑: anaDiag.failEarly, 中断原因: anaDiag.breakAt, 跳越界: anaDiag.skipHuge } };
})()`, 1500000);

if (typeof out === 'string') { console.log('运行失败: ' + out); }
else {
  console.log('   卡住轮数 = ' + out.卡住轮数);
  for (const r of out.明细) console.log('   ' + JSON.stringify(r));
  console.log('\n   埋点汇总：' + JSON.stringify(out.最终埋点));
}
ws.close();
