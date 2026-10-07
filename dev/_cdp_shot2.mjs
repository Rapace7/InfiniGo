/* 抓展示图（带分析版）：打开棋谱 → 加载 KataGo → 等分析出胜率/走势 → 截图。
   比第一版多做的事：点引擎灯加载 KataGo，等 state 里真有胜率数据再截。
   ★ 引擎加载/分析时间不确定，所以每步都有超时上限，超时也照样截图（不给用户空等）。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ★ 2026-10-07：脚本搬进 dev\ —— 默认输出路径按**脚本自身位置**算，
   不要再写死 D:/GoStudy/RapaceGo（换机器/换目录就废）。 */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const PORT = 9333;
/* ⚠️ 参数走环境变量 —— _rtest.py 的调用约定是
     `_rtest.py <测试脚本> <截图名> <第二段脚本> <第二张截图名>`，
   第 2 个位置参数会被它当成**截图文件名**，传不进脚本（今天在 _cdp_stuck.mjs 上踩过）。
   用法：$env:SHOT_OUT="...路径..."; $env:SHOT_REC="棋谱名.sgf" */
const OUT = process.env.SHOT_OUT || path.join(ROOT, 'docs/screenshots/main-with-coach.png');
const REC = process.env.SHOT_REC || null;

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

/* ---------- 1) 打开棋谱，停在解说最丰富的那一手 ----------
   ★ 用程序自己的 openRecord(name) —— 它内部会 parseSGF 再 applyRecord。
     2026-10-07 踩过：自己拼 `applyRecord(await records.read(nm))` 漏了 parseSGF，
     直接把 {name,note,size,mtime} 当成解析结果传进去 → applyRecord 里
     `rec.moves.map` 抛错、棋谱根本没打开，而截图照拍 —— 结果是一张**空盘**、
     还带着上一次残留的胜率条（差点当成"最新展示图"发出去）。
     ★ 另外 records.list() 返回的是**对象数组**（{name, note, size, mtime, hasReview, hasCoach}），
     不是字符串数组，取名字要用 it.name。 */
const info = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const list = (await window.api.records.list()) || [];
  const names = list.map(f => (typeof f === 'string' ? f : f.name)).filter(Boolean);
  if (!names.length) return { 错误: '棋谱库是空的（先把要展示的 .sgf 放进 records\\）' };
  let pick = ${JSON.stringify(REC)}, at = 0, total = 0;
  for (const nm of (pick ? [pick] : names.slice(0, 6))) {
    const rd = await window.api.records.read(nm);
    if (!rd || rd.error) continue;
    const p = parseSGF(rd.text);
    if (!p || !p.moves || !p.moves.length) continue;      // ★ 解析失败/空棋盘一律跳过
    const keys = Object.keys(p.comments || {}).map(Number).filter(k => k > 0).sort((a, b) => a - b);
    let best = p.moves.length, blen = 0;                  // 没有解说就停在最后一手
    for (const k of keys) { const s = (p.comments[k] || ''); if (s.length > blen) { blen = s.length; best = k; } }
    pick = nm; total = p.moves.length; at = best; break;
  }
  if (!total) return { 错误: '没有能打开的棋谱' };
  await openRecord(pick);                                 // ★ 走程序自己的路径
  await sleep(600);
  if (!state.moves.length) return { 错误: 'openRecord 之后 state.moves 仍为空' };
  gotoView(at);
  await sleep(400);
  /* ★ 推荐点默认是**关**的（2026-10-04 用户定的启动默认），展示图必须打开它 */
  const chk = document.getElementById('chk-show');
  if (!chk.checked) { chk.checked = true; chk.onchange({ target: chk }); }
  return { 棋谱: pick.slice(0, 30) + '…', 手数: state.moves.length, 停在第几手: at,
           有解说: (state.sgfComments[at] || '').length > 0, 推荐点开关: state.showHints };
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

/* ---------- 3) 等分析数据（最多 60 秒） ----------
   ★★ 判据必须是**程序里真实存在的字段**。原来查的是 state.analysisByMove / state.winrate，
      这两个字段**根本不存在** → 永远返回 null → 每张图都是"没等到数据也照样截"。
      （2026-10-07 发现，那张图因此没有推荐点。）
   现在看这三个真字段：state.candAt（这批推荐点是第几手的）、state.viewAt、state.candidates。 */
let waited = 0, hasData = false;
while (waited < 60000) {
  await new Promise(r => setTimeout(r, 2000)); waited += 2000;
  const st = await js(`(function(){
    try {
      return { 引擎就绪: !!engineReady, 推荐点开关: !!state.showHints,
               candAt: state.candAt, viewAt: state.viewAt, 候选点数: state.candidates.length,
               搜索量: state.rootVisits, 请求在跑: anaBusy, 欠账: anaQueue.length,
               胜率条: document.getElementById('eval-wr').textContent,
               走势点数: (state.history || []).filter(v => typeof v === 'number').length };
    } catch (e) { return { err: String(e).slice(0, 80) }; }
  })()`);
  const ok = st && st.引擎就绪 && st.candAt === st.viewAt && st.候选点数 > 0 && st.走势点数 > 0;
  if (ok) { hasData = true; console.log('③ 推荐点已上屏（等了 ' + (waited / 1000) + ' 秒）: ' + JSON.stringify(st)); break; }
  if (waited % 10000 === 0) console.log('   …等待中 ' + (waited / 1000) + ' 秒  ' + JSON.stringify(st));
}
if (!hasData) {
  console.log('★ 60 秒内推荐点没上屏 —— 这张图不能用（会是空盘），已放弃截图');
  ws.close();
  process.exit(1);
}

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
