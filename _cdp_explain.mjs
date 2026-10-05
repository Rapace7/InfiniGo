/* 验证两个讲解框：常驻标注 / 选点讲解（多推荐点）/ 分析讲解 / 打谱时禁用 */
const PORT = 9333;
async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 400000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '');
  return r.result?.result?.value;
}

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};

  /* ---------- ① 两个框的常驻标注 ---------- */
  const ex = $('explain-body').textContent || '';
  const pk = $('pick-body').textContent || '';
  R['① 分析讲解标注'] = ex.slice(0, 46).replace(/\\s+/g, ' ');
  R['① 选点讲解标注（前 90 字）'] = pk.slice(0, 90).replace(/\\s+/g, ' ');
  R['① 标注说了和棋盘推荐点的关系'] = pk.indexOf('虚线圆圈') > 0 && pk.indexOf('同一批') > 0
    ? '✓ 明确写了' : '★ 没写清';
  R['① 打谱时禁用这一点也写了'] = pk.indexOf('打谱时用不了') > 0 ? '✓' : '★ 没写';

  /* ---------- ② 加载两个引擎 ---------- */
  await window.api.engine.load('katago');
  await window.api.engine.load('coach');
  const t0 = Date.now();
  while (Date.now() - t0 < 200000) {
    await sleep(1000);
    if (engineReady && engineReadyPlay && coachReady) break;
  }
  R['② 引擎'] = (engineReady ? 'KataGo✓' : 'KataGo✗') + ' ' + (coachReady ? 'LoGos✓' : 'LoGos✗')
    + '（' + ((Date.now() - t0) / 1000).toFixed(0) + ' 秒）';
  if (!coachReady || !engineReady) return JSON.stringify(R, null, 1);

  /* ---------- ③ 开局落几手，等候选点 ---------- */
  settings.mode = 'free';
  applyNewGame();
  await sleep(300);
  const pts = [[3,3],[15,15],[3,15],[15,3],[9,9]];
  for (const p of pts) { tryPlay(p[0], p[1]); await sleep(160); }
  const t1 = Date.now();
  while (Date.now() - t1 < 60000) {
    await sleep(500);
    if (state.candAt === state.viewAt && state.candidates.length) break;
  }
  R['③ 棋盘候选点'] = state.candidates.length
    ? ('✓ ' + state.candidates.map(c => toGTP(c.x, c.y) + '(' + (c.win * 100).toFixed(0) + '%)').join(' '))
    : '★ 没算出来';
  if (!state.candidates.length) return JSON.stringify(R, null, 1);

  /* ---------- ④ 选点讲解（应该每个点一段） ---------- */
  const t2 = Date.now();
  $('btn-pick').click();
  while (Date.now() - t2 < 200000) { await sleep(400); if (!$('btn-pick').disabled) break; }
  await sleep(3200);        // ★ 再等一会儿：打字机还在逐字放（80 字/秒）
  const pickTxt = $('pick-body').textContent || '';
  R['④ 选点讲解'] = pickTxt.length > 60
    ? ('✓ ' + pickTxt.length + ' 字 · ' + ((Date.now() - t2) / 1000).toFixed(1) + ' 秒')
    : ('★ 太短：' + pickTxt.slice(0, 60));
  R['④ 讲到的点'] = (pickTxt.match(/推荐 \\d+ · [A-HJ-T][0-9]{1,2}/g) || []).join(' | ') || '（没匹配到）';
  R['④ 都是条件句'] = (pickTxt.match(/如果/g) || []).length >= 2 ? '✓ 每点都用「如果……」' : '★ 有断言句';
  R['④ 内容节选'] = pickTxt.slice(0, 260).replace(/\\s+/g, ' ');

  /* ---------- ⑤ 分析讲解（点评当前这一手） ---------- */
  const t3 = Date.now();
  $('btn-explain').click();
  while (Date.now() - t3 < 200000) { await sleep(400); if (!$('btn-explain').disabled) break; }
  await sleep(3000);        // ★ 同上：等打字机放完再读
  const exTxt = $('explain-body').textContent || '';
  R['⑤ 分析讲解'] = exTxt.length > 40
    ? ('✓ ' + exTxt.length + ' 字 · ' + ((Date.now() - t3) / 1000).toFixed(1) + ' 秒')
    : ('★ 太短：' + exTxt.slice(0, 60));
  R['⑤ 内容'] = exTxt.slice(0, 260).replace(/\\s+/g, ' ');
  R['⑤ 是条件句（不是既成事实）'] = exTxt.indexOf('如果') >= 0 ? '✓ 用「如果……」开头' : '★ 还是断言句';

  /* ---------- ⑥ 打谱时选点讲解该被挡住 ---------- */
  const before = $('pick-body').textContent;
  state.fromRecord = true;
  $('btn-pick').click();
  await sleep(900);
  R['⑥ 打谱时点选点讲解'] = $('pick-body').textContent === before ? '✓ 没动（挡住了）' : '★ 还是跑了';
  state.fromRecord = false;

  /* ---------- ⑦ 再点一次 = 覆盖 + 打字机 ---------- */
  $('btn-pick').click();
  await sleep(1600);
  const n1 = $('pick-body').children.length;
  const justN = $('pick-body').querySelectorAll('.just').length;
  R['⑦ 再点一次（覆盖）'] = n1 >= 1 ? ('✓ 旧的清掉、新的建起来了（' + n1 + ' 个）') : '★ 没重建';
  R['⑦ 打字机（淡入的字）'] = justN > 0
    ? ('✓ 演讲中有 ' + justN + ' 个淡入字（不是整段贴上去）') : '★ 没看到淡入字';
  /* 打断它，别让测试跑太久 */
  await window.api.coach.cancel();
  await sleep(400);

  return JSON.stringify(R, null, 1);
})()`);

console.log(out);
ws.close();
process.exit(0);
