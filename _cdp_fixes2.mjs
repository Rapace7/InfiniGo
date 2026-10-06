/* 验证这一批的两处界面行为（2026-10-06 审查修复）：
   ① 回看历史手时点「悔棋」应当被拒绝（原来会撤掉**最后一手**、画面还乱跳）
   ② 结果条按叉关掉后**不该被下次刷新弹回来**（原来只隐藏，renderVerdict 又显示）
   ③ 数子把「数的是第几手」钉在发起时（at0）—— 这里顺带确认那个变量存在且被两处引用
   （③ 要引擎才能端到端验，这里只做代码级确认；逻辑本身是「同一个值用两处」，
     读代码即可判定，无法在无引擎情况下模拟 await 期间的 viewAt 变化。） */
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 30000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};
  const $b = id => document.getElementById(id);

  settings.mode = 'edit'; settings.size = 19; settings.handicap = 0; applyNewGame();
  for (const [x, y] of [[3,3],[15,3],[3,15],[15,15],[9,9]]) { tryPlay(x, y); await sleep(60); }

  /* ---------- ① 回看中悔棋应被拒 ---------- */
  const len0 = state.moves.length;
  gotoView(3);                                  // 跳到第 3 手看
  $b('btn-undo').click(); await sleep(150);
  R['① 回看中悔棋'] = (state.moves.length === len0)
    ? ('✓ 被拒绝，手数没变（' + len0 + '）') : ('★ 竟然撤了：' + len0 + ' → ' + state.moves.length);
  R['① 提示语'] = ($b('status').textContent || '').slice(0, 20);

  /* 跳到最新之后应当能撤 */
  gotoView(state.moves.length); await sleep(80);
  $b('btn-undo').click(); await sleep(150);
  R['① 跳到最新后悔棋'] = (state.moves.length === len0 - 1)
    ? ('✓ 正常撤一手（' + (len0 - 1) + '）') : ('★ ' + state.moves.length);

  /* ---------- ② 结果条：关掉后不该被弹回 ---------- */
  state.result = { winner: 'b', lead: 3.5, unit: '子', resign: false, by: 'score', terminal: true, at: state.viewAt };
  renderVerdict();
  R['② 有结果时显示'] = ($b('verdict').hidden === false) ? '✓ 显示' : '★ 没显示';
  $b('verdict-close').click(); await sleep(80);
  R['② 按叉后'] = ($b('verdict').hidden === true) ? '✓ 已收起' : '★ 没收起';
  renderVerdict();                              // 模拟「下一次刷新」
  R['② 刷新后仍收起'] = ($b('verdict').hidden === true)
    ? '✓ 没被弹回来' : '★ 又自己冒出来了';
  /* 新的一次数子（替换 result）应当照常显示 */
  state.result = { winner: 'w', lead: 1.5, unit: '子', resign: false, by: 'score', terminal: true, at: state.viewAt };
  renderVerdict();
  R['② 新结果照常显示'] = ($b('verdict').hidden === false) ? '✓' : '★ 被上一次的关闭状态挡住了';

  /* ---------- ③ 数子用 at0 的代码级确认 ---------- */
  const src = String(runScore);
  R['③ runScore 里钉住 at0'] = (src.indexOf('const at0 = state.viewAt') >= 0) ? '✓ 有' : '★ 没有';
  R['③ 请求用 at0'] = (src.indexOf('state.moves.slice(0, at0)') >= 0) ? '✓' : '★ 还在用 viewAt';
  R['③ 结果存 at0'] = (src.indexOf('at: at0') >= 0) ? '✓' : '★ 还在用 viewAt';

  applyNewGame();
  return R;
})()`);

console.log(JSON.stringify(out, null, 2));
ws.close();