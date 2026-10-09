/* 验证「引擎兼容性自检」现在同时查两套引擎（2026-10-08 加 LoGos 检查）。
   要确认：
     ① 返回里同时有 backend（KataGo）和 llama（LoGos）
     ② 两者都识别出设备（本机 N 卡，应分别报 CUDA / CUDA0）
     ③ 界面上真的把两行都显示出来
*/
(function () {
  var L = [];
  function P(s) { L.push(s); }
  function ok(n, g, w) { L.push((String(g) === String(w) ? '  [V] ' : '  [X] ') + n + '  得=' + g + ' 望=' + w); }

  return (async function () {
    P('===== ① 自检返回的完整结构 =====');
    var r = await window.api.engineCheck();
    P('  backend: ' + JSON.stringify(r && r.backend));
    P('  llama  : ' + JSON.stringify(r && r.llama));
    P('  gpu    : ' + JSON.stringify(r && r.gpu));
    P('  warn   : "' + (r && r.warn) + '"');

    ok('KataGo 那项在', !!(r && r.backend && r.backend.ok), true);
    ok('★ LoGos 那项也在（这就是这次新增的）', !!(r && r.llama), true);
    ok('LoGos 认出了设备', !!(r && r.llama && r.llama.ok), true);
    if (r && r.llama && r.llama.ok) {
      P('  LoGos 设备: ' + r.llama.device + ' · ' + r.llama.detail);
      ok('LoGos 报出了显存', (r.llama.vramMB > 0), true);
    }

    P('');
    P('===== ② 界面上显示成什么 =====');
    var el = document.getElementById('eng-check');
    var btn = document.getElementById('btn-eng-check');
    if (btn) {

      /* 真点一次按钮，走完整链路 */
      btn.click();
    }
    var t0 = Date.now();
    while (Date.now() - t0 < 40000) {
      var txt = el ? el.textContent : '';
      if (txt && txt.indexOf('显卡') >= 0 && txt.indexOf('——') >= 0) break;
      await new Promise(function (x) { setTimeout(x, 500); });
    }
    P('  界面文字: ' + (el ? el.textContent : '(没有这个元素)'));
    ok('界面上有「下棋/分析」那项', (el.textContent.indexOf('下棋/分析') >= 0), true);
    ok('界面上有「AI 讲解」那项', (el.textContent.indexOf('AI 讲解') >= 0), true);
    ok('结论是"都能配上"', (el.textContent.indexOf('都能配上') >= 0), true);
    return L.join(String.fromCharCode(10));
  })();
})();
