/* 实测「引擎兼容性自检」到底能查什么 —— 懒人包只装了 N 卡构建，
   对 A 卡/Intel 用户应该报「跑不起来」。这里把自检的真实输出打出来。 */
(function () {
  var L = [];
  function P(s) { L.push(s); }
  return (async function () {
    P('===== ① 自检原始返回 =====');
    var r = null;
    try { r = await window.api.engineCheck(); } catch (e) { P('  抛错: ' + e.message); }
    P('  ' + JSON.stringify(r, null, 2).split('\n').join('\n  '));

    P('');
    P('===== ② 后台探测到的显卡 =====');
    try {
      var g = await window.api.gpuInfo();
      P('  ' + JSON.stringify(g));
    } catch (e) { P('  gpuInfo 不可用: ' + e.message); }

    P('');
    P('===== ③ 对弈/LoGos 那边有没有类似的兼容性检查 =====');
    P('  （看 window.api.engine 暴露了哪些方法）');
    try { P('  ' + Object.keys(window.api.engine || {}).join(', ')); } catch (e) { P('  ' + e.message); }

    P('');
    P('===== ④ 界面上的三个检查入口是否都在 =====');
    ['eng-check', 'btn-eng-check', 'app-version', 'btn-check-update'].forEach(function (id) {
      P('  ' + id + ': ' + (document.getElementById(id) ? '在' : '★ 不在'));
    });
    return L.join(String.fromCharCode(10));
  })();
})();
