/* 验证「引擎手动加载」这套界面：
   ① 顶栏两个状态灯  ② 点开的操作菜单  ③ 胜率条不再写「AI 准备中」
   ④ 设置面板分成两组 + 问号  ⑤ 加载 / 卸载 时灯的变化 */
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

  /* ---------- ① 顶栏状态灯 ---------- */
  const lamps = [...document.querySelectorAll('.engines .eng')];
  R['① 状态灯'] = lamps.length === 2 ? '✓ 两个' : ('★ ' + lamps.length + ' 个');
  R['① 初始状态'] = lamps.map(l => l.dataset.key + '=' + l.dataset.state).join(' | ');

  /* ---------- ② 点开操作菜单 ---------- */
  document.querySelector('.engines .eng[data-key="katago"]').click();
  await sleep(250);
  const menu = document.getElementById('engmenu');
  const btns = [...menu.querySelectorAll('button')].map(b => b.textContent);
  R['② 点 KataGo 弹菜单'] = !menu.hidden ? ('✓ ' + btns.join(' / ')) : '★ 没弹出来';
  R['② 菜单定位'] = (menu.style.top && menu.style.left) ? ('✓ 左 ' + menu.style.left + ' 上 ' + menu.style.top) : '★ 没定位';
  document.body.click();                       // 点外面
  await sleep(200);
  R['② 点外面收起'] = menu.hidden ? '✓' : '★ 还开着';
  document.querySelector('.engines .eng[data-key="katago"]').click();
  await sleep(200);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await sleep(200);
  R['② Esc 收起'] = menu.hidden ? '✓' : '★ 还开着';

  /* ---------- ③ 胜率条不再写「AI 准备中」 ---------- */
  const wrTxt = document.getElementById('eval-wr').textContent;
  const ldTxt = document.getElementById('eval-lead').textContent;
  R['③ 胜率条文案'] = wrTxt + ' ｜ ' + ldTxt;
  R['③ 不再有「AI 准备中」'] = (wrTxt + ldTxt).indexOf('AI 准备中') < 0 ? '✓' : '★ 还在写';

  /* ---------- ④ 设置面板：两组 + 问号 ---------- */
  document.getElementById('btn-settings').click();
  await sleep(1000);
  const mask = document.getElementById('settings');
  R['④ 设置面板'] = mask.classList.contains('open') ? '✓ 打开' : '★ 没打开';
  const five = ['set-katago','set-analyzeWeight','set-playWeight','set-coachServer','set-coachWeight'];
  R['④ 五条路径都在'] = five.every(id => document.getElementById(id)) ? '✓' : ('★ 缺：' + five.filter(id => !document.getElementById(id)));
  const groups = document.querySelectorAll('.setgroup');
  R['④ 分组'] = groups.length === 2
    ? ('✓ 2 组：' + [...groups].map(g => g.querySelector('h3').textContent.trim().replace(/\\s+/g,' ')).join(' ｜ '))
    : ('★ ' + groups.length + ' 组');
  const qh = [...document.querySelectorAll('.setgroup .qh')];
  R['④ 问号'] = qh.length === 2
    ? ('✓ 2 个，说明分别 ' + qh.map(q => (q.dataset.tip || '').length).join(' / ') + ' 字')
    : ('★ ' + qh.length + ' 个');
  const cs = qh.length ? getComputedStyle(qh[0], '::after') : null;
  R['④ 悬停浮层样式'] = (cs && cs.content && cs.content.length > 8) ? ('✓ content=' + cs.content + ' 宽 ' + cs.width) : '★ 没生效';
  R['④ LoGos 组的两行'] = ['set-coachServer','set-coachWeight'].every(id => {
    const el = document.getElementById(id);
    return el && el.closest('.setgroup') === groups[1];
  }) ? '✓ 在第二组里' : '★ 位置不对';
  document.getElementById('set-cancel').click();
  await sleep(400);

  /* ---------- ⑤ 加载 LoGos → 灯变绿 ---------- */
  const t0 = Date.now();
  await window.api.engine.load('coach');
  const lamp = () => document.querySelector('.engines .eng[data-key="coach"]');
  while (Date.now() - t0 < 120000) {
    await sleep(800);
    if (lamp().dataset.state === 'ready' || lamp().dataset.state === 'error') break;
  }
  R['⑤ 加载后'] = lamp().dataset.state === 'ready'
    ? ('✓ 灯变就绪（' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒）')
    : ('★ ' + lamp().dataset.state);

  /* ---------- ⑥ 就绪时的菜单内容（不该再有「加载」） ---------- */
  lamp().click();
  await sleep(250);
  R['⑥ 就绪时菜单'] = [...document.querySelectorAll('#engmenu button')].map(b => b.textContent).join(' / ');
  document.getElementById('engmenu').hidden = true;

  /* ---------- ⑦ 卸载 → 灯回灰 ---------- */
  await window.api.engine.unload('coach');
  await sleep(2500);
  R['⑦ 卸载后'] = lamp().dataset.state === 'off' ? '✓ 灯回「未加载」' : ('★ ' + lamp().dataset.state);

  /* ---------- ⑧ 再加载（截图用，让画面里有盏绿灯） ---------- */
  const t2 = Date.now();
  await window.api.engine.load('coach');
  while (Date.now() - t2 < 120000) {
    await sleep(800);
    if (lamp().dataset.state === 'ready') break;
  }
  R['⑧ 二次加载'] = lamp().dataset.state === 'ready'
    ? ('✓ 就绪（' + ((Date.now() - t2) / 1000).toFixed(1) + ' 秒，第二次更快）') : ('★ ' + lamp().dataset.state);

  return JSON.stringify(R, null, 1);
})()`);

console.log(out);
ws.close();
process.exit(0);
