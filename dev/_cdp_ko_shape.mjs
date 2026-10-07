/* 别猜了：把棋盘（第 13~15 行、C~G 列那块）直接打出来看黑白空，再逐手打印。 */
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

const SCRIPT = [
  '(async function(){',
  '  const sleep = ms => new Promise(r => setTimeout(r, ms));',
  '  const log = [];',
  '  const G = s => { const m = /^([A-T])(\\d+)$/.exec(s); return { x: m[1].charCodeAt(0) - 65, y: N - parseInt(m[2], 10) }; };',
  '  const put = (s, c) => { const p = G(s); state.moves.push({ x: p.x, y: p.y, color: c, pass: false, captured: 0 }); state.viewAt = state.moves.length; };',
  '  const dump = tag => {',
  '    const b = boardAt(state.moves.length); const rows = [];',
  '    for (let y = 12; y <= 16; y++) {',
  '      let line = "    " + (N - y) + " ";',
  '      for (let x = 1; x <= 7; x++) line += (b[idx(x, y)] === 0 ? "." : (b[idx(x, y)] === 1 ? "X" : "O")) + " ";',
  '      rows.push(line);',
  '    }',
  '    log.push(tag + "  （X=黑 O=白 .=空；列 B..H，行 " + (N-12) + ".." + (N-16) + "）");',
  '    for (const r of rows) log.push(r);',
  '  };',
  '  const koTxt = () => state.koPoint ? (GTP_COLS[state.koPoint.x] + (N - state.koPoint.y)) : "null";',
  '',
  '  settings.mode = "free"; settings.size = 19; settings.handicap = 0; settings.rules = "chinese";',
  '  applyNewGame(); await sleep(300);',
  '  state.moves = []; state.viewAt = 0; state.koPoint = null; state.setup = [];',
  '  for (const pair of [["C5","b"], ["D6","b"], ["F5","b"], ["E6","b"], ["E4","b"], ["D5","w"]]) put(pair[0], pair[1]);',
  '  syncUI(); await sleep(200);',
  '  log.push("=== 摆子后（手数 " + state.moves.length + "）===");',
  '  dump("局面");',
  '  log.push("  D5=" + boardAt(state.moves.length)[idx(G("D5").x, G("D5").y)] + "(2=白)  E5=" + boardAt(state.moves.length)[idx(G("E5").x, G("E5").y)] + "(0=空)");',
  '',
  '  state.toMove = "b";',
  '  const r1 = tryPlay(G("E5").x, G("E5").y); await sleep(150);',
  '  log.push("=== ① 黑 E5（落子=" + r1 + "，提=" + (state.moves[state.moves.length-1]||{}).captured + "）===");',
  '  dump("局面");',
  '  log.push("  D5=" + boardAt(state.moves.length)[idx(G("D5").x, G("D5").y)] + "(应为 0，被提)  禁着点=" + koTxt());',
  '',
  '  state.toMove = "w";',
  '  const r2 = tryPlay(G("D4").x, G("D4").y); await sleep(150);',
  '  log.push("=== ② 白 D4（落子=" + r2 + "，提=" + (state.moves[state.moves.length-1]||{}).captured + "）===");',
  '  dump("局面");',
  '  log.push("  禁着点=" + koTxt() + "（应为 D5）");',
  '  return log;',
  '})()',
].join('\n');

const out = await js(SCRIPT, 120000);
if (typeof out === 'string') { console.log('运行失败: ' + out); }
else { for (const l of out) console.log(l); }
ws.close();
