/* 量 window.api.engineCheck() 的真实耗时 —— 界面上按钮点完一直显示「正在读引擎后端…」，
   要分清是「探测慢」还是「渲染端读结果的方式不对」。 */
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 120000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

console.log('① 连续调 3 次，各测耗时：');
console.log('   ' + await js(`(async function(){
  const out = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    let r = null, err = '';
    try { r = await window.api.engineCheck(); } catch(e) { err = e.message; }
    out.push({ 第几次: i+1, 毫秒: Math.round(performance.now() - t0),
               有结果: !!r, 后端: r && r.backend && r.backend.raw, 显卡品牌: r && r.gpu && r.gpu.brand, 报错: err });
  }
  return JSON.stringify(out);
})()`, 120000));

console.log('\n② 直接调 renderEngineCheck 看它写不写得进去：');
console.log('   ' + await js(`(async function(){
  const el = document.getElementById('eng-check');
  document.getElementById('btn-settings').click();
  await new Promise(r => setTimeout(r, 600));
  const r = await window.api.engineCheck();
  renderEngineCheck(r);
  return JSON.stringify({ 文字: el.textContent, 类: el.className, hidden: el.offsetParent === null ? '元素不可见' : '可见' });
})()`, 120000));

console.log('\n③ 看按钮点一次之后 5 秒内它自己的状态：');
console.log('   ' + await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const btn = document.getElementById('btn-eng-check');
  const el = document.getElementById('eng-check');
  const before = el.textContent;
  btn.click();
  const marks = [];
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    marks.push(i*200 + 'ms:' + btn.textContent + '/' + (btn.disabled?'禁':'可') + '/' + el.textContent.slice(0, 12));
    if (el.textContent !== before && el.textContent.indexOf('正在') < 0) break;
  }
  return marks.join(' | ');
})()`, 120000));
ws.close();
