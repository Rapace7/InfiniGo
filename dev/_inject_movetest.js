/* 验证「把整个文件夹搬个位置，软件能不能自适应」。
   场景：settings.json 里存着旧位置的**绝对路径**（免解压版就是这样），
        把整个目录复制到别处之后启动 —— 那些绝对路径全部失效。
   期望：readConfig 的 usable() 回退到 defaultPaths()，引擎正常起来。

   ★ 为什么必须实测：这是"搬运用户数据"的核心保证，
     读代码只能看到"逻辑上会回退"，看不到"回退后的路径真的对"。
*/
(function () {
  var L = [];
  function P(s) { L.push(s); }
  function ok(n, g, w) { L.push((String(g) === String(w) ? '  [V] ' : '  [X] ') + n + '  得=' + g + ' 望=' + w); }

  return (async function () {
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    P('===== ① 解析出的引擎路径（应指向**新位置**）=====');
    var s = await window.api.settings.get();
    var c = s.config || {};
    P('  katago       : ' + c.katago);
    P('  analyzeWeight: ' + c.analyzeWeight);
    P('  coachServer  : ' + c.coachServer);
    P('  coachWeight  : ' + c.coachWeight);
    ok('引擎路径已跟随到新位置（不再是旧盘的路径）',
      !/D:\\GoStudy\\KataGo/i.test(String(c.katago)), true);
    ok('权重也跟过来了', !!(s.files && s.files.analyzeWeight && s.files.playWeight), true);
    ok('LoGos 两个文件也在', !!(s.files && s.files.coachServer && s.files.coachWeight), true);

    P('');
    P('===== ② 数据目录是否也在新位置（不该写回 C 盘或旧路径）=====');
    var info = null;
    try { info = await window.api.app.info(); } catch (e) { P('  app.info 失败: ' + e.message); }
    if (info) P('  ' + JSON.stringify(info));

    P('');
    P('===== ③ 引擎真能起来吗（最关键的）=====');
    var t0 = Date.now();
    try { await window.api.engine.load('analyze'); } catch (e) { P('  load 抛错: ' + e.message); }
    while (!engineReady && Date.now() - t0 < 90000) await sleep(1000);
    ok('分析引擎起来了', engineReady, true);

    P('');
    P('===== ④ 端到端：真分析一手 =====');
    try {
      var r = await window.api.analyze({ moves: [['B', 'E5']], rules: 'chinese', komi: 7.5, size: 9, maxVisits: 50 });
      var mv = ((r && r.moves) || [])[0];
      P('  首选点 ' + (mv && mv.move) + '  胜率 ' + (mv ? (mv.winrate * 100).toFixed(1) : '?') + '%');
      ok('拿到了候选点', !!(mv && mv.move), true);
    } catch (e) { P('  分析失败: ' + e.message); ok('拿到了候选点', false, true); }
    return L.join(String.fromCharCode(10));
  })();
})();
