/* 验证「每手自带 capAt」这个设计在**我们的软件**特有的操作下是否站得住：
   ⚠️ KaTrain 没有 undo（它靠引擎重放），所以它的 `last_capture` 可以是个可变全局量。
      我们**悔棋是常态**，还有"打开别人棋谱接着摆" —— 这两条它没有。
   本用例专门测这两条：
     ① 悔棋后：capAt 跟着手顺走 → 禁着点该在还在、该消就消
     ② 打开棋谱（手顺里没有 capAt）→ rebuildCapAt 补上后，接着摆的那一手要受劫约束
   注入页面执行（INJECT 指向本文件）。不写模板串、不写反斜杠转义。 */
(function () {
  var L = [];
  function P(s) { L.push(s); }
  function ok(n, g, w) { L.push((String(g) === String(w) ? '  [V] ' : '  [X] ') + n + '  得=' + g + ' 望=' + w); }
  function dump(b) {
    var out = [];
    for (var y = 0; y < N; y++) { var s = ''; for (var x = 0; x < N; x++) s += (b[y * N + x] === 1 ? 'X' : b[y * N + x] === 2 ? 'O' : '.'); out.push(s); }
    return out.join('/');
  }
  settings.size = 5; N = 5; settings.rules = 'chinese'; settings.komi = 0;
  settings.handicap = 0; settings.mode = 'free';
  state.noGame = false; state.fromRecord = false; state.draft = null;

  function reset(setup, turn) {
    state.setup = (setup || []).map(function (s) { return { x: s[0], y: s[1], color: s[2] }; });
    state.moves = []; state.viewAt = 0; state.koPoint = null;
    state.candidates = []; state.candAt = -1; state.history = [];
    state.toMove = turn || 'b';
  }
  var S2 = [[1,2,'b'],[2,1,'b'],[2,3,'b'],[2,2,'w'],[4,2,'w'],[3,1,'w'],[3,3,'w']];

  /* ① 悔棋后禁着点要跟着手顺走 */
  P('===== ① 悔棋（我们的常态操作，KaTrain 没有）=====');
  reset(S2, 'b');
  tryPlay(3, 2);                                  // 黑提劫
  P('  提劫后 koPoint=' + JSON.stringify(state.koPoint) + '  手数=' + state.moves.length);
  ok('1a 提劫后有禁着点', JSON.stringify(state.koPoint), JSON.stringify({ x: 2, y: 2 }));
  /* 模拟悔棋：退一手 + 用 koFromBoard 重算（悔棋处理里就是这么做的） */
  state.moves.pop();
  state.viewAt = state.moves.length;
  state.toMove = 'b';
  state.koPoint = koFromBoard(boardAt(state.moves.length), state.moves);
  ok('1b 退掉提劫那一手 → 禁着点消失', JSON.stringify(state.koPoint), 'null');
  /* 再重下那手，禁着点该回来 */
  tryPlay(3, 2);
  state.koPoint = koFromBoard(boardAt(state.moves.length), state.moves);
  ok('1c 重下提劫手 → 禁着点回来', JSON.stringify(state.koPoint), JSON.stringify({ x: 2, y: 2 }));
  /* 对方在他处走一手后再悔棋 → 劫还成立（用户报过的反向 bug） */
  state.toMove = 'w';
  tryPlay(0, 4);                                  // 白在他处走
  var nBefore = state.moves.length;
  state.moves.pop();                              // 悔掉白那一手
  state.viewAt = state.moves.length;
  state.koPoint = koFromBoard(boardAt(state.moves.length), state.moves);
  ok('1d 悔掉"他处那一手"后劫仍成立', JSON.stringify(state.koPoint), JSON.stringify({ x: 2, y: 2 }));

  /* ② 打开棋谱（手顺里没有 capAt）→ rebuildCapAt 补上，接着摆要受约束 */
  P('');
  P('===== ② 打开棋谱接着摆（KaTrain 这条是 ignore_ko，我们不能）=====');
  reset(S2, 'b');
  tryPlay(3, 2);                                  // 造出一段"棋谱手顺"
  var rec = state.moves.map(function (m) { return { x: m.x, y: m.y, color: m.color, pass: false, captured: m.captured }; });
  /* 模拟"从棋谱读进来"：手顺里没有 capAt（真棋谱不会有这个字段） */
  state.moves = rec.slice();
  state.viewAt = state.moves.length;
  state.koPoint = null;
  ok('2a 棋谱手顺里确实没有 capAt', state.moves[0].capAt === undefined, true);
  P('  补之前 koFromBoard = ' + JSON.stringify(koFromBoard(boardAt(state.moves.length), state.moves)));
  rebuildCapAt();                                 // 打开棋谱时会调它
  P('  补之后 moves[0].capAt = ' + JSON.stringify(state.moves[0].capAt));
  ok('2b rebuildCapAt 补出了被提点 (2,2)', JSON.stringify(state.moves[0].capAt), JSON.stringify({ x: 2, y: 2 }));
  state.koPoint = koFromBoard(boardAt(state.moves.length), state.moves);
  ok('2c 补完后禁着点成立', JSON.stringify(state.koPoint), JSON.stringify({ x: 2, y: 2 }));
  state.toMove = 'w';
  ok('2d 接着摆时白回提被拒（棋谱来的局面也要判劫）', tryPlay(2, 2), false);

  return L.join(String.fromCharCode(10));
})();
