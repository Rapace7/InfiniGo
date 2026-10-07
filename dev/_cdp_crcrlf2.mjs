/* 用「用户截图里那一手」做最终确认：显示 vs 编辑框，逐项数列。
   选一条**含双空行（\r\n\r\n）**的解说词 —— 那正是用户截图第 38 手的样子。
   量三件事：① 解析值 ② div 里渲染出来的 ③ textarea.value
   判据：②③ 的换行个数必须一致（显示和编辑不再"看起来不一样"）。 */
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 60000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const NAME = '_test_crcrlf.sgf';
const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};
  const NAME = '_test_crcrlf.sgf';
  const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
  const CRLF = CR + LF, CRCRLF = CR + CR + LF;
  const cnt = (s, sub) => s.split(sub).length - 1;
  const stat = s => ({ len: s.length, CRCRLF: cnt(s, CRCRLF), CRLF: cnt(s, CRLF), LF: cnt(s, LF) });

  const rd = await window.api.records.read(NAME);
  const rawText = rd.text;
  R['文件级：仍有 CRCRLF 的处数'] = cnt(rawText, CRCRLF);
  const p = parseSGF(rawText);
  const keys = Object.keys(p.comments || {}).map(Number).filter(k => k > 0).sort((a,b)=>a-b);
  R['带解说词的手数'] = keys.length;

  /* 选一条含多行内容的（用户截图第 38 手那种）。
     ★ 口径已改：解析阶段就会 normalize + tighten，所以这里**不会**再看到 CRCRLF，
       要改判"有没有换行"，而不是"有没有 CRCRLF"。 */
  let target = null;
  for (const k of keys) {
    const v = p.comments[k] || '';
    if (cnt(v, CRLF) >= 3) { target = k; break; }   // 至少 4 行的长解说
  }
  const pick = target !== null ? target : keys[0];
  R['选中手数'] = pick;
  if (target === null) R['说明'] = '这份棋谱没有多行解说，退回第一条';
  const raw = p.comments[pick] || '';
  R['① 解析值（parseSGF）'] = stat(raw);
  R['① 行数（应 = 换行数 + 1）'] = raw.split(CRLF).length;
  R['① 解析值里还有 CRCRLF 吗'] = cnt(raw, CRCRLF) === 0 ? '✓ 没有（归一化生效）' : '★ 还有 ' + cnt(raw, CRCRLF);
  R['① 里面有连续空行吗'] = cnt(raw, CRLF + CRLF) === 0 ? '✓ 没有（压缩生效）' : '★ 还有 ' + cnt(raw, CRLF + CRLF);
  R['① 内容开头'] = JSON.stringify(raw.slice(0, 30)).replace(/\\\\r/g,'<CR>').replace(/\\\\n/g,'<LF>');

  applyRecord(p, NAME);
  await sleep(250);
  gotoView(pick);
  await sleep(300);

  const box = document.getElementById('cbox');
  const shown = box.textContent || '';
  R['② 显示（div.textContent）'] = stat(shown);
  R['② 显示 == 解析值'] = (shown === raw) ? '✓ 完全相同' : ('★ 差 ' + (shown.length - raw.length) + ' 字');

  editComment();
  await sleep(300);
  const ta = box.querySelector('textarea');
  if (!ta) { R['③ 编辑框'] = '★ 没出来'; return R; }
  const v = ta.value;
  R['③ 编辑（textarea.value）'] = stat(v);
  R['③ 与显示换行个数一致'] = (cnt(v, LF) === cnt(shown, LF)) ? '✓ 一致（这才是不该有偏差的地方）' : ('★ 显示 ' + cnt(shown, LF) + ' 个换行，编辑框 ' + cnt(v, LF) + ' 个');
  R['③ 编辑框里还有 CRCRLF 吗'] = cnt(v, CRCRLF) === 0 ? '✓ 没有' : '★ 还有 ' + cnt(v, CRCRLF);
  R['③ 开头'] = JSON.stringify(v.slice(0, 30)).replace(/\\\\r/g,'<CR>').replace(/\\\\n/g,'<LF>');
  exitCommentEdit(); renderCommentBox();
  return R;
})()`);

console.log(JSON.stringify(out, null, 2));
ws.close();
