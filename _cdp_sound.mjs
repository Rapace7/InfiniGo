/* 验证落子音效的修复（2026-10-06 用户报「有时候声音特别小、几乎听不见」）。
   修的核心是两条：
     ① 每种音效预备 3 个副本 → 播放时**不去动正在播的元素**（原来 5 个复用，
        重播要先 currentTime=0，对正在播的元素就是 seek → 声音被掐断）
     ② 起播挪到重绘之后（这条在 app.js 的 tryPlay 里，这里顺带确认没写错）
   本测试只能验证①②的**机制**（元素池、挑空闲副本、不误伤正在播的）——
   音色/响度得靠耳朵，机器测不了（已用 RMS 做过归一，数值留档在开发记录）。 */
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 40000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};
  const eq = (a, b) => a === b ? '✓' : ('★ 期望 ' + b + '，实际 ' + a);

  R['① 音效文件数'] = SOUND_FILES.length + ' ' + eq(SOUND_FILES.length, 5);
  R['② 元素池大小'] = SOUND_POOL.length + ' ' + eq(SOUND_POOL.length, 15);
  R['③ 每种份数'] = SOUND_COPIES + ' ' + eq(SOUND_COPIES, 3);
  R['④ 音量都在 0.5~1'] = (SOUND_POOL.every(x => x.el.volume >= 0.5 && x.el.volume <= 1) ? '✓' : '★ 有异常')
    + '（范围 ' + Math.min(...SOUND_POOL.map(x => x.el.volume)).toFixed(2) + '~' + Math.max(...SOUND_POOL.map(x => x.el.volume)).toFixed(2) + '）';
  R['⑤ 全部 preload=auto'] = SOUND_POOL.every(x => x.el.preload === 'auto') ? '✓' : '★';
  R['⑥ 资源路径都对'] = SOUND_POOL.every(x => x.el.src.indexOf('go_stone_') > 0) ? '✓' : '★';

  /* 关键：连播 8 次，看有没有「正在播的元素被再次选中」*/
  state.soundOn = true;
  const used = [];
  let retrigger = 0;
  for (let k = 0; k < 8; k++) {
    const playingBefore = new Set(SOUND_POOL.filter(x => !x.el.paused && !x.el.ended).map(x => x.el));
    playStoneSound();
    /* 找出这次新开始播的那个 */
    const nowPlaying = SOUND_POOL.filter(x => !x.el.paused && !x.el.ended).map(x => x.el);
    const fresh = nowPlaying.filter(e => !playingBefore.has(e));
    if (fresh.length) used.push(fresh[0].src.split('/').pop());
    else retrigger++;                       // 没有新元素开始播 → 说明动了一个原本在播的
    await sleep(12);
  }
  R['⑦ 连播 8 次用了几个不同元素'] = used.length + ' 次起播 / 出现 ' + retrigger + ' 次「无新元素」'
    + (retrigger === 0 ? ' ✓（每次都用了空闲副本）' : ' ★（动了正在播的）');
  R['⑦ 用到的音效'] = used.join(' ');

  /* 关掉音效时不该出声 */
  state.soundOn = false;
  const before = SOUND_POOL.filter(x => !x.el.paused && !x.el.ended).length;
  playStoneSound();
  await sleep(80);
  const after = SOUND_POOL.filter(x => !x.el.paused && !x.el.ended).length;
  R['⑧ 关掉音效不出声'] = (after <= before) ? '✓' : '★ 还在播';
  state.soundOn = true;

  /* 顺带确认 tryPlay 里音效是**排在重绘之后**
     ⚠️ 别用正则：本文件是模板字符串，`\(` 会被 JS 先吃掉反斜杠变成 `(`，
     正则就成了一个「分组」→ 匹配不上（这里踩过一次，白报了一个假警）。 */
  R['⑨ 起播排在重绘后'] = String(tryPlay).indexOf('setTimeout(playStoneSound, 0)') >= 0
    ? '✓ 源码里是 setTimeout(playStoneSound, 0)'
    : '★ 没找到（音效可能又挪回重绘之前了）';

  state.soundOn = true;
  return R;
})()`);

console.log(JSON.stringify(out, null, 2));
ws.close();