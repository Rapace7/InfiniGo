/* 打开「帮助」面板并停住（供外面截图），顺便把帮助里那几段关键文案取回来核对。
   用来确认：① 帮助能正常打开 ② 新增的「打谱 / 解说词」条目渲染正常（没有 `**` 漏出来） */
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
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 30000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};
  const help = document.getElementById('help');
  R['① 帮助面板存在'] = !!help ? '✓' : '★ 没有 #help';

  /* 打开帮助 */
  document.getElementById('btn-help').click();
  await sleep(400);
  R['② 打开后可见'] = (help && !help.hidden) ? '✓' : ('★ hidden=' + (help && help.hidden));

  /* ③ 关键内容是否在（用包含判断，不写死整段） */
  const txt = (help ? help.textContent : '') || '';
  R['③ 版本号已填'] = /v?\\d+\\.\\d+\\.\\d+/.test(txt) ? '✓（' + (txt.match(/v?\\d+\\.\\d+\\.\\d+/) || [''])[0] + '）' : '★ 没找到版本号';
  R['③ 有「打谱（打开棋谱）」'] = txt.indexOf('打谱（打开棋谱）') >= 0 ? '✓' : '★ 缺';
  R['③ 有「解说词（棋谱自带的评注）」'] = txt.indexOf('解说词（棋谱自带的评注）') >= 0 ? '✓' : '★ 缺';
  R['③ 提到「空行会被收掉」'] = txt.indexOf('空行会被收掉') >= 0 ? '✓' : '★ 缺';
  R['③ 提到「第 N 题 / 共 M 题」'] = txt.indexOf('第 N 题 / 共 M 题') >= 0 ? '✓' : '★ 缺';
  R['③ 棋谱库讲了搜索/导入'] = (txt.indexOf('搜索框') >= 0 && txt.indexOf('导入棋谱') >= 0) ? '✓' : '★ 缺';

  /* ④ 有没有 Markdown 的 ** 漏到界面上 */
  R['④ 界面上漏出 **'] = txt.indexOf('**') < 0 ? '✓ 没有' : ('★ 有 ' + (txt.match(/\\*\\*/g) || []).length + ' 处');

  /* ⑤ 有没有可见的 HTML 标签文本漏出来（说明标签写错） */
  R['⑤ 漏出 <b> 之类'] = /<b>|<span|&lt;/.test(txt) ? '★ 有' : '✓ 没有';

  /* 打开着的帮助滚动到「主要功能」那一段，供截图 */
  const h3 = Array.from(help.querySelectorAll('h3')).find(x => x.textContent.indexOf('主要功能') >= 0);
  if (h3) h3.scrollIntoView({ block: 'start' });
  R['⑥ 已滚到「主要功能」'] = h3 ? '✓' : '（没找到 h3）';
  return R;
})()`);

console.log(JSON.stringify(out, null, 2));
/* 面板留着不关，让外面截图 */
ws.close();
