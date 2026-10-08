/* 「实时推荐落点」开关的行为测试。
   由外部贡献（PR#6）带来的沙箱式写法 —— 从 app.js 里切出 setHintsVisible 单独跑，
   不启动 Electron。

   ★ 2026-10-08 按用户要求改过：
     原来断言「chk-show 与 pick-show-hints **两个**控件同步」，
     但用户明确要求**删掉讲解卡片里那个重复的开关** —— 只保留「显示」菜单里那一个
     （两处重复只会让人搞不清该信哪个）。
     所以现在只断言 **chk-show 一个**控件，并**明确检查另一个确实不存在**。 */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(__dirname + '/../renderer/app.js', 'utf8');
const match = source.match(/function setHintsVisible\(visible\) \{[\s\S]*?\n\}/);
assert.ok(match, 'setHintsVisible 这个统一入口存在');

/* ① 那个重复的开关**必须已经删掉**（用户要求） */
assert.ok(!/pick-show-hints/.test(source), 'app.js 里不该再有 pick-show-hints（重复开关已删）');
const html = fs.readFileSync(__dirname + '/../renderer/index.html', 'utf8');
assert.ok(!/pick-show-hints/.test(html), 'index.html 里不该再有 pick-show-hints');
assert.ok(!/pick-display-toggle/.test(html), 'index.html 里不该再有 pick-display-toggle 的样式类');
const css = fs.readFileSync(__dirname + '/../renderer/style.css', 'utf8');
assert.ok(!/pick-display-toggle/.test(css), 'style.css 里不该再有 pick-display-toggle 的规则');

/* ② 只剩一个控件，行为照旧 */
const controls = { 'chk-show': {} };
const saved = new Map();
let draws = 0;
const context = {
  state: { showHints: false },
  $: id => controls[id],
  localStorage: { setItem: (k, v) => saved.set(k, v) },
  draw: () => draws++,
};
vm.createContext(context);
vm.runInContext(match[0], context);

context.setHintsVisible(true);
assert.equal(context.state.showHints, true);
assert.equal(controls['chk-show'].checked, true);
assert.equal(saved.get('rapacego.showHints'), 'true');

context.setHintsVisible(false);
assert.equal(controls['chk-show'].checked, false);
assert.equal(saved.get('rapacego.showHints'), 'false');
assert.equal(draws, 2);

/* ③ localStorage 不可用时不能挡住交互 */
context.localStorage.setItem = () => { throw new Error('storage unavailable'); };
context.setHintsVisible(true);
assert.equal(context.state.showHints, true, '存储失败也必须能用');

console.log('推荐落点开关：单一控件 / 同步 / 记忆 / 存储失败兜底 —— 全部通过');
