/* 复现：**人机对弈**下「AI 落子后很短时间内点悔棋」→ 选点/形势卡住不显示。
 *
 * 用户描述（2026-10-07）：
 *   「在我落子后，AI 落子后很短时间内我点击悔棋的话，
 *     然后 katago 的选点推荐和形势分析就会突然卡住不显示，有时候不会，有时候会」。
 *
 * 与我之前测过的场景的关键差别：**这是人机对弈**（两个引擎在跑、AI 那条链路也在动），
 * 而且悔棋发生在 AI 刚落完子的极短时间内（几百毫秒）。
 * 之前我测的是「摆棋模式 + 手动落子」，所以没复现。
 *
 * 计时口径：从点悔棋到 state.candAt === state.viewAt（选点刷新到新局面）。
 * 超过 20 秒算卡住。每轮都把内部状态记下来，卡住时好定位。 */
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 600000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

console.log('① 加载两个引擎（分析 + 对弈）…');
console.log('   ' + await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  if (!engineReady) await window.api.engine.load('analyze');
  if (!engineReadyPlay) await window.api.engine.load('play');
  const t0 = Date.now();
  while ((!engineReady || !engineReadyPlay) && Date.now() - t0 < 240000) await sleep(1000);
  return JSON.stringify({ 分析引擎: engineReady, 对弈引擎: engineReadyPlay, 等了秒: Math.round((Date.now()-t0)/1000) });
})()`, 300000));
if (!(await js('engineReady && engineReadyPlay'))) { console.log('★ 引擎没起来，放弃'); ws.close(); process.exit(1); }

console.log('\n② 人机对弈：反复「我落子 → 等 AI 落子 → 立刻悔棋」，看选点会不会卡');
const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = [];
  const free = () => {
    const b = boardAt(state.moves.length), out = [];
    for (let y = 3; y < 16; y++) for (let x = 3; x < 16; x++) if (!b[y*N+x]) out.push([x, y]);
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); const t = out[i]; out[i] = out[j]; out[j] = t; }
    return out;
  };
  const drop = () => { const f = free(); for (let i = 0; i < 12 && i < f.length; i++) if (tryPlay(f[i][0], f[i][1])) return true; return false; };

  /* 人机对弈、我执黑、低段位（AI 快一点，好制造"很短时间"） */
  settings.mode = 'play'; settings.size = 19; settings.myColor = 'b'; settings.color = 'b';
  settings.handicap = 0; settings.rules = 'chinese'; settings.visits = 500;
  settings.level = 'rank_5k';
  applyNewGame(); await sleep(1200);

  for (let round = 1; round <= 10; round++) {
    /* ★ 先铺 3 手底子，免得悔棋直接退到空盘 ——
       空盘（state.noGame 或 moves.length===0）本来就不发分析请求、也不画选点，
       拿它当"卡住"是**假警报**（第一版就栽在这儿：10 轮全报卡住，
       其实 viewAt 都是 0）。 */
    let guard0 = 0;
    while (state.moves.length < 4 && guard0++ < 20) {
      if (isMyTurn()) { if (!drop()) break; }
      const n = state.moves.length;
      const t = Date.now();
      while (state.moves.length === n && Date.now() - t < 30000) await sleep(60);
      await sleep(150);
    }
    /* 我落一手 */
    if (!isMyTurn()) { const t = Date.now(); const n = state.moves.length; while (state.moves.length === n && Date.now() - t < 30000) await sleep(60); }
    if (!drop()) { R.push({ 轮: round, 说明: '没空点了' }); break; }
    const myLen = state.moves.length;
    /* 等 AI 应手（AI 落子后 moves.length 会 +1） */
    const t0 = Date.now();
    while (state.moves.length === myLen && Date.now() - t0 < 60000) await sleep(50);
    const aiDone = Date.now();
    if (state.moves.length === myLen) { R.push({ 轮: round, 说明: 'AI 60 秒没应手' }); break; }
    const aiLen = state.moves.length;
    /* ★ 关键：AI 刚落完就**立刻**悔棋（这是用户说的"很短时间内"） */
    $('btn-undo').click();
    const t1 = Date.now();
    const 空盘 = (state.moves.length === 0 || state.noGame);
    /* 等选点追上新局面：有上限，超了就算卡住（空盘除外 —— 那种情况本来就不该有选点） */
    let took = null;
    while (Date.now() - t1 < 20000) {
      if (state.candAt === state.viewAt || state.moves.length === 0 || state.noGame) { took = Date.now() - t1; break; }
      await sleep(30);
    }
    const s = {
      轮: round,
      AI应手间隔ms: aiDone - t0,
      悔棋前手数: aiLen,
      悔棋后手数: state.moves.length,
      退到空盘了: 空盘,
      '选点恢复ms': took,
      卡住: (took === null && !空盘) ? '★ 是' : (空盘 ? '（空盘，不判）' : '否'),
      noGame: state.noGame,
      candAt: state.candAt,
      viewAt: state.viewAt,
      搜索量: state.rootVisits,
      候选点数: state.candidates.length,
      请求在跑: anaBusy,
      欠账: anaQueue.length,
      待重算: anaForceCur,
      AI在忙: aiBusy,
      试下: !!state.draft,
      结果条: !!state.result,
    };
    R.push(s);
    if (took === null && !空盘) {
      /* 卡住了：再等 15 秒看它会不会自己好 */
      const t2 = Date.now();
      while (Date.now() - t2 < 15000) {
        await sleep(100);
        if (state.candAt === state.viewAt && !anaBusy) break;
      }
      R.push({ 轮: round, 说明: '再等 15 秒后', 好了: (state.candAt === state.viewAt && !anaBusy) ? '✓ 自己好了' : '★ 仍然卡着',
               candAt: state.candAt, viewAt: state.viewAt, anaBusy: anaBusy, 欠账: anaQueue.length,
               待重算: anaForceCur, 引擎就绪: engineReady, 对弈引擎: engineReadyPlay, 超时计数: anaTimeouts });
    }
    /* 下一轮前把局面收拾干净：退到我方、但别退到空盘（退到 2 手就停） */
    let guard = 0;
    while (state.moves.length > 3 && guard++ < 40) { $('btn-undo').click(); await sleep(120); }
    await sleep(600);
  }
  return R;
})()`, 900000);

if (typeof out === 'string') { console.log('运行失败: ' + out); }
else {
  let stuck = 0;
  for (const r of out) {
    if (r.卡住 === '★ 是') stuck++;
    console.log('   ' + JSON.stringify(r));
  }
  console.log('\n   共 ' + out.filter(x => x.卡住).length + ' 轮有判定，其中 ★ 卡住 ' + stuck + ' 轮');
}
ws.close();
