/* 跨局竞态测试（2026-10-04 代码审查发现的三处同源缺陷）：
   分析 / AI 落子 / 数子 / 复盘 —— 都是「发请求 → 等结果 → 写状态」，
   如果在等待期间用户换了局，旧结果会落到新局上。
   构造办法：发起请求后**立刻**换局，等结果回来再看有没有被污染。
   修复前：① AI 会往未开局的空盘上落一手；② 新盘上会冒出上一局的胜负结果。 */
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
const errs = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push('未捕获异常: ' + (m.params.exceptionDetails?.exception?.description || '').split('\n')[0]);
};
const send = (method, params) => new Promise(res => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 300000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const t0 = Date.now();
  while ((!engineReady || !engineReadyPlay) && Date.now() - t0 < 90000) await sleep(500);
  const R = {};
  const $ = id => document.getElementById(id);

  /* ① AI 落子：请求在飞时换局 —— 旧结果不能落到新盘上 */
  settings.mode = 'play';
  settings.color = 'w';          // 我执白 → AI 执黑，空盘轮到它 → 它马上开始思考
  applyNewGame();
  await sleep(150);              // 让请求发出去（但没回来）
  applyNewGame(true);            // 立刻换回「未开局」
  R['① 换局瞬间 AI 正在思考'] = '（已切到未开局）';
  await sleep(5000);             // 等那个旧请求回来
  R['① AI 没往新盘落子'] = (state.moves.length === 0 && state.noGame)
    ? '✓ 手数 0、仍是未开局' : ('★ 手数=' + state.moves.length + ' noGame=' + state.noGame);

  /* ② 数子：请求在飞时换局 —— 新盘上不能冒出胜负结果 */
  settings.mode = 'free';
  applyNewGame();
  tryPlay(3, 3); tryPlay(15, 15);
  await sleep(300);
  $('btn-score').click();        // 数子是长请求（引擎要跑）
  await sleep(250);              // 刚发出去
  applyNewGame(true);            // 立刻换局
  await sleep(8000);             // 等数子结果回来
  R['② 数子结果没污染新局'] = (state.result === null)
    ? '✓ 新局没有终局结果' : ('★ 冒出了结果：' + JSON.stringify(state.result).slice(0, 60));
  R['② 结果条是否显示'] = $('verdict').hidden ? '✓ 隐藏' : '★ 显示着';

  /* ③ 分析（回归）：之前修过的，再确认一次 */
  settings.mode = 'free';
  applyNewGame();
  tryPlay(3, 3);
  await sleep(150);
  applyNewGame(true);
  await sleep(3000);
  R['③ 分析没污染新局'] = (Object.keys(state.history).length === 0 && state.lastEval === null
    && state.candidates.length === 0)
    ? '✓ history 空 / 无候选点 / lastEval 空' : '★ 被污染了';

  /* ④ 顺带确认守卫没有誤伤：正常换局之后功能照常 */
  settings.mode = 'free';
  applyNewGame();
  tryPlay(3, 3);
  await sleep(2500);
  R['④ 正常落子仍然有数据'] = (typeof state.history[0] === 'number' || state.lastEval)
    ? '✓ 分析照常出结果' : '（这条依赖引擎速度，仅供参考）';

  /* 收尾 */
  applyNewGame(true);
  await sleep(600);
  R['⑤ 收尾'] = 'noGame=' + state.noGame;
  return JSON.stringify(R, null, 1);
})()`);

await new Promise(r => setTimeout(r, 1000));
console.log(out);
console.log('');
console.log('=== 运行时错误 ===');
console.log(errs.length ? errs.join('\n') : '（无 ✓）');
ws.close();
process.exit(0);
