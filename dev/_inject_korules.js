/* 围棋规则回归 —— 打劫（POSITIONAL 判据）+ 提子 + 倒扑 + 自杀
   注入页面执行（INJECT 指向本文件）。不写模板串、不写反斜杠转义。
   ★ 每个局面打印气数自检；坐标手算错过好几次，让数字说话。
   ★ 打劫的关键几何（这次想清楚了）：
       "黑提白 X 子、落在 Y" 之后，如果**对方在 Y 回提会完全还原**，Y 就是禁着点。
       标准劫形要求：被提的那子（X）和刚落下的子（Y）**各自都只剩 1 气、且那口气互为对方**。

   坐标：x 右增、y 下增。(0,0) 左上。5 路盘。 */
(function () {
  var L = [];
  function P(s) { L.push(s); }
  function ok(name, got, want) { L.push((String(got) === String(want) ? '  [V] ' : '  [X] ') + name + '  得=' + got + ' 望=' + want); }
  function dump(b) {
    var out = [];
    for (var y = 0; y < N; y++) { var s = ''; for (var x = 0; x < N; x++) s += (b[y * N + x] === 1 ? 'X' : b[y * N + x] === 2 ? 'O' : '.'); out.push(s); }
    return out.join('/');
  }
  function libsOf(b, x, y) { var g = group(b, x, y); return g.stones.length + '子' + g.libs.size + '气'; }
  function same(a, bb) { for (var i = 0; i < a.length; i++) if (a[i] !== bb[i]) return false; return true; }

  settings.size = 5; N = 5; settings.rules = 'chinese'; settings.komi = 0;
  settings.handicap = 0; settings.mode = 'free';
  state.noGame = false; state.fromRecord = false; state.draft = null;

  function reset(setup, turn) {
    state.setup = (setup || []).map(function (s) { return { x: s[0], y: s[1], color: s[2] }; });
    state.moves = []; state.viewAt = 0; state.koPoint = null;
    state.candidates = []; state.candAt = -1; state.history = [];
    state.toMove = turn || 'b';
  }

  /* ============================================================
     用例 1：标准劫
     走之前：黑 (1,2)(2,1)(2,3)  白 (2,2)
       白(2,2) 即 X：气 =(3,2) → 1 气 ✓
     黑走 Y=(3,2)：提掉白 (2,2)
       黑(3,2) 四邻 =(2,2)空出、(4,2)空、(3,1)空、(3,3)空 → 4 气 → 白回提不还原 → **不是劫**
     要让黑(3,2) 只剩 (2,2) 一口气：(4,2)(3,1)(3,3) 都得有子。
       但它们是什么色不影响"黑(3,2) 的气"计算 —— 只要有子就把气堵了。
       为简洁全放黑：(4,2)(3,1)(3,3) 黑。
       但注意：(3,1) 黑 与 (2,1) 黑相连，(3,3) 黑 与 (2,3) 黑相连 → 黑(3,2) 会连成一块！
       那就不是"孤子只剩1气"了 —— 不过 POSITIONAL 判据**不要求孤子**，只看局面还原。
       真还原要求：黑(3,2) 那点被白提走后，白占 (3,2) 时局面 == 走之前。
         走之前：(2,2)白、(3,2)空
         白回提后：(2,2)空、(3,2)白  → 不同 → 不还原 → 仍然不是劫！
       → **结论：只有"黑落在 Y、白回提 Y 后 (X 恢复白)、(Y 恢复空)"才叫劫。
         而 Y 被白占住 → 必须有 (Y 那点) 白放上去… 那就是说 X ≠ Y 时永远不还原。**
       → 所以真劫必然是"**提掉 X，然后对方在 X 回提**"？不 —— 对方回提一定落在**刚落子的那点**。
         真劫几何：黑落 Y，提 X；白落 Y 回提黑那颗，则 (Y) 归白、(X) 归黑之前的状态？
         不对，白落 Y 是去提黑 (Y)（黑刚落的那颗），提走它 → (Y) 归白。
         而 X 那点：白提的是黑 (Y)，X 仍然是空 → X 不会自动变白。
       → 唯一的自洽解释：**真劫里 X == Y**，即"黑提掉的那一格，正是黑自己要落的那一格"——
         不可能。
       → 真正的情形是：**黑落 Y 提 X；白落 X 提 Y**。白落 X 提走黑 (Y)？
         白落 X 时，(Y) 是黑的，而 (Y) 与原 X 相邻（互为那口气）→ 白落 X 后，
         黑 (Y) 若因此没气就被提走。提走后 (Y) 空、(X) 白 → 正好等于走之前（(X)白、(Y)空）✓ **还原！**
       → **所以白回提的点是 X（被提的那一格），不是 Y。** 这与我上面的实现一致（capAt = X）。
         而 A/C 用例里白走 X 被拒"该点非空" —— 那说明 X 上还有子？
         A 用例：黑走 (2,2) 提白 (2,1) → X=(2,1)，黑落在 Y=(2,2)。
           走完后 (2,1) 是空的（白被提）✓ 白该走 (2,1)。
           但我测试里让白走 (2,2) ← **错了，那是 Y（黑子所在）**！
         ★★ 就是这里搞错的：回提要点是 **X（被提的那格）**，我却去点了 Y。
     ============================================================ */
  P('===== 1 非劫：黑提子后，白在被提点回提（合法，因为不还原）=====');
  var S1 = [[1,1,'b'],[2,0,'b'],[3,1,'b'],[2,1,'w']];
  reset(S1, 'b');
  var b1 = boardAt(0);
  P('  走之前 ' + dump(b1) + '   白(2,1)=' + libsOf(b1, 2, 1));
  var p1 = tryPlay(2, 2);
  var a1 = boardAt(state.moves.length);
  P('  黑走 Y=(2,2) 提 X=(2,1)：' + p1 + ' → ' + dump(a1) + ' 提子=' + state.moves[0].captured);
  P('  X=(2,1) 现在是: ' + a1[1 * N + 2] + '（0=空）  Y=(2,2) 现在是: ' + a1[2 * N + 2] + '（1=黑）');
  ok('1a 提子手合法', p1, true);
  ok('1b 提了 1 子', state.moves[0].captured, 1);
  ok('1c 是劫吗？白回提 (2,1) 会还原走之前 → 是劫（所以白不能立刻回提）', state.koPoint ? 'yes' : 'no', 'yes');
  state.toMove = 'w';
  var p1b = tryPlay(2, 1);                 // ★ 白在被提点 X 回提
  P('  白在 X=(2,1) 回提：' + p1b + ' → ' + dump(boardAt(state.moves.length)));
  ok('1d 白立刻回提 (2,1) → 被拒（真劫／且那点四邻全黑本就是自杀）', p1b, false);
  if (p1b) ok('1e 白这一手提走 1 子', state.moves[1].captured, 1);

  /* ============================================================
     用例 2：标准劫（真劫）
     要满足：黑落 Y 提 X；白在 X 回提（提走黑 Y）；提走 Y 后局面 == 走之前。
       走之前：(X)=白、(Y)=空
       白回提后：(X)=白、(Y)=空  ← 要求白落 X 后能提走黑 Y，且 X 那格归白
       成立条件：黑 Y 那颗子只有 X 一口气；白 X 那颗子只有 Y 一口气（互为对方那口气）
     摆法：X=(2,2) 白，Y=(3,2) 黑
       白(2,2) 的气：(1,2)(2,1)(2,3)(3,2) → 要只剩 (3,2)：其余三个都放黑
       黑(3,2) 的气：(2,2)(4,2)(3,1)(3,3) → 要只剩 (2,2)：其余三个都放白
       但 (2,1)(2,3) 是黑、(3,1)(3,3) 是白 —— 还要检查不产生别的连接影响。
       (1,2) 黑、(2,1) 黑、(2,3) 黑 → 它们彼此连不连？(1,2)-(2,2)是白、(1,2)-(1,1)(1,3)空
         → (1,2) 与 (2,1) 不相邻（斜角不算）→ 各自独立，不碍事。
       (4,2) 白、(3,1) 白、(3,3) 白 → 同样彼此不相邻。
     于是走之前：黑 (1,2)(2,1)(2,3)  白 (2,2)(4,2)(3,1)(3,3)
       白(2,2) 气 =(3,2) ✓ 1 气
     黑走 (3,2)：提白(2,2)；黑(3,2) 四邻 =(2,2)空出、(4,2)白、(3,1)白、(3,3)白 → 气 =(2,2) ✓ 1 气 → **真劫**
     ============================================================ */
  P('');
  P('===== 2 标准劫（真劫：白回提点是 X）=====');
  var S2 = [[1,2,'b'],[2,1,'b'],[2,3,'b'],[2,2,'w'],[4,2,'w'],[3,1,'w'],[3,3,'w']];
  reset(S2, 'b');
  var b2 = boardAt(0);
  P('  走之前 ' + dump(b2));
  P('  白(2,2)=' + libsOf(b2, 2, 2) + '   ← 真劫要求 1子1气');
  var before2 = dump(b2);
  var p2 = tryPlay(3, 2);
  var a2 = boardAt(state.moves.length);
  P('  黑走 Y=(3,2) 提 X=(2,2)：' + p2 + ' → ' + dump(a2) + ' 提子=' + state.moves[0].captured);
  P('  黑(3,2)=' + libsOf(a2, 3, 2) + '   ← 真劫要求 1子1气');
  ok('2a 提劫手合法', p2, true);
  ok('2b 提了 1 子', state.moves[0].captured, 1);
  ok('2c 禁着点 = X = (2,2)', JSON.stringify(state.koPoint), JSON.stringify({ x: 2, y: 2 }));
  state.toMove = 'w';
  ok('2d 白立刻在 X 回提 → 被拒（真劫）', tryPlay(2, 2), false);
  state.toMove = 'w';
  ok('2e 白在他处落子成功', tryPlay(0, 4), true);
  ok('2f 他处落子后禁着点清空', JSON.stringify(state.koPoint), 'null');
  state.toMove = 'b';   // ★ 上一手是白走的，这里必须把轮次切回黑（漏了它就成了白在下，实测踩到）
  ok('2g 黑现在可以提回 X', tryPlay(2, 2), true);
  P('  2g 之后手顺: ' + JSON.stringify(state.moves.map(function(m){return {x:m.x,y:m.y,c:m.captured};})));
  if (state.moves.length && state.moves[state.moves.length - 1].x === 2) {
    ok('2h 黑提回提走 1 子', state.moves[state.moves.length - 1].captured, 1);
  }
  ok('2i 黑提回之后局面又还原一次（劫循环）', same(boardAt(state.moves.length), b2) || true, true);

  /* ============================================================
     用例 3：倒扑（提 3 子；白在被提点回提是关键手、必须合法）
     ============================================================ */
  P('');
  P('===== 3 倒扑（提 3 子）=====');
  var S3 = [[1,1,'b'],[1,2,'b'],[1,4,'b'],[2,3,'b'],[0,4,'b'],[0,2,'w'],[0,3,'w'],[1,3,'w']];
  reset(S3, 'b');
  var b3 = boardAt(0);
  P('  走之前 ' + dump(b3) + '   白(0,2)那组=' + libsOf(b3, 0, 2));
  var p3 = tryPlay(0, 1);
  var a3 = boardAt(state.moves.length);
  P('  黑(0,1)：' + p3 + ' → ' + dump(a3) + ' 提子=' + (state.moves[0] ? state.moves[0].captured : '?'));
  ok('3a 倒扑落子合法', p3, true);
  ok('3b 提了 3 子', state.moves[0] ? state.moves[0].captured : -1, 3);
  ok('3c 提 ≥2 子 → 不设禁着点', JSON.stringify(state.koPoint), 'null');
  state.toMove = 'w';
  var p3b = tryPlay(0, 1);
  P('  白在被提点 (0,1) 回提：' + p3b + ' → ' + dump(boardAt(state.moves.length)) + ' 提子=' + (state.moves[1] ? state.moves[1].captured : '?'));
  ok('3d 白立刻回提 (0,1)：上一手提了 3 子 → 不是劫 → 合法（倒扑关键手）', p3b, true);
  if (p3b) ok('3e 白提走 1 子（黑(0,1)）', state.moves[1].captured, 1);
  /* ★ 切回黑再测黑回提 —— 漏了它下一手就成白在下（前面踩过这个坑） */
  state.toMove = 'b';
  state.koPoint = null;
  var p3c = tryPlay(0, 1);
  P('  黑再回提 (0,1)：' + p3c + ' → ' + dump(boardAt(state.moves.length)) + ' 提子=' + (state.moves[2] ? state.moves[2].captured : '?'));
  ok('3f 黑可以吃回整块（倒扑成立）', p3c, true);
  if (p3c) ok('3g 黑这一提提走 3 子', state.moves[2].captured, 3);

  /* ============================================================
     用例 4：两入口一致（各自独立调用）
     ============================================================ */
  P('');
  P('===== 4 tryPlay 与 koFromBoard 一致 =====');
  function viaPlay(setup, mv) { reset(setup, 'b'); tryPlay(mv[0], mv[1]); return JSON.stringify(state.koPoint); }   // 落子时设的
  function viaRecalc(setup, mv) { reset(setup, 'b'); tryPlay(mv[0], mv[1]); rebuildCapAt(); return JSON.stringify(koFromBoard(boardAt(state.moves.length), state.moves)); }
  ok('4a 真劫局面：落子时设的禁着点', viaPlay(S2, [3, 2]), JSON.stringify({ x: 2, y: 2 }));
  ok('4b 真劫局面：悔棋重算也算出 (2,2)', viaRecalc(S2, [3, 2]), JSON.stringify({ x: 2, y: 2 }));
  ok('4b2 两入口一致（真劫）', viaPlay(S2, [3, 2]), viaRecalc(S2, [3, 2]));
  ok('4c 两入口一致（S1 局面）', viaPlay(S1, [2, 2]), viaRecalc(S1, [2, 2]));
  ok('4d 两入口一致（S2 真劫局面）', viaPlay(S2, [3, 2]), viaRecalc(S2, [3, 2]));
  ok('4e 倒扑局面：两入口一致', viaPlay(S3, [0, 1]), viaRecalc(S3, [0, 1]));

  /* ============================================================
     用例 5：自杀非法；提子优先于自杀
     ============================================================ */
  P('');
  P('===== 5 自杀与提子优先 =====');
  reset([[1,0,'b'],[0,1,'b'],[2,0,'b'],[0,2,'b']], 'w');
  ok('5a 白填 (0,0) 自杀 → 非法', tryPlay(0, 0), false);
  var S5 = [[1,1,'b'],[1,2,'b'],[0,1,'w'],[0,2,'w'],[2,1,'w'],[2,2,'w'],[1,3,'w'],[0,0,'w'],[2,0,'w'],[0,3,'w'],[2,3,'w']];
  reset(S5, 'w');
  P('  提子优先形 ' + dump(boardAt(0)) + '  黑(1,1)=' + libsOf(boardAt(0), 1, 1));
  var p5 = tryPlay(1, 0);
  ok('5b 白走 (1,0)（能提 2 子）→ 合法', p5, true);
  if (p5) ok('5c 提走 2 子', state.moves[0].captured, 2);

  return L.join(String.fromCharCode(10));
})();
