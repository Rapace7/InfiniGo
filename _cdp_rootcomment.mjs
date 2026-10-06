/* 端到端：v0.1.10 的「棋谱说明」（SGF 根节点上那段文字）。
   样本是真实的 GBK 死活题集（《手筋辞典》，飞扬围棋网）——
   它的根节点说明跨 5 行、写在跨行摆放的 AB/AW 后面，正好是原来读不出来的那种。

   验六件事：
     ① 读进来：rootComment 有内容、是真中文（不是乱码）
     ② 显示：进「开局前」那一档时，右下角解说词框里显示的就是那段说明
     ③ 不串档：第 7 手的解说词**不会**跑到「开局前」这一档里（原来它俩共用 comments[0]）
     ④ 编辑：点编辑 → 框里是那段说明（且换行是 CRLF 口径）
     ⑤ 保存：改完写回文件，重新读盘能拿到新文字
     ⑥ 安全：写回后手数没变、别的解说词没被动 */
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

const NAME = '_test_rootcomment.sgf';
const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};
  const NAME = ${JSON.stringify(NAME)};
  const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

  /* ---------- ① 打开这份棋谱 ---------- */
  const rd = await window.api.records.read(NAME);
  if (!rd || rd.error) return { '① 读棋谱': '★ ' + ((rd && rd.error) || '失败') };
  const p = parseSGF(rd.text);
  R['① 手数'] = p.moves.length;
  R['① 摆子'] = p.ab.length + ' 黑 / ' + p.aw.length + ' 白';
  const rc = String(p.rootComment || '');
  R['① 棋谱说明字数'] = rc.length;
  R['① 说明开头'] = JSON.stringify(rc.slice(0, 24));
  R['① 是真中文（无乱码）'] = (rc.indexOf('\\uFFFD') < 0 && /[\\u4e00-\\u9fff]/.test(rc)) ? '✓' : '★ 乱码';
  R['① 含「第55图 黑先」'] = rc.indexOf('第55图 黑先') > 0 ? '✓' : '★ 缺';
  R['① 说明里的换行数（CRLF）'] = rc.split(CR + LF).length - 1;
  R['① 原来那个键没被占用'] = !p.comments[0] || p.comments[0].indexOf('手筋辞典') < 0 ? '✓' : '★ 仍被根节点文字占用';

  applyRecord(p, NAME);
  await sleep(250);

  /* ---------- ② 进「开局前」那一档，看框里显示什么 ---------- */
  gotoView(0);
  await sleep(250);
  const shown = document.getElementById('cbox').textContent || '';
  R['② 标题'] = document.getElementById('cbox-at').textContent;
  R['② 框里显示的开头'] = JSON.stringify(shown.slice(0, 24));
  R['② 与棋谱说明一致'] = (shown.trim() === rc.trim()) ? '✓' : '★ 不一致（框里是 ' + JSON.stringify(shown.slice(0, 20)) + '）';
  R['② 显示的是真换行'] = shown.indexOf(CR) < 0 ? '✓（div 里被规范化成 LF，渲染成换行）' : '（div 里仍含 CR，也正常）';
  R['② 编辑按钮可用'] = document.getElementById('cbox-edit').disabled === false ? '✓' : '★ 不可用';

  /* ---------- ③ 不串档：第 7 手那条不该出现在「开局前」里 ---------- */
  const keys = Object.keys(p.comments || {}).map(Number).filter(k => k > 0).sort((a,b)=>a-b);
  const firstKey = keys[0];
  const c7 = p.comments[firstKey] || '';
  R['③ 第 ' + firstKey + ' 手解说词'] = JSON.stringify(c7.slice(0, 20));
  R['③ 它没跑到「开局前」档里'] = (shown.indexOf(c7.slice(0, 8)) < 0) ? '✓' : '★ 串档了';

  /* ---------- ④ 编辑态：给的是那段说明，且是「可编辑」的形态 ----------
     ★ 判据说明（别写错）：**不能**要求 textarea.value 里是 CRLF ——
       HTML 规范规定「API value 只含 LF」，赋值时给的 CRLF 也会被规范化掉。
       所以这里验的是：
         · 内容对得上（比对时把 CRLF 归一成 LF 再比，因为拿回来必然是 LF）
         · 编辑态的 textarea 拿到的是 LF —— 这正是**现象①的机制**（显示是 CRLF、
           编辑是 LF），而现象②已由「写回时 nlForSGF 转回 CRLF」堵住（见 ⑤）。 */
  editComment();
  await sleep(200);
  const ta = document.getElementById('cbox').querySelector('textarea');
  R['④ 编辑框存在'] = ta ? '✓' : '★ 没有 textarea';
  if (ta) {
    const v = ta.value || '';
    const norm = s => String(s).split(CR + LF).join(LF);
    R['④ 编辑框开头'] = JSON.stringify(v.slice(0, 20));
    R['④ 与说明内容一致'] = (norm(v) === norm(rc)) ? '✓' : '★ 不一致';
    R['④ 编辑态是 LF（HTML 规范）'] = (v.indexOf(CR + LF) < 0) ? '✓ 预期行为' : '★ 竟然含 CRLF';
    R['④ 行数与说明一致'] = (v.split(LF).length === rc.split(CR + LF).length) ? '✓' : '★ 行数不同';
  }
  exitCommentEdit(); renderCommentBox();
  await sleep(150);

  /* ---------- ⑤ 保存：改完写回文件 ---------- */
  const NEW = '测试棋谱说明' + LF + '第二行' + LF + LF + '第四行 · ' + Date.now();
  const w = await saveComment(0, NEW, true);          // isRoot = true
  R['⑤ 保存结果'] = (w && w.ok) ? '✓' : ('★ ' + JSON.stringify(w));
  const rd2 = await window.api.records.read(NAME);
  const p2 = parseSGF(rd2.text);
  const back = String(p2.rootComment || '');
  R['⑤ 重新读盘：新文字在不在'] = (back === nlForSGF(NEW)) ? '✓' : ('★ 读到 ' + JSON.stringify(back.slice(0, 30)));
  R['⑤ 写回的是 CRLF'] = (rd2.text.indexOf(CR + CR + LF) < 0) ? '✓（没有 CRCRLF）' : '★ 出现了 CRCRLF';
  R['⑤ 文件里的说明带 CRLF'] = (back.split(CR + LF).length - 1) === 3 ? '✓' : ('实际 ' + (back.split(CR + LF).length - 1) + ' 个');

  /* ---------- ⑥ 安全：手数没变、别的解说词没被动 ---------- */
  R['⑥ 手数没变'] = (p2.moves.length === p.moves.length) ? '✓' : ('★ ' + p.moves.length + '→' + p2.moves.length);
  R['⑥ 摆子没变'] = (p2.ab.length === p.ab.length && p2.aw.length === p.aw.length) ? '✓' : '★ 变了';
  const others = keys.slice(1);
  R['⑥ 别的手解说词还在'] = others.every(k => (p2.comments[k] || '') === (p.comments[k] || ''))
    ? ('✓ 抽查 ' + others.length + ' 手') : '★ 被误改了';

  /* 界面重绘后应显示新文字 */
  renderCommentBox();
  await sleep(150);
  R['⑥ 框里已更新'] = (document.getElementById('cbox').textContent || '').indexOf('测试棋谱说明') >= 0 ? '✓' : '★';
  return R;
})()`);

console.log(JSON.stringify(out, null, 2));
ws.close();
