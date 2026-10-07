/* 验收「引擎兼容性自检」（v0.1.13 新增）+ 权重代际提示。
   本机是 N 卡 + CUDA 版引擎 → 应当报「✓ 这两者能配上」。 */
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

console.log('① 主进程自检原始返回:');
console.log('   ' + await js(`(async function(){
  try { return JSON.stringify(await window.api.engineCheck()); } catch(e) { return 'ERR ' + e.message; }
})()`, 60000));

console.log('\n② 界面按钮：打开设置 → 点「检查」→ 读那一行文字');
console.log('   ' + await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  document.getElementById('btn-settings').click();
  await sleep(800);
  const el = document.getElementById('eng-check');
  const before = el ? el.textContent : '(找不到 eng-check)';
  const btn = document.getElementById('btn-eng-check');
  if (!btn) return JSON.stringify({ 错误: '找不到检查按钮', 打开设置后: before });
  btn.click();
  /* 探测要跑一次 katago（约 0.1~1 秒），等它写结果 */
  const t0 = Date.now();
  while (el.textContent === before && Date.now() - t0 < 20000) await sleep(200);
  const cs = getComputedStyle(el);
  const out = {
    点之前: before, 点之后: el.textContent,
    颜色类: el.className, 文字颜色: cs.color,
    是绿还是红: el.classList.contains('ok') ? '✓ 绿(匹配)' : (el.classList.contains('bad') ? '★ 红(不匹配)' : '无'),
    按钮复原: btn.textContent,
  };
  document.getElementById('set-cancel') && document.getElementById('set-cancel').click();
  return JSON.stringify(out);
})()`, 60000));

console.log('\n③ 帮助面板里那几条新说明在不在');
console.log('   ' + await js(`(function(){
  const h = document.getElementById('help').innerHTML;
  return JSON.stringify({
    引擎版本与权重代际: h.indexOf('引擎版本与权重要对得上') >= 0,
    权重从哪来: h.indexOf('权重从哪来') >= 0,
    显卡品牌: h.indexOf('显卡品牌') >= 0,
    transformer字样: h.indexOf('transformer') >= 0,
    v118提示: h.indexOf('v1.18.0') >= 0,
  });
})()`));

console.log('\n④ 棋盘中央那条「具体原因」的元素在不在（未开局且引擎有错时才显示）');
console.log('   ' + await js(`(function(){
  const w = document.getElementById('gate-why');
  return JSON.stringify({ 元素存在: !!w, 当前hidden: w ? w.hidden : null, 文字: w ? w.textContent : null });
})()`));
ws.close();
