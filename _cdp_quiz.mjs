/* 「第 N 题 / 共 M 题」提示的端到端测试（2026-10-06）。
   显示位置：**顶栏状态行**（棋盘四周只有 3px 空隙，任何浮层都会盖住棋盘 ——
   先前做成普通块级元素，它成了 .board-wrap 的第三个 flex item，被挤到棋盘正中间；
   改成绝对定位也还是落在棋盘上，因为棋盘几乎占满整个区域。所以并进顶栏最自然：
   顶栏本来就写着「第 N 手」，题号跟它是同一类信息）。

   验五件事：
     ① 打开题集后顶栏出现题号，题号/总题数对，且**不遮挡棋盘**（量几何）
     ② 逐个分界前后，题号正好跨 1（唯一容易写错的地方：>= 还是 >）
     ③ 末局题号 == 总题数
     ④ 解说词框不受影响
     ⑤ 反向：单题棋谱 / 未开局 时不出现 */
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
async function js(expr, tmo) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 60000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};

  /* ---------- ① 从棋谱库里找一份多题题集 ---------- */
  const list = await window.api.records.list();
  R['① 棋谱库份数'] = (list && list.length) || 0;
  let name = null, p = null;
  if (list && list.length) {
    for (const it of list) {
      if (!/\\.sgf$/i.test(it.name)) continue;
      const rd = await window.api.records.read(it.name);
      if (!rd || rd.error) continue;
      let q;
      try { q = parseSGF(rd.text); } catch (e) { continue; }
      if ((q.seps || []).length >= 1) { name = it.name; p = q; break; }
    }
  }
  if (!name) return { '① 结果': '★ 棋谱库里没有多题题集（zz），这条测不了' };

  R['① 样本'] = name;
  R['① 手数'] = p.moves.length + ' 手';
  R['① 题数'] = (p.seps || []).length + 1 + ' 题';
  R['① 分界位置'] = JSON.stringify(p.seps || []);

  const st = () => (document.getElementById('status').textContent || '').trim();
  const quizNum = () => {
    const m = st().match(/第 (\\d+) 题/);
    return m ? parseInt(m[1], 10) : null;
  };
  const totalTxt = () => {
    const m = st().match(/共 (\\d+) 题/);
    return m ? parseInt(m[1], 10) : null;
  };

  applyRecord(p, name);
  gotoView(p.moves.length);
  await sleep(300);

  R['① 顶栏文字'] = JSON.stringify(st());
  R['① 末局题号'] = quizNum();
  R['① 总题数'] = totalTxt();
  R['① 提示出现在顶栏'] = quizNum() !== null ? '✓' : '★ 顶栏没有题号';

  /* ★ 不遮挡：题号只在顶栏里，棋盘区域的子元素不该多出提示块 */
  const wrap = document.querySelector('.board-wrap');
  const extra = [...wrap.children].filter(e => !['board', 'verdict', 'board-gate'].includes(e.id));
  R['① 棋盘区没多出提示块'] = extra.length === 0
    ? '✓ (' + [...wrap.children].map(e=>'#'+e.id).join(' ') + ')'
    : '★ 多出 ' + extra.map(e=>'#'+e.id).join(',');
  const stRect = document.getElementById('status').getBoundingClientRect();
  const bdRect = document.getElementById('board').getBoundingClientRect();
  R['① 顶栏不压棋盘'] = stRect.bottom <= bdRect.top ? ('✓ (顶栏底 ' + Math.round(stRect.bottom) + ' ≤ 棋盘顶 ' + Math.round(bdRect.top) + ')') : '★ 压住了';

  /* ---------- ② 逐个分界：题号正好跨 1 ---------- */
  const seps = p.seps || [];
  let bad = [], rows = [];
  for (const s of seps) {
    gotoView(Math.max(0, s - 1)); await sleep(130);
    const nb = quizNum();
    gotoView(s); await sleep(130);
    const na = quizNum();
    rows.push('手' + Math.max(0,s-1) + '→第' + nb + ' · 手' + s + '→第' + na);
    if (na !== nb + 1) bad.push('分界 ' + s + '：' + nb + ' → ' + na);
  }
  R['② 分界跨 1'] = bad.length ? ('★ ' + bad.join(' | ')) : ('✓ ' + seps.length + ' 个分界全对');
  R['② 明细'] = rows.join('； ');

  /* ---------- ③ 首尾 ---------- */
  const total = seps.length + 1;
  gotoView(0); await sleep(150);
  R['③ 开局顶栏'] = JSON.stringify(st());
  R['③ 开局题号 == 1'] = quizNum() === 1 ? '✓' : '★ ' + quizNum();
  R['③ 总题数 == seps+1'] = totalTxt() === total ? ('✓ 共 ' + total) : ('★ ' + totalTxt() + ' vs ' + total);

  /* ---------- ④ 解说词框没被影响 ---------- */
  gotoView(seps[0]); await sleep(200);
  R['④ 该手解说词框标题'] = JSON.stringify(document.getElementById('cbox-at').textContent);
  R['④ 解说词框仍在'] = document.getElementById('cbox') ? '✓' : '★ 不见了';
  R['④ 该手顶栏'] = JSON.stringify(st());

  /* ---------- ⑤ 反向：不该出现的两种情况 ---------- */
  applyRecord(parseSGF('(;GM[1]FF[4]SZ[19];B[pd];W[dp];B[pp])'), name);
  gotoView(1); await sleep(250);
  R['⑤ 单题棋谱不显示'] = quizNum() === null ? '✓ 顶栏无题号' : ('★ ' + JSON.stringify(st()));
  R['⑤ 单题顶栏文字'] = JSON.stringify(st());

  state.noGame = true; state.quizTips = [10]; await sleep(200);
  R['⑤ 未开局不显示'] = quizNum() === null ? '✓' : '★';

  /* 复原 */
  state.noGame = false;
  applyRecord(p, name); gotoView(0);
  await sleep(250);
  R['复原后顶栏'] = JSON.stringify(st());
  return R;
})()`);

console.log(JSON.stringify(out, null, 1));
process.exit(0);
