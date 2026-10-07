/* 通用小工具：把一个**独立的注入脚本文件**读出来，丢进页面执行，打印返回值。
 *
 * 为什么要这个：前面几次踩了「在模板串里写注入代码」的坑 ——
 * 模板串会把反斜杠转义吃掉（写 `\n`、写正则都会出事），报的又是很难懂的
 * 「SyntaxError: Invalid or unexpected token」。把注入代码放独立文件（.js）
 * 就没有任何转义问题，编辑器也能高亮、能单独检查语法。
 *
 * 用法： node _cdp_runfile.mjs <注入脚本.js> [调试端口]
 */
import { readFileSync } from 'node:fs';

/* 注入脚本路径：命令行第一个参数，或者环境变量 INJECT。
   ★ 为什么还要认环境变量：`_rtest.py` 把**每个命令行参数**都当成一个测试脚本去跑，
   所以 `_rtest.py _cdp_runfile.mjs _inject_xxx.js` 会把注入脚本也当成"要单独跑的脚本"
   （它就跑在 node 里、没有页面环境，于是报 `settings is not defined`）。
   用环境变量就没有这个歧义。（2026-10-07 踩到。） */
const file = process.argv[2] || process.env.INJECT;
if (!file) { console.error('用法: node _cdp_runfile.mjs <注入脚本.js> [端口]，或设 INJECT=<路径>'); process.exit(1); }
const PORT = Number(process.argv[3] || process.env.CDP_PORT || 9333);

async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('连不上调试端口 ' + PORT);
}
const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise(res => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');

const expr = readFileSync(file, 'utf8');
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 300000 });
if (r.result && r.result.exceptionDetails) {
  console.log('页面里报错: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]);
  process.exitCode = 1;
} else {
  const v = r.result?.result?.value;
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
}
ws.close();
