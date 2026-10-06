/* 抓展示图：打开一份真实棋谱（带绝艺解说）+ 停在有解说的一手，然后**用 CDP 页面截图**存盘。
   用途：README 的「主界面」展示图（原来那张是空棋盘，看不出软件能干什么）。
   ★ 用 Page.captureScreenshot 而不是窗口截图：拿到的是干净的渲染画面，不含窗口边框/标题栏。 */
import fs from 'node:fs';

const PORT = 9333;
const OUT = process.argv[2] || 'D:/GoStudy/RapaceGo/docs/screenshots/main-with-coach.png';
const REC = process.argv[3] || null;          // 指定棋谱名（默认挑第一份）

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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 60000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');
await send('Page.enable');

/* ---------- 1) 打开棋谱、停到有解说的一手 ---------- */
const info = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const list = await window.api.records.list();
  const files = (list && (list.files || list.list || list)) || [];
  const names = (Array.isArray(files) ? files : []).map(f => (typeof f === 'string' ? f : (f.name || f.file))).filter(Boolean);
  if (!names.length) return { 错误: '棋谱库是空的' };

  /* 挑一份带解说词的（逐个试，最多 4 份） */
  let pick = ${JSON.stringify(REC)}, data = null, at = 0;
  const tryList = pick ? [pick] : names.slice(0, 4);
  for (const nm of tryList) {
    const rd = await window.api.records.read(nm);
    if (!rd || rd.error) continue;
    const p = parseSGF(rd.text);
    const keys = Object.keys(p.comments || {}).map(Number).filter(k => k > 0).sort((a, b) => a - b);
    if (!keys.length) continue;
    /* 挑解说最长的那一手（展示效果好） */
    let best = keys[0], blen = 0;
    for (const k of keys) { const s = (p.comments[k] || ''); if (s.length > blen) { blen = s.length; best = k; } }
    pick = nm; data = p; at = best;
    break;
  }
  if (!data) return { 错误: '这几份棋谱都没有解说词' };

  applyRecord(data, pick);
  await sleep(400);
  if (typeof gotoView === 'function') gotoView(at);
  await sleep(600);
  return {
    棋谱: pick,
    手数: data.moves.length,
    停在第几手: at,
    解说词长度: (data.comments[at] || '').length,
    解说词开头: (data.comments[at] || '').slice(0, 40),
  };
})()`);
console.log('打开棋谱: ' + JSON.stringify(info, null, 1));
if (info && info.错误) { console.log('★ ' + info.错误); ws.close(); process.exit(1); }

/* 让画面稳一会儿（分析结果、走势图重绘） */
await new Promise(r => setTimeout(r, 2500));

/* ---------- 2) 页面截图 ---------- */
let clip = null;
try {
  const m = await send('Page.getLayoutMetrics', {});
  const css = m.result && (m.result.cssLayoutViewport || m.result.layoutViewport);
  if (css && css.clientWidth) {
    clip = { x: 0, y: 0, width: Math.round(css.clientWidth), height: Math.round(css.clientHeight), scale: 1 };
  }
} catch (e) { }

const shot = await send('Page.captureScreenshot', clip ? { format: 'png', clip, captureBeyondViewport: false } : { format: 'png' });
const b64 = shot.result && shot.result.data;
if (!b64) { console.log('★ 截图失败: ' + JSON.stringify(shot).slice(0, 300)); ws.close(); process.exit(1); }
fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log('✓ 已保存 ' + OUT + '（' + Math.round(fs.statSync(OUT).size / 1024) + ' KB' + (clip ? '，' + clip.width + '×' + clip.height : '') + '）');
ws.close();
