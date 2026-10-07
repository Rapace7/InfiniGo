/* 复现「悔棋后 KataGo 分析停下来」——分段执行，每段独立返回，
   避免整段 promise 挂死导致什么都看不到（2026-10-06 前三版都栽在这）。
   用法：node _cdp_undo.mjs 1   → 加载引擎
        node _cdp_undo.mjs 2   → 落 10 手 + 等追上
        node _cdp_undo.mjs 3   → 悔棋 3 次 + 观察
        node _cdp_undo.mjs 4   → 再落一子看能否恢复 */
const PORT = 9333;
const STEP = process.argv[2] || '1';

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
/* 注意：不设 awaitPromise 之外的 timeout 隐患；每个表达式自带上限 */
async function js(expr, tmo) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 60000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const HELPERS = `
window.__undoProbe = { reqs: 0, wrLog: [] };
if (!window.__undoProbeInstalled) {
  window.__undoProbeInstalled = true;
  const oa = window.api.analyze;
  window.api.analyze = function(...a){ window.__undoProbe.reqs++; return oa.apply(this, a); };
}
window.__snap = () => ({
  moves: state.moves.length, viewAt: state.viewAt, shownAt: shownAt,
  candAt: state.candAt, visits: state.rootVisits,
  wr: document.getElementById('eval-wr').textContent,
  q: anaQueue.slice(), force: anaForceCur, busy: anaBusy, poke: anaPoke,
  reqs: window.__undoProbe.reqs,
  /* ★ 断言用：队列里不该有超过手数的项，history/leads 也不该比手数还长 */
  qBad: anaQueue.filter(at => at > state.moves.length).length,
  hLen: state.history.length, hNum: state.history.filter(x => typeof x === 'number').length,
  lLen: state.leads.length,
});
'setup ok'`;

let r;
if (STEP === '1') {
  r = await js(`(async function(){
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await window.api.engine.load('analyze');
    const t0 = Date.now();
    while (!engineReady && Date.now() - t0 < 80000) await sleep(500);
    return { ready: engineReady, waited: Math.round((Date.now()-t0)/1000) };
  })()`, 100000);
  console.log('STEP1 ' + JSON.stringify(r));
} else if (STEP === '2') {
  r = await js(HELPERS, 20000);
  console.log('setup ' + JSON.stringify(r));
  r = await js(`(async function(){
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    settings.mode = 'edit'; applyNewGame(); await sleep(300);
    const pts = [[3,3],[15,3],[3,15],[15,15],[9,3],[9,15],[3,9],[15,9],[9,9],[5,5]];
    for (const [x,y] of pts) { tryPlay(x,y); await sleep(150); }
    const t1 = Date.now();
    while (shownAt !== state.viewAt && Date.now() - t1 < 45000) await sleep(400);
    return window.__snap();
  })()`, 120000);
  console.log('STEP2 ' + JSON.stringify(r));
} else if (STEP === '3') {
  r = await js(HELPERS, 20000);
  const before = await js('JSON.stringify(window.__snap())', 15000);
  console.log('BEFORE ' + before);
  r = await js(`(async function(){
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    $('btn-undo').click(); await sleep(500);
    $('btn-undo').click(); await sleep(500);
    $('btn-undo').click(); await sleep(500);
    return window.__snap();
  })()`, 30000);
  console.log('AFTER_UNDO ' + JSON.stringify(r));
  /* 观察 25 秒：引擎还发不发请求、shownAt 追不追得上 */
  r = await js(`(async function(){
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const log = [];
    for (let i = 0; i < 10; i++) { await sleep(2500); log.push(window.__snap()); }
    return log;
  })()`, 60000);
  console.log('WATCH ' + JSON.stringify(r));
} else if (STEP === '4') {
  r = await js(HELPERS, 20000);
  r = await js(`(async function(){
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    tryPlay(11,11);
    const t = Date.now();
    while (shownAt !== state.viewAt && Date.now() - t < 30000) await sleep(400);
    return window.__snap();
  })()`, 60000);
  console.log('STEP4 ' + JSON.stringify(r));
}
ws.close();