/* 实测打劫判定（2026-10-06 审查发现：漏了「孤子」条件，倒扑会被误禁）。
   规则：**简单劫**三条同时成立才算 —— ①只提 1 子 ②落下的那颗子是**孤子**（未连己方子）
   ③落子后只剩 1 气。缺 ② 的话，把**倒扑**也当成劫：对方回提会一口气提走 ≥2 子，
   那是完全合法的一手，却被禁掉。

   本测试摆两个真实棋形（都是 9 路，y=0 在最上面）：
     A 倒扑（落子连着己方子 → **不该**判劫）
       黑：(0,0) (2,0) (0,1)；白：(1,0) (0,2) (2,1) (1,2)
       黑下 (1,1)：提掉白的 (1,0)，黑这块是 2 颗、只剩 (1,0) 一口气 → 白可回提且**多吃一子**
       ⇒ koPoint 应为 null，白下 (1,0) 应被允许
     B 真劫（落子是孤子 → 该判劫）
       W(2,2) 只剩 (2,1) 一口气；黑：(1,2) (3,2) (2,3)；白：(1,1) (3,1) (2,0)
       黑下 (2,1)：**只提 1 子**（那些黑子各自另有气，不会被连带提）、
       黑这颗是孤子、且只剩 (2,2) 一口气
       ⇒ koPoint 应为 (2,2)，白立刻回提应被拒绝
       （上一版这个棋形设计错了：(0,0)/(2,0) 在角上双邻皆黑 → 黑一手连带提 3 子，
         `captured===1` 不成立，测的其实不是劫。） */
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 40000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const out = await js(`(function(){
  const R = {};
  const setup = (blacks, whites) => {
    settings.mode = 'edit'; settings.size = 9; settings.handicap = 0; settings.komi = 7.5;
    settings.rules = 'chinese'; applyNewGame();
    state.setup = [
      ...blacks.map(([x,y]) => ({ x, y, color: 'b' })),
      ...whites.map(([x,y]) => ({ x, y, color: 'w' })),
    ];
    state.moves = []; state.viewAt = 0; state.toMove = 'b'; state.koPoint = null; state.result = null;
  };
  const B = (x,y) => boardAt(state.moves.length)[y * N + x];

  /* ---------- A 倒扑：落子连己方子 → 不该判劫 ---------- */
  setup([[0,0],[2,0],[0,1]], [[1,0],[0,2],[2,1],[1,2]]);
  const okA = tryPlay(1, 1);
  R['A 落子成功'] = okA ? '✓' : '★ 被拒';
  R['A 提到的白子已消失'] = B(1,0) === 0 ? '✓' : '★ 还在';
  R['A koPoint'] = JSON.stringify(state.koPoint) +
    (state.koPoint === null ? '  ✓ null（不是劫 —— 落子连着己方子，回提会多吃）'
                            : '  ★ 被误判成劫！白方合法回提被禁');
  /* 白回提：应当允许（会提走黑 2 子） */
  const okA2 = tryPlay(1, 0);
  R['A 白方回提'] = okA2 ? '✓ 允许（合法，提走 2 子）' : '★ 被禁掉了';

  /* ---------- B 真劫：落子是孤子 → 该判劫 ---------- */
  setup([[1,2],[3,2],[2,3]], [[2,2],[1,1],[3,1],[2,0]]);
  const okB = tryPlay(2, 1);
  R['B 落子成功'] = okB ? '✓' : '★ 被拒';
  R['B 提到的白子已消失'] = B(2,2) === 0 ? '✓' : '★ 还在';
  R['B koPoint'] = JSON.stringify(state.koPoint) +
    (state.koPoint && state.koPoint.x === 2 && state.koPoint.y === 2
      ? '  ✓ 正确判为劫（孤子 + 剩 1 气）' : '  ★ 应当判为劫');
  /* 白立刻回提：应当被拒 */
  const okB2 = tryPlay(2, 2);
  R['B 白方立刻回提'] = okB2 ? '★ 竟然允许了（劫形没被禁）' : '✓ 被拒绝（正确）';

  applyNewGame();
  return R;
})()`);

console.log(JSON.stringify(out, null, 2));
ws.close();