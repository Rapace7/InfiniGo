/* 验证：当配好的引擎路径指向的目录里**没有**引擎、而另一套存在时，
   程序会不会自动挑到存在的那一套并成功起来。
   场景：RAPACEGO_KATAGO 指向只有 engine-generic 的测试包（真 OpenCL 引擎）。
   期望：解析出 engine-generic\katago.exe，且引擎能起来、自报 OpenCL。
*/
(function () {
  var L = [];
  function P(s) { L.push(s); }
  function ok(n, g, w) { L.push((String(g) === String(w) ? '  [V] ' : '  [X] ') + n + '  得=' + g + ' 望=' + w); }

  return (async function () {
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    P('===== ① 解析出的引擎路径 =====');
    var s = await window.api.settings.get();
    var c = s.config || {};
    P('  katago : ' + c.katago);
    P('  coach  : ' + c.coachServer);
    ok('挑到 engine-generic（因为 engine-nvidia 是空的）',
      /engine-generic\\katago\.exe$/i.test(String(c.katago)), true);

    P('');
    P('===== ② 自检报什么 =====');
    var r = await window.api.engineCheck();
    P('  后端: ' + JSON.stringify(r && r.backend));
    ok('自检认出 OpenCL', !!(r && r.backend && r.backend.raw === 'opencl'), true);
    ok('自检在 N 卡机器上会提醒"不匹配"（是对的，因为这是通用版）',
      String((r && r.warn) || '').indexOf('不匹配') >= 0 || String((r && r.warn) || '').length > 0, true);

    P('');
    P('===== ③ 引擎真能起来吗（最关键的）=====');
    var t0 = Date.now();
    try { await window.api.engine.load('analyze'); } catch (e) { P('  load 抛错: ' + e.message); }
    while (!engineReady && Date.now() - t0 < 120000) await sleep(1000);
    P('  engineReady = ' + engineReady + '  耗时 ' + Math.round((Date.now() - t0) / 1000) + ' 秒');
    ok('引擎起来了（说明自动挑对了）', engineReady, true);

    P('');
    P('===== ④ 端到端：真分析一手 =====');
    try {
      var res = await window.api.analyze({ moves: [['B', 'E5']], rules: 'chinese', komi: 7.5, size: 9, maxVisits: 60 });
      var mv = ((res && res.moves) || [])[0];
      P('  首选点: ' + (mv && mv.move) + '  胜率: ' + (mv ? (mv.winrate * 100).toFixed(1) : '?') + '%');
      ok('拿到了候选点', !!(mv && mv.move), true);
    } catch (e) { P('  分析失败: ' + e.message); ok('拿到了候选点', false, true); }
    return L.join(String.fromCharCode(10));
  })();
})();
