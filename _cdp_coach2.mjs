/* 验证用户报的两个 bug 已修：
   ① 讲完第 6 手 → 点回第 2 手：分析讲解**不该**还挂着第 6 手的内容
   ② 切回第 6 手：第 6 手的讲解要**还在**（不能讲完就丢）
   ③ 选点讲解：**不跟手数走** —— 切手数后那份内容要原样留着（并标出对应手数） */
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
  const exTxt = () => ($('explain-body').textContent || '').replace(/\\s+/g, ' ').trim();
  const pkTxt = () => ($('pick-body').textContent || '').replace(/\\s+/g, ' ').trim();

  /* 加载两个引擎 */
  await window.api.engine.load('katago');
  await window.api.engine.load('coach');
  const t0 = Date.now();
  while (Date.now() - t0 < 200000) { await sleep(900); if (engineReady && coachReady) break; }
  R['引擎'] = (engineReady ? 'KataGo✓' : 'KataGo✗') + ' ' + (coachReady ? 'LoGos✓' : 'LoGos✗');
  if (!engineReady || !coachReady) return JSON.stringify(R, null, 1);

  /* 落 6 手 */
  settings.mode = 'free';
  applyNewGame();
  await sleep(300);
  [[3,3],[15,15],[3,15],[15,3],[9,9],[9,3]].forEach(p => tryPlay(p[0], p[1]));
  await sleep(800);
  R['手数'] = state.moves.length;
  const t1 = Date.now();
  while (Date.now() - t1 < 40000) { await sleep(400); if (typeof state.history[6] === 'number') break; }

  /* ---------- ① 第 6 手做分析讲解 ---------- */
  const t2 = Date.now();
  $('btn-explain').click();
  while (Date.now() - t2 < 120000) { await sleep(400); if (!$('btn-explain').disabled) break; }
  await sleep(2600);
  const sixth = exTxt();
  R['① 第6手讲解'] = sixth.length > 30 ? ('✓ ' + sixth.length + ' 字') : ('★ ' + sixth.slice(0, 50));

  /* ---------- ② 点回第 2 手：不该还有第 6 手的内容 ---------- */
  gotoView(2);
  await sleep(700);
  const at2 = exTxt();
  R['② 点回第2手'] = at2.indexOf('还没有讲解') >= 0
    ? '✓ 显示「这一手还没有讲解」' : ('★ 还是旧内容：' + at2.slice(0, 60));
  R['② 内容确实换了'] = at2 !== sixth ? '✓ 不是第6手那份了' : '★ 一字没变';

  /* ---------- ③ 切回第 6 手：讲解要还在 ---------- */
  gotoView(6);
  await sleep(700);
  R['③ 切回第6手'] = exTxt() === sixth ? '✓ 第6手的讲解原样还在' : '★ 丢了或变了';

  /* ---------- ④ 第 2 手单独讲一次，验证两手互不干扰 ---------- */
  gotoView(2);
  await sleep(400);
  const t3 = Date.now();
  $('btn-explain').click();
  while (Date.now() - t3 < 120000) { await sleep(400); if (!$('btn-explain').disabled) break; }
  await sleep(2600);
  const second = exTxt();
  R['④ 第2手讲解'] = second.length > 30 ? ('✓ ' + second.length + ' 字') : ('★ ' + second.slice(0, 50));
  R['④ 两手内容不同'] = (second !== sixth) ? '✓ 各自独立' : '★ 一样（可疑）';
  gotoView(4); await sleep(600);
  R['④ 切到第4手'] = exTxt().indexOf('还没有讲解') >= 0 ? '✓ 提示未讲解' : '★ 有残留';
  gotoView(2); await sleep(600);
  R['④ 切回第2手'] = exTxt() === second ? '✓ 第2手的还在' : '★ 丢了';
  gotoView(6); await sleep(600);
  R['④ 再切回第6手'] = exTxt() === sixth ? '✓ 第6手的也还在' : '★ 丢了';

  /* ---------- ⑤ 选点讲解：不跟手数走 ---------- */
  gotoView(4);
  await sleep(500);
  const t4 = Date.now();
  while (Date.now() - t4 < 40000) { await sleep(400); if (state.candAt === state.viewAt && state.candidates.length) break; }
  const t5 = Date.now();
  $('btn-pick').click();
  while (Date.now() - t5 < 200000) { await sleep(400); if (!$('btn-pick').disabled) break; }
  await sleep(4000);
  const pick4 = pkTxt();
  R['⑤ 第4手选点讲解'] = pick4.length > 60 ? ('✓ ' + pick4.length + ' 字') : ('★ ' + pick4.slice(0, 60));

  gotoView(1);
  await sleep(800);
  const pick1 = pkTxt();
  R['⑤ 切到第1手后仍在'] = pick1.indexOf('推荐 1') >= 0 ? '✓ 内容还在（没被清掉）' : '★ 没了';
  R['⑤ 标出了对应手数'] = pick1.indexOf('第 4 手之后') >= 0 ? '✓ 有「（这是第 4 手之后…）」' : '★ 没标注';
  R['⑤ 内容一字未改'] = pick1.replace(/^（这是[^）]*）\\s*/, '') === pick4 ? '✓' : '★ 变了（' + pick1.slice(0, 40) + '）';

  return JSON.stringify(R, null, 1);
})()`);

console.log(out);
ws.close();
process.exit(0);
