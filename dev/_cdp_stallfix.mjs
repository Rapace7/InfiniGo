/* 验证「算过但没上屏」这个卡住状态：
 *   ① applyAnalysis 现在会**如实报告**有没有真上屏；
 *   ② shownAt 只在真上屏时才记 → 于是那个局面下一轮会**重新算**（不再是死结）；
 *   ③ 自愈网：即使人为把它造成卡住状态，6 秒后也会自己重算，不用用户再落一手。
 *
 * 对应用户 2026-10-07 的自检输出：
 *   「看第2手·选点: 还没算过·搜索量: 200·请求: 空闲·空跑0」
 *   —— 请求发过、回过进度，但 candAt 还是 -1，且没有任何待办 → 正是"被当成已显示"。 */
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

console.log('① 加载分析引擎…');
console.log('   ' + await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  if (!engineReady) await window.api.engine.load('analyze');
  const t0 = Date.now();
  while (!engineReady && Date.now() - t0 < 180000) await sleep(1000);
  return JSON.stringify({ 就绪: engineReady, 秒: Math.round((Date.now()-t0)/1000) });
})()`, 240000));

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = [];
  const ok = (name, got, want) => R.push({ 项: name, 得到: String(got), 期望: String(want), 结果: (String(got) === String(want)) ? '✓' : '★' });
  const note = s => R.push({ 项: s, 得到: '', 期望: '', 结果: '·' });
  const free = () => {
    const b = boardAt(state.moves.length), o = [];
    for (let y = 3; y < 16; y++) for (let x = 3; x < 16; x++) if (!b[y*N+x]) o.push([x, y]);
    return o;
  };
  const drop = () => { const f = free(); for (let i = 0; i < f.length; i++) if (tryPlay(f[i][0], f[i][1])) return true; return false; };

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  settings.visits = 500; state.showHints = true;
  applyNewGame(); await sleep(600);
  for (let k = 0; k < 4; k++) { drop(); await sleep(900); }
  await sleep(1500);
  note('前置：手数=' + state.moves.length + ' candAt=' + state.candAt + ' 候选点=' + state.candidates.length);

  /* ---------- ① applyAnalysis 的返回值要如实 ---------- */
  const fake = { root: { winrate: 0.5, scoreLead: 0, visits: 500, currentPlayer: 'B' }, moves: [] };
  const r1 = applyAnalysis(fake, state.viewAt);          // 正常情况 → true
  ok('applyAnalysis(正常局面) 返回 true', r1, 'true');
  const r2 = applyAnalysis(fake, state.viewAt - 1);      // 报文与当前局面不符 → false
  ok('applyAnalysis(报文与当前局面不符) 返回 false', r2, 'false');
  const r3 = applyAnalysis({ root: { winrate: 0.5, scoreLead: 0, visits: 5, currentPlayer: 'B' }, moves: [] }, state.viewAt);
  ok('applyAnalysis(搜索量太低) 返回 false', r3, 'false');
  const r4 = applyAnalysis(null, state.viewAt);
  ok('applyAnalysis(空结果) 返回 false', r4, 'false');

  /* ---------- ② 人为造成「算过但没上屏」，看自愈网会不会救 ---------- */
  const cur = state.viewAt;
  shownAt = cur;                 // 假装算过
  state.candAt = -1;             // 但没上屏
  anaForceCur = false;
  anaQueue = [];
  anaStallWatched = -1;          // 让自愈网愿意重新排
  const before = { shownAt: shownAt, candAt: state.candAt, busy: anaBusy };
  note('人为造出卡住状态：shownAt=' + cur + ' candAt=' + state.candAt + '（正是用户截图那个状态）');
  scheduleStallRecovery();       // 挂上自愈（正常由 scheduleAnalysis 自动挂）
  /* 等它自愈（设计上 6 秒后动手，给 20 秒余量） */
  let fixed = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    await sleep(200);
    if (state.candAt === cur && state.candidates.length > 0) { fixed = Math.round((Date.now() - t0) / 1000); break; }
  }
  ok('② 自愈网把卡住状态救回来了', fixed !== null, 'true');
  note('   自愈耗时 ' + fixed + ' 秒；救回后 candAt=' + state.candAt + ' 候选点=' + state.candidates.length);
  ok('② 自愈经过的路径被记进埋点', (anaDiag.breakAt['自愈：算过但没上屏'] || 0) > 0, 'true');

  /* ---------- ③ 再验一次「真上屏才记 shownAt」的链路 ---------- */
  const cur2 = state.viewAt;
  shownAt = -1; state.candAt = -1; anaForceCur = true; anaQueue = [cur2];
  scheduleAnalysis(0, true);
  const t1 = Date.now();
  let took = null;
  while (Date.now() - t1 < 15000) {
    if (state.candAt === cur2 && state.candidates.length > 0) { took = Date.now() - t1; break; }
    await sleep(100);
  }
  ok('③ 强制重算后候选点上屏', took !== null, 'true');
  ok('③ shownAt 与 candAt 一致', shownAt === state.candAt, 'true');
  return R;
})()`, 400000);

if (typeof out === 'string') { console.log('运行失败: ' + out); }
else {
  let bad = 0;
  for (const r of out) {
    if (r.结果 === '★') bad++;
    if (r.结果 === '·') console.log('    ' + r.项);
    else console.log('  ' + r.结果 + ' ' + r.项 + '：得到 ' + r.得到 + '（期望 ' + r.期望 + '）');
  }
  console.log('\n  ' + (bad === 0 ? '断言全部通过 ✓' : ('★ 有 ' + bad + ' 项不通过')));
}
ws.close();
