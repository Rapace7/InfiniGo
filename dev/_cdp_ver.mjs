/* 检查版本号接口与显示（2026-10-06 新加）。
   为什么要有它：包名固定是 RapaceGo.zip（不带版本号），
   用户只能靠软件里的版本号判断「要不要更新」—— 这条链断了用户就没法自查。
   链子三段：main 的 app:version → preload 的 api.appVersion → 帮助面板上的 #help-ver。 */
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

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};
  R['① preload 暴露了 appVersion'] = (typeof window.api.appVersion === 'function') ? '✓' : '★ 没有';
  if (typeof window.api.appVersion !== 'function') return R;
  const v = await window.api.appVersion();
  R['② 主进程返回的版本'] = JSON.stringify(v);
  R['② 形状对不对'] = (typeof v === 'string' && /^\\d+\\.\\d+\\.\\d+$/.test(v)) ? '✓ x.y.z' : '★ 不是 x.y.z';
  /* 帮助面板上的显示（启动时异步填入，给一点时间） */
  const el = document.getElementById('help-ver');
  R['③ #help-ver 存在'] = el ? '✓' : '★ 没有这个元素';
  let txt = el ? el.textContent : '';
  if (!txt) { await sleep(1200); txt = el ? el.textContent : ''; }
  R['③ 上面显示的'] = JSON.stringify(txt);
  R['③ 与接口一致'] = (txt === 'v' + v) ? '✓' : ('★ 期望 v' + v);
  return R;
})()`);

console.log(JSON.stringify(out, null, 2));
ws.close();