/* 静态检查：JS 里引用的 DOM id 是否真的存在于 HTML。
   为什么专门写这个：本项目已经出过「元素没了但 JS 还在赋值 →
   $('x').textContent 抛 TypeError → 整个 syncUI 被打断、界面再也不刷新」这类 bug，
   而且是静默的（只有控制台报错）。这个检查能在几毫秒内把所有这类引用扫一遍。
   用法：node _lint_ids.mjs

   ★ 两个必须处理的误报源（第一版没处理，8 条命中全是误报）：
     ① **注释里的示例代码**（比如注释写着 `$('info-mode').textContent` 当反面教材）
        → 先把 /* *​/ 与 // 注释剥掉再扫；
     ② **JS 动态生成的元素**（复盘报告里 `h += '<button id="rv-go">'`）
        → 单独收集"页面里 new 出来的 id"，从缺失名单里剔除。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/* ★ 2026-10-07：脚本从仓库根目录搬进了 dev\ —— 原来用相对路径读文件
   （readFileSync('renderer/app.js')）就依赖「在哪儿运行」，一搬就坏。
   现在统按**脚本自身位置**定位仓库根，从哪个目录运行都行。 */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')          // 块注释
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');      // 行注释（避开 http:// 里的 //）

const raw = {
  app: fs.readFileSync(path.join(ROOT, 'renderer/app.js'), 'utf8'),
  main: fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8'),
  pre: fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8'),
};
const APP = strip(raw.app), MAIN = strip(raw.main);
const HTML = fs.readFileSync(path.join(ROOT, 'renderer/index.html'), 'utf8');

/* ---------- HTML 里的 id ---------- */
const htmlIds = [];
for (const m of HTML.matchAll(/\bid="([^"]+)"/g)) htmlIds.push(m[1]);
const htmlSet = new Set(htmlIds);
const dup = htmlIds.filter((v, i) => htmlIds.indexOf(v) !== i);

/* ---------- JS **运行时动态生成**的 id（innerHTML 拼出来的） ---------- */
const genIds = new Set();
for (const m of APP.matchAll(/id="([^"$]+)"/g)) genIds.add(m[1]);   // 不带 ${} 的才当静态名

/* ---------- JS 里的引用 ---------- */
const lit = new Set();        // 纯字面量 $('x')
const dyn = new Set();        // 拼接 $('prefix' + k)
const qsel = new Set();       // querySelector 选择器
for (const src of [APP, MAIN]) {
  for (const m of src.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) lit.add(m[1]);
  for (const m of src.matchAll(/\$\(\s*'([^']+)'\s*\)/g)) lit.add(m[1]);
  for (const m of src.matchAll(/\$\(\s*'([^']*)'\s*\+/g)) dyn.add(m[1]);
}
for (const m of APP.matchAll(/querySelector(?:All)?\(\s*'([^']+)'/g)) qsel.add(m[1]);

/* ---------- 拼接前缀展开（后缀是循环变量，这里按实际用到的值展开） ---------- */
const SUFFIX = {
  'cid-': ['b', 'w'],
  'ctime-': ['b', 'w'],
  'mark-': ['katago', 'analyzeWeight', 'playWeight', 'coachServer', 'coachWeight'],
  'set-': ['katago', 'analyzeWeight', 'playWeight', 'coachServer', 'coachWeight'],
  'pick-': ['katago', 'analyzeWeight', 'playWeight', 'coachServer', 'coachWeight'],
  'recent-': ['analyzeWeight', 'playWeight', 'coachWeight'],   // 设置面板里的权重历史下拉（datalist）
};
const expanded = [];
for (const p of dyn) {
  const sfx = SUFFIX[p];
  if (!sfx) { expanded.push({ p, ok: null }); continue; }       // 未知前缀，人工看
  for (const s of sfx) expanded.push({ p: p + s, ok: htmlSet.has(p + s) });
}

/* ---------- 比对 ---------- */
const missing = [...lit].filter(id => !htmlSet.has(id) && !genIds.has(id)).sort();

console.log('=== 规模 ===');
console.log('HTML id:', htmlIds.length, '| JS 静态引用:', lit.size, '| 拼接前缀:', dyn.size,
  '| 运行时动态生成:', genIds.size);
console.log('');
console.log('=== ① JS 引用但 HTML/动态生成里都没有（真会抛 TypeError）===');
console.log(missing.length ? missing.join('\n') : '（无 ✓）');
console.log('');
console.log('=== ② HTML 里重复的 id ===');
console.log(dup.length ? dup.join('\n') : '（无 ✓）');
console.log('');
console.log('=== ③ 拼接前缀逐项验证 ===');
const bad = expanded.filter(e => e.ok === false);
console.log(expanded.map(e => (e.ok === null ? `? ${e.p}…（未知前缀，人工看）`
  : `${e.ok ? '✓' : '★'} ${e.p}`)).join('\n'));
console.log(bad.length ? `\n★ 展开后有 ${bad.length} 个不存在！` : '\n（全部存在 ✓）');
console.log('');
console.log('=== ④ HTML 定义但 JS 从未引用（可能已废弃）===');
const unused = [...htmlSet].filter(id => !lit.has(id) && ![...dyn].some(p => id.startsWith(p)));
console.log(unused.length ? unused.join(', ') : '（无）');
console.log('');
console.log('=== ⑤ querySelector 选择器（人工核对）===');
console.log([...qsel].join('\n') || '（无）');
console.log('');
console.log('=== ⑥ 运行时动态生成的 id ===');
console.log([...genIds].sort().join(', ') || '（无）');

