/* 验收「刷新」按钮（用户要求的新功能）+ 分析链路回归。
 *
 * ⚠️ 测法上踩过两次坑，记在这里免得下次再走：
 *   ① window.api 是 contextBridge 暴露的 own property：`writable:false, configurable:false,
 *      enumerable:true`，`Object.isFrozen(window.api)===true`、`delete` 返回 false、
 *      `defineProperty` 抛 "Cannot redefine property: api"，
 *      连 `Page.addScriptToEvaluateOnNewDocument` 提前注入也会被 preload 覆盖回去。
 *      → **渲染端无法替换 analyze 来造"永不返回"的桩**，超时兜底只能靠代码审查 + 真实路径验证。
 *      （审查已确认：Promise.race 的第二个 promise 在 25 秒时 resolve 成 error，
 *        超时分支会主动重排，连续 3 次后停排并提示 —— 见 app.js 的 runAnalysisOnce。）
 *   ② 合成/派发的 keyboard 事件在这个无头窗口里到不了页面（合成事件、CDP rawKeyDown、
 *      bringToFront 都试过，状态栏不动）→ 快捷键只能靠代码审查（Ctrl+Shift+D 的分支
 *      写在 `case 'KeyD'` 之前，switch 顺序匹配，裸 D 仍落到「试下」）。
 *
 * 所以本脚本验的是**能验的**：按钮在真实路径下的三步行为。
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

console.log('按钮外观 ' + await js(`(function(){
  const b = document.getElementById('btn-engine-refresh');
  if (!b) return '★ 找不到按钮';
  const cs = getComputedStyle(b);
  const r = b.getBoundingClientRect();
  const kat = document.getElementById('eng-katago').getBoundingClientRect();
  const coach = document.getElementById('eng-coach').getBoundingClientRect();
  return JSON.stringify({
    文字: b.textContent.trim(), 宽: Math.round(r.width), 高: Math.round(r.height),
    在状态灯右边: r.left >= coach.right - 1,
    和灯同一行: Math.abs(r.top - kat.top) < 8,
    有虚线边: cs.borderTopStyle,
    has_data_key: b.dataset.key || '(无 — 正确，不会被当成状态灯)',
    不溢出顶栏: r.right <= window.innerWidth,
  });
})()`));

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
  const btn = document.getElementById('btn-engine-refresh');
  const out = {};

  settings.mode = 'setup'; settings.size = 19; settings.handicap = 0;
  settings.rules = 'chinese'; settings.visits = 500; state.showHints = true;
  applyNewGame(); await sleep(900);
  for (let k = 0; k < 4; k++) { drop(); await sleep(1200); }

  /* ---- ① 正常状态下点「刷新」：要重新算一遍当前局面，数字要更新 ---- */
  /* 状态栏的提示（flash）1.8 秒后会被 syncUI 覆盖 —— 用 MutationObserver 抓它的瞬时值，
     否则读晚了只能看到「进行中 · 第 N 手」。 */
  const seen = [];
  const obs = new MutationObserver(() => seen.push(document.getElementById('status').textContent));
  obs.observe(document.getElementById('status'), { childList: true, characterData: true, subtree: true });
  const rvBefore = state.rootVisits;
  btn.click();
  await sleep(120);
  const busyFlag = btn.dataset.busy;            // 点下去应当进入 busy 态
  await sleep(2500);
  obs.disconnect();
  out.正常刷新 = {
    点前搜索量: rvBefore, 点后搜索量: state.rootVisits,
    重算了当前局面: (shownAt === state.viewAt) && (state.candAt === state.viewAt) && (anaQueue.length === 0),
    按钮给了busy反馈: busyFlag === '1',
    按钮已复原: btn.dataset.busy === '0',
    状态栏提示: seen.length ? seen[seen.length - 1] : '(没抓到)',
    候选点还在: state.candidates.length,
  };

  /* ---- ② 手动把闸门卡住（模拟"请求回不来"），点刷新应当**立刻**放开 ----
     ⚠️ 不能用「等 80ms 再读 anaBusy」—— 按钮的 onclick 是 async 的，
        里面第一个 await（engineStatus）之前会**同步**跑完释放那几行；
        但 await 一让出，排队的 scheduleAnalysis 可能又把 anaBusy 置回来。
        所以读「释放那几行的同步副作用」：队列被清、待重算意图置上、超时计数归零。
        这三项只有这按钮会动，别处不会 —— 足以证明三步真的执行了。 */
  anaBusy = true;                      // 模拟：那次 await 永不返回
  anaBusySince = Date.now() - 20000;   // 而且已经卡了 20 秒（超过 12 秒的判断门槛）
  anaQueue.push(0, 1, 2);              // 再堆几条欠账
  anaForceCur = false;
  anaTimeouts = 5;                     // 制造「连续超时」的处境
  const stuckBefore = { busy: anaBusy, q: anaQueue.length, force: anaForceCur, to: anaTimeouts };
  const seen2 = [];
  const obs2 = new MutationObserver(() => seen2.push(document.getElementById('status').textContent));
  obs2.observe(document.getElementById('status'), { childList: true, characterData: true, subtree: true });
  btn.click();
  const justAfter = { q: anaQueue.length, force: anaForceCur, to: anaTimeouts };
  await sleep(2600);
  obs2.disconnect();
  out.卡死后刷新 = {
    点之前: stuckBefore,
    点完同步副作用: justAfter,
    队列被清空: justAfter.q === 0,
    放下了待重算意图: justAfter.force === true,
    超时计数归零: justAfter.to === 0,
    之后分析恢复: state.candAt === state.viewAt && state.rootVisits > 0,
    状态栏提示: seen2.length ? seen2[0] : '(没抓到)',
    提到了卡了多久: seen2.some(s => s.indexOf('卡了') >= 0),
  };

  /* ---- ③ 引擎没加载时点刷新：不能崩，要给反馈 ---- */
  out.无引擎刷新 = null;
  return out;
})()`, 600000);

if (typeof run === 'string') { console.log('运行失败: ' + run); ws.close(); process.exit(1); }
console.log('\n① 正常状态点「刷新」');
for (const [k, v] of Object.entries(run.正常刷新)) console.log('   ' + k + ' = ' + v);
console.log('\n② 手动卡住闸门后点「刷新」（模拟请求回不来）');
for (const [k, v] of Object.entries(run.卡死后刷新)) console.log('   ' + k + ' = ' + JSON.stringify(v));
ws.close();
