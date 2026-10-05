/* 验证「棋谱库位置可改」（2026-10-05 用户要求）：
   默认仍在程序目录\records，但设置面板和棋谱库里都能改；
   改的时候已有棋谱会**复制**过去（老的不删）。 */
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 120000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '');
  return r.result?.result?.value;
}

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};
  const NEW = 'D:/GoStudy/RapaceGo/_test_records';

  /* ---------- ① 默认位置 ---------- */
  const d0 = await window.api.records.dir();
  R['① 默认位置'] = d0;
  R['① 在程序目录里'] = /RapaceGo[/\\\\]records$/.test(d0) ? '✓' : '★ 不对';

  /* ---------- ② 造两份棋谱（模拟用户已有的） ---------- */
  await window.api.records.save('_t1.sgf', '(;GM[1]FF[4]SZ[19]KM[7.5]RU[Chinese];B[pd];W[dp])');
  await window.api.records.save('_t2.sgf', '(;GM[1]FF[4]SZ[19]KM[7.5]RU[Chinese];B[pp];W[dd])');
  R['② 造了 2 份棋谱'] = 'ok';

  /* ---------- ③ 设置面板里那一项在不在 ---------- */
  $('set-save') && 0;
  R['③ 设置面板有这一项'] = ($('set-recordsDir') && $('pick-recordsDir') && $('mark-recordsDir'))
    ? '✓ 输入框 + 更改 + 用默认 都在' : '★ 缺元素';
  R['③ 棋谱库有按钮'] = $('rec-change-dir') ? '✓' : '★ 缺 rec-change-dir';

  /* ---------- ④ 改位置（直接调 IPC，跳过系统对话框） ---------- */
  const r = await window.api.records.setDir(NEW);
  R['④ 改位置'] = (r && r.ok) ? ('✓ → ' + r.dir) : ('★ ' + ((r && r.error) || '失败'));
  R['④ 搬了几份'] = r && r.moved ? ('复制 ' + r.moved.copied + ' / 跳过 ' + r.moved.skipped + ' / 失败 ' + r.moved.failed) : '—';
  const d1 = await window.api.records.dir();
  R['④ 目录已切'] = (d1 === NEW) ? '✓' : ('★ 仍是 ' + d1);

  /* ---------- ⑤ 新位置真能看到棋谱 ---------- */
  const list = await window.api.records.list();
  R['⑤ 新位置里的棋谱'] = list.filter(x => x.name.indexOf('_t') === 0).map(x => x.name).join(' ') || '（空）';

  /* ---------- ⑥ 老位置没被删（安全：宁可多删一次） ----------
     渲染进程没有 require，不能直接看文件 —— 改成「切回老位置去列一下」：
     如果还在，说明只是复制、没删。 */
  await window.api.records.setDir(d0);
  const oldList = await window.api.records.list();
  const stillThere = oldList.filter(x => x.name.indexOf('_t') === 0).length;
  R['⑥ 老位置保留'] = stillThere >= 2
    ? ('✓ ' + stillThere + ' 份都还在（只是复制、没删）') : ('★ 只剩 ' + stillThere + ' 份');

  /* ---------- ⑦ 改回默认 ---------- */
  const r2 = await window.api.records.setDir('');
  const d2 = await window.api.records.dir();
  R['⑦ 改回默认'] = /records$/.test(d2) && d2 !== NEW ? ('✓ → ' + d2) : ('★ ' + d2);
  R['⑦ 回默认后棋谱还在'] = (await window.api.records.list()).some(x => x.name === '_t1.sgf') ? '✓' : '★ 丢了';

  /* 清理测试文件 */
  for (const n of ['_t1.sgf', '_t2.sgf']) {
    try { await window.api.records.remove(n); } catch (e) {}
  }
  R['⑧ 清理'] = 'ok';
  return JSON.stringify(R, null, 1);
})()`);

console.log(out);
ws.close();
process.exit(0);
