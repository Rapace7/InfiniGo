/* 复现「解说词框点编辑后退不出去」。
   根因（2026-10-06）：
     renderCommentBox() 开头有 `if (box.querySelector('textarea')) return;`
     —— 正在编辑时不覆盖用户输入（这是对的，syncUI 会频繁调它）。
     而「取消」按钮调的**正是** renderCommentBox()，此时 textarea 还在框里
     → 第一行就 return → **永远退不出编辑态**。

   验证要点：
     ① 进得去（点编辑确实变成 textarea）
     ② 退不出来（点取消，textarea 还在）
     ③ 同一个按钮连点两次有没有用（应该没用 —— 状态没变）
     ④ 保存能不能出去（保存走的是另一条路，应该正常）
     ⑤ 修完之后 ②③ 要变成 ✓
*/
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
  const NAME = '死活题集-示例.sgf';

  const rd = await window.api.records.read(NAME);
  if (!rd || rd.error) return { '读棋谱': '★ ' + ((rd && rd.error) || '失败') };
  const p = parseSGF(rd.text);
  applyRecord(p, NAME);
  await sleep(300);
  const keys = Object.keys(p.comments || {}).map(Number).filter(k => k > 0);
  if (!keys.length) return { '★ 结果': '这份棋谱没有解说词，测不了' };
  gotoView(keys[0]);
  await sleep(300);

  const box = document.getElementById('cbox');
  const btnEdit = document.getElementById('cbox-edit');
  const inEdit = () => !!box.querySelector('textarea');

  R['起始是编辑态吗'] = inEdit() ? '★ 一开始就在编辑' : '否';

  /* ① 进得去吗 */
  btnEdit.click();
  await sleep(250);
  R['① 点「编辑」能进去'] = inEdit() ? '✓' : '★ 进不去';
  R['① 有取消按钮'] = (function(){
    const bs = [...box.querySelectorAll('button')].map(b => b.textContent);
    return bs.includes('取消') ? '✓ ' + bs.join('/') : '★ ' + bs.join('/');
  })();

  /* ② 退不出来吗 */
  const cancel = () => {
    const b = [...box.querySelectorAll('button')].filter(x => x.textContent === '取消')[0];
    if (b) b.click();
  };
  cancel();
  await sleep(300);
  R['② 点「取消」退得出吗'] = inEdit() ? '★ 退不出（textarea 还在）' : '✓ 退出了';
  R['② 退不出时的框里是什么'] = inEdit()
    ? JSON.stringify(box.textContent.replace(/\\s+/g,' ').trim().slice(0, 40))
    : '(已清空)';

  /* ③ 连点两次有用吗（状态没变，应该没用） */
  cancel(); await sleep(150); cancel(); await sleep(250);
  R['③ 连点两次'] = inEdit() ? '★ 还是退不出（按预期：状态没变）' : '✓ 退出去了';

  /* ④ 换个手再回来，编辑态会清掉吗（syncUI 走的是同一个 render） */
  if (inEdit()) {
    gotoView(keys[0] + 1); await sleep(200);
    gotoView(keys[0]); await sleep(200);
    R['④ 翻手再回来'] = inEdit() ? '★ 还卡在编辑态（翻手也救不了）' : '✓ 翻手后自动清了';
  }

  /* ⑤ 保存这条路能出去吗（它是另一条路） */
  if (inEdit()) { cancel(); await sleep(200); }
  btnEdit.click(); await sleep(200);
  if (inEdit()) {
    const ta = box.querySelector('textarea');
    ta.value = '测试：保存路径能不能出去';
    const save = [...box.querySelectorAll('button')].filter(x => x.textContent === '保存')[0];
    if (save) save.click();
    await sleep(900);
    R['⑤ 点「保存」能出去吗'] = inEdit() ? '★ 也退不出' : '✓ 退出了';
    R['⑤ 保存后框里显示'] = JSON.stringify((box.textContent || '').replace(/\\s+/g,' ').trim().slice(0, 34));
  } else {
    R['⑤ 点「保存」能出去吗'] = '（前面已经退出了，跳过）';
  }

  /* ---------- ⑥ 修好后新增的两条出路 ---------- */
  // ⑥-a Esc = 取消
  btnEdit.click(); await sleep(200);
  if (!inEdit()) { R['⑥-a 进编辑态'] = '★ 进不去'; }
  else {
    const ta = box.querySelector('textarea');
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await sleep(250);
    R['⑥-a Esc 能取消'] = inEdit() ? '★ Esc 没用' : '✓ 退出了';
  }

  // ⑥-b 换棋谱时自动退出（否则上一份的半截文字会跟着走进新棋谱）
  btnEdit.click(); await sleep(200);
  if (inEdit()) {
    box.querySelector('textarea').value = '★ 半截没保存的文字';
    gotoView(keys[0] + 1); await sleep(150);
    const rd2 = await window.api.records.read(NAME);
    applyRecord(parseSGF(rd2.text), NAME);
    await sleep(300);
    R['⑥-b 换棋谱后编辑态'] = inEdit() ? '★ 还卡着（半截文字会跟到新棋谱）' : '✓ 自动退出了';
    R['⑥-b 框里是否残留半截文字'] = (box.textContent || '').includes('半截没保存')
      ? '★ 残留了' : '✓ 没有';
  } else {
    R['⑥-b'] = '（进不去编辑态，跳过）';
  }

  /* ---------- ⑧ ★ 用户明确的要求：取消 = 不保存，且显示回到打开编辑时的样子 ----------
     用户原话：「取消就是不进行更改保存，新写的东西，点取消了就不保存，
     还是原来打开编辑时候的样子」
     这要验两件不同的事：
       a) 界面上显示的回到原样（不是新写的）
       b) **磁盘上的文件一个字节都没变**（界面对了、文件被改了，那是更严重的事） */
  // 先拿到一份干净的磁盘内容
  const rdBefore = await window.api.records.read(NAME);
  const txtBefore = rdBefore.text;
  const at0 = keys[0];
  const originText = (p.comments && p.comments[at0]) || '';

  // 进编辑 → 写一堆新东西 → 取消
  gotoView(at0); await sleep(250);
  btnEdit.click(); await sleep(220);
  if (!inEdit()) { R['⑧ 进编辑态'] = '★ 进不去'; }
  else {
    const ta = box.querySelector('textarea');
    ta.value = '★★ 这是我新写但不该保存的内容 ★★';
    const cancelBtn = [...box.querySelectorAll('button')].filter(x => x.textContent === '取消')[0];
    cancelBtn.click();
    await sleep(350);

    const shown = (box.textContent || '').replace(/\s+/g, ' ').trim();
    R['⑧ 显示回到原样'] = shown === originText.replace(/\s+/g, ' ').trim()
      ? '✓ 与打开编辑前一致' : ('★ 变成了 ' + JSON.stringify(shown.slice(0, 40)));
    R['⑧ 新写的内容没显示'] = shown.includes('★★ 这是我新写') ? '★ 还显示着新写的' : '✓ 没了';
    R['⑧ 没有 textarea 残留'] = inEdit() ? '★ 还在编辑态' : '✓ 已退出';
  }

  // 磁盘文件必须一字节未变
  const rdAfter = await window.api.records.read(NAME);
  R['⑧ 磁盘文件字节数'] = rdBefore.text.length + ' → ' + rdAfter.text.length;
  R['⑧ 磁盘内容完全未变'] = txtBefore === rdAfter.text
    ? '✓ 一个字节都没动'
    : '★ 文件被改了（这是更严重的事）';

  /* ---------- ⑦ 复核：每条出路都能连续用两次（防"只能用一次"） ---------- */
  for (let i = 1; i <= 2; i++) {
    btnEdit.click(); await sleep(180);
    const entered = inEdit();
    const cancel = () => {
      const b2 = [...box.querySelectorAll('button')].filter(x => x.textContent === '取消' || x.textContent === '放弃修改')[0];
      if (b2) b2.click();
    };
    cancel(); await sleep(220);
    R['⑦ 第 ' + i + ' 轮：进→退'] = (entered && !inEdit()) ? '✓' : (entered ? '★ 退不出' : '★ 进不去');
  }

  return R;
})()`);

console.log(JSON.stringify(out, null, 1));
process.exit(0);
