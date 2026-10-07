/* 诊断：为什么 rememberEval 的搜索量门槛没挡住覆盖？
   直接打印每一次调用的入参和门槛判断的中间量（target / old / v / settled / better）。 */
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 180000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

/* 不改行为：把每次调用前后的 history / histVisits / settings.visits 都拍下来 */
const HOOK = `
window.__diag = [];
(function(){
  const orig = rememberEval;
  window.rememberEval = function(at, w, l, v) {
    const rec = {
      at: at, v: v, target: settings.visits, AV: ANALYZE_VISITS,
      before_hist: state.history[at], before_hv: state.histVisits[at],
      hvArr: state.histVisits.length, histArr: state.history.length,
      moves: state.moves.length, draft: !!state.draft,
    };
    const r = orig.apply(this, arguments);
    rec.after_hist = state.history[at]; rec.after_hv = state.histVisits[at];
    rec.写进去了 = rec.before_hist !== rec.after_hist;
    window.__diag.push(rec);
    return r;
  };
})();
'diag ok'`;
const p0 = await js(HOOK, 15000);
console.log('钩子: ' + p0);
if (p0 !== 'diag ok') { ws.close(); process.exit(1); }

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
  settings.mode = 'setup'; settings.size = 19; settings.handicap = 0;
  settings.rules = 'chinese'; settings.visits = 500; state.showHints = true;
  applyNewGame();
  await sleep(900);
  const free = () => {
    const b = boardAt(state.moves.length), out = [];
    for (let y = 2; y < 17; y++) for (let x = 2; x < 17; x++) if (!b[y*N+x]) out.push([x,y]);
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); const t = out[i]; out[i] = out[j]; out[j] = t; }
    return out;
  };
  const drop = () => { const f = free(); for (let i = 0; i < 12 && i < f.length; i++) if (tryPlay(f[i][0], f[i][1])) return true; return false; };
  const shown = () => Array.from(document.querySelectorAll('#movelist li')).map(li => li.querySelector('.dl')?.textContent || '—').join(' ');
  const seqLog = [];
  for (let k = 0; k < 3; k++) {
    drop();
    await sleep(700);  seqLog.push({ 时点: '第'+(k+1)+'手刚落', 列表: shown(), hv: JSON.stringify(state.histVisits) });
    await sleep(4000); seqLog.push({ 时点: '第'+(k+1)+'手等4s', 列表: shown(), hv: JSON.stringify(state.histVisits) });
  }
  return { seqLog, diag: window.__diag, hv: state.histVisits.slice() };
})()`, 300000);

if (typeof run === 'string') { console.log('运行失败: ' + run); ws.close(); process.exit(1); }
console.log('\n列表变化：');
for (const s of run.seqLog) console.log('  ' + s.时点.padEnd(12) + ' ' + s.列表 + '   histVisits=' + s.hv);

console.log('\n每次 rememberEval 调用（★ = 实际改写了 history）：');
for (const d of run.diag) {
  console.log(`  at=${d.at} v=${String(d.v).padStart(4)} target=${d.target} AV=${d.AV} 旧值=${d.before_hist === undefined ? '空' : (d.before_hist*100).toFixed(2)} 旧精度=${d.before_hv === undefined ? '空' : d.before_hv} 手数=${d.moves} hvLen=${d.hvArr} histLen=${d.histArr} ${d.写进去了 ? '★ 写入 → ' + (d.after_hist*100).toFixed(2) + ' 精度' + d.after_hv : '（被门槛挡住）'}`);
}
ws.close();
