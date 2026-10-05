/* 看左栏布局：落几手让手数列表有内容，然后量一下三栏宽度、棋盘大小 */
const PORT = 9333;
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
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 120000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '');
  return r.result?.result?.value;
}

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  settings.mode = 'free';            /* 摆棋模式：自己两边都能下，不惊动 AI 引擎 */
  applyNewGame();
  await sleep(300);
  const pts = [[3,3],[15,15],[3,15],[15,3],[9,9],[2,2],[16,16],[9,3],[3,9],[9,15]];
  for (const p of pts) { tryPlay(p[0], p[1]); await sleep(120); }
  await sleep(700);

  const w = el => Math.round(el.getBoundingClientRect().width);
  const left = document.querySelector('.left');
  const R = {
    窗口: innerWidth + ' x ' + innerHeight,
    左栏宽: left ? w(left) : '★ 没有左栏',
    棋盘宽: w(document.getElementById('board')),
    右栏宽: w(document.querySelector('.side')),
    手数条目数: document.querySelectorAll('#movelist li').length,
    '手数在左栏里': !!document.querySelector('.left #movelist') ? '✓' : '★ 不在',
    '两个讲解框': (document.querySelector('.left #explain-body') && document.querySelector('.left #pick-body')) ? '✓' : '★ 缺',
    '三个卡的高度': [...left.children].map(c => Math.round(c.getBoundingClientRect().height)).join(' / '),
    '底栏/顶栏高度': Math.round(document.querySelector('.bottombar').getBoundingClientRect().height)
      + ' / ' + Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
  };
  return JSON.stringify(R, null, 1);
})()`);

console.log(out);
ws.close();
process.exit(0);
