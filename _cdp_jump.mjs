/* 量「手数列表里胜率涨跌会变」到底变多少、为什么变。
 *
 * 用户报（2026-10-06 晚）：
 *   「我下完一手后显示一个数字，过会儿再点回去看，又会跳到另一个数字。
 *     比如原本算是亏的，再点一次看，就是不亏了。这是不是计算时间太短导致的？」
 *
 * 代码事实（先钉死）：
 *   · 第 i 手（1-based）的涨跌 = (history[i] − history[i-1]) × 100，带一位小数。
 *   · history 的**唯一写入口**是 rememberEval(at, win, lead)，它会被每一次
 *     针对同一个 at 的分析结果覆盖 —— 包括「补历史欠账」和「回看时重算当前局面」。
 *   · 所以数字会变 ⟺ 同一个 at 被算了不止一次，且两次的搜索量/结果不同。
 *
 * 本脚本在页面里挂一层 rememberEval 的钩子，把所有写入原样记下来（at、访问量、值），
 * 然后按用户的操作顺序走一遍：落子 → 立刻记 → 回看前面几手 → 回最新 → 再点回去看。
 * 最后把「同一手被写了几次、每次差多少」逐条打出来。
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 180000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

/* 钩子：包一层 applyAnalysis 拿到本次的 root.visits，再包一层 rememberEval 记下每次写入。
   ⚠️ 两个都是函数声明（会提升），重新赋值即可 —— 内部调用走的是同一个绑定。
   注意：这里只记录、不改行为，避免"观测者效应"。 */
const HOOK2 = `
window.__rt = []; window.__lastV = -1;
(function(){
  const oa = applyAnalysis;
  window.applyAnalysis = function(p, at) {
    window.__lastV = (p && p.root && p.root.visits) || 0;
    return oa.apply(this, arguments);
  };
  const or = rememberEval;
  window.rememberEval = function(at, w, l) {
    window.__rt.push({ t: Date.now(), at: at, win: w, vis: window.__lastV,
                       from: (new Error()).stack.split('\\n')[2].trim().replace(/^at\\s+/, '').slice(0, 60) });
    return or.apply(this, arguments);
  };
})();
'snap ok'`;

