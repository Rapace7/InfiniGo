/* 拼 Release 说明：版本专属那段（文件开头）+ 通用部分（从「关于三大目录的分工」起）。
   为什么用 node 而不是 PowerShell：PS 5.1 的命令行中文参数会被转码成 GBK，
   `IndexOf('三大目录')` 恒返回 -1（实测踩到）。node 读写 UTF-8 干净。
   用法：node _mk_notes.mjs  → 生成 _release_notes.md */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ★ 2026-10-07：脚本搬进 dev\ —— 路径按脚本自身位置算，不写死盘符。 */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, '发布说明.md');
const OUT = path.join(ROOT, '_release_notes.md');

const t = fs.readFileSync(SRC, 'utf8');
const marker = '## 关于「三大目录」的分工';
const i = t.indexOf(marker);
if (i < 0) { console.error('★ 找不到通用部分的起点：' + marker); process.exit(1); }

const ver = t.slice(0, i);
const gen = t.slice(i);

/* ★★ 2026-10-08 用户要求：**Release 说明必须"下载优先"**。
   原来正文一上来就是几千字的分版本说明，用户要往下拉很久才看到下载文件 ——
   而 GitHub 的 Release 页面里**文件清单（Assets）在页面最下面**，
   说明越长，越难找到下载（用户原话：「需要往下拉很多才能看到 assets 的下载」）。

   现在拼成这个结构：
     ① 首屏只有**一行话 + 一个直达 Assets 的锚点链接**（点一下滚到下载处）
     ② 所有正文折进 <details>，默认收起 —— 想看细节的人自己展开
   这样"从进页面到能点下载"永远只有一行 + 一次点击。 */
const firstLine = (ver.split('\n')[0] || '').replace(/^v?[\d.]+\s*[：:]\s*/, '').trim();

const HEAD = [
  '## 📥 [点这里下载 RapaceGo.zip](#assets)',
  '',
  '> ' + (firstLine || '本次更新说明见下。'),
  '> 下载文件在页面**最下面**的 `Assets` 那块 —— 点上面那个链接会直接滚过去。',
  '',
  '<details>',
  '<summary><b>展开看这一版改了什么</b></summary>',
  '',
].join('\n');

const FOOT = '\n</details>\n';

fs.writeFileSync(OUT, HEAD + ver + '\n' + gen + FOOT, 'utf8');

console.log('说明段 ' + ver.length + ' 字符（已折进 <details>）');
console.log('通用部分 ' + gen.length + ' 字符（也已折起）');
console.log('合计 ' + (HEAD.length + ver.length + gen.length + FOOT.length) + ' 字符 → ' + OUT);
console.log('--- 首屏（用户第一眼看到的）---');
console.log(HEAD);
