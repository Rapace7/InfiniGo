/* 验证两套坐标字母表各自正确（2026-10-06 用户报「坐标少了 I」+ 我自己的一次改错）。

   事实（用本机 21433 份真实职业棋谱统计过）：
     · 界面/GTP 坐标 **跳过 I**（A B C D E F G H J K…）—— 围棋传统，**不是 bug**
     · SGF 棋谱坐标 **包含 i**（a b c … h i j …）—— SGF 规范如此
       证据：坐标字母 i 在职业棋谱里出现 16.4 万次；第 16 列是 p 不是 q。
   所以本测试要同时钉住这两条 —— 少钉一条，下一个人（或下一个我）就会再改错一次。 */
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
  const eq = (a, b) => a === b ? '✓' : ('★ 期望 ' + b + '，实际 ' + a);

  /* ---------- ① 界面/GTP 表：必须跳过 I ---------- */
  R['① 界面表长度'] = GTP_COLS.length + ' ' + eq(GTP_COLS.length, 19);
  R['① 界面表全貌'] = GTP_COLS;
  R['① 界面表不含 I'] = eq(GTP_COLS.indexOf('I'), -1);
  const hjk = [GTP_COLS[7], GTP_COLS[8], GTP_COLS[9]].join('');
  R['① 第8/9/10列'] = hjk + ' ' + eq(hjk, 'HJK');

  /* ---------- ② SGF 表：必须包含 i ---------- */
  R['② SGF表长度'] = SGF_COLS.length + ' ' + eq(SGF_COLS.length, 19);
  R['② SGF表全貌'] = SGF_COLS;
  R['② SGF第9列是 i'] = SGF_COLS[8] + ' ' + eq(SGF_COLS[8], 'i');
  R['② SGF第16列是 p'] = SGF_COLS[15] + ' ' + eq(SGF_COLS[15], 'p');

  /* ---------- ③ 两套表必须不同（相同 = 又被合并了）---------- */
  R['③ 两套表不同'] = (GTP_COLS !== SGF_COLS) ? '✓' : '★ 被合并成一套了，一定有一边是错的';

  /* ---------- ④ 导出实测：最底行 x=0/7/8/9/18 ---------- */
  settings.mode = 'edit'; settings.rules = 'chinese'; settings.size = 19;
  settings.handicap = 0; settings.komi = 7.5; applyNewGame();
  for (const x of [0, 7, 8, 9, 18]) tryPlay(x, 18);
  const sgf = buildSGF();
  const coords = sgf.split(';B[').slice(1).map(s => s.slice(0, s.indexOf(']'))).join(' ');
  R['④ 导出的坐标'] = coords;
  R['④ 期望'] = 'as hs is js ss';
  R['④ 判定'] = eq(coords, 'as hs is js ss');

  /* ---------- ⑤ 往返：导出 → 解析回来必须一致 ---------- */
  const parsed = parseSGF(sgf);
  const rt = (parsed && parsed.moves ? parsed.moves : [])
    .map(m => m.pass ? 'pass' : (SGF_COLS[m.x] + SGF_COLS[m.y])).join(' ');
  R['⑤ 解析回来'] = rt;
  R['⑤ 往返一致'] = eq(rt, 'as hs is js ss');

  /* ---------- ⑥ 反向：手写含 i 的 SGF，看读得对不对 ---------- */
  const p2 = parseSGF('(;GM[1]FF[4]SZ[19];B[id];W[jd];B[dd])');
  const got2 = (p2.moves || []).map(m => m.x + ',' + m.y).join(' | ');
  R['⑥ 读含 i 的棋谱'] = got2;
  R['⑥ 期望(x,y)'] = '8,3 | 9,3 | 3,3';
  R['⑥ 判定'] = eq(got2, '8,3 | 9,3 | 3,3');

  applyNewGame();
  return R;
})()`);

console.log(JSON.stringify(out, null, 2));
ws.close();