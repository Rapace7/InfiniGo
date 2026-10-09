/* 验证 README 的两条断言：
   ①「软件**默认一个引擎都不加载** —— 你不用 AI 就不占显存」
   ②「**没有独显也能用**：KataGo 支持纯 CPU 模式（**设置面板里能改**）」

   ① 的做法：看启动后主进程有没有起 katago.exe / llama-server.exe 子进程。
      （真跑一次，用系统进程表查 —— 这是硬证据，不是看代码猜。）
   ② 的做法：看设置面板里到底有没有能切到纯 CPU 的控件。
*/
(function () {
  var L = [];
  function P(s) { L.push(s); }

  return (async function () {
    P('===== 断言① 默认是否加载引擎 =====');
    var st = null;
    try { st = await window.api.engine.status(); } catch (e) { P('  engine.status 不可用: ' + e.message); }
    P('  engine.status = ' + JSON.stringify(st));

    /* 界面上三个引擎指示灯的状态 */
    var lights = [];
    ['灯', 'engine-lamp', 'lamp-analyze', 'lamp-play', 'lamp-coach'].forEach(function (id) {
      var e = document.getElementById(id);
      if (e) lights.push(id + '=' + (e.className || '') + '/' + (e.textContent || '').slice(0, 20));
    });
    P('  指示灯: ' + (lights.join('  |  ') || '(没找到)'));
    P('  → 若都显示未加载/未运行，则与 README 说法一致');

    P('');
    P('===== 断言② 设置面板里有没有"纯 CPU"选项 =====');
    /* 把设置面板里跟引擎后端相关的控件都列出来 */
    var panel = document.getElementById('settings-panel') || document.getElementById('settings') || document.body;
    var found = [];
    var all = panel.querySelectorAll('select, input[type=checkbox], input[type=radio], button');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var t = ((el.getAttribute('title') || '') + ' ' + (el.textContent || '') + ' ' + (el.value || '') + ' ' + (el.id || '')).toLowerCase();
      if (/cpu|eigen|后端|backend|显卡/.test(t)) {
        found.push((el.tagName + '#' + (el.id || '?') + ' ' + el.type) + ' :: ' + t.replace(/\s+/g, ' ').slice(0, 90));
      }
    }
    P('  跟"后端/CPU"沾边的控件 ' + found.length + ' 个:');
    found.forEach(function (f) { P('    · ' + f); });
    L.push(found.length ? '  → 有相关控件（需人工判断能不能切纯 CPU）' : '  ★ 一个都没有 → README 那句「设置面板里能改」可能是错的');
    return L.join(String.fromCharCode(10));
  })();
})();
