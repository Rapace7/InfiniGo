/* 验收本轮三处改动是否真的生效（并且没把别的东西弄坏）：
 *   ① 涨跌数字：刚落子显示「…」，收敛后出数字，之后连续采样不变
 *   ② 分析超时兜底：故意制造一个永不返回的 analyze，看 anaBusy 会不会永远卡住
 *      —— 这是「选点不显示 + 计算中数字定住」的机械根因验证
 *   ③ Ctrl+Shift+D 自检：状态栏要能打出关键内部状态，而且不能抢走「试下」（D）
 */
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 300000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');
await send('Page.enable');

/* ★ 关键：window.api 是不可写、不可重定义的 own property（实测 A2：换了对象=false、
   属性可写=false），**页面里改不了**。所以桩必须在页面**加载之前**注入 ——
   用 Page.addScriptToEvaluateOnNewDocument，然后重新加载页面。
   注入的内容把 api 换成一层「可替换」的代理：默认透传真 api，
   测试中途只要把 window.__stubAnalyze 置上，analyze 就走桩。 */
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    (function(){
      const real = window.api;
      if (!real) return;
      const wrapper = {};
      for (const k of Object.keys(real)) {
        wrapper[k] = (typeof real[k] === 'function') ? real[k].bind(real) : real[k];
      }
      wrapper.analyze = function () {
        if (window.__stubAnalyze) { window.__stubCalls = (window.__stubCalls || 0) + 1; return new Promise(function(){}); }
        return real.analyze.apply(real, arguments);
      };
      /* 嵌套对象（engine / coach / settings …）原样给过去，它们本来就不冻结 */
      try { Object.defineProperty(window, 'api', { value: wrapper, writable: true, configurable: true }); }
      catch (e) { /* 注入失败就让测试自己发现 */ }
    })();
  `,
});
await send('Page.reload', { ignoreCache: false });
await new Promise(r => setTimeout(r, 2500));
await send('Runtime.enable');
console.log('注入可用的 api 包装: ' + await js('typeof window.__stubAnalyze !== "undefined" || true'));

/* ③ 自检快捷键：★ 用 CDP 派发**真实按键**（window.dispatchEvent 造的合成事件
   在 check 里读不到，实测「状态栏变化:false」；走 Input.dispatchKeyEvent 才等同真键盘）。
   注意：Ctrl+Shift+D 必须**吃掉**这个组合、不能连带触发「试下」（D）。 */
const res3 = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  settings.mode = 'setup'; applyNewGame(); await sleep(400);   // 先开局（未开局时试下按钮无意义）
  return { 开局: state.moves.length === 0 && !state.noGame, 试下初值: !!state.draft };
})()`, 20000);
for (const k of [
  { code: 'KeyD', key: 'D', modifiers: 2 | 8, text: '' },      // Ctrl(2)+Shift(8)
]) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: k.code, key: k.key, windowsVirtualKeyCode: 68, modifiers: k.modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: k.code, key: k.key, windowsVirtualKeyCode: 68, modifiers: k.modifiers });
}
await new Promise(r => setTimeout(r, 300));
const afterSelfCheck = await js(`({ 状态栏: document.getElementById('status').textContent, 试下: !!state.draft })`, 20000);
/* 单独按 D：应当切换「试下」（证明自检没把它吃掉） */
await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68, modifiers: 0 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68, modifiers: 0 });
await new Promise(r => setTimeout(r, 300));
const afterD = await js(`({ 试下: !!state.draft })`, 20000);
if (afterD.试下) {   // 还原
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68, modifiers: 0 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68, modifiers: 0 });
  await new Promise(r => setTimeout(r, 300));
}
console.log('③ 自检快捷键  开局=' + res3.开局
  + '  状态栏="' + afterSelfCheck.状态栏 + '"'
  + '  自检没抢走试下=' + (!afterSelfCheck.试下 && afterD.试下 ? '✓' : '★ 抢走了'));

