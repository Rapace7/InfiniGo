/* 复现「悔棋后 AI 下子成功但棋盘上不显示（只出现在手数列表）」。
   ★ 症状对应的数据关系：棋盘按 state.viewAt 画（draw():256），
     手数列表按 state.moves.length 画（renderMoveList）——
     所以「列表有、棋盘没有」= viewAt < moves.length。
   本测试每步都把这个关系打出来，看它到底在什么时候错位。

   分段执行：
     node _cdp_aimove.mjs 1   → 加载对弈引擎
     node _cdp_aimove.mjs 2   → 新开一局 + 用户落子 + 等 AI 应手
     node _cdp_aimove.mjs 3   → 悔棋，观察 AI 是否自己动、错位有没有出现
     node _cdp_aimove.mjs 4   → 悔棋后用户再走一手，看 AI 应手有没有上屏
*/
const PORT = 9333;
const STEP = process.argv[2] || '1';

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

const SNAP = `
window.__snap2 = () => {
  const bv = boardAt(state.viewAt), bm = boardAt(state.moves.length);
  let sv = 0, sm = 0;
  for (let i = 0; i < bv.length; i++) { if (bv[i]) sv++; if (bm[i]) sm++; }
  return {
    手数: state.moves.length, 看着第几手: state.viewAt,
    错位: state.viewAt !== state.moves.length ? '★ 是（列表有、棋盘没有）' : '✓ 否',
    我执: state.myColor, 轮谁: state.toMove,
    该我走: isMyTurn(), AI在忙: aiBusy, AI该下: needAIMove(), 思考中: !!state.thinking,
    棋盘上棋子数: sv, 全部手摆出来的棋子数: sm,
    结果: state.result ? state.result.winner : null,
  };
};
'snap ok'`;

let out;
if (STEP === '1') {
  out = await js(`(async function(){
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await window.api.engine.load('play');
    const t0 = Date.now();
    while (!engineReadyPlay && Date.now() - t0 < 150000) await sleep(1000);
    return { 对弈引擎就绪: engineReadyPlay, 等了秒: Math.round((Date.now()-t0)/1000) };
  })()`, 200000);
  console.log('STEP1 ' + JSON.stringify(out));
} else {
  await js(SNAP, 15000);

  if (STEP === '2') {
    out = await js(`(async function(){
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      /* 新开一局：AI 对弈、我执黑、19 路 */
      settings.mode = 'play'; settings.size = 19; settings.myColor = 'b';
      settings.color = 'b'; settings.rules = 'chinese'; settings.handicap = 0;
      applyNewGame();
      await sleep(500);
      const before = window.__snap2();
      tryPlay(3, 3);                       // 我下一手
      await sleep(600);
      /* 等 AI 应手 */
      const t = Date.now();
      while (state.moves.length < 2 && Date.now() - t < 60000) await sleep(500);
      await sleep(1500);
      return { 我落子前: before, 我落子后: window.__snap2() };
    })()`, 120000);
    console.log('STEP2 ' + JSON.stringify(out));
  }

  if (STEP === '3') {
    out = await js(`(async function(){
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const before = window.__snap2();
      $('btn-undo').click();               // 悔棋
      await sleep(300);
      const rightAfter = window.__snap2();
      /* 关键：悔棋后 AI 会不会自己走？走完有没有上屏？ */
      const t = Date.now();
      while (Date.now() - t < 25000) {
        await sleep(500);
        if (state.moves.length !== rightAfter.手数) break;
      }
      await sleep(2000);
      return { 悔棋前: before, 悔棋后立刻: rightAfter, 等了25秒后: window.__snap2() };
    })()`, 90000);
    console.log('STEP3 ' + JSON.stringify(out));
  }

  if (STEP === '4') {
    out = await js(`(async function(){
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const before = window.__snap2();
      /* 悔棋后悔该我走：我下一手，看 AI 的应手有没有上屏 */
      const free = [];
      for (let y = 3; y < 17; y++) for (let x = 3; x < 17; x++) {
        if (boardAt(state.moves.length)[y * N + x] === 0) free.push([x, y]);
      }
      if (!free.length) return { 说明: '没有空点' };
      const [px, py] = free[Math.floor(free.length / 2)];
      tryPlay(px, py);
      await sleep(600);
      const afterMine = window.__snap2();
      const t = Date.now();
      const lenBefore = state.moves.length;
      while (state.moves.length === lenBefore && Date.now() - t < 60000) await sleep(500);
      await sleep(2000);
      return { 悔棋前: before, 我下完: afterMine, AI应手后: window.__snap2() };
    })()`, 120000);
    console.log('STEP4 ' + JSON.stringify(out));
  }
}
ws.close();