/* 摆好画面给 _rtest.py 截图：设置面板 + 鼠标停在 KataGo 那组的问号上。
   ⚠️ CDP 的 Input.dispatchMouseEvent 要**先移开再移入**才会触发 CSS :hover ——
      只发一次 mouseMoved 的话，那个点会被当成「初始位置」，hover 不生效（2026-10-05 踩过）。 */
const PORT = 9333;
import fs from 'fs';
async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 120000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '');
  return r.result?.result?.value;
}

await js(`document.getElementById('btn-settings').click();`);
await sleep(1500);

const raw = await js(`(function(){
  const q = document.querySelectorAll('.setgroup .qh')[0];
  const r = q.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
})()`);
const pos = JSON.parse(raw);

await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 });
await sleep(150);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y, buttons: 0 });
await sleep(800);

const op = await js(`getComputedStyle(document.querySelectorAll('.setgroup .qh')[0], '::after').opacity`);
console.log('设置面板已打开；鼠标停在 KataGo 问号 (' + pos.x + ',' + pos.y + ')，tooltip opacity=' + op);

/* ★ 自己截图，不等 _rtest.py —— 脚本一结束，模拟的鼠标状态就被重置了，
   交给外面截的话 hover 已经消失（2026-10-05 踩过）。 */
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result && shot.result.data) {
  fs.writeFileSync('D:/GoStudy/RapaceGo/_trash/_shot_sethelp.png', Buffer.from(shot.result.data, 'base64'));
  console.log('已截图 → _trash/_shot_sethelp.png');
} else {
  console.log('★ 截图失败：' + JSON.stringify(shot).slice(0, 200));
}

ws.close();
process.exit(0);
