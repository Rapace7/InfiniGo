/* 拼 Release 说明：版本专属那段（文件开头）+ 通用部分（从「关于三大目录的分工」起）。
   为什么用 node 而不是 PowerShell：PS 5.1 的命令行中文参数会被转码成 GBK，
   `IndexOf('三大目录')` 恒返回 -1（实测踩到）。node 读写 UTF-8 干净。
   用法：node _mk_notes.mjs  → 生成 _release_notes.md */
import fs from 'node:fs';

const SRC = 'D:/GoStudy/RapaceGo/发布说明.md';
const OUT = 'D:/GoStudy/RapaceGo/_release_notes.md';

const t = fs.readFileSync(SRC, 'utf8');
const marker = '## 关于「三大目录」的分工';
const i = t.indexOf(marker);
if (i < 0) { console.error('★ 找不到通用部分的起点：' + marker); process.exit(1); }

const ver = t.slice(0, i);
const gen = t.slice(i);
fs.writeFileSync(OUT, ver + gen, 'utf8');

console.log('版本专属段 ' + ver.length + ' 字符');
console.log('通用部分   ' + gen.length + ' 字符');
console.log('合计       ' + (ver.length + gen.length) + ' 字符 → ' + OUT);
console.log('--- 版本段首行 ---');
console.log(ver.split('\n')[0]);
console.log('--- 拼接处（版本段末 3 行 + 通用段首 2 行）---');
const tail = ver.trimEnd().split('\n').slice(-3);
const head = gen.split('\n').slice(0, 2);
for (const l of tail) console.log('  │ ' + l);
console.log('  ├─ 接 ─');
for (const l of head) console.log('  │ ' + l);
