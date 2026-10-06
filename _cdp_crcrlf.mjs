/* 实测：真实棋谱里的 `\r\r\n`（CR CR LF，690 处）在「显示」与「编辑」两条路径上到底变成什么。
   这是用户报的「一点开编辑，所有文段自动划分并加空行」的现场复现。
   ★ 只测量、不修改文件。 */
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
  const NAME = ${JSON.stringify(NAME)};
  const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
  const stat = s => ({
    len: s.length,
    CR: (s.match(/\\r/g) || []).length,
    LF: (s.match(/\\n/g) || []).length,
    CRLF: (s.match(/\\r\\n/g) || []).length,
    CRCRLF: (s.match(/\\r\\r\\n/g) || []).length,
    bareCR: (s.match(/\\r(?!\\n)/g) || []).length,
  });

  const rd = await window.api.records.read(NAME);
  if (!rd || rd.error) return { '读文件': '★ ' + ((rd && rd.error) || '失败') };
  R['文件字节数'] = rd.text.length;
  R['文件里的 \\\\r\\\\r\\\\n 处数'] = (rd.text.match(/\\r\\r\\n/g) || []).length;
  R['文件里的裸 \\\\r 处数'] = (rd.text.match(/\\r(?!\\n)/g) || []).length;
  /* 去掉 \\r\\r\\n 之后还剩多少裸 CR —— 判断"双 CR"是不是成对出现 */
  R['成对判断'] = (rd.text.match(/\\r\\r\\n/g) || []).length * 2 + ' ≈ 裸 CR 数 ' + (rd.text.match(/\\r(?!\\n)/g) || []).length;

  const p = parseSGF(rd.text);
  R['手数'] = p.moves.length;
  const keys = Object.keys(p.comments || {}).map(Number).filter(k => k > 0).sort((a,b)=>a-b);
  R['有解说词的手数'] = keys.length;

  /* 找那条含 \\r\\r\\n 的解说词（第 2 个 C，按用户截图的样子） */
  let target = null;
  for (const k of keys) {
    const v = p.comments[k] || '';
    if (v.indexOf(CR + CR + LF) >= 0) { target = k; break; }
  }
  if (target === null) return Object.assign(R, { '★ 找不到含 CRCRLF 的解说词': '换一份样本' });
  const raw = p.comments[target];
  R['选中的手数'] = target;
  R['◆ 解析出来的原文'] = stat(raw);
  R['◆ 原文开头'] = JSON.stringify(raw.slice(0, 30));

  applyRecord(p, NAME);
  await sleep(250);
  gotoView(target);
  await sleep(250);

  /* ---- ① 显示路径：div.textContent（pre-wrap 渲染） ---- */
  const box = document.getElementById('cbox');
  const shown = box.textContent || '';
  R['① 显示（div.textContent）'] = stat(shown);
  R['① 与解析原文相同'] = (shown === raw) ? '✓ 完全相同' : '★ 不同（差 ' + (raw.length - shown.length) + ' 字符）';

  /* 用 getClientRects 量真实行数 —— 视觉上到底显示了几行 */
  const rects = box.getClientRects ? box.getClientRects().length : -1;
  R['① div 的 client rect 数'] = rects;

  /* ---- ② 编辑路径：textarea.value ---- */
  editComment();
  await sleep(250);
  const ta = box.querySelector('textarea');
  if (!ta) return Object.assign(R, { '★ 编辑框没出来': '失败' });
  const v = ta.value;
  R['② 编辑（textarea.value）'] = stat(v);
  R['② 与原文长度差'] = v.length - raw.length;
  R['② 开头 30 字（显式化）'] = JSON.stringify(v.slice(0, 30)).replace(/\\\\r/g, '<CR>').replace(/\\\\n/g, '<LF>');

  /* 逐字符比对：找出第一处差异 */
  let firstDiff = -1;
  for (let i = 0; i < Math.min(raw.length, v.length); i++) {
    if (raw[i] !== v[i]) { firstDiff = i; break; }
  }
  R['② 第一处差异位置'] = firstDiff;
  if (firstDiff >= 0) {
    const ctx = s => JSON.stringify(s.slice(Math.max(0, firstDiff - 6), firstDiff + 10))
      .replace(/\\\\r/g, '<CR>').replace(/\\\\n/g, '<LF>');
    R['② 原文在那附近'] = ctx(raw);
    R['② 编辑框在那附近'] = ctx(v);
  }
  return R;
})()`);

console.log(JSON.stringify(out, null, 2));
ws.close();
