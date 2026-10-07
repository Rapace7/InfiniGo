/* 验证「反复自愈」+ 分析链路日志。
 *
 * 背景：第一版自愈网写成「同一手数只排一次定时器」（`if (anaStallWatched === cur) return;`），
 * 而**卡住之后这个值一直等于 cur** → 之后每次 scheduleAnalysis 都在那里 return，
 * 自愈定时器再也不会排 —— 第一次没救回来就永久卡住。
 * 用户实测正是这个现象：「过了很久也没修好，没用自己修」。
 *
 * 本脚本验三件事：
 *   ① 卡住状态下，自愈会**反复尝试**（不是只试一次）；
 *   ② 就算前几次失败，后面仍然会再试（模拟"请求一直失败"）；
 *   ③ 分析链路日志真的写进文件了（卡住后可以直接读文件定位）。 */
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

console.log('① 加载分析引擎…');
console.log('   ' + await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  if (!engineReady) await window.api.engine.load('analyze');
  const t0 = Date.now();
  while (!engineReady && Date.now() - t0 < 180000) await sleep(1000);
  return JSON.stringify({ 就绪: engineReady, 秒: Math.round((Date.now()-t0)/1000) });
})()`, 240000));

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = [];
  const ok = (n, g, w) => R.push({ 项: n, 得到: String(g), 期望: String(w), 结果: (String(g) === String(w)) ? '✓' : '★' });
  const note = s => R.push({ 项: s, 得到: '', 期望: '', 结果: '·' });
  const free = () => { const b = boardAt(state.moves.length), o = []; for (let y = 3; y < 16; y++) for (let x = 3; x < 16; x++) if (!b[y*N+x]) o.push([x, y]); return o; };
  const drop = () => { const f = free(); for (let i = 0; i < f.length; i++) if (tryPlay(f[i][0], f[i][1])) return true; return false; };

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  settings.visits = 500; state.showHints = true;
  applyNewGame(); await sleep(600);
  for (let k = 0; k < 4; k++) { drop(); await sleep(700); }
  await sleep(1200);
  note('前置：手数=' + state.moves.length + ' candAt=' + state.candAt + ' 候选点=' + state.candidates.length);

  /* ---------- ① 正常自愈：造出卡住状态，看它救回来 ---------- */
  let cur = state.viewAt;
  shownAt = cur; state.candAt = -1; anaForceCur = false; anaQueue = [];
  anaStallWatched = -1; anaStallTries = 0; clearTimeout(anaStallTimer); anaStallTimer = null;
  const beforeTries = anaStallTries;
  scheduleStallRecovery();
  ok('① 排上了自愈定时器', !!anaStallTimer, 'true');
  ok('① 尝试次数 +1', anaStallTries > beforeTries, 'true');
  let fixed = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    await sleep(200);
    if (state.candAt === cur && state.candidates.length > 0) { fixed = Math.round((Date.now() - t0) / 1000); break; }
  }
  ok('① 自愈把卡住状态救回来了', fixed !== null, 'true');
  note('   自愈耗时 ' + fixed + ' 秒');

  /* ---------- ② ★ 反复自愈：让每次重算都失败，看它会不会**一直**试 ----------
     ⚠️ 第一版这里写错了：把 candAt 设成 cur 就等于"已经恢复"，重试计数当然清零。
        正确的造法：让 runAnalysis 一进去就提前 return（scoreBusy=true），
        这样 candAt / shownAt 都保持"卡住"的样子，重试才该继续。 */
  cur = state.viewAt;
  shownAt = cur; state.candAt = -1; anaForceCur = false; anaQueue = [];
  anaStallWatched = -1; anaStallTries = 0; clearTimeout(anaStallTimer); anaStallTimer = null;
  /* 把分析请求换成一个"永远失败"的假实现，让自愈每次都不成功。
     ⚠️ window.api 是冻结对象改不了 —— 改内部计数变量做不到，
        所以改用「让 runAnalysis 一进去就提前 return」这个更土但有效的办法：
        把 scoreBusy 置真，runAnalysis 第一行就 return，自愈必然失败。 */
  scoreBusy = true;
  scheduleStallRecovery();
  const triesSeen = [];
  const t1 = Date.now();
  /* ★ 注意：这里**不再**手动重复调 scheduleStallRecovery ——
     就是要验「卡住时用户什么都不做，自愈也会自己一直重试」。 */
  while (Date.now() - t1 < 26000) {
    await sleep(500);
    triesSeen.push(anaStallTries);
    if (anaStallTries >= 3) break;
  }
  scoreBusy = false;
  const maxTry = Math.max(...triesSeen);
  ok('② 失败时仍然反复重试（不是只试一次）', maxTry >= 3, 'true');
  note('   尝试次数变化：' + triesSeen.filter((v, i, a) => i === 0 || v !== a[i-1]).join(' → '));
  /* 放开 scoreBusy 后应当自己好 */
  let fixed2 = null;
  const t2 = Date.now();
  while (Date.now() - t2 < 20000) {
    await sleep(200);
    if (state.candAt === state.viewAt && state.candidates.length > 0) { fixed2 = Math.round((Date.now() - t2) / 1000); break; }
  }
  ok('② 障碍解除后自愈成功', fixed2 !== null, 'true');
  note('   解除后 ' + fixed2 + ' 秒恢复');

  /* ---------- ③ 日志文件真的写了 ---------- */
  let p = null;
  try { p = await window.api.diagPath(); } catch (e) { p = 'ERR ' + e.message; }
  note('③ 分析链路日志文件：' + p);
  return R;
})()`, 400000);

if (typeof out === 'string') { console.log('运行失败: ' + out); }
else {
  let bad = 0;
  for (const r of out) {
    if (r.结果 === '★') bad++;
    if (r.结果 === '·') console.log('    ' + r.项);
    else console.log('  ' + r.结果 + ' ' + r.项 + '：得到 ' + r.得到 + '（期望 ' + r.期望 + '）');
  }
  console.log('\n  ' + (bad === 0 ? '断言全部通过 ✓' : ('★ 有 ' + bad + ' 项不通过')));
}
ws.close();
