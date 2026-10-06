/* 逐条核对帮助 vs 实际界面：把界面上真实存在的东西抓回来，跟帮助里写的比。
   只读，不改任何状态。 */
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
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 30000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};
  const txt = el => (el ? (el.textContent || '').replace(/\\s+/g,' ').trim() : null);

  /* ---- 左上角那一排 ---- */
  const topLeft = document.querySelector('header') || document.body;
  R['左上角按钮'] = Array.from(topLeft.querySelectorAll('button')).slice(0, 8).map(b => txt(b));

  /* ---- 顶栏右侧 ---- */
  R['顶栏右侧'] = {
    '新建/新对局': txt(document.getElementById('btn-new')),
    '人机对弈': txt(document.querySelector('#mode-nav, .seg') && Array.from(document.querySelectorAll('button')).find(b => txt(b) === '人机对弈')),
    '摆棋/双人': (function(){ const b = Array.from(document.querySelectorAll('button')).find(x => (txt(x)||'').indexOf('摆棋') >= 0); return txt(b); })(),
  };
  const lvl = document.querySelector('select');
  R['对手棋力下拉'] = lvl ? { id: lvl.id, 前两个选项: Array.from(lvl.options).slice(0,2).map(o => o.textContent) } : null;

  /* ---- 左栏标题 ---- */
  R['左栏卡片标题'] = Array.from(document.querySelectorAll('aside.left .card-title, .left .card-title')).map(txt).slice(0, 6);

  /* ---- 右栏卡片标题 ---- */
  R['右栏卡片标题'] = Array.from(document.querySelectorAll('aside.right .card-title, .right .card-title')).map(txt).slice(0, 8);

  /* ---- 底栏：显示菜单里的开关文案 ---- */
  document.getElementById('btn-disp').click();
  await sleep(250);
  const disp = document.getElementById('disp');
  R['显示菜单里的项'] = disp ? Array.from(disp.querySelectorAll('label, .row, button')).map(txt).filter(Boolean).slice(0, 12) : '（找不到 #disp）';
  document.getElementById('btn-disp').click();
  await sleep(150);

  /* ---- 底栏右侧按钮 ---- */
  R['底栏按钮'] = ['btn-undo','btn-draft','btn-pass','btn-score','btn-resign','btn-save'].map(id => txt(document.getElementById(id)));
  R['计算深度控件'] = (function(){
    const s = Array.from(document.querySelectorAll('select')).find(x => Array.from(x.options).some(o => o.textContent.indexOf('500') >= 0));
    return s ? { id: s.id, 选项: Array.from(s.options).map(o => o.textContent).slice(0,4) } : null;
  })();
  R['拟人落子文案'] = (function(){
    const l = Array.from(document.querySelectorAll('label')).find(x => (txt(x)||'').indexOf('拟人') >= 0);
    return txt(l);
  })();

  /* ---- 棋盘中央提示（未开局时）---- */
  R['棋盘中央'] = txt(document.querySelector('.board-center, #gate, .gc')) || txt(document.getElementById('btn-gate-new'));

  /* ---- 帮助里那些"去哪找"的说法，逐个验证元素真的存在 ---- */
  R['设置面板里有哪些分组'] = (function(){ return null; })();
  return R;
})()`);

console.log(JSON.stringify(out, null, 2));
ws.close();
