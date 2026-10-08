/* 验证「分析讲解」讲的是**实际下的那一手**，不是 AI 推荐的那一手。
   起因：用户报自己第 83 手（实际 S12）亏了 0.1%，但讲解整段在讲 AI 想下的 D8 ——
        代码里 coachPrompt(..., best.move) 传错了点（「分析讲解」与「全盘讲解」两处）。

   怎么测：打谱模式下模块内的 engineReady 是 false（注入脚本改不动模块作用域的 let），
   所以不走整条 UI 链，而是**直接测被修的那两段**：
     ① coachPrompt(...) 生成的条件句 —— 必须问实际那一点、并含"先讲后果"的要求
     ② coachTextReady(...) 补的开头 —— 必须是「这一手 X…下出来」，不是「如果下在 X，」
   这两段正是本次改动之处，测它们就能覆盖回退风险。 */
(function () {
  var L = [];
  function P(s) { L.push(s); }
  function ok(n, g, w) { L.push((String(g) === String(w) ? '  [V] ' : '  [X] ') + n + '  得=' + g + ' 望=' + w); }

  return (async function () {
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    /* 打开您那份 83 手棋谱 */
    var name = null;
    try {
      var lib = await window.api.records.list();
      var all = Array.isArray(lib) ? lib : [];
      for (var i = 0; i < all.length; i++) {
        var nm = (typeof all[i] === 'string') ? all[i] : (all[i].name || '');
        if (String(nm).indexOf('83手') >= 0) { name = nm; break; }
      }
    } catch (e) { P('列棋谱失败: ' + e.message); }
    if (!name) { P('没找到棋谱'); return L.join(String.fromCharCode(10)); }
    await openRecord(name);
    await sleep(1200);

    var at = state.moves.length;
    var m = state.moves[at - 1];
    var pt = m.pass ? '停一手' : toGTP(m.x, m.y);
    P('棋谱共 ' + at + ' 手，第 ' + at + ' 手实际下的是：' + (m.color === 'b' ? '黑' : '白') + ' ' + pt);
    ok('实际那一手确实是 S12（和用户报的情况一致）', pt, 'S12');

    P('');
    P('===== ① coachPrompt：问的是哪一点 =====');
    var bestMove = 'D8';                       // 故意用 AI 的首选（≠ 实际那一手）
    var before = state.moves.slice(0, at - 1);
    var board = boardAt(at - 1);
    var onset = '，不过 AI 当时更倾向 ' + bestMove + '（黑棋当时胜率 99.9%）';
    var good = coachPrompt(before, board, m.color, pt, onset);

    ok('条件句问的是实际那手（下在' + pt + '）', good.indexOf('下在' + pt + '，') >= 0, true);
    ok('条件句**没有**问 AI 的首选（下在D8）', good.indexOf('下在' + bestMove + '，') >= 0, false);
    ok('带了"先直接说这一手之后会发生什么"的要求', good.indexOf('先直接说这一手之后会发生什么') >= 0, true);
    ok('明确禁止它重复讲"应该下在别处"', good.indexOf('不要说「应该下在别处」') >= 0, true);
    ok('把 AI 的倾向作为背景交代了（不藏）', good.indexOf(bestMove) >= 0, true);

    P('');
    P('===== ② 对照：推荐落点讲解（不该受影响）=====');
    var pick = coachPrompt(before, board, m.color, bestMove);
    ok('推荐落点讲解仍问那个推荐点', pick.indexOf('下在' + bestMove + '，') >= 0, true);
    ok('推荐落点讲解**没被塞进**"先讲后果"那段（保持原行为）',
      pick.indexOf('先直接说这一手之后会发生什么') >= 0, false);

    P('');
    P('===== ③ coachTextReady：补的开头 =====');
    var raw = '这一步先把上边的白棋压住，同时自己连回左下的大块。';
    var head = '这一手 ' + pt + '（黑棋第 ' + at + ' 手）下出来，';
    var out = coachTextReady(raw, pt, m.color, head);
    P('  最终文字: ' + out);
    ok('开头是「这一手 S12（黑棋第 83 手）下出来，」', out.indexOf(head) === 0, true);
    ok('不再是「如果…下在…」', out.indexOf('如果') === 0, false);

    var outPick = coachTextReady(raw, bestMove, 'b');
    P('  推荐落点讲解的开头: ' + outPick);
    ok('推荐落点讲解的开头保持「如果黑棋下在D8，」', outPick.indexOf('如果黑棋下在D8，') === 0, true);

    return L.join(String.fromCharCode(10));
  })();
})();
