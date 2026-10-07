/* 诊断（分步、每步都兜住异常）：打开棋谱 + 加载引擎后为什么没有推荐点 */
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 120000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

console.log('1 别的东西在不在: ' + await js(`JSON.stringify({
  state: typeof state, applyRecord: typeof applyRecord, settings: typeof settings,
  engineReady: typeof engineReady, anaBusy: typeof anaBusy, anaQueue: typeof anaQueue,
  anaForceCur: typeof anaForceCur, shownAt: typeof shownAt, isMyTurn: typeof isMyTurn,
  toGTP: typeof toGTP, N: typeof N, recordsApi: typeof (window.api && window.api.records),
})`));

console.log('2 records.list 原始返回: ' + await js(`(async function(){
  try { const r = await window.api.records.list(); return JSON.stringify(r).slice(0, 400); }
  catch(e) { return 'ERR ' + e.message; }
})()`));

console.log('3 打开棋谱: ' + await js(`(async function(){
  try {
    const list = await window.api.records.list();
    const files = (list && (list.files || list.list || list)) || [];
    const names = (Array.isArray(files) ? files : []).map(f => (typeof f === 'string' ? f : (f.name || f.file))).filter(Boolean);
    if (!names.length) return '棋谱库空';
    const rd = await window.api.records.read(names[0]);
    if (!rd || rd.error) return '读失败 ' + JSON.stringify(rd);
    applyRecord(rd, names[0]);
    return 'ok 手数=' + state.moves.length + ' viewAt=' + state.viewAt + ' noGame=' + state.noGame;
  } catch(e) { return 'ERR ' + e.message + ' @ ' + (e.stack||'').split('\\n')[1]; }
})()`));

console.log('4 加载引擎: ' + await js(`(async function(){
  try {
    await window.api.engine.load('analyze');
    const t0 = Date.now();
    while (!engineReady && Date.now()-t0 < 120000) await new Promise(r=>setTimeout(r,1000));
    return 'ready=' + engineReady + ' 等了' + Math.round((Date.now()-t0)/1000) + '秒 note=' + JSON.stringify(engineNote);
  } catch(e) { return 'ERR ' + e.message; }
})()`, 180000));

console.log('5 界面/开关: ' + await js(`JSON.stringify({
  showHints: state.showHints, chkShow: document.getElementById('chk-show').checked,
  mode: settings.mode, myColor: state.myColor, isMyTurn: isMyTurn(),
  N: N, 手数: state.moves.length, viewAt: state.viewAt,
  candAt: state.candAt, rv: state.rootVisits, 点数: state.candidates.length,
  busy: anaBusy, q: anaQueue.length, force: anaForceCur, shownAt: shownAt,
  lastEval: state.lastEval ? state.lastEval.blackWin : null,
  ownAt: state.ownAt, historyLen: state.history.length, histVisits: JSON.stringify(state.histVisits.slice(0,5)),
})`));

console.log('6 等 45 秒内的变化: ' + await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const marks = []; let last = '';
  const t1 = Date.now();
  while (Date.now() - t1 < 45000) {
    await sleep(500);
    const s = 'candAt=' + state.candAt + '/' + state.viewAt + ' rv=' + state.rootVisits
      + ' 点=' + state.candidates.length + ' busy=' + anaBusy + ' q=' + anaQueue.length
      + ' force=' + anaForceCur + ' shown=' + shownAt
      + ' hist=' + state.history.length + ' note=' + JSON.stringify(engineNote);
    if (s !== last) { marks.push(Math.round((Date.now()-t1)/1000) + 's ' + s); last = s; }
    if (state.candAt === state.viewAt && state.candidates.length) break;
  }
  return marks.join('\\n     ');
})()`, 120000));

console.log('7 手工 analyze: ' + await js(`(async function(){
  try {
    const mv = state.moves.slice(0, state.viewAt).map(m => [m.color === 'b' ? 'B' : 'W', m.pass ? 'pass' : toGTP(m.x, m.y)]);
    const raw = await window.api.analyze({ initialStones: [], moves: mv, rules: 'chinese', komi: 7.5, size: N, maxVisits: 100 });
    if (!raw) return 'undefined';
    if (raw.error) return 'error=' + raw.error;
    return 'root.visits=' + (raw.root && raw.root.visits) + ' moveInfos=' + ((raw.moves||[]).length) + ' winrate=' + (raw.root && raw.root.winrate);
  } catch(e) { return 'ERR ' + e.message; }
})()`, 120000));

console.log('8 界面文字: ' + await js(`JSON.stringify({
  wr: document.getElementById('eval-wr').textContent,
  lead: document.getElementById('eval-lead').textContent,
  status: document.getElementById('status').textContent,
})`));
ws.close();
