/* 查「检查」按钮为什么点不动：句柄在不在、onclick 绑没绑、被谁遮住了。 */
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

console.log('① 元素与句柄:');
console.log('   ' + await js(`JSON.stringify({
  元素在: !!document.getElementById('btn-eng-check'),
  全局变量btnEngCheck: typeof btnEngCheck,
  onclick类型: typeof (document.getElementById('btn-eng-check') || {}).onclick,
  disabled: document.getElementById('btn-eng-check').disabled,
})`));

console.log('\n② 点一次，看同步与 1 秒后的状态:');
console.log('   ' + await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const b = document.getElementById('btn-eng-check'), el = document.getElementById('eng-check');
  b.click();
  const now = { 文字: b.textContent, disabled: b.disabled, 结果区: el.textContent.slice(0, 20) };
  await sleep(1000);
  return JSON.stringify({ 点完立刻: now, 一秒后: { 文字: b.textContent, disabled: b.disabled, 结果区: el.textContent.slice(0, 40) } });
})()`, 60000));

console.log('\n③ 设置面板是不是真开着（自检那一行在不在可视区）:');
console.log('   ' + await js(`(function(){
  const m = document.getElementById('settings');
  const row = document.getElementById('eng-check').closest('.setrow');
  const r = row ? row.getBoundingClientRect() : null;
  return JSON.stringify({
    遮罩类: m ? m.className : '(无)',
    面板开着: m ? m.classList.contains('open') : null,
    自检行位置: r ? (Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)) : '(找不到)',
    行内元素: row ? Array.from(row.children).map(c => c.tagName + '#' + (c.id||'') + '.' + (c.className||'')) : null,
  });
})()`));

console.log('\n④ 用 disabled=false 强制后再点:');
console.log('   ' + await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const b = document.getElementById('btn-eng-check'), el = document.getElementById('eng-check');
  b.disabled = false;
  b.click();
  await sleep(900);
  return JSON.stringify({ 文字: b.textContent, disabled: b.disabled, 结果区: el.textContent.slice(0, 60) });
})()`, 60000));
ws.close();
