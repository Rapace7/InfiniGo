/* 验证本轮六项改动（2026-10-04 用户挑的功能）：
   ① 超时判负  ② 读秒提示音  ③ 棋谱库搜索/筛选  ④ 权重历史下拉（datalist）
   ⑤ 导入棋谱（只验入口，不点 —— 点了会弹系统文件框卡住测试）  ⑥ 首次使用引导
   结束时停在「未开局 + 帮助面板打开」供截图。 */
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
let seq = 0; const pending = new Map(); const errs = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    errs.push('异常: ' + (m.params.exceptionDetails?.exception?.description || '').split('\n')[0]);
  }
};
const send = (method, params) => new Promise(res => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 300000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const t0 = Date.now();
  while ((!engineReady || !engineReadyPlay) && Date.now() - t0 < 90000) await sleep(500);
  const R = {};
  const $ = id => document.getElementById(id);
  const setClock = (o) => {
    const c = state.clock;
    c.on = true; c.byo = o.byo || 0; c.add = 0; c.paused = false; c.expired = null;
    c.b = { t: o.bt, n: o.bn === undefined ? 3 : o.bn };
    c.w = { t: o.wt, n: o.wn === undefined ? 3 : o.wn };
    c.side = o.side || 'b';
    c.phase = (o.side === 'w' ? c.w.t : c.b.t) > 0 ? 'main' : 'byo';
    c.since = performance.now() - (o.elapsed || 0) * 1000;
    c.running = true;
  };

  /* ---------- ① 超时判负：主时间走完且不读秒 ---------- */
  settings.clock = 'none'; applyNewGame();
  tryPlay(3, 3); await sleep(300);
  setClock({ bt: 0.4, wt: 60, byo: 0, side: 'b' });     // 黑方只剩 0.4 秒、无读秒
  await sleep(1200);
  R['① 超时判负（无读秒）'] = state.result
    ? ('✓ ' + (state.result.winner === 'w' ? '白方胜' : '黑方胜') + ' · by=' + state.result.by)
    : '★ 没有判负';
  R['① 结果条'] = $('verdict').hidden ? '★ 没显示' : ('✓ ' + ($('verdict-text').textContent || '').slice(0, 30));
  R['① 结果条文案对（不是「认输」）'] = /超时/.test($('verdict-text').textContent || '') ? '✓' : '★ 文案错了';

  /* ---------- ①b 读秒次数用尽 → 也判负 ---------- */
  state.result = null; renderVerdict();
  setClock({ bt: 0, wt: 60, byo: 2, bn: 0, wn: 3, side: 'b', elapsed: 2.4 });   // 读秒只剩 0 次还超时
  await sleep(1200);
  R['①b 超时判负（读秒用尽）'] = state.result ? ('✓ by=' + state.result.by) : '★ 没有判负';

  /* ---------- ② 读秒提示音：hook 掉 playBeep 计数 ----------
     ⚠️ 必须用**摆棋模式**：人机模式下 AI 会在我造的这几秒里抢一手落子，
        时钟就跟着切到它那边（主时间 60 秒）→ 读秒根本不会触发（第一版就是这么误判的）。 */
  let beeps = 0;
  try { window.playBeep = function () { beeps++; }; } catch (e) { }
  state.result = null; renderVerdict();
  settings.mode = 'free'; applyNewGame(); await sleep(250);
  setClock({ bt: 0, wt: 60, byo: 5, bn: 3, wn: 3, side: 'b', elapsed: 3.6 });   // 读秒剩约 1.4 秒
  await sleep(1200);
  R['② 读秒音'] = beeps > 0 ? ('✓ 触发 ' + beeps + ' 次') : '★ 一次都没触发（检查时钟是不是被抢手切走了）';
  /* 主时间阶段不该响 */
  beeps = 0;
  setClock({ bt: 40, wt: 40, byo: 5, bn: 3, wn: 3, side: 'b', elapsed: 1 });
  await sleep(800);
  R['② 主时间阶段不响'] = beeps === 0 ? '✓' : ('★ 响了 ' + beeps + ' 次');

  /* ---------- ③ 棋谱库搜索 / 筛选 ---------- */
  settings.clock = 'none'; applyNewGame(true); await sleep(300);
  $('btn-records').click(); await sleep(700);
  const n0 = document.querySelectorAll('#reclist li').length;
  R['③ 搜索框存在'] = !!$('rec-search') ? '✓' : '★';
  R['③ 计数（未筛选）'] = $('rec-count').textContent;
  $('rec-search').value = 'zzz不存在zzz'; $('rec-search').oninput(); await sleep(300);
  R['③ 无匹配时'] = (document.querySelectorAll('#reclist li').length === 1
    && !!document.querySelector('#reclist li.empty')) ? '✓ 显示空提示' : '★ 状态不对';
  $('rec-search').value = '115'; $('rec-search').oninput(); await sleep(300);
  R['③ 按文件名数字筛选'] = 'li=' + document.querySelectorAll('#reclist li').length + ' · ' + $('rec-count').textContent;
  $('rec-search').value = ''; $('rec-search').oninput(); await sleep(300);
  R['③ 清空后恢复'] = document.querySelectorAll('#reclist li').length === n0 ? '✓' : '★';
  R['③ 导入按钮'] = ($('rec-import') && typeof $('rec-import').onclick === 'function') ? '✓ 有入口（没点：会弹系统文件框）' : '★ 没有';
  $('rec-close').click(); await sleep(200);

  /* ---------- ④ 权重历史下拉（datalist） ---------- */
  fillRecentWeights({ analyzeWeight: ['D:/a/b11c768nbt.bin.gz', 'D:/b/别的强权重.bin.gz'], playWeight: ['D:/c/humanv0.bin.gz'] });
  R['④ 分析权重历史项'] = $('recent-analyzeWeight').children.length + ' 项';
  R['④ 对弈权重历史项'] = $('recent-playWeight').children.length + ' 项';
  R['④ 输入框已挂 datalist'] = ($('set-analyzeWeight').getAttribute('list') === 'recent-analyzeWeight'
    && $('set-playWeight').getAttribute('list') === 'recent-playWeight') ? '✓' : '★ 没挂上';
  fillRecentWeights({});       // 还原（真实数据由主进程提供）

  /* ---------- ⑤ 引擎没起来时的指路提示 ---------- */
  engineNote = '（测试）引擎异常';
  applyNewGame(true); syncUI(); await sleep(300);
  R['⑤ gate-tip 显示'] = !$('gate-tip').hidden ? '✓' : '★ 没显示';
  engineNote = ''; syncUI(); await sleep(250);
  R['⑤ gate-tip 隐藏'] = $('gate-tip').hidden ? '✓' : '★ 还显示着';

  /* ---------- ⑥ 首次使用引导 ---------- */
  $('btn-help').click(); await sleep(400);
  const h3 = [...document.querySelectorAll('#help .help-body h3')].map(e => e.textContent.trim());
  R['⑥ 帮助分节'] = h3;
  R['⑥ 第一节是引导'] = h3[0] && h3[0].indexOf('第一次使用') === 0 ? '✓' : '★ 不在最前';
  R['⑥ 引导步骤数'] = document.querySelectorAll('#help .help-steps li').length;
  R['⑥ 引导首条'] = (document.querySelector('#help .help-steps li') || {}).textContent?.slice(0, 30);
  R['⑥ 帮助没有自动弹过'] = '（由测试脚本手动打开的，不是自动弹的）';

  return JSON.stringify(R, null, 1);
})()`);
await new Promise(r => setTimeout(r, 800));
console.log(out);
console.log('');
console.log('=== 运行时错误 ===');
console.log(errs.length ? errs.join('\n') : '（无 ✓）');
ws.close();
process.exit(0);
