/* 抓展示图（带分析版）：打开棋谱 → 加载 KataGo → 等分析出胜率/走势 → 截图。
   比第一版多做的事：点引擎灯加载 KataGo，等 state 里真有胜率数据再截。
   ★ 引擎加载/分析时间不确定，所以每步都有超时上限，超时也照样截图（不给用户空等）。 */
import fs from 'node:fs';

const PORT = 9333;
const OUT = process.argv[2] || 'D:/GoStudy/RapaceGo/docs/screenshots/main-with-coach.png';
const REC = process.argv[3] || null;

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

/* ---------- 1) 打开棋谱，停在中间某手（这样走势图有内容可选） ---------- */
const info = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const list = await window.api.records.list();
  const files = (list && (list.files || list.list || list)) || [];
  const names = (Array.isArray(files) ? files : []).map(f => (typeof f === 'string' ? f : (f.name || f.file))).filter(Boolean);
  if (!names.length) return { 错误: '棋谱库是空的' };
  let pick = ${JSON.stringify(REC)}, data = null, at = 0;
  for (const nm of (pick ? [pick] : names.slice(0, 4))) {
    const rd = await window.api.records.read(nm);
    if (!rd || rd.error) continue;
    const p = parseSGF(rd.text);
    const keys = Object.keys(p.comments || {}).map(Number).filter(k => k > 0).sort((a, b) => a - b);
    if (!keys.length) continue;
    let best = keys[0], blen = 0;
    for (const k of keys) { const s = (p.comments[k] || ''); if (s.length > blen) { blen = s.length; best = k; } }
    pick = nm; data = p; at = best; break;
  }
  if (!data) return { 错误: '没有带解说词的棋谱' };
  applyRecord(data, pick);
  await sleep(400);
  gotoView(at);
  await sleep(400);
  return { 棋谱: pick, 手数: data.moves.length, 停在第几手: at, 有解说: (data.comments[at] || '').length > 0 };
})()`);
console.log('① 打开棋谱: ' + JSON.stringify(info));
if (info && info.错误) { console.log('★ ' + info.错误); ws.close(); process.exit(1); }

/* ---------- 2) 加载 KataGo（引擎灯 → 加载） ---------- */
const load = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  /* 找到引擎灯里 KataGo 那一组并点「加载」 */
  const btn = Array.from(document.querySelectorAll('button, .eng, [id^="eng"]'))
    .find(b => (b.textContent || '').trim() === 'KataGo' || (b.id || '').indexOf('eng-katago') >= 0);
  if (btn) { btn.click(); await sleep(400); }
  const menu = document.querySelector('.engine-menu, #engine-menu, #engmenu');
  const loadBtn = menu ? Array.from(menu.querySelectorAll('button')).find(b => (b.textContent || '').indexOf('加载') >= 0) : null;
  if (loadBtn) { loadBtn.click(); return '已点加载'; }
  /* 没找到菜单就试 state/引擎 API */
  if (window.api && window.api.engine && window.api.engine.load) { await window.api.engine.load('katago'); return '用 API 加载'; }
  return '★ 没找到加载入口（沿用当前状态）';
})()`);
console.log('② 加载引擎: ' + load);

/* ---------- 3) 等分析数据（最多 40 秒） ---------- */
let waited = 0, hasData = false;
while (waited < 40000) {
  await new Promise(r => setTimeout(r, 2000)); waited += 2000;
  const st = await js(`(function(){
    try {
      const s = (typeof state !== 'undefined' && state) ? state : null;
      if (!s) return { ok: false };
      const own = Array.isArray(s.analysisByMove) ? s.analysisByMove.length : 0;
      const w = (s.winrate != null) ? s.winrate : (s.lastWinrate != null ? s.lastWinrate : null);
      const ready = (typeof engineReady !== 'undefined') ? !!engineReady : null;
      const bar = document.querySelector('#winrate, .winrate, #wr-b, #bar-b');
      return { ok: true, 引擎就绪: ready, 胜率: w, 分析条数: own, 有胜率条元素: !!bar };
    } catch (e) { return { ok: false, err: String(e).slice(0, 60) }; }
  })()`);
  if (st && st.ok && (st.胜率 != null || (st.分析条数 || 0) > 0)) { hasData = true; console.log('③ 拿到分析数据: ' + JSON.stringify(st) + '（等了 ' + (waited / 1000) + ' 秒）'); break; }
  if (waited % 10000 === 0) console.log('   …等待中 ' + (waited / 1000) + ' 秒  ' + JSON.stringify(st));
}
if (!hasData) console.log('③ 40 秒内没等到分析数据 —— 照样截图（不空等）');

/* 让走势图/胜率条重绘完 */
await new Promise(r => setTimeout(r, 2000));

/* ---------- 4) 截图 ---------- */
let clip = null;
try {
  const m = await send('Page.getLayoutMetrics', {});
  const css = m.result && (m.result.cssLayoutViewport || m.result.layoutViewport);
  if (css && css.clientWidth) clip = { x: 0, y: 0, width: Math.round(css.clientWidth), height: Math.round(css.clientHeight), scale: 1 };
} catch (e) { }
const shot = await send('Page.captureScreenshot', clip ? { format: 'png', clip, captureBeyondViewport: false } : { format: 'png' });
const b64 = shot.result && shot.result.data;
if (!b64) { console.log('★ 截图失败'); ws.close(); process.exit(1); }
fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log('✓ 已保存 ' + OUT + '（' + Math.round(fs.statSync(OUT).size / 1024) + ' KB' + (clip ? '，' + clip.width + '×' + clip.height : '') + '）');
ws.close();
