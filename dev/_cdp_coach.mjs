/* 验证 LoGos 接入：三个引擎默认不加载 → 手动加载 coach → 流式讲解 → 卸载
   这一版还**没有界面**，所以直接走 window.api（桥接层），验的是主进程那条链路。 */
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 300000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '');
  return r.result?.result?.value;
}

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};

  /* ---------- ① 启动时三个引擎都该是「未加载」 ---------- */
  const st0 = await window.api.engineStatus();
  const three = [st0.analyze.state, st0.play.state, st0.coach.state];
  R['① 启动不加载任何引擎'] = three.join(',') === 'off,off,off'
    ? '✓ off / off / off' : ('★ ' + JSON.stringify(three));
  R['① 三个引擎的权重名'] = [
    'analyze=' + st0.analyze.model,
    'play=' + st0.play.model,
    'coach=' + st0.coach.model,
  ].join(' | ');

  /* ---------- ② 手动加载 LoGos ---------- */
  const t0 = Date.now();
  await window.api.engine.load('coach');
  let st = null;
  while (Date.now() - t0 < 180000) {
    await sleep(1000);
    st = await window.api.engineStatus();
    if (st.coach.state === 'ready' || st.coach.state === 'error') break;
  }
  const loadMs = Date.now() - t0;
  R['② 加载 LoGos'] = st.coach.state === 'ready'
    ? ('✓ 就绪（' + (loadMs / 1000).toFixed(1) + ' 秒）')
    : ('★ ' + st.coach.state + ' · ' + (st.coach.error || ''));
  if (st.coach.state !== 'ready') return JSON.stringify(R, null, 1);

  /* ---------- ③ 流式讲解 ---------- */
  let chunks = 0, firstAt = 0;
  window.api.coach.onProgress(d => { chunks++; if (!firstAt) firstAt = Date.now(); });
  const t1 = Date.now();
  const res = await window.api.coach.explain({
    id: 1,
    prompt: '你是一位专业的围棋棋手。请用一句话（30 字以内）说明围棋里「星位」是什么。',
    maxTokens: 120, temperature: 0.3
  });
  const dt = Date.now() - t1;
  R['③ 讲解返回'] = (res && res.text)
    ? ('✓ ' + res.text.length + ' 字 · 总耗时 ' + dt + 'ms · 首字 ' + (firstAt ? (firstAt - t1) + 'ms' : '?') )
    : ('★ ' + JSON.stringify(res));
  R['③ 内容'] = String((res && res.text) || '').replace(/\\s+/g, ' ').slice(0, 140);
  R['④ 流式回调'] = chunks > 1 ? ('✓ 分 ' + chunks + ' 次推回') : ('★ 只 ' + chunks + ' 次');

  /* ---------- ⑤ 中止能力 ---------- */
  const p2 = window.api.coach.explain({
    id: 2,
    prompt: '你是一位专业的围棋棋手。请详细分析围棋的十大基本概念。',
    maxTokens: 400, temperature: 0.3
  });
  await sleep(1200);
  await window.api.coach.cancel();
  const res2 = await p2;
  R['⑤ 中止'] = (res2 && res2.aborted) ? ('✓ 已掐断（保留了 ' + String(res2.text || '').length + ' 字）') : ('★ ' + JSON.stringify(res2).slice(0, 80));

  /* ---------- ⑥ 卸载 ---------- */
  await window.api.engine.unload('coach');
  await sleep(2000);
  const st2 = await window.api.engineStatus();
  R['⑥ 卸载'] = st2.coach.state === 'off' ? '✓ 回到 off' : ('★ ' + st2.coach.state);

  return JSON.stringify(R, null, 1);
})()`);

console.log(out);
ws.close();
process.exit(0);
