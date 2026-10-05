/* 精确诊断：用 RapaceGo 自己的 coachPrompt + 自己的通道调一次，
   看返回的 text 到底有多长 —— 定位「只拿到开头 3 个字」是谁的问题。 */
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

  await window.api.engine.load('coach');
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await sleep(800);
    if (coachReady) break;
  }
  R['引擎'] = coachReady ? '✓' : '★ 没就绪';
  if (!coachReady) return JSON.stringify(R, null, 1);

  /* 落 4 手，构造和「分析讲解」完全一样的输入 */
  settings.mode = 'free';
  applyNewGame();
  await sleep(300);
  [[3,3],[15,15],[3,15],[15,3]].forEach(p => tryPlay(p[0], p[1]));
  await sleep(500);

  const before = state.moves.slice(0, 4);
  const prompt = coachPrompt(before, boardAt(4), 'b', 'R17');
  R['prompt 长度'] = prompt.length;
  R['prompt 结尾 30 字'] = JSON.stringify(prompt.slice(-30));

  /* ① 完全照 ⑤ 的参数 */
  let r = await window.api.coach.explain({
    id: 9001, prompt: prompt, maxTokens: 320, temperature: 0.3, stop: COACH_STOP,
  });
  R['① 带 stop'] = '长度 ' + String((r && r.text) || '').length + '｜错误：' + ((r && r.error) || '无');
  R['① 内容'] = String((r && r.text) || '').slice(0, 150);

  /* ② 不传 stop */
  r = await window.api.coach.explain({
    id: 9002, prompt: prompt, maxTokens: 320, temperature: 0.3,
  });
  R['② 不带 stop'] = '长度 ' + String((r && r.text) || '').length + '｜错误：' + ((r && r.error) || '无');
  R['② 内容'] = String((r && r.text) || '').slice(0, 150);

  /* ③ 带 stop，但 id 去掉（看是不是 id 字段的锅） */
  r = await window.api.coach.explain({
    prompt: prompt, maxTokens: 320, temperature: 0.3, stop: COACH_STOP,
  });
  R['③ 不带 id'] = '长度 ' + String((r && r.text) || '').length + '｜错误：' + ((r && r.error) || '无');

  return JSON.stringify(R, null, 1);
})()`);

console.log(out);
ws.close();
process.exit(0);
