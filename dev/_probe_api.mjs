/* 弄清 window.api 到底是个什么属性 —— 决定超时兜底能不能用桩验证。 */
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
await send('Page.enable');

const probe = `
(function(){
  const d = Object.getOwnPropertyDescriptor(window, 'api');
  return JSON.stringify({
    ownDesc: d ? { writable: d.writable, configurable: d.configurable, enumerable: d.enumerable,
                   hasGet: !!d.get, hasValue: 'value' in d } : null,
    frozen: Object.isFrozen(window.api),
    ctor: window.api && window.api.constructor && window.api.constructor.name,
    keys: window.api ? Object.keys(window.api).length : -1,
  });
})()`;
console.log('原本 ' + await js(probe));

/* 试着删掉 / 重定义 */
console.log('删除 ' + await js(`(function(){ try { return delete window.api; } catch(e){ return 'ERR '+e.message; } })()`));
console.log('删后 ' + await js(probe));
/* 删不掉就用 defineProperty 强上（configurable=false 时必失败，看它怎么说） */
console.log('强定义 ' + await js(`(function(){
  try { Object.defineProperty(window, 'api', { value: { probe: 1 }, writable: true, configurable: true }); return 'ok: ' + (window.api.probe === 1); }
  catch(e) { return 'ERR ' + e.message; }
})()`));
console.log('再看 ' + await js(probe));
ws.close();
