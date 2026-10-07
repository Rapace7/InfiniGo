/* 验证「全盘分析」（2026-10-05 用户要求）：
   ① 打开棋谱才出现按钮，新对局时收起
   ② 点一下 → 进度条出现 → 整盘逐手讲完 → 进度条收起
   ③ 讲解**存进棋谱旁边**（.coach.json），重新打开这份棋谱能自动读回来
   ④ 新对局会把讲解清掉（用户要求：只在对局/棋谱期间保留）
   ⑤ 「停止」能中途停下，且已经讲完的手保留
   ⑥ 再点一次是**接着讲**（讲过的不重讲）

   用一份临时造的 6 手棋谱跑（真实棋谱 200 手要十几分钟，测试跑不完）。 */
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 600000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '');
  return r.result?.result?.value;
}

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};
  const nm = '_batch_test.sgf';
  const sgf = '(;GM[1]FF[4]CA[UTF-8]SZ[19]KM[7.5]RU[Chinese]GN[测试用]'
    + ';B[pd];W[dp];B[pp];W[dd];B[fq];W[cn])';
  const clean = s => String(s || '').replace(/\\s+/g, ' ').trim();
  /* 整段包在 try 里：任何一步抛错也要把已经测到的结果吐出来（否则全丢） */
  try {

  /* ---------- 引擎 ---------- */
  await window.api.engine.load('katago');
  await window.api.engine.load('coach');
  const t0 = Date.now();
  while (Date.now() - t0 < 220000) { await sleep(900); if (engineReady && coachReady) break; }
  R['① 引擎'] = (engineReady ? 'KataGo✓' : 'KataGo✗') + '  ' + (coachReady ? 'LoGos✓' : 'LoGos✗');
  if (!engineReady || !coachReady) return JSON.stringify(R, null, 1);

  /* ---------- 新对局时按钮应该收着 ---------- */
  applyNewGame(true);
  await sleep(500);
  R['② 新对局时'] = ($('btn-batch').hidden && state.recName === '')
    ? '✓ 全盘分析收起 · recName 清空' : ('★ hidden=' + $('btn-batch').hidden + ' recName=' + state.recName);

  /* ---------- 造一份 6 手棋谱并打开 ---------- */
  await window.api.records.save(nm, sgf);
  await openRecord(nm);
  await sleep(1400);
  R['③ 打开棋谱'] = (state.fromRecord && state.moves.length === 6 && state.recName === nm)
    ? '✓ 6 手 · 记下了棋谱名' : ('★ moves=' + state.moves.length + ' recName=' + state.recName);
  R['④ 按钮/进度条初态'] = (!$('btn-batch').hidden && $('batch-bar').hidden)
    ? '✓ 按钮露出 · 进度条收着' : '★ 显隐不对';

  /* ---------- 跑全盘分析 ---------- */
  let sawBar = false;
  const t1 = Date.now();
  $('btn-batch').click();
  while (Date.now() - t1 < 300000) {
    await sleep(500);
    if (!$('batch-bar').hidden) sawBar = true;
    if (state.coach.batch === null && !$('btn-batch').disabled) break;
  }
  const secs = ((Date.now() - t1) / 1000).toFixed(1);
  R['⑤ 进度条出现过'] = sawBar ? '✓' : '★ 从没露出来';
  R['⑥ 耗时'] = secs + ' 秒（6 手）';
  R['⑦ 跑完收起'] = $('batch-bar').hidden ? '✓' : '★ 还开着';
  const nGot = Object.keys(state.coach.explain).length;
  R['⑧ 逐手讲解'] = nGot + ' / 6 手';
  R['⑨ 第 1 手'] = (clean(state.coach.explain[1] && state.coach.explain[1].body) || '（空）').slice(0, 110);
  R['⑨ 第 6 手'] = (clean(state.coach.explain[6] && state.coach.explain[6].body) || '（空）').slice(0, 110);
  R['⑩ 好坏由谁定'] = state.coach.explain[6] ? (state.coach.explain[6].verdict + ' ｜ ' + (state.coach.explain[6].lead || '').slice(0, 46)) : '—';
  R['⑪ 按钮恢复'] = (!$('btn-explain').disabled && !$('btn-pick').disabled && !$('btn-batch').disabled) ? '✓ 都恢复了' : '★ 还有灰的';

  /* ---------- 存进棋谱旁边 ---------- */
  const f = await window.api.records.readCoach(nm);
  let saved = 0, okJson = false;
  try { const d = JSON.parse((f && f.text) || ''); saved = (d.list || []).filter(Boolean).length; okJson = true; } catch (e) { }
  R['⑫ 存进棋谱旁边'] = (okJson && saved >= 6) ? ('✓ .coach.json 里存了 ' + saved + ' 手') : '★ 没存上';

  /* ---------- 新对局清空 + 再打开自动读回 ---------- */
  applyNewGame(true);
  await sleep(500);
  R['⑬ 新对局清空'] = Object.keys(state.coach.explain).length === 0 ? '✓ 没带过来' : '★ 还留着';
  await openRecord(nm);
  await sleep(1600);
  const back = Object.keys(state.coach.explain).length;
  R['⑭ 再打开自动读回'] = back >= 6 ? ('✓ ' + back + ' 手都在（没重跑）') : ('★ 只回来 ' + back + ' 手');
  R['⑭ 框里显示'] = clean($('explain-body').textContent).slice(0, 90);

  /* ---------- 停止 ---------- */
  await window.api.records.remove(nm);            // 连 .coach.json 一起进回收站
  await sleep(600);
  await window.api.records.save(nm, sgf);
  await openRecord(nm);
  await sleep(1000);
  R['⑮ 删掉后讲解为空'] = Object.keys(state.coach.explain).length === 0 ? '✓' : '★ 还有残留';

  const t2 = Date.now();
  $('btn-batch').click();
  await sleep(2600);                              // 让它跑一会儿
  $('batch-stop').click();
  while (Date.now() - t2 < 90000) { await sleep(400); if (state.coach.batch === null) break; }
  const got = Object.keys(state.coach.explain).length;
  R['⑯ 停止'] = (state.coach.batch === null && got < 6)
    ? ('✓ 停下了（讲完 ' + got + ' 手，没到 6）') : ('★ 没停下 / 已经全讲完：' + got);
  R['⑰ 停止后进度条收起'] = $('batch-bar').hidden ? '✓' : '★ 还开着';
  R['⑱ 停止后按钮恢复'] = !$('btn-batch').disabled ? '✓' : '★';

  /* ---------- 接着讲（讲过的不重讲） ---------- */
  const before = Object.keys(state.coach.explain).length;
  const t3 = Date.now();
  $('btn-batch').click();
  await sleep(2000);
  $('batch-stop').click();
  while (Date.now() - t3 < 90000) { await sleep(400); if (state.coach.batch === null) break; }
  const after = Object.keys(state.coach.explain).length;
  R['⑲ 接着讲'] = after >= before ? ('✓ 条数没减少（' + before + ' → ' + after + '）') : ('★ 反而少了：' + before + ' → ' + after);

  /* 收尾：把内存清干净（文件由外部脚本删） */
  applyNewGame(true);
  } catch (e) { R['⑳ 脚本异常'] = String((e && e.message) || e); }
  return JSON.stringify(R, null, 1);
})()`);

console.log(out);
ws.close();
process.exit(0);
