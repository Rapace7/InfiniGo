/* 验证「单子被提且自己只剩1气」但**并非真劫**的局面，会不会被错误禁掉。
 *
 * 从 KataGo 裁判那里已经确认：下面这个局面上黑提 E2 是**合法**的
 * （GTP 实测 MoveNum 7 接受了 B A2）。
 *
 * 局面（5 路）：
 *   黑 A5、A1、B2      白 D1、E2、E3
 *   黑走 A2 → 提掉白 E2，黑 A2B2A1A5 连成一块
 *   此时白回提 A2 会提走 ≥1 子但**盘面不完全还原**（B2 挡着）→ 合法
 *
 * 现有判据（提1子 + 孤子 + 只剩1气）在这个局面上会成立吗？成立就是误判。 */
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

const out = await js(`(function(){
  const R = [];
  const note = s => R.push({ 项: s, 得: '', 望: '', r: '·' });
  const ok = (n, g, w) => R.push({ 项: n, 得: String(g), 望: String(w), r: (String(g) === String(w)) ? '✓' : '★' });

  /* 5 路盘，按 GTP 语义摆：字母=列(0起)、数字=从下往上(1起) */
  settings.size = 5; N = 5; settings.rules = 'chinese'; settings.komi = 0;
  settings.handicap = 0; settings.mode = 'free';
  state.noGame = false; state.fromRecord = false;
  state.setup = [];
  const P = (gtp) => { const col = 'ABCDEFGHJKLMNOPQRST'; const x = col.indexOf(gtp[0]); const y = N - parseInt(gtp.slice(1), 10); return { x, y }; };
  const mk = (gtp, color) => { const p = P(gtp); return { x: p.x, y: p.y, color, pass: false, captured: 0 }; };

  state.moves = [ mk('A5','b'), mk('D1','w'), mk('A1','b'), mk('E2','w'), mk('B2','b'), mk('E3','w') ];
  state.viewAt = state.moves.length;
  state.toMove = 'b';        // 轮黑走（第 7 手）
  state.koPoint = null;

  const b0 = boardAt(state.moves.length);
  const show = (b, tag) => { const rows = []; for (let y = 0; y < N; y++) { let s = ''; for (let x = 0; x < N; x++) s += (b[y*N+x] === 1 ? 'X' : b[y*N+x] === 2 ? 'O' : '.'); rows.push(s); } note(tag + ' [' + rows.join(' / ') + ']'); };
  show(b0, '走之前');

  const a2 = P('A2');
  note('黑要走 A2 = (' + a2.x + ',' + a2.y + ')；A2 现在是空的? ' + (b0[a2.y*N+a2.x] === 0));

  /* 手工推一遍这手的提子情况（复刻 tryPlay 的算法，只为拿到判据输入） */
  const b = Int8Array.from(b0);
  b[a2.y*N+a2.x] = 1;
  let captured = 0, capAt = null;
  for (const [nx, ny] of neighbors(a2.x, a2.y)) {
    if (b[ny*N+nx] === 2) {
      const gp = group(b, nx, ny);
      if (gp.libs.size === 0) { captured += gp.stones.length; capAt = { x: nx, y: ny }; gp.stones.forEach(k => { b[k] = 0; }); }
    }
  }
  const gSelf = group(b, a2.x, a2.y);
  note('这一手：提子数=' + captured + '，自己这块=' + gSelf.stones.length + '子/' + gSelf.libs.size + '气');
  const 旧判据成立 = (captured === 1 && gSelf.stones.length === 1 && gSelf.libs.size === 1);
  note('【旧判据(提1子+孤子+剩1气)】会设禁着点吗? ' + 旧判据成立);

  /* 真正该用的判据：走完之后，盘面是否与"走之前"完全一致 */
  let 完全还原 = true;
  for (let i = 0; i < b.length; i++) if (b[i] !== b0[i]) { 完全还原 = false; break; }
  note('【正确判据(盘面是否完全还原)】还原吗? ' + 完全还原 + '  → ' + (完全还原 ? '非法（真劫）' : '合法'));
  ok('两个判据在这个局面上结论不同（证明旧判据有误）', 旧判据成立 !== 完全还原, 'true');

  /* 再让真软件跑一遍：它到底禁不禁 */
  const tok = gameGen;
  const played = tryPlay(a2.x, a2.y);
  note('真软件 tryPlay(A2) 结果: ' + played + '（true=落子成功，false=被拒）');
  note('落子后 koPoint = ' + JSON.stringify(state.koPoint));
  ok('真软件允许这一手（KataGo 判合法）', played, 'true');
  return R;
})()`, 120000);

if (typeof out === 'string') { console.log('运行失败: ' + out); }
else { let bad = 0; for (const r of out) { if (r.r === '★') bad++; if (r.r === '·') console.log('    ' + r.项); else console.log('  ' + r.r + ' ' + r.项 + '：得 ' + r.得 + '（望 ' + r.望 + '）'); } console.log('\n  ' + (bad === 0 ? '通过 ✓' : '★ ' + bad + ' 项不通过')); }
ws.close();
