/* 复现用户报的「悔棋之后就能无视禁着点直接提劫」。
 *
 * 用户场景（他是黑，AI 执白，右上角）：
 *   白提劫 → 黑被禁着 → 黑在他处走一手 → 白补上劫空 → 黑悔棋…
 *   悔到「白提完劫之后」那个局面时，黑可以**直接提回去**（违反禁着点）。
 *
 * 根因假设：`btn-undo` 里 `state.koPoint = null;` —— 悔棋把禁着点**忘了**，
 * 而它本该按新局面重新算出来（简单劫：上一手提 1 子、且落子是孤子只剩一口气）。
 *
 * 一步一步走完整场景，每步都检查「该被禁的点能不能下」。 */
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
  '  const put = (x, y, c) => { state.moves.push({ x: x, y: y, color: c, pass: false, captured: 0 }); state.viewAt = state.moves.length; };',
  '  const koTxt = () => state.koPoint ? (GTP_COLS[state.koPoint.x] + (N - state.koPoint.y)) : "null";',
  '  const mark = s => log.push(s);',
  '',
  '  settings.mode = "free"; settings.size = 19; settings.handicap = 0;',
  '  settings.rules = "chinese"; state.showHints = false;',
  '  applyNewGame(); await sleep(400);',
  '  state.moves = []; state.viewAt = 0; state.koPoint = null;',
  '  for (const pair of [["C3","b"], ["D3","b"], ["E3","b"], ["E4","b"], ["D4","w"], ["D5","w"]]) {',
  '    const p = G(pair[0]); put(p.x, p.y, pair[1]);',
  '  }',
  '  syncUI();',
  '  mark("摆好劫形：黑 C3 D3 E3 E4 ／ 白 D4 D5  手数=" + state.moves.length + "  禁着点=" + koTxt() + "（摆子阶段不该有）");',
  '',
  '  state.toMove = "w";',
  '  const okKo = tryPlay(G("D4").x, G("D4").y); await sleep(120);',
  '  mark("① 白 D4 提劫（提黑 C4 那子）：落子=" + okKo + "  提了几子=" + state.moves[state.moves.length-1].captured + "  禁着点=" + koTxt() + "（应为 E5）");',
  '',
  '  state.toMove = "b";',
  '  const blocked = tryPlay(G("E5").x, G("E5").y); await sleep(120);',
  '  mark("② 黑立刻点 E5（被禁）：落子=" + blocked + "（应为 false）  手数=" + state.moves.length);',
  '',
  '  state.toMove = "b";',
  '  const elsewhere = tryPlay(G("Q16").x, G("Q16").y); await sleep(120);',
  '  mark("③ 黑在他处 Q16：落子=" + elsewhere + "  禁着点=" + koTxt() + "（走别处后应清空）");',
  '',
  '  state.toMove = "w";',
  '  const fill = tryPlay(G("E5").x, G("E5").y); await sleep(120);',
  '  mark("④ 白补 E5：落子=" + fill + "  禁着点=" + koTxt() + "  手数=" + state.moves.length);',
  '',
  '  $("btn-undo").click(); await sleep(200);',
  '  mark("⑤ 悔 1 次（撤掉白补的 E5）：手数=" + state.moves.length + "  禁着点=" + koTxt() + "（撤掉补劫后应恢复成 E5）");',
  '  $("btn-undo").click(); await sleep(200);',
  '  mark("⑤ 悔 2 次（撤掉黑 Q16）→ 这就是「白提完劫之后」：手数=" + state.moves.length',
  '    + "  看第几手=" + state.viewAt + "  禁着点=" + koTxt() + "   ← ★ 这里应当是 E5");',
  '',
  '  const before = state.moves.length;',
  '  const illegal = tryPlay(G("E5").x, G("E5").y); await sleep(200);',
  '  mark("⑥ 黑直接点 E5：落子=" + illegal + "（**应为 false**）  手数 " + before + " → " + state.moves.length);',
  '  mark(illegal ? "★★★ 复现成功：悔棋后禁着点丢失，黑能直接提劫" : "✓ 仍被正确禁着（本次没复现）");',
  '  return log;',
  '})()',
].join('\n');

const out = await js(SCRIPT, 120000);
if (typeof out === 'string') { console.log('运行失败: ' + out); }
else { for (const l of out) console.log('  ' + l); }
ws.close();
