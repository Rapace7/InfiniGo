/* 解说词框的端到端测试（2026-10-06 新功能）。
   样本是真实的 GBK 棋谱（《手筋辞典》濑越宪作/吴清源，来自飞扬围棋网），
   所以这一次顺带把「GBK 棋谱读进来会不会乱码」也验了。
   验四件事：
     ① 读进来：解说词是真中文（不是 U+FFFD 乱码）
     ② 显示：框里显示的是**当前看着那一手**的解说词
     ③ 保存：改完写回文件，重新读盘能拿到新文字；同时 `.bak` 备份生成了
     ④ 安全：手数没变、别的解说词没被碰 */
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

const NAME = '_test_comment.sgf';
const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};
  const NAME = ${JSON.stringify(NAME)};

  /* ---------- ① 打开这份棋谱 ---------- */
  const rd = await window.api.records.read(NAME);
  if (!rd || rd.error) return { '① 读棋谱': '★ ' + ((rd && rd.error) || '失败') };
  const p = parseSGF(rd.text);
  R['① 手数'] = p.moves.length;
  const keys = Object.keys(p.comments || {}).map(Number).filter(k => k > 0);
  R['① 带解说词的手数'] = keys.length;
  const sample = keys.length ? (p.comments[keys[0]] || '') : '';
  R['① 解说词片段'] = JSON.stringify(sample.slice(0, 34));
  R['① 是真中文（无乱码）'] = (sample.indexOf('\\uFFFD') < 0 && /[\\u4e00-\\u9fff]/.test(sample))
    ? '✓' : '★ 有替换字符或没有中文（GBK 解码可能没生效）';

  applyRecord(p, NAME);
  await sleep(200);

  /* ---------- ② 显示：跳到「有解说词的那一手」，看框里是不是那条 ---------- */
  if (!keys.length) return Object.assign(R, { '② 跳过': '这份棋谱没有带解说词的手' });
  const at = keys[0];
  gotoView(at);
  await sleep(200);
  const shown = document.getElementById('cbox').textContent || '';
  R['② 看着第几手'] = at;
  R['② 框里显示的开头'] = JSON.stringify(shown.slice(0, 30));
  R['② 与棋谱里那条一致'] = (shown.trim() === (p.comments[at] || '').trim()) ? '✓' : '★ 不一致';
  R['② 标题'] = document.getElementById('cbox-at').textContent;
  R['② 可以编辑'] = document.getElementById('cbox-edit').disabled === false ? '✓ 按钮可用' : '★ 按钮不可用';

  /* ---------- ③ 改一个，写回文件 ---------- */
  const NEW = '测试解说词 · ' + Date.now();
  const w = await saveComment(at, NEW);
  R['③ 保存结果'] = (w && w.ok) ? '✓' : ('★ ' + JSON.stringify(w));
  const rd2 = await window.api.records.read(NAME);
  const p2 = parseSGF(rd2.text);
  R['③ 重新读盘：新文字在不在'] = ((p2.comments[at] || '') === NEW) ? '✓' : ('★ 读到 ' + JSON.stringify((p2.comments[at] || '').slice(0, 30)));
  /* ④ 安全：手数不变、别的手的解说词还在 */
  R['④ 手数没变'] = (p2.moves.length === p.moves.length) ? '✓' : ('★ ' + p.moves.length + '→' + p2.moves.length);
  const others = keys.slice(1);
  R['④ 别的手解说词还在'] = others.every(k => (p2.comments[k] || '') === (p.comments[k] || ''))
    ? ('✓ 抽查 ' + others.length + ' 手') : '★ 被误改了';
  R['④ 备份 .bak'] = '（下面用命令行核）';

  /* 界面重绘后应显示新文字 */
  renderCommentBox();
  await sleep(100);
  R['③ 框里已更新'] = (document.getElementById('cbox').textContent || '').indexOf('测试解说词') >= 0 ? '✓' : '★';

  return R;
})()`);

console.log(JSON.stringify(out, null, 2));
ws.close();