/* 量引擎真实显存占用：加载后**等 50 秒**（期间外面用 nvidia-smi 采样），然后分析两手。
   为什么用等待而不是快照：显存分配是渐进的（CUDA 上下文 + 权重上卡），
   加载完立刻量会偏低。等 50 秒能拿到稳定值。
*/
(function () {
  var L = [];
  function P(s) { L.push(s); }
  return (async function () {
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    P('===== 加载分析引擎，然后保持 50 秒不动（外面采样显存）=====');
    var t0 = Date.now();
    try { await window.api.engine.load('analyze'); } catch (e) { P('  load 抛错: ' + e.message); }
    P('  load 返回用了 ' + Math.round((Date.now() - t0) / 1000) + ' 秒');
    for (var i = 0; i < 5; i++) { await sleep(10000); P('  ...已保持 ' + ((i + 1) * 10) + ' 秒'); }

    P('');
    P('===== 顺手确认它能真算 =====');
    try {
      var r = await window.api.analyze({ moves: [['B', 'E5']], rules: 'chinese', komi: 7.5, size: 9, maxVisits: 50 });
      var mv = ((r && r.moves) || [])[0];
      P('  首选点 ' + (mv && mv.move) + '  胜率 ' + (mv ? (mv.winrate * 100).toFixed(1) : '?') + '%');
    } catch (e) { P('  分析失败: ' + e.message); }

    P('');
    P('===== 保持 20 秒（第二段采样）=====');
    await sleep(20000);
    P('  结束');
    return L.join(String.fromCharCode(10));
  })();
})();
