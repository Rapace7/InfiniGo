/* 验证坐标字母表统一（2026-10-06 用户报「第 9 列起坐标错位」）：
   ① 显示层底边字母必须是 A–H **J**–T（跳 I，这是围棋标准，不是 bug）
   ② SGF 导出的坐标必须与显示一致（第 9 列 = J，不能是 I）
   ③ SGF 导出 → 重新导入，坐标必须往返一致
   ④ GTP 坐标（含 KATA_GO 用的那套）也一致 */
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 30000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const out = await js(`(function(){
  const R = {};
  /* ---------- ① 字母表本身 ---------- */
  R['① 字母表长度'] = GTP_COLS.length + '（应为19）';
  R['① 第 8/9/10 个'] = GTP_COLS[7] + ' ' + GTP_COLS[8] + ' ' + GTP_COLS[9] + '（应为H J K）';
  R['① 是否含 I'] = GTP_COLS.indexOf('I') < 0 ? '✓ 不含 I（围棋标准，跳过）' : '★ 含 I';
  R['① 全部字母'] = GTP_COLS;

  /* 关键：有没有第二份含 I 的表（那会让导出错位） */
  let dup = null;
  try { eval('L'); dup = '★ 还存在第二份 L=' + L; } catch (e) { dup = '✓ 只有一份表（旧的 L 已删）'; }
  R['② 字母表唯一'] = dup;

  /* ---------- ③ 逐列对照：显示用的列字母 vs SGF 导出的列字母 ---------- */
  settings.mode = 'edit'; applyNewGame();
  /* 底边一整排（y=18 是最底行）：x=0(A) 7(H) 8(J) 9(K) 10(L) 18(T) */
  for (const x of [0, 7, 8, 9, 10, 18]) tryPlay(x, 18);
  const sgf = buildSGF();
  /* 不去猜正则 —— 直接把 SGF 里的着手片段截出来看 */
  const tail = sgf.slice(sgf.indexOf(';B['));
  R['③ SGF 实际导出'] = tail;
  R['③ 期望'] = ';B[A19];B[H19];B[J19];B[K19];B[L19];B[T19]';
  const got = tail.split(';B[').filter(Boolean).map(s => s.slice(0, s.indexOf(']'))).join(' ');
  const want = 'A19 H19 J19 K19 L19 T19';
  R['③ 拆出的坐标'] = got;
  R['③ 判定'] = (got === want) ? '✓ 完全一致（第 9 列 = J，没被错成 I）' : ('★ 实际: ' + got);

  /* 逐点验证 toGTP（引擎与显示共用的换算） */
  const probes = [];
  for (const x of [0, 7, 8, 9, 10, 18]) {
    probes.push(x + '→' + toGTP(x, 18));
  }
  R['④ 底边各列（GTP）'] = probes.join('  ');
  R['④ 期望'] = '0→A  7→H  8→J  9→K  10→L  18→T';

  /* 往返一致性：SGF 文本 → 解析回来，坐标必须完全还原 */
  const parsed = parseSGF(sgf);
  const rt = (parsed && parsed.moves ? parsed.moves : []).map(m => m.pass ? 'pass' : GTP_COLS[m.x] + (N - m.y));
  R['⑥ SGF 往返'] = rt.join(' ');
  R['⑥ 期望'] = 'A19 H19 J19 K19 L19 T19';
  R['⑥ 判定'] = (rt.join(' ') === 'A19 H19 J19 K19 L19 T19') ? '✓ 往返无损' : '★ 往返有损';

  /* fromGTP 反向：J 应该是第 8 列（下标），不是 9 */
  const bk = ['A','H','J','K','L','T'].map(c => c + '->' + (fromGTP(c + '1') ? fromGTP(c + '1').x : 'null'));
  R['⑤ fromGTP 反查下标'] = bk.join('  ');
  R['⑤ 期望'] = 'A->0  H->7  J->8  K->9  L->10  T->18';

  applyNewGame();
  return R;
})()`);

console.log(JSON.stringify(out, null, 2));
ws.close();