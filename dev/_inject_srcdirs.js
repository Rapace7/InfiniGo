/* 验证 README 那条断言：**源码模式**下引擎放在"项目的上一级"。
   做法：从仓库跑开发态（不是打包版），看它解析出的引擎路径是不是
         D:\GoStudy\KataGo\...（= 仓库 D:\GoStudy\RapaceGo 的上一级）。
   这条很重要：README 两种模式说法不同，写错了会让人配错方向。
*/
(function () {
  var L = [];
  function P(s) { L.push(s); }
  return (async function () {
    var s = await window.api.settings.get();
    var c = s.config || {};
    P('===== 源码模式解析出的引擎路径 =====');
    P('  katago : ' + c.katago);
    P('  coach  : ' + c.coachServer);
    var ok1 = /^D:\\GoStudy\\KataGo\\/i.test(String(c.katago));
    var ok2 = /^D:\\GoStudy\\LoGos\\/i.test(String(c.coachServer));
    L.push((ok1 ? '  [V] ' : '  [X] ') + 'KataGo 在"仓库的上一级"(D:\\GoStudy\\KataGo)  得=' + ok1);
    L.push((ok2 ? '  [V] ' : '  [X] ') + 'LoGos  在"仓库的上一级"(D:\\GoStudy\\LoGos)   得=' + ok2);
    P('');
    P('  → README 第 401 行说"源码模式下引擎要放在项目的上一级"：' + ((ok1 && ok2) ? '✓ 与实测一致' : '★ 与实测不符'));
    return L.join(String.fromCharCode(10));
  })();
})();
