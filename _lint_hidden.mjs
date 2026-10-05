/* 静态检查：`[hidden]` 会不会被 CSS 的 display 压过。
   原理：浏览器默认样式的 `[hidden]{display:none}` 优先级**低于**任何类/ID 选择器里的 display，
   所以「既要能隐藏、自身又是 flex/grid 容器」的元素必须显式写 `xxx[hidden]{display:none}`。
   本项目已因此踩坑 3 次（.verdict / .board-gate / .mrow），这里全量扫一遍。
   用法：node _lint_hidden.mjs */
import fs from 'fs';

const HTML = fs.readFileSync('renderer/index.html', 'utf8');
const CSS = fs.readFileSync('renderer/style.css', 'utf8');
/* ★ 必须先剥掉注释再扫：注释里常把「不要这样写」的反例代码原样写上
   （比如 `$('clock-card').hidden = ...`），不剥就会当成真代码误报。
   第一版没剥 → clock-card 那条修完之后仍在报。 */
const APP = fs.readFileSync('renderer/app.js', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/* 1. HTML 里带 hidden 属性的元素 → 记下它的 id / class */
const htmlHidden = [];
for (const m of HTML.matchAll(/<(\w+)((?:[^>"']|"[^"]*"|'[^']*')*?)>/g)) {
  const attrs = m[2];
  if (!/(^|\s)hidden(\s|=|$)/.test(attrs)) continue;
  htmlHidden.push({
    tag: m[1],
    id: (attrs.match(/\bid="([^"]+)"/) || [])[1] || null,
    cls: ((attrs.match(/\bclass="([^"]+)"/) || [])[1] || '').split(/\s+/).filter(Boolean),
  });
}

/* 2. JS 里会被 .hidden = ... 切换的 id */
const jsHidden = [...new Set([...APP.matchAll(/\$\('([^']+)'\)\.hidden\s*=/g)].map(m => m[1]))];

/* 3. CSS 规则：选择器 + display 值 */
const rules = [];
for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const d = /display\s*:\s*([^;]+)/.exec(m[2]);
  if (d) rules.push({ sel, val: d[1].trim() });
}
/* 有 [hidden] 覆盖规则的选择器们 */
const hiddenRules = rules.filter(r => r.sel.includes('[hidden]'));

/* 4. 能不能命中 */
const hit = (sel, id, cls) => {
  // 把选择器拆成逗号分句，逐个看它是否只靠 #id / .class 命中
  return sel.split(',').some(one => {
    one = one.trim();
    if (!one) return false;
    const parts = one.match(/[#.][\w-]+/g) || [];
    if (!parts.length) return false;               // 纯标签选择器（如 li）不算（优先级本来就低）
    return parts.every(p => p[0] === '#' ? p.slice(1) === id : cls.includes(p.slice(1)));
  });
};

console.log('HTML 里带 hidden 的元素:', htmlHidden.length, '| JS 里切换 hidden 的 id:', jsHidden.length);
console.log('CSS 里带 display 的规则:', rules.length, '| 其中 [hidden] 覆盖规则:', hiddenRules.length);
console.log('');

const problems = [];
const checked = [];
const check = (label, id, cls) => {
  const disp = rules.filter(r => !r.sel.includes('[hidden]') && hit(r.sel, id, cls) && r.val !== 'none');
  if (!disp.length) return;                        // 没有任何 display 规则命中 → [hidden] 天然有效
  const cov = hiddenRules.some(r => hit(r.sel, id, cls));
  checked.push(`${cov ? '✓' : '★'} ${label} — 命中 display 规则: ${disp.map(d => `${d.sel} {display:${d.val}}`).join(' 、 ')}${cov ? '（有 [hidden] 覆盖）' : '（★ 缺 [hidden] 覆盖！）'}`);
  if (!cov) problems.push(label + ' ← ' + disp.map(d => d.sel).join(' / '));
};
for (const el of htmlHidden) check(`${el.tag}#${el.id || '?'}${el.cls.length ? '.' + el.cls.join('.') : ''}（HTML hidden）`, el.id, el.cls);
for (const id of jsHidden) {
  if (htmlHidden.some(e => e.id === id)) continue;  // 上面已查过
  // 从 HTML 里找这个 id 元素的 class
  const m = new RegExp('<[^>]*\\bid="' + id + '"[^>]*>').exec(HTML);
  const cls = ((m && m[0].match(/\bclass="([^"]+)"/)) || [])[1];
  check(`#${id}（JS 用 .hidden 切换）`, id, cls ? cls.split(/\s+/) : []);
}

console.log('=== 逐个核对（有 display 规则的才列出来）===');
console.log(checked.length ? checked.join('\n') : '（没有被 display 规则命中的隐藏元素）');
console.log('');
console.log('=== ★ 隐患：会被 display 压过、却没有 [hidden] 覆盖的 ===');
console.log(problems.length ? problems.join('\n') : '（无 ✓）');
console.log('');
console.log('=== 所有 [hidden] 覆盖规则 ===');
console.log(hiddenRules.map(r => r.sel).join('\n') || '（无）');
