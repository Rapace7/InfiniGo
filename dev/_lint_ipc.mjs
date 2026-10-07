/* 静态检查：preload 暴露给前端的 API ↔ 主进程注册的 IPC handler 是否对得上。
   为什么值得单独查：前端调一个主进程没注册的方法时，`ipcRenderer.invoke` 会 reject
   （或静默失败），表现为"点了没反应"，而且只在运行时才暴露。
   用法：node _lint_ipc.mjs

   ★ 2026-10-05 修过一个自己的 bug：原来的参数正则只认 `() =>` 和 `(a, b) =>`，
     **漏掉了不带括号的单参数写法** `req => ipcRenderer.invoke(...)` ——
     于是把一堆真实存在的接口报成「没暴露」（假警报）。
     现在参数部分写成 `[^;{}\n]*?=>`（同一条目里不含分号/花括号，也没跨行）。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/* ★ 2026-10-07：脚本搬进 dev\ 之后，不能再用相对路径读（那依赖"在哪儿运行"）。
   统按脚本自身位置定位仓库根。 */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const PRE = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'renderer/app.js'), 'utf8');

/* ---------- main.js：注册了哪些频道 ---------- */
const handled = new Set();
for (const m of MAIN.matchAll(/ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)) handled.add(m[1]);

/* ---------- preload：暴露了哪些方法 → 走哪个频道 ---------- */
const exposed = [];          // { api, ch, kind }  kind: 'req'（invoke/send）| 'event'（on）
for (const m of PRE.matchAll(/(\w+)\s*:\s*[^;{}\n]*?=>\s*ipcRenderer\.(invoke|send|on)\(\s*'([^']+)'/g)) {
  exposed.push({ api: m[1], ch: m[3], kind: m[2] === 'on' ? 'event' : 'req' });
}
/* preload 的顶层键（含 `engine: {` / `records: {` 这种整块对象） */
const topKeys = new Set();
for (const m of PRE.matchAll(/^ {2}(\w+)\s*:/gm)) topKeys.add(m[1]);

const requests = exposed.filter(e => e.kind === 'req');
const events = exposed.filter(e => e.kind === 'event');

console.log('=== 规模 ===');
console.log('主进程注册频道:', handled.size, '| preload 接口:', exposed.length,
  '（请求', requests.length, '/ 事件', events.length, '）| 顶层键:', topKeys.size);
console.log('');

/* ---------- ① preload 用了但主进程没注册的频道 ---------- */
const missing = requests.filter(e => !handled.has(e.ch));
console.log('=== ① preload 请求了、但主进程没注册的频道（调用会失败）===');
console.log(missing.length ? missing.map(e => `★ ${e.api} → '${e.ch}'`).join('\n') : '（无 ✓）');
console.log('');

/* ---------- ② 事件订阅有没有发送方 ---------- */
/* ★ 注意：main.js 里推事件走的是自己封装的 `send(ch, data)` 辅助函数
   （`webContents.send` 包了一层，用来挡「窗口已销毁」），
   所以这里用 `\bsend(` 一次把两种写法都收进来 —— 只认 `webContents.send` 会全报假警报。 */
const sent = new Set();
for (const m of MAIN.matchAll(/\bsend\(\s*'([^']+)'/g)) sent.add(m[1]);
const evNoSender = events.filter(e => !sent.has(e.ch));
console.log('=== ② 事件订阅了、但主进程从没 send 过的 ===');
console.log(events.length
  ? (evNoSender.length
    ? evNoSender.map(e => `★ ${e.api} ← '${e.ch}'（没人发）`).join('\n')
    : '（无 ✓ 每个事件都有发送方）')
  : '（preload 没有事件订阅）');
console.log('');

/* ---------- ③ 主进程注册了但没人用（可能已废弃）---------- */
const usedCh = new Set(exposed.map(e => e.ch));
const unused = [...handled].filter(c => !usedCh.has(c)).sort();
console.log('=== ③ 主进程注册了但 preload 从没用过的频道 ===');
console.log(unused.length ? unused.join(', ') : '（无 ✓）');
console.log('');

/* ---------- ④ 前端调的 window.api.X（含二级 .Y）是否存在 ---------- */
const apiNames = new Set(exposed.map(e => e.api));
const badApi = [];
for (const m of APP.matchAll(/window\.api\.(\w+)(?:\.(\w+))?/g)) {
  const [, one, two] = m;
  if (!topKeys.has(one)) badApi.push('★ window.api.' + one + '（顶层键不存在）');
  else if (two && !apiNames.has(two)) badApi.push('★ window.api.' + one + '.' + two + '（方法不存在）');
}
const uniqBad = [...new Set(badApi)];
console.log('=== ④ 前端调了 window.api.X / .X.Y，但 preload 里没有 ===');
console.log(uniqBad.length ? uniqBad.join('\n') : '（无 ✓）');
console.log('');

/* ---------- ⑤ 前端根本没碰过的 preload 接口（冗余）----------
   ★ 动态调用（`window.api.engine[act](key)`）算是"用过了"——
     这种写法下方法名在运行时才决定，静态看不出来，所以整块标为已用。 */
const called = new Set();
for (const m of APP.matchAll(/window\.api\.(\w+)(?:\.(\w+))?/g)) called.add(m[2] || m[1]);
for (const m of APP.matchAll(/window\.api\.(\w+)\s*\[/g)) {
  for (const e of exposed) if (topKeys.has(m[1]) && e.api) called.add(e.api);
}
const neverCalled = [...apiNames].filter(n => !called.has(n)).sort();
console.log('=== ⑤ preload 暴露了、但前端从没调过的接口 ===');
console.log(neverCalled.length ? neverCalled.join(', ') : '（无 ✓）');
