/* 验证底栏「显示」下拉（2026-10-04 方案 A）：
   ① 底栏从三行回到一行（高度 + 不溢出）
   ② 点「显示 ▾」展开、点外面/Esc 收起
   ③ 菜单里 6 个开关 + 形势画法下拉一个不少（id 没变）
   ④ 菜单里点开关能生效；快捷键 T/Z/M/B/Y/X/N 仍照常，且菜单里的勾选跟着同步
   结束时把菜单展开，供截图。 */
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
  if (m.method === 'Runtime.exceptionThrown') errs.push('异常: ' + (m.params.exceptionDetails?.exception?.description || '').split('\n')[0]);
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
  while (!engineReady && Date.now() - t0 < 60000) await sleep(500);
  const R = {};
  const $ = id => document.getElementById(id);
  const bar = document.querySelector('.bottombar');
  const menu = $('disp-menu');

  /* ① 底栏布局 */
  R['① 底栏高度'] = bar.clientHeight + 'px（一行约 48~60；折三行会 >100）';
  R['① 底栏是否溢出'] = bar.scrollWidth > bar.clientWidth + 1
    ? ('★ 溢出 ' + bar.scrollWidth + ' > ' + bar.clientWidth) : '✓ 没溢出';
  /* 底栏里还剩几个直接子元素（原来开关一堆，现在应该少很多） */
  R['① 底栏里可见的开关数量'] = [...bar.querySelectorAll('.toggle')].filter(e => e.offsetParent !== null).length;

  /* ② 展开 / 收起 */
  R['② 初始是收起的'] = menu.hidden ? '✓' : '★ 一进来就开着';
  $('btn-disp').click(); await sleep(250);
  R['② 点「显示」展开'] = (!menu.hidden && getComputedStyle(menu).display === 'flex')
    ? '✓ 展开（display:flex）' : ('★ hidden=' + menu.hidden + ' display=' + getComputedStyle(menu).display);
  const mb = menu.getBoundingClientRect(), bb = bar.getBoundingClientRect();
  R['② 菜单位置'] = '菜单底 ' + Math.round(mb.bottom) + ' · 底栏顶 ' + Math.round(bb.top)
    + ' · 菜单顶 ' + Math.round(mb.top);
  R['② 在底栏上方且没出屏'] = (mb.bottom <= bb.top + 8 && mb.top >= 0)
    ? '✓' : '★ 位置不对';

  /* ③ 菜单内容完整 */
  const ids = ['chk-show', 'chk-coords', 'chk-nums', 'chk-pv', 'chk-sound', 'chk-terr', 'sel-terr'];
  R['③ 菜单里的元素'] = ids.filter(i => menu.contains($(i))).join(', ') || '★ 一个都没有';
  R['③ 开关标签'] = [...menu.querySelectorAll('.toggle span')].map(e => e.textContent).join(' / ');

  /* ④ 菜单里点开关 = 生效 */
  const before = state.showNums;
  $('chk-nums').click(); await sleep(250);
  R['④ 菜单里点「手数」'] = state.showNums !== before ? ('✓ showNums=' + state.showNums) : '★ 没生效';
  $('chk-nums').click(); await sleep(200);          // 还原

  /* ⑤ 快捷键仍然工作，且菜单里的勾选同步 */
  const beforeShow = state.showHints;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', bubbles: true }));
  await sleep(300);
  R['⑤ 快捷键 T 仍生效'] = state.showHints !== beforeShow ? ('✓ showHints=' + state.showHints) : '★ 没生效';
  R['⑤ 菜单里的勾选跟着同步'] = $('chk-show').checked === state.showHints ? '✓' : '★ 脱节';
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', bubbles: true }));   // 还原
  await sleep(250);

  /* ⑥ 点外面 / Esc 收起 */
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(250);
  R['⑥ 点外面收起'] = menu.hidden ? '✓' : '★ 还开着';
  $('btn-disp').click(); await sleep(200);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(250);
  R['⑥ Esc 收起'] = menu.hidden ? '✓' : '★ 还开着';

  /* ⑦ 菜单里点开关时**不该**自动收起（连着开几个是常见用法） */
  $('btn-disp').click(); await sleep(200);
  $('chk-coords').click(); await sleep(250);
  R['⑦ 点开关不收起菜单'] = !menu.hidden ? '✓' : '★ 收起来了';
  $('chk-coords').click(); await sleep(200);        // 还原

  /* 留最后：展开菜单供截图 */
  await sleep(300);
  R['⑧ 截图状态'] = !menu.hidden ? '菜单展开 ✓' : '★ 收起了（重新打开）';
  if (menu.hidden) $('btn-disp').click();
  await sleep(300);
  return JSON.stringify(R, null, 1);
})()`);
await new Promise(r => setTimeout(r, 600));
console.log(out);
console.log('');
console.log('=== 运行时错误 ===');
console.log(errs.length ? errs.join('\n') : '（无 ✓）');
ws.close();
process.exit(0);
