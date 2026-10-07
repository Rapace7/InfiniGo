/* 诊断：把摆出来的局面逐格打出来，确认 A2 那一手到底该不该提子。
   上一版测试里「提子数=0」是不对的 —— 先查清楚是摆位错了还是我的理解错了。 */
const PORT = 9333;
async function getPage() {
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); if (p) return p; } catch (e) { }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('连不上');
}
const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise(res => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 120000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

console.log(await js(`(function(){
  const L = [];
  settings.size = 5; N = 5; settings.rules = 'chinese'; settings.komi = 0;
  settings.handicap = 0; settings.mode = 'free';
  state.noGame = false; state.fromRecord = false; state.setup = [];
  const col = 'ABCDEFGHJKLMNOPQRST';
  const P = g => ({ x: col.indexOf(g[0]), y: N - parseInt(g.slice(1), 10) });
  const mk = (g, c) => { const p = P(g); return { x: p.x, y: p.y, color: c, pass: false, captured: 0 }; };
  state.moves = [mk('A5','b'), mk('D1','w'), mk('A1','b'), mk('E2','w'), mk('B2','b'), mk('E3','w')];
  state.viewAt = 6; state.toMove = 'b'; state.koPoint = null;

  L.push('=== 每手坐标核对（GTP → 内部 x,y）===');
  for (const m of state.moves) L.push('  ' + m.color.toUpperCase() + ' [' + m.x + ',' + m.y + ']');

  const b = boardAt(6);
  L.push('=== boardAt(6) 逐格（行 y=0 在最上；列 x=0 在最左）===');
  L.push('     x=0 1 2 3 4');
  for (let y = 0; y < N; y++) { let s = ''; for (let x = 0; x < N; x++) s += (b[y*N+x] === 1 ? 'X ' : b[y*N+x] === 2 ? 'O ' : '. '); L.push('  y=' + y + ' ' + s); }

  const e2 = P('E2'), e3 = P('E3'), a2 = P('A2');
  L.push('E2 = (' + e2.x + ',' + e2.y + ')  这格是: ' + b[e2.y*N+e2.x]);
  L.push('E3 = (' + e3.x + ',' + e3.y + ')  这格是: ' + b[e3.y*N+e3.x]);
  L.push('A2 = (' + a2.x + ',' + a2.y + ')  这格是: ' + b[a2.y*N+a2.x]);

  L.push('=== 白 E2 那组的气 ===');
  const gE2 = group(b, e2.x, e2.y);
  L.push('  子数=' + gE2.stones.length + '  气数=' + gE2.libs.size + '  气格=' + [...gE2.libs].map(k => '(' + (k%N) + ',' + ((k/N)|0) + ')').join(' '));

  L.push('=== 黑 A2 四邻 ===');
  for (const [nx, ny] of neighbors(a2.x, a2.y)) L.push('  (' + nx + ',' + ny + ') = ' + b[ny*N+nx] + '（' + (b[ny*N+nx]===1?'黑':b[ny*N+nx]===2?'白':'空') + '）');
  return L.join('\n');
})()`));
ws.close();
