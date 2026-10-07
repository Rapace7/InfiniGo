/* 悔棋 × 打劫 的专项回归（2026-10-07 用户报的真 bug）。
 *
 * 用户现象：白提劫 → 我禁着 → 我在别处走一手 → 白在别处走 → 我悔棋回到"白提完劫"
 *          → 这时能**无视禁着点直接提劫**。
 * 根因：`btn-undo` 里把 `state.koPoint` 清成 null（注释写"局面变了随之失效"）——
 *      退掉提劫那一手时它确实该失效，但**退到"刚提完劫"那个局面时它必须重新成立**。
 *      反方向也错：悔棋**退掉一个"在别处走"的手**之后，劫其实又成立了，禁着点该回来。
 * 修法：悔棋后按新局面重算（`koFromBoard`），判据与 tryPlay 完全一致。
 *
 * ★★ 两条纪律（都是这份测试自己踩出来的）：
 *   ① **不手算劫形坐标** —— 手算错了三次（漏一口气、提错子），白烧三轮。
 *      改成让引擎报：走完一手读 state.koPoint，断言都基于它。
 *   ② **不信"我以为哪手下上了"** —— 落子可能被拒（禁着点/合法性）。
 *      所以每一步都**先确认落子真的成功**（比对落子前后的手数），再往下走。
 *      否则后面所有断言都在错误的局面上做，报出来的"★"全是假的。
 */
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
  '  const R = [];',
  '  const koTxt = () => state.koPoint ? (GTP_COLS[state.koPoint.x] + (N - state.koPoint.y)) : "null";',
  '  const G = s => { const m = /^([A-T])(\\d+)$/.exec(s); return { x: m[1].charCodeAt(0) - 65, y: N - parseInt(m[2], 10) }; };',
  '  const ok = (name, got, want) => R.push({ 项: name, 得到: String(got), 期望: String(want), 结果: (String(got) === String(want)) ? "✓" : "★" });',
  '  const note = s => R.push({ 项: s, 得到: "", 期望: "", 结果: "·" });',
  '  /* 找一片空地落子（别撞上已有棋子） */',
  '  const findEmpty = () => {',
  '    const b = boardAt(state.moves.length);',
  '    for (let y = 8; y < 12; y++) for (let x = 1; x < 18; x++) if (b[idx(x, y)] === 0) return { x: x, y: y };',
  '    return null;',
  '  };',
  '  /* 落一手，返回「真的落上了吗」 */',
  '  const play = async (pt) => {',
  '    const n0 = state.moves.length;',
  '    state.toMove = sideToMove(state.moves.length);',
  '    const r = tryPlay(pt.x, pt.y);',
  '    await sleep(200);',
  '    return { 接受: r, 落上了: state.moves.length === n0 + 1 };',
  '  };',
  '',
  '  settings.mode = "free"; settings.size = 19; settings.handicap = 0; settings.rules = "chinese";',
  '',
  '  /* ---------- 用「打劫BUG」那份棋谱摆到「白提完劫」那一刻 ----------',
  '     ★ 用 dev\\fixtures\\ 里的副本，**不读用户的棋谱库**。',
  '       2026-10-07 踩过：原来按 /34手|打劫|BUG/ 去 records 里找，',
  '       找到的是用户自己的文件；而测试跑在活目录上，他的棋谱在测试期间消失了。',
  '       fixture 在仓库里，换机器也能跑。 */',
  '  const list = (await window.api.records.list()) || [];',
  '  const nm = list.map(f => f.name).filter(n => /打劫BUG-34手/i.test(n))[0];',
  '  if (!nm) { note("★ 开发目录 records 里没有 打劫BUG-34手.sgf"); note("   先跑：copy dev\\fixtures\\打劫BUG-34手.sgf records\\"); return R; }',
  '  const rd = await window.api.records.read(nm);',
  '  const p = parseSGF(rd.text);',
  '  applyNewGame(); await sleep(300);',
  '  state.moves = []; state.viewAt = 0; state.koPoint = null; state.setup = [];',
  '  /* 逐手重下前 32 手；被拒的手跳过（那份棋谱里有自杀手） */',
  '  let replayed = 0, skipped = 0;',
  '  const koAt = {};',
  '  for (let i = 0; i < 32; i++) {',
  '    const m = p.moves[i];',
  '    state.toMove = m.color;',
  '    const n0 = state.moves.length;',
  '    tryPlay(m.x, m.y);',
  '    if (state.moves.length === n0 + 1) replayed++; else { skipped++; continue; }',
  '    if (state.koPoint) koAt[i + 1] = GTP_COLS[state.koPoint.x] + (N - state.koPoint.y);',
  '  }',
  '  await sleep(200);',
  '  note("重下前 32 手：成功 " + replayed + " 手，被拒 " + skipped + " 手；出现劫点的手数=" + JSON.stringify(koAt));',
  '  if (!state.koPoint) { note("★ 重下之后没有劫点 —— 测试无法继续"); return R; }',
  '',
  '  const ko = { x: state.koPoint.x, y: state.koPoint.y };',
  '  const kname = GTP_COLS[ko.x] + (N - ko.y);',
  '  const nKo = state.moves.length;',
  '  note("★ 引擎报出的劫点 = " + kname + "，此时手数 " + nKo);',
  '  ok("① 提劫后生成了禁着点", koTxt(), kname);',
  '',
  '  /* ② 此刻直接回提 → 必须被拒 */',
  '  const a2 = await play(ko);',
  '  ok("② 立刻回提被拒（不落子）", a2.接受 + "/手数不变" + (!a2.落上了), "false/手数不变true");',
  '',
  '  /* ③ 在别处走一手 → 禁着点清空 */',
  '  const away = findEmpty();',
  '  const a3 = await play(away);',
  '  ok("③ 别处落子成功", a3.落上了, "true");',
  '  ok("③ 走别处后禁着点清空", koTxt(), "null");',
  '',
  '  /* ④ 悔棋一次 → 退回「刚提完劫」⇒ 禁着点必须重新成立（用户报的就是这一步） */',
  '  $("btn-undo").click(); await sleep(300);',
  '  ok("④ 手数退回提劫那一刻", state.moves.length, nKo);',
  '  ok("④ 悔棋后禁着点重新成立", koTxt(), kname);',
  '',
  '  /* ⑤ 这时直接回提 —— 必须仍被拒（bug 就在这里） */',
  '  const n5 = state.moves.length;',
  '  const a5 = await play(ko);',
  '  ok("⑤ 悔棋后回提仍被拒（用户报的 bug）", a5.接受 + "/手数不变" + (state.moves.length === n5), "false/手数不变true");',
  '',
  '  /* ⑥ 对照：别处应当**能**下（不能把整个局面锁死） */',
  '  const away2 = findEmpty();',
  '  const a6 = await play(away2);',
  '  ok("⑥ 别处仍可正常落子", a6.落上了, "true");',
  '',
  '  /* ⑦ 反向再验一次：撤掉刚落的这手 → 回到提劫局面，禁着点又回来 */',
  '  $("btn-undo").click(); await sleep(300);',
  '  ok("⑦ 再撤一手后禁着点仍在", koTxt(), kname);',
  '  const n7 = state.moves.length;',
  '  const a7 = await play(ko);',
  '  ok("⑦ 仍然拒绝对劫点的回提", a7.接受 + "/手数不变" + (state.moves.length === n7), "false/手数不变true");',
  '',
  '  return R;',
  '})()',
].join('\n');

const out = await js(SCRIPT, 180000);
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