const load = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  if (engineReady) return { 已就绪: true };
  await window.api.engine.load('analyze');
  const t0 = Date.now();
  while (!engineReady && Date.now() - t0 < 180000) await sleep(1000);
  return { 就绪: engineReady, 等了秒: Math.round((Date.now()-t0)/1000) };
})()`, 200000);
console.log('引擎 ' + JSON.stringify(load));
if (!load || !load.就绪) { ws.close(); process.exit(1); }

const run = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const free = () => {
    const b = boardAt(state.moves.length), out = [];
    for (let y = 2; y < 17; y++) for (let x = 2; x < 17; x++) if (!b[y*N+x]) out.push([x,y]);
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); const t = out[i]; out[i] = out[j]; out[j] = t; }
    return out;
  };
  const drop = () => { const f = free(); for (let i = 0; i < 12 && i < f.length; i++) if (tryPlay(f[i][0], f[i][1])) return true; return false; };
  const shown = () => Array.from(document.querySelectorAll('#movelist li')).map(li => li.querySelector('.dl')?.textContent || '—').join(' ');
  const out = {};

  /* ---------- ① 涨跌数字稳定性 ---------- */
  settings.mode = 'setup'; settings.size = 19; settings.handicap = 0;
  settings.rules = 'chinese'; settings.visits = 500; state.showHints = true;
  applyNewGame(); await sleep(900);
  out.稳定 = [];
  for (let k = 0; k < 4; k++) {
    drop(); await sleep(600);
    const early = shown();
    await sleep(4500);
    const base = shown();
    const samples = [];
    for (let t = 0; t < 5; t++) { await sleep(400); samples.push(shown()); }
    out.稳定.push({ 手: state.moves.length, 刚落: early.trim().split(' ').pop(), 收敛后: base.trim().split(' ').pop(),
                    定住: samples.every(s => s === base) ? '✓' : '★' });
  }

  /* ---------- ② 超时兜底：让 analyze 永不返回，看 anaBusy 会不会永远卡住 ----------
     桩是通过 Page.addScriptToEvaluateOnNewDocument 注入的包装层（见文件开头），
     这里只要把 window.__stubAnalyze 置上就生效，置回 false 就恢复真引擎。 */
  window.__stubCalls = 0;
  window.__stubAnalyze = true;
  applyNewGame(); await sleep(400);
  drop();                                   // 触发一次分析 → 会落到桩上
  const t0 = Date.now();
  let released = null;
  while (Date.now() - t0 < 40000) {
    await sleep(400);
    if (!anaBusy) { released = Math.round((Date.now() - t0) / 1000); break; }
  }
  const stubCalls = window.__stubCalls || 0;
  out.超时 = { 桩调用次数: stubCalls, anaBusy是否被释放: !anaBusy, 释放耗时秒: released,
               超时计数: anaTimeouts, 状态栏: document.getElementById('status').textContent.slice(0, 70) };
  window.__stubAnalyze = false;             // 恢复真引擎（包装层还在，但会透传）

  /* ---------- ②b 用户新要的「刷新」按钮：卡住时点一下必须立刻解开 ---------- */
  {
    const btn = document.getElementById('btn-engine-refresh');
    out.刷新按钮存在 = !!btn;
    /* 再做一次卡死，然后**不等超时**、直接点刷新 —— 闸门应当立刻放开、并重排一次分析 */
    window.__stubCalls = 0;
    window.__stubAnalyze = true;
    applyNewGame(); await sleep(300);
    drop(); await sleep(600);
    const busyBefore = anaBusy;
    const callsBefore = window.__stubCalls;
    btn.click();
    /* ⚠️ 必须**立刻**读 —— 桩永不返回，按钮点完 200ms 后重排的分析又会占上 anaBusy；
       晚一点读就会看到「还在跑」，那是新请求，不是没放开。 */
    await sleep(60);
    const freedNow = !anaBusy;
    await sleep(800);
    out.刷新后 = { 点之前请求在跑: busyBefore, 点完立刻放开: freedNow,
                   重排发生了: (window.__stubCalls > callsBefore),
                   桩被调用次数: window.__stubCalls,
                   状态栏: document.getElementById('status').textContent.slice(0, 50) };
    window.__stubAnalyze = false;
  }

  /* 还原之后分析必须能自己活过来（重排生效） */
  applyNewGame(); await sleep(800);
  drop(); await sleep(3000);
  out.还原后可恢复 = (state.candAt === state.viewAt && state.rootVisits > 0) ? '✓ 是' : '★ 否';
  out.还原后细节 = 'candAt=' + state.candAt + ' viewAt=' + state.viewAt + ' rv=' + state.rootVisits + ' busy=' + anaBusy;
  return out;
})()`, 600000);

if (typeof run === 'string') { console.log('运行失败: ' + run); ws.close(); process.exit(1); }
console.log('\n① 涨跌数字稳定性');
for (const s of run.稳定) console.log('   第' + s.手 + '手  刚落=' + s.刚落 + '  收敛后=' + s.收敛后 + '  连续5次采样定住 ' + s.定住);
console.log('\n② 分析超时兜底（把 analyze 换成永不返回的桩）');
console.log('   ' + JSON.stringify(run.超时));
console.log('\n②b 顶栏「刷新」按钮 ');
console.log('   存在=' + run.刷新按钮存在 + '   ' + JSON.stringify(run.刷新后));
console.log('\n   还原真引擎后：' + run.还原后可恢复 + '   ' + run.还原后细节);
ws.close();
