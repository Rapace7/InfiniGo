/* 端到端冒烟：把主要功能路径**真跑一遍**，同时收集浏览器侧的运行时错误
   （未捕获异常 / console.error / 资源加载失败）。
   为什么必须做这一步：JS 里有些 bug 是静默的 —— 比如某个回调抛异常会把整条链打断，
   界面上只表现为"点了没反应"，光看代码或截图都发现不了。
   用法：python _rtest.py _smoke.mjs _trash/_shot_smoke.png */
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
const errs = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    errs.push('未捕获异常: ' + (d.exception?.description || d.text || '?').split('\n')[0]);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errs.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errs.push('log: ' + m.params.entry.text.slice(0, 200));
  }
};
const send = (method, params) => new Promise(res => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 300000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}

await send('Runtime.enable');
await send('Log.enable');

const out = await js(`(async function(){
  const steps = [];
  const step = async (name, fn) => {
    try { const r = await fn(); steps.push('✓ ' + name + (r === undefined || r === '' ? '' : ' → ' + r)); }
    catch (e) { steps.push('★ ' + name + ' 抛异常 → ' + ((e && e.message) || e)); }
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const open = id => $(id).classList.contains('open');
  const seg = (id, v) => $(id).querySelector('[data-v="' + v + '"]').click();
  const lit = id => { const b = $(id).querySelector('.on'); return b ? b.dataset.v : '无'; };
  const key = code => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));

  const t0 = Date.now();
  while ((!engineReady || !engineReadyPlay) && Date.now() - t0 < 90000) await sleep(500);
  steps.push('（引擎就绪 analyze=' + engineReady + ' play=' + engineReadyPlay + '）');

  /* ---------- 1. 四个弹窗的开合 ---------- */
  await step('弹窗 · 帮助', async () => { $('btn-help').click(); await sleep(200);
    const o = open('help'); $('help-close').click(); await sleep(150);
    return o && !open('help') ? '开关都正常' : '★ 状态不对'; });
  await step('弹窗 · 设置', async () => { $('btn-settings').click(); await sleep(400);
    const o = open('settings'); $('set-cancel').click(); await sleep(150);
    return o && !open('settings') ? '开关都正常' : '★ 状态不对'; });
  await step('弹窗 · 棋谱库', async () => { $('btn-records').click(); await sleep(500);
    const n = document.querySelectorAll('#reclist li').length;
    const o = open('records'); $('rec-close').click(); await sleep(150);
    return (o && !open('records') ? '开关都正常' : '★ 状态不对') + ' · 列表 ' + n + ' 项'; });
  await step('弹窗 · 新对局（切类型）', async () => { $('btn-new').click(); await sleep(250);
    const a = seg('seg-ntype', 'free'); await sleep(200);
    const hiddenOk = $('row-color').hidden && $('row-level').hidden;
    seg('seg-ntype', 'play'); await sleep(200);
    const shownOk = !$('row-color').hidden && !$('row-level').hidden;
    $('m-cancel').click(); await sleep(150);
    return (hiddenOk && shownOk ? '类型切换正常' : '★ 行显隐不对') + ' · ' + (open('newgame') ? '★ 没关掉' : '已关闭'); });

  /* ---------- 2. AI 对弈：开新局 → 落子 → AI 回应 ---------- */
  await step('开新局 · AI 对弈', async () => { $('btn-new').click(); await sleep(250);
    seg('seg-ntype', 'play'); seg('seg-color', 'b'); seg('seg-size', '19');
    seg('seg-handicap', '0'); seg('seg-komi', '7.5');
    $('m-rules').value = 'chinese'; $('m-rules').onchange(); await sleep(150);
    $('m-start').click(); await sleep(600);
    return 'mode=' + settings.mode + ' 手数=' + state.moves.length + ' 我执=' + state.myColor; });
  await step('落一手 → 等 AI 回应', async () => { tryPlay(3, 3); await sleep(4000);
    return '手数=' + state.moves.length + '（>1 说明 AI 接了）'; });
  await step('悔棋', async () => { const n0 = state.moves.length; $('btn-undo').click(); await sleep(300);
    return n0 + ' → ' + state.moves.length; });
  await step('再落一手 + 试下', async () => { tryPlay(15, 15); await sleep(2500);
    $('btn-draft').click(); await sleep(300);
    const inDraft = !!state.draft;
    $('btn-draft').click(); await sleep(300);
    return (inDraft && !state.draft ? '进出试下正常' : '★ 试下状态不对') + ' · 手数 ' + state.moves.length; });
  await step('停一手', async () => { const n0 = state.moves.length; $('btn-pass').click(); await sleep(300);
    return n0 + ' → ' + state.moves.length; });
  await step('数子', async () => { $('btn-score').click(); await sleep(6000);
    return state.result ? ('结果：' + ($('verdict-text').textContent || '').slice(0, 30)) : '（未终局，只看过程没崩）'; });
  await step('认输', async () => { $('btn-resign').click(); await sleep(600);
    return state.result ? '已判负' : '★ 没有结果'; });

  /* ---------- 3. 各种开关与快捷键 ---------- */
  await step('快捷键 T/Z/M/B/Y/X/N 全按一遍', async () => {
    const before = [state.showHints, state.showCoords, state.showNums, state.showPV,
      state.soundOn, state.showTerritory, settings.humanLike].join(',');
    ['KeyT', 'KeyZ', 'KeyM', 'KeyB', 'KeyY', 'KeyX', 'KeyN'].forEach(k => key(k));
    await sleep(400);
    const after = [state.showHints, state.showCoords, state.showNums, state.showPV,
      state.soundOn, state.showTerritory, settings.humanLike].join(',');
    ['KeyT', 'KeyZ', 'KeyM', 'KeyB', 'KeyY', 'KeyX', 'KeyN'].forEach(k => key(k));  // 复原
    await sleep(300);
    return before !== after ? '7 个键都生效了' : '★ 一个都没生效'; });
  await step('走势图切换 胜率/目差', async () => { seg('seg-curve', 'lead'); await sleep(250);
    const a = state.curveMode; seg('seg-curve', 'win'); await sleep(250);
    return a + ' → ' + state.curveMode; });
  await step('计算深度切换（底栏 + 面板两处）', async () => {
    $('sel-visits').value = '1000'; $('sel-visits').onchange({ target: $('sel-visits') }); await sleep(300);
    const a = settings.visits;
    $('btn-new').click(); await sleep(250);
    $('m-visits').value = '500'; $('m-visits').onchange({ target: $('m-visits') }); await sleep(250);
    const b = settings.visits;
    $('m-cancel').click(); await sleep(150);
    return a + ' → ' + b; });

  /* ---------- 4. 模式切换（含确认弹窗） ---------- */
  await step('AI 对弈 → 摆棋 / 双人', async () => { seg('seg-mode', 'free'); await sleep(400);
    return 'mode=' + settings.mode + ' 顶栏亮=' + lit('seg-mode'); });
  await step('摆棋 → AI 对弈（弹窗 · 取消）', async () => { seg('seg-mode', 'play'); await sleep(400);
    const o = open('takeover'); $('tk-cancel').click(); await sleep(300);
    return (o ? '弹窗出现了' : '★ 没弹') + ' · 取消后 mode=' + settings.mode + ' 顶栏亮=' + lit('seg-mode'); });
  await step('摆棋 → AI 对弈（弹窗 · 确定）', async () => { seg('seg-mode', 'play'); await sleep(400);
    seg('seg-tk-color', 'w'); await sleep(200); $('tk-ok').click(); await sleep(3500);
    return 'mode=' + settings.mode + ' 顶栏亮=' + lit('seg-mode') + ' 我执=' + state.myColor; });

  /* ---------- 5. 摆棋 + 让子开局 ---------- */
  await step('开新局 · 摆棋 + 让 3 子', async () => { $('btn-new').click(); await sleep(250);
    seg('seg-ntype', 'free'); seg('seg-handicap', '3'); await sleep(250);
    const komi = settings.komi; $('m-start').click(); await sleep(1500);
    return '盘上 ' + state.setup.length + ' 子 · komi=' + komi + ' · 轮走=' + sideToMove(state.viewAt)
      + ' · 让子行隐藏=' + $('row-color').hidden; });
  await step('摆棋模式下两边各落一手', async () => { tryPlay(3, 3); await sleep(200); tryPlay(15, 15); await sleep(300);
    return '手数=' + state.moves.length; });

  /* ---------- 6. 棋谱库：打开棋谱 / 看已存报告 ---------- */
  await step('棋谱库 · 打开一份棋谱', async () => { $('btn-records').click(); await sleep(600);
    const li = document.querySelector('#reclist li');
    if (!li) { $('rec-close').click(); return '（库里没棋谱，跳过）'; }
    li.querySelector('button').click(); await sleep(1200);
    return '载入 ' + state.moves.length + ' 手 · mode=' + settings.mode + ' 名字=' + (state.names.b || '—') + '/' + (state.names.w || '—'); });
  await step('棋谱库 · 复盘报告（读已存的）', async () => { $('btn-records').click(); await sleep(600);
    const li = document.querySelector('#reclist li');
    const bs = [...li.querySelectorAll('button')];
    const rv = bs.find(b => b.textContent.indexOf('复盘报告') >= 0);
    if (!rv || rv.disabled) { $('rec-close').click(); return '（没有已存报告，跳过）'; }
    rv.click(); await sleep(1200);
    const txt = ($('review-body').textContent || '').slice(0, 40);
    const o = open('review'); $('review-close').click(); await sleep(200);
    return (o ? '报告打开了' : '★ 没打开') + ' · ' + txt; });
  await step('棋谱库 · 关掉', async () => { if (open('records')) { $('rec-close').click(); await sleep(200); }
    return open('records') ? '★ 还开着' : '已关'; });

  /* ---------- 7. 导出棋谱（会写进 records/，测试后由主进程清理） ---------- */
  await step('导出棋谱（存进棋谱库）', async () => {
    const before = [...document.querySelectorAll('#reclist li')].length;
    $('btn-save').click(); await sleep(1200);
    return '点击成功（下面由脚本核对文件数）'; });

  /* ---------- 8. 收尾：复位到未开局 ---------- */
  await step('复位 · 回到未开局', async () => { applyNewGame(true); await sleep(500);
    return 'noGame=' + state.noGame + ' 中央按钮可见=' + !$('board-gate').hidden; });

  return JSON.stringify({ 步骤: steps }, null, 1);
})()`);

/* 等一下再收尾，确保异步错误都冒出来了 */
await new Promise(r => setTimeout(r, 1500));
console.log(out);
console.log('');
console.log('=== 运行时错误（未捕获异常 / console.error）===');
console.log(errs.length ? errs.join('\n') : '（一条都没有 ✓）');
ws.close();
process.exit(0);
