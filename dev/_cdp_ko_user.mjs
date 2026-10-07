/* 用用户那份棋谱（GN[打劫BUG]，34 手）验证**悔棋后禁着点丢失**。
 *
 * 从棋谱本身能读出的触发链（关键）：
 *   32 W[S17] 白提劫 → 生成禁着点 R17
 *   33 B[R17] 黑提回     ← 这一手**被记进棋谱了**，说明当时软件没拒它
 *   34 W[D3]  白在别处
 *
 * 在 34 手局面下，33B[R17] 其实**不**违反禁着点：
 *   因为黑 33 提回之后白又在别处补了一手（34），局面已经变了。
 *
 * 所以用户看到的现象必然是：**悔棋之后**，那个本该还在的禁着点没了 ——
 * 于是「白提完劫（32）」的局面下，黑能直接点 R17 提回去。
 *
 * 本脚本就照这条链走：重下到 32 → 记下禁着点 → 走过去再悔回来 → 看禁着点在不在。 */
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

const SCRIPT = [
  '(async function(){',
  '  const sleep = ms => new Promise(r => setTimeout(r, ms));',
  '  const log = [];',
  '  const koTxt = () => state.koPoint ? (GTP_COLS[state.koPoint.x] + (N - state.koPoint.y)) : "null";',
  '  const G = s => { const m = /^([A-T])(\\d+)$/.exec(s); return { x: m[1].charCodeAt(0) - 65, y: N - parseInt(m[2], 10) }; };',
  '',
  '  /* ① 摆到「白提完劫」那一刻（棋谱前 32 手） */',
  '  const list = (await window.api.records.list()) || [];',
  '  const nm = list.map(f => f.name).filter(n => /34手|打劫|BUG/i.test(n))[0];',
  '  const rd = await window.api.records.read(nm);',
  '  const p = parseSGF(rd.text);',
  '  settings.mode = "free"; settings.size = 19; settings.handicap = 0; settings.rules = "chinese";',
  '  applyNewGame(); await sleep(300);',
  '  state.moves = []; state.viewAt = 0; state.koPoint = null; state.setup = [];',
  '  for (let i = 0; i < 32; i++) { const m = p.moves[i]; state.toMove = m.color; tryPlay(m.x, m.y); }',
  '  await sleep(200);',
  '  log.push("① 摆到第 32 手（白提劫 W[S17]）：手数=" + state.moves.length + "  禁着点=" + koTxt() + "（应为 R17）");',
  '  if (koTxt() !== "R17") { log.push("★ 前置条件不成立，后面没意义"); return log; }',
  '',
  '  /* ② 此刻黑直接点 R17 —— 必须被拒 */',
  '  state.toMove = "b";',
  '  const direct = tryPlay(G("R17").x, G("R17").y); await sleep(150);',
  '  log.push("② 黑直接点 R17：落子=" + direct + "（应为 false）");',
  '  if (direct) { log.push("★★ 这一手本来就该被拒 —— 禁着点一开始就没生效"); return log; }',
  '',
  '  /* ③ 黑在别处走一手（Q16），再让白在别处走一手（模拟 34 W[D3]） */',
  '  state.toMove = "b";',
  '  tryPlay(G("Q16").x, G("Q16").y); await sleep(120);',
  '  log.push("③ 黑在别处 Q16：手数=" + state.moves.length + "  禁着点=" + koTxt() + "（走别处后应清空）");',
  '  state.toMove = "w";',
  '  tryPlay(G("D3").x, G("D3").y); await sleep(120);',
  '  log.push("④ 白在别处 D3（相当于棋谱第 34 手）：手数=" + state.moves.length + "  禁着点=" + koTxt());',
  '',
  '  /* ⑤ 悔棋两次 → 回到「白提完劫」那个局面 */',
  '  $("btn-undo").click(); await sleep(200);',
  '  log.push("⑤ 悔 1 次（撤白 D3）：手数=" + state.moves.length + "  禁着点=" + koTxt()',
  '    + "（撤掉白那手后，「白提劫」成了最后一手 → 应为 R17）");',
  '  $("btn-undo").click(); await sleep(200);',
  '  log.push("⑤ 悔 2 次（撤黑 Q16）→ 退到棋谱第 31 手：手数=" + state.moves.length + "  看第几手=" + state.viewAt',
  '    + "  禁着点=" + koTxt() + "   ← ★ 它的上一手是「白提劫」→ 应为 Q18");',
  '',
  '  /* ⑥ ★ 该被禁的是 Q18（白刚提掉的那颗黑子），不是 R17。',
  '     判据要按「上一手提了哪颗子」来定，别照搬截图里那个点。 */',
  '  const before = state.moves.length;',
  '  state.toMove = "b";',
  '  const illegal = tryPlay(G("Q18").x, G("Q18").y); await sleep(200);',
  '  log.push("⑥ 黑直接在劫点 Q18 提回：落子=" + illegal + "（**应为 false**）  手数 " + before + " → " + state.moves.length);',
  '  log.push(illegal ? "★★★ 复现：悔棋后禁着点丢失，能直接提劫" : "✓ 被正确禁着 —— 修复生效");',
  '',
  '  /* ⑦ 反向验一次：撤掉「在别处走」的手之后，劫应当重新成立 */',
  '  $("btn-undo").click(); await sleep(200);',
  '  log.push("⑦ 再悔 1 次（撤白提劫 W[S17]）：手数=" + state.moves.length + "  禁着点=" + koTxt()',
  '    + "（白那颗子还没提，不该有劫点；上一手是黑 Q17 提劫 → 应为 R17）");',
  '  return log;',
  '})()',
].join('\n');

const out = await js(SCRIPT, 180000);
if (typeof out === 'string') { console.log('运行失败: ' + out); }
else { for (const l of out) console.log('  ' + l); }
ws.close();
