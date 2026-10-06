/* 验证形势雾的修复（2026-10-06 审查发现：白棋永远被当成死子）。
   修的是类型混用：boardAt 存 1/2（黑/白），而 owner 是 ±1 —— 原来直接 stone === owner，
   白棋（2）永远不等于 -1，于是**所有白子都按「死子」画成半透明**。
   本测试直接调 stoneAlphaAt 看返回值：
     归属偏白（ownership = -1）时：白子应当接近 1（活）、黑子应当 0.85（死）
     归属偏黑（ownership = +1）时：黑子应当接近 1、白子应当 0.85
   （数值不可靠的话，肉眼在盘上根本分不出"这是雾的效果"还是"这是 bug"——
     所以必须用返回值把它钉住。） */
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

const out = await js(`(function(){
  const R = {};
  settings.mode = 'edit'; settings.size = 19; applyNewGame();
  state.showTerritory = true;
  state.terrStyle = 'fog';
  const N2 = N * N;

  /* 情形一：整盘归属都偏白（ownership = -1） */
  state.ownership = new Array(N2).fill(-1);
  const w1 = stoneAlphaAt(3, 3, 2);     // 白子（活）
  const b1 = stoneAlphaAt(3, 3, 1);     // 黑子（死）
  R['① 偏白局面：白子透明度'] = w1.toFixed(3) + (w1 > 0.98 ? '  ✓ 接近 1（活）' : '  ★ 应当接近 1');
  R['① 偏白局面：黑子透明度'] = b1.toFixed(3) + (b1 < 0.87 ? '  ✓ 0.85（死）' : '  ★ 应当是 0.85');

  /* 情形二：整盘归属都偏黑（ownership = +1） */
  state.ownership = new Array(N2).fill(1);
  const w2 = stoneAlphaAt(3, 3, 2);
  const b2 = stoneAlphaAt(3, 3, 1);
  R['② 偏黑局面：黑子透明度'] = b2.toFixed(3) + (b2 > 0.98 ? '  ✓ 接近 1（活）' : '  ★ 应当接近 1');
  R['② 偏黑局面：白子透明度'] = w2.toFixed(3) + (w2 < 0.87 ? '  ✓ 0.85（死）' : '  ★ 应当是 0.85');

  /* 情形三：中间值（归属不明确）→ 双方都应当是"半淡"的中间态 */
  state.ownership = new Array(N2).fill(0.3);
  const b3 = stoneAlphaAt(3, 3, 1);
  R['③ 归属 0.3：黑子'] = b3.toFixed(3) + (b3 > 0.85 && b3 < 1 ? '  ✓ 在 0.85~1 之间（渐显）' : '  ★ 越界');

  /* 关掉形势显示时一律不透明 */
  state.showTerritory = false;
  R['④ 关掉形势：白子'] = stoneAlphaAt(3, 3, 2) === 1 ? '✓ 1.0（不受影响）' : '★ 被影响了';

  state.showTerritory = false; state.terrStyle = 'fog'; state.ownership = null;
  applyNewGame();
  return R;
})()`);

console.log(JSON.stringify(out, null, 2));
ws.close();