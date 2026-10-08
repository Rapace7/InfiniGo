/* 静态检查：**本软件除了"检查更新"，任何地方都不出网**。
   为什么值得单独查：用户明确要求过"本软件无需联网"，而那是一条**很容易被无意破坏**的约定 ——
   加个小功能顺手 fetch 一下、引个库偷偷上报统计，静态代码里看不出来，运行时才知道。
   所以把它固化成一条可执行的检查，任何人（包括以后的我）改动时都会被拦住。

   用法：node _lint_net.mjs

   判据分三类：
     ① 允许：本地回环 —— 软件跟 LoGos（llama-server）说话走 127.0.0.1，不出网卡
     ② 允许：**检查更新**这一处（用户点名要的功能），且限于 GitHub 的 release 接口
     ③ 其余任何出网调用 → ★ 报出来

   ★ 注意别被"注释里的 URL"骗到：KataGo 自带的配置里满是 `# https://…` 文档链接，
     那是纯注释、不是请求。所以匹配前先把注释与字符串常量分开看。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILES = ['main.js', 'preload.js', 'renderer/app.js'];

/* ---------- 允许出网的宿主（只有 GitHub 的 release 页/接口）---------- */
const ALLOWED_HOSTS = [
  'api.github.com',
  'github.com',
];

/** 往后看几行，找这次调用实际连到哪：
 *    ① 同一行/后几行里的 http(s):// 主机名 → 就用它
 *    ② 没有主机名但出现了 127.0.0.1 / localhost → 本机（允许）
 *    ③ 都没有 → 交给调用方按函数名判断（比如自己封装的 fetchText）
 *  为什么往后看 6 行：实际写法常常是
 *      const r = http.request(        ← 调用在这行
 *        { host: '127.0.0.1', ... },  ← 主机在下一行
 *  只看同一行会把本机调用误报成"来路不明"。 */
function hostOf(lines, i) {
  const win = lines.slice(i, i + 6).join(' ');
  if (/127\.0\.0\.1|localhost/.test(win)) return 'loopback';
  const m = win.match(/https?:\/\/([a-z0-9.-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/* 自己封装的取文本函数 fetchText —— 它所在的行区间要**先算出来**，
   因为主循环里要跳过它（它的主机由调用方传入，不算出网点）。 */
const mainSrcEarly = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const wrapperRange = (() => {
  const start = mainSrcEarly.split('\n').findIndex(l => /async function fetchText/.test(l));
  if (start < 0) return null;
  const lines = mainSrcEarly.split('\n');
  let end = start;
  for (let k = start + 1; k < lines.length; k++) {
    if (/^\}/.test(lines[k])) { end = k; break; }     // 顶格的 } = 函数结束
  }
  return [start, end];
})();

const problems = [];
const allowed = [];
const wrappedCalls = [];

for (const rel of FILES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, 'utf8');
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    const no = i + 1;
    const code = line.trim();
    /* 跳过注释行（含块注释里的 `*` 开头）—— 那些 URL 是文档，不是请求 */
    if (/^(\/\/|\*|\/\*)/.test(code)) return;

    const callM = code.match(/\b(net\.fetch|fetch|https?\.request|https?\.get)\s*\(/);
    if (!callM) return;

    /* ★ 自己封装的那一层（`async function fetchText` / 函数体里的 `net.fetch(url,…)`）：
       它的主机由调用方传入，所以这里不算出网点 —— 改由下面单独检查**所有调用方**。 */
    const inWrapper = wrapperRange && i >= wrapperRange[0] && i <= wrapperRange[1];
    if (inWrapper) { wrappedCalls.push(`${rel}:${no}`); return; }

    const host = hostOf(lines, i);

    if (host === 'loopback') {
      allowed.push(`${rel}:${no}  ✓ 本机回环（跟 LoGos 说话，不出网卡）`);
    } else if (host && ALLOWED_HOSTS.includes(host)) {
      allowed.push(`${rel}:${no}  ✓ ${host}（检查更新）`);
    } else if (host) {
      problems.push(`${rel}:${no}  ★ 出网到 ${host}：${code.slice(0, 64)}`);
    } else {
      problems.push(`${rel}:${no}  ★ 来路不明的网络调用（主机名是变量，静态看不出来）：${code.slice(0, 64)}`);
    }
  });
}

/* ---------- 单独检查：自己封装的 fetchText 内部连到哪 ---------- */
const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const wrapperBody = (() => {
  const i = mainSrc.indexOf('async function fetchText');
  if (i < 0) return null;
  const j = mainSrc.indexOf('\n}', i);
  return mainSrc.slice(i, j < 0 ? i + 500 : j);
})();
if (wrapperBody) {
  /* wrapper 本身不含任何写死的 URL（URL 由调用方传入）—— 那就检查**所有调用方**传的是什么。
     ★ 要排除函数**定义**那一行（`async function fetchText(url, timeoutMs)`），
       它是声明不是调用 —— 第一版没排除，于是永远多报一个"主机是变量"。 */
  const callsites = [...mainSrc.matchAll(/(async\s+)?function\s+fetchText|fetchText\(\s*([^,)]+)/g)]
    .filter(m => m[2])                      // 只要"带实参的调用"，不要函数名/定义
    .map(m => m[2].trim());
  const bad = callsites.filter(c => {
    const h = (c.match(/https?:\/\/([a-z0-9.-]+)/i) || [])[1];
    return !h || !ALLOWED_HOSTS.includes(h.toLowerCase());
  });
  console.log('=== 自己封装的取文本函数 fetchText（检查更新用的那条路）===');
  console.log('  调用点 ' + callsites.length + ' 个：');
  for (const c of callsites) {
    const h = (c.match(/https?:\/\/([a-z0-9.-]+)/i) || [])[1] || '(主机是变量)';
    console.log('    ' + (ALLOWED_HOSTS.includes(String(h).toLowerCase()) ? '✓' : '★') + ' ' + h + '   ' + c.slice(0, 56));
  }
  if (bad.length) problems.push('fetchText 有 ' + bad.length + ' 个调用点连到了白名单之外的主机');
  console.log('');
}

/* ---------- ③ 反向检查：有没有偷偷引联网库 ---------- */
const NET_LIBS = ['axios', 'node-fetch', 'got', 'superagent', 'request', 'undici'];
const libHits = [];
for (const rel of FILES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, 'utf8');
  for (const lib of NET_LIBS) {
    const re = new RegExp("require\\(\\s*['\"]" + lib + "['\"]");
    if (re.test(src)) libHits.push(`${rel} 引了 ${lib}`);
  }
}

console.log('=== 允许的出网点（白名单）===');
console.log(allowed.length ? allowed.join('\n') : '（无）');
console.log('');
console.log('=== ★ 不该出网的地方 ===');
console.log(problems.length ? problems.join('\n') : '（无 ✓ 除检查更新外没有出网调用）');
console.log('');
console.log('=== ★ 偷偷引的联网库 ===');
console.log(libHits.length ? libHits.join('\n') : '（无 ✓）');

const bad = problems.length + libHits.length;
console.log('');
console.log(bad ? `★ 发现 ${bad} 处需要确认` : '✓ 通过：只有「检查更新」会出网，其余全在本机');
process.exit(bad ? 1 : 0);