const p0 = await js(HOOK2, 15000);
console.log('钩子: ' + p0);
if (p0 !== 'snap ok') { console.log('注入失败'); ws.close(); process.exit(1); }

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
  settings.mode = 'setup'; settings.size = 19; settings.handicap = 0;
  settings.rules = 'chinese'; settings.visits = 500; state.showHints = true;
  applyNewGame();
  await sleep(900);

  const free = () => {
    const b = boardAt(state.moves.length), out = [];
    for (let y = 2; y < 17; y++) for (let x = 2; x < 17; x++) if (!b[y*N+x]) out.push([x,y]);
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); const t = out[i]; out[i] = out[j]; out[j] = t; }
    return out;
  };
  const drop = () => { const f = free(); for (let i = 0; i < 12 && i < f.length; i++) if (tryPlay(f[i][0], f[i][1])) return true; return false; };
  /* 把当前 movelist 上每一手右侧显示的涨跌文字抓下来（就是用户看到的东西） */
  const shown = () => Array.from(document.querySelectorAll('#movelist li')).map(li => {
    const n = li.querySelector('.no')?.textContent || '';
    const d = li.querySelector('.dl')?.textContent || '—';
    return n + ':' + d;
  }).join(' ');
  /* history 的原值（一位小数会掩盖差异，所以要看原值） */
  const hist = () => state.history.map(v => (typeof v === 'number' ? (v*100).toFixed(3) : '·')).join(',');

  const steps = [];
  const snapshot = tag => steps.push({ tag, 手数: state.moves.length, 看: state.viewAt,
      列表: shown(), history: hist(), rt条数: window.__rt.length });

  /* ① 连落 6 手，每手等 2.5 秒（给足分析时间，模拟"正常下棋"） */
  for (let k = 0; k < 6; k++) { drop(); await sleep(2500); }
  await sleep(2500);
  snapshot('连落6手+等2.5s');

  /* ①b ★ 关键验收：数字的契约是「**收敛之后不再变**」，而不是「一开始就准」。
     所以量两件事：
       (a) 刚落子时那一格显示的是不是「…」（还没算准 → 不许摆数字）；
       (b) 收敛后连续采样 6 次（每 400ms），列表文字必须**一个字都不变**。 */
  const stable = [];
  {
    applyNewGame(); await sleep(900);
    for (let k = 0; k < 5; k++) {
      drop();
      await sleep(700);
      const early = shown();
      await sleep(4500);                       // 等收敛
      const base = shown();
      const samples = [];
      for (let t = 0; t < 6; t++) { await sleep(400); samples.push(shown()); }
      const allSame = samples.every(s => s === base);
      const col = s => s.trim().split(' ').pop();
      stable.push({ 手: state.moves.length, 刚落时: col(early), 收敛后: col(base),
                    采样: samples.map(col).join(' '),
                    数字稳定: allSame ? '✓' : '★ 变了',
                    整表稳定: samples.every(s => s === base) ? '✓' : '★ 变了' });
    }
  }

  /* ② 回看第 2 手 → 第 1 手 → 第 3 手，各停 1.2 秒 */
  gotoView(2); await sleep(1200); snapshot('回看第2手');
  gotoView(1); await sleep(1200); snapshot('回看第1手');
  gotoView(3); await sleep(1200); snapshot('回看第3手');

  /* ③ 回最新 */
  gotoView(state.moves.length); await sleep(2500); snapshot('回最新+等2.5s');

  /* ④ 再回看点一遍（用户说"过会儿再点回去看"） */
  gotoView(2); await sleep(1500); snapshot('再回看第2手');
  gotoView(1); await sleep(1500); snapshot('再回看第1手');
  gotoView(state.moves.length); await sleep(2500); snapshot('再回最新');

  /* ⑤ 悔棋一手再落一手（换一手重下） */
  $('btn-undo').click(); await sleep(2000); snapshot('悔棋1手');
  drop(); await sleep(2500); snapshot('重落一手');
  $('btn-undo').click(); await sleep(2000); snapshot('再悔棋');
  drop(); await sleep(2500); snapshot('再重落');

  return { steps, stable, rt: window.__rt };
})()`, 600000);

if (typeof run === 'string') { console.log('运行失败: ' + run); ws.close(); process.exit(1); }

console.log('\n===== 每一步界面上显示的东西 =====');
for (const s of run.steps) {
  console.log('[' + s.tag + '] 手' + s.手数 + ' 看' + s.看 + ' rt=' + s.rt条数);
  console.log('   列表: ' + s.列表);
  console.log('   原值: ' + s.history);
}

console.log('\n===== ★ 验收：刚落子时是「…」，收敛后数字定住不变 =====');
for (const s of run.stable) {
  console.log('第' + s.手 + '手  刚落时=' + s.刚落时 + '  收敛后=' + s.收敛后
    + '  连续6次采样=[' + s.采样 + ']  数字' + s.数字稳定 + '  整表' + s.整表稳定);
}

/* 统计：每个 at 被 rememberEval 写了几次、值差多少 */
const byAt = new Map();
for (let i = 0; i < run.rt.length; i++) {
  const r = run.rt[i];
  if (!byAt.has(r.at)) byAt.set(r.at, []);
  byAt.get(r.at).push(r);
}
console.log('\n===== 同一个 at 被写了多少次（数字会不会跳的根源）=====');
let jumps = 0;
for (const at of [...byAt.keys()].sort((a, b) => a - b)) {
  const list = byAt.get(at);
  if (list.length < 2) continue;
  const wins = list.map(x => (x.win * 100));
  const spread = Math.max(...wins) - Math.min(...wins);
  const vis = list.map(x => x.vis).join('/');
  const froms = [...new Set(list.map(x => x.from))].slice(0, 3).join(' ;; ');
  if (spread * 100 >= 0.05) jumps++;
  console.log('at=' + at + ' 写了 ' + list.length + ' 次  访问量=[' + vis + ']  胜率%=' +
    wins.map(v => v.toFixed(3)).join(', ') + '  极差=' + spread.toFixed(3) + '%');
  console.log('    来源: ' + froms);
}
console.log('\n★ 会让列表数字变动的 at 个数（极差≥0.05%）= ' + jumps + ' / 共 ' + byAt.size + ' 个 at');
ws.close();
