/* CDP 测试脚本预检器
   ★ 为什么要「先求值再检查」：直接把原始文本丢给 new Function() 是不够的 ——
     模板字符串里的反斜杠转义会在**求值时**被吃掉。
     例：源码里写 /RE\[/ → 模板串求值后变成 /RE[/ → 正则语法错误，
         而 new Function(原始文本) 却完全正常 —— 这类错误只有真正求值才抓得到。
   ★ 失败时把「求值后的代码」落盘（_precheck_fail_*.js）并指出行号 ——
     否则只知道有错、不知道在哪（这里踩过：定位一次要绕三步）。

   检查范围：文件里**所有** `js(\`...\`)` 模板串。
   ⚠️ 别用 /await js\(`([\s\S]*?)`\);/ 这种写法 —— 遇到结尾不是 `\`);` 的调用
      （例如 `JSON.parse(await js(\`...\`))`）会一直匹配到后面某个 `\`);`，
      把多个模板串截成一段，报出莫名其妙的语法错（踩过）。 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const dir = 'D:/GoStudy/GoMate';
let bad = 0;

for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.mjs') && !x.startsWith('_precheck') && !x.startsWith('_dump'))) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  /* ⚠️ 先剥掉块注释再找模板串 —— 否则注释里写一句示例 js(`...`) 也会被当成真代码，
     报出莫名其妙的「Unexpected end of input」（本文件就踩过：注释里举例写了 js(`...`)，body 变成 "..."）。 */
  const srcNC = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const all = [...srcNC.matchAll(/js\(`([\s\S]*?)`\)/g)];
  if (!all.length) { console.log('  ' + f + '  没有模板串'); continue; }

  let failed = false;
  for (let i = 0; i < all.length; i++) {
    const body = all[i][1];
    const where = all.length > 1 ? ('模板串#' + (i + 1) + ' ') : '';

    /* ① 转义方括号：会被模板串吃掉，改用 indexOf/slice */
    if (/\\\[|\\\]/.test(body)) {
      bad++; failed = true;
      console.log('  ★ ' + f + '  ' + where + '有转义方括号 —— 会被吃掉，改用 indexOf/slice');
      continue;
    }

    let val;
    try {
      /* ⚠️ 先把 ${...} 插值换成 0 再求值 —— 模板串里用 node 侧的变量拼字符串是正常写法
         （例如 js('... runReview(\`' + NAME + '\`) ...') 写成模板插值时），
         但求值时那个变量在检查器里并不存在，会抛 ReferenceError 造成**误报**。
         它只影响语法检查，替换掉正好。 */
      const forEval = body.replace(/\$\{[^}]*\}/g, '0');
      val = new Function('return `' + forEval + '`;')();       // 第一段：按模板串求值（转义在这被处理）
    } catch (e) {
      bad++; failed = true;
      console.log('  ★ ' + f + '  ' + where + '模板串求值失败：' + e.message);
      continue;
    }
    try {
      /* 用 vm.Script 而不是 new Function —— 它的 SyntaxError.stack 里**带行号**
         （new Function 只给个光秃秃的消息，定位还得手动 node --check 一遍） */
      new vm.Script(val, { filename: 'precheck.js' });
    } catch (e) {
      bad++; failed = true;
      const out = path.join(dir, '_precheck_fail_' + f.replace(/\.mjs$/, '') + '_' + (i + 1) + '.js');
      fs.writeFileSync(out, val, 'utf8');
      console.log('  ★ ' + f + '  ' + where + e.message);
      const st = String(e.stack || '').split('\n');
      if (st.length > 1) console.log('     ' + st[1].trim());
      if (st.length > 2 && /^\s{4}/.test(st[2])) console.log('     ' + st[2].trim().slice(0, 110));
      console.log('     求值后的代码已写到 ' + path.basename(out));
    }
  }
  if (!failed) console.log('  ' + f + '  OK' + (all.length > 1 ? ('（' + all.length + ' 个模板串）') : ''));
}
process.exit(bad ? 1 : 0);
