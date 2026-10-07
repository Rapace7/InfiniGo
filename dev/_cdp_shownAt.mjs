/* 精确复现并锁定 v0.1.18 修的那个死结：
 *   「看过第 N 手」+「悔棋退到更早的一手」→ candAt 被清成 -1、但 shownAt 留着
 *   → runAnalysis 判「已算过」跳过、scheduleAnalysis 又因 history 有值不入队
 *   → 那个局面永远不再分析（界面：计算中… N 定住、推荐点永远不出来）。
 *
 * 这是从《分析链路.log》里逮到的实据：
 *   showAt=2 candAt=-1 busy=false force=false hist[2]=有
 *   ★ run 认为已算过但 candAt=-1 ≠ viewAt=2
 *
 * 断言分两层：
 *   ① 单元层：清 candAt 时 shownAt 必须一起清（要废一起废）；
 *   ② 场景层：落 8 手 → 回看第 2 手 → 回最新 → 悔棋退到第 2 手 → 第 2 手的选点必须能重新上屏。 */
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
  const ok = (n, g, w) => R.push({ 项: n, 得到: String(g), 期望: String(w), 结果: (String(g) === String(w)) ? '✓' : '★' });
  const note = s => R.push({ 项: s, 得到: '', 期望: '', 结果: '·' });
  const free = () => { const b = boardAt(state.moves.length), o = []; for (let y = 3; y < 16; y++) for (let x = 3; x < 16; x++) if (!b[y*N+x]) o.push([x, y]); return o; };
  const drop = () => { const f = free(); for (let i = 0; i < f.length; i++) if (tryPlay(f[i][0], f[i][1])) return true; return false; };

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  settings.visits = 500; state.showHints = true;
  applyNewGame(); await sleep(600);

  /* ---------- ① 单元层：清 candAt 时 shownAt 必须一起清 ---------- */
  state.moves = []; state.viewAt = 0;
  for (let k = 0; k < 6; k++) { const f = free(); state.moves.push({ x: f[0][0], y: f[0][1], color: k % 2 ? 'w' : 'b', pass: false, captured: 0 }); }
  state.viewAt = 6;
  state.candAt = 6; shownAt = 6;                 // 模拟"看过第 6 手"
  note('造场景：candAt=6 shownAt=6，现在截断到 2 手（悔棋退到第 2 手）');
  truncateAnalysisTo(2);
  ok('① 截断后 candAt 被清', state.candAt, -1);
  ok('① 截断后 shownAt 也必须被清（要废一起废）', shownAt, -1);

  /* 反向：candAt 还有效（等于新长度）时，shownAt 不该被误清 */
  state.candAt = 2; shownAt = 2;
  truncateAnalysisTo(4);                          // 4 ≥ 2，candAt 仍有效
  ok('② candAt 有效时不被清', state.candAt, 2);
  ok('② 此时 shownAt 也不该被清', shownAt, 2);

  /* ---------- ③ 场景层：真走一遍「回看 → 回最新 → 悔棋退到早先看过的那一手」 ---------- */
  applyNewGame(); await sleep(500);
  const chk = document.getElementById('chk-show');
  if (!chk.checked) { chk.checked = true; chk.onchange({ target: chk }); }
  for (let k = 0; k < 8; k++) { drop(); await sleep(700); }
  await sleep(1500);
  note('落 8 手后：手数=' + state.moves.length + ' candAt=' + state.candAt + ' 候选点=' + state.candidates.length);

  /* 回看第 2 手（让 showAt 停在 2），再回最新 */
  gotoView(2); await sleep(900);
  note('回看第 2 手后：viewAt=' + state.viewAt + ' shownAt=' + shownAt + ' candAt=' + state.candAt);
  gotoView(state.moves.length); await sleep(1200);
  note('回最新后：viewAt=' + state.viewAt + ' shownAt=' + shownAt + ' candAt=' + state.candAt);

  /* ★ 关键：悔棋退到第 2 手 —— 这正是当初死结的现场 */
  let guard = 0;
  while (state.moves.length > 2 && guard++ < 20) { $('btn-undo').click(); await sleep(120); }
  note('悔棋退到第 ' + state.moves.length + ' 手：shownAt=' + shownAt + ' candAt=' + state.candAt + ' busy=' + anaBusy);
  ok('③ 退到第2手时 shownAt 与 candAt 一致（不再一真一假）', shownAt === state.candAt, 'true');

  /* 等第 2 手的选点上屏（这正是原来永远等不到的东西） */
  let took = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (state.candAt === state.viewAt && state.candidates.length > 0) { took = Date.now() - t0; break; }
    await sleep(50);
  }
  ok('③ 第2手的选点重新上屏（原死结处）', took !== null, 'true');
  note('   耗时 ' + took + ' ms；candAt=' + state.candAt + ' 候选点=' + state.candidates.length);
  ok('③ 链路里没有出现「认为已算过但 candAt 不符」', (anaDiag.breakAt['认为已算过但candAt不符'] || 0) === 0, 'true');
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
