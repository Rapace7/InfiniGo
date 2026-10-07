/* 懒人包自检（跑在 _rtest.py 启动的实例里，启动方式与真实一致）：
   把软件**实际解析出来的引擎路径**读出来，看它是不是指向懒人包上一级的 KataGo。
   ★ 用 api.settings.check —— 它按主进程真实 PATHS 去检查文件存在性，骗不了人。 */
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
  const R = {};
  R['① 标题'] = document.title || '(空)';
  R['② 版本'] = ((document.getElementById('help-ver') || {}).textContent || '(未打开帮助)');

  /* 主进程**真实**用的路径 + 文件存在性检查 */
  try {
    const cfg = await window.api.settings.get();
    const c = (cfg && (cfg.config || cfg.paths || cfg)) || {};
    R['③ 解析出的 katago'] = c.katago || '(空)';
    R['③ 解析出的 analyzeWeight'] = c.analyzeWeight || '(空)';
    R['③ 解析出的 coachServer'] = c.coachServer || '(空)';
  } catch (e) { R['③ settings.get'] = '★ ' + String(e).slice(0, 100); }

  try {
    const ck = await window.api.settings.check();
    R['④ 存在性检查（主进程实测）'] = ck;
  } catch (e) { R['④ settings.check'] = '★ ' + String(e).slice(0, 100); }

  /* 真加载一次引擎 —— 能找到文件才可能就绪 */
  try {
    if (window.api && window.api.engine && window.api.engine.load) {
      await window.api.engine.load('katago');
      R['⑤ 调 load(katago)'] = '✓ 已调';
    }
  } catch (e) { R['⑤ 调 load'] = '★ ' + String(e).slice(0, 100); }
  return R;
})()`);

console.log(JSON.stringify(out, null, 2));

/* 在 Node 层轮询引擎就绪（不能在页面上下文里调 js） */
let ready = null;
for (let i = 0; i < 16; i++) {
  await new Promise(r => setTimeout(r, 1500));
  ready = await js('(typeof engineReady !== "undefined") ? !!engineReady : null');
  if (ready === true) { console.log('⑥ 引擎就绪: ✓ 加载成功（等了 ' + ((i + 1) * 1.5).toFixed(1) + ' 秒）'); break; }
}
if (ready !== true) console.log('⑥ 引擎就绪: ★ 24 秒内没就绪（last=' + JSON.stringify(ready) + '）');
ws.close();
