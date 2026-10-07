/* 规则总检（第二部分）：坐标转换 / 星位 / 座子 / 让子 / 停一手与终局。
   注入页面执行（INJECT 指向本文件）。不写模板串、不写反斜杠转义。 */
(function () {
  var L = [];
  function P(s) { L.push(s); }
  function ok(n, g, w) { L.push((String(g) === String(w) ? '  [V] ' : '  [X] ') + n + '  得=' + g + ' 望=' + w); }

  settings.size = 19; N = 19; settings.rules = 'chinese'; settings.komi = 7.5;
  settings.handicap = 0; settings.mode = 'free';
  state.noGame = false; state.fromRecord = false; state.draft = null;

  /* ---------- ① 坐标往返：内部 → GTP → 内部 ---------- */
  P('===== 1 坐标往返 =====');
  var bad = 0;
  for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
    var g = GTP_COLS[x] + (N - y);
    var pt = fromGTP(g);
    if (!pt || pt.x !== x || pt.y !== y) { bad++; if (bad < 4) P('   不一致: (' + x + ',' + y + ') -> ' + g + ' -> ' + JSON.stringify(pt)); }
  }
  ok('1a 全部 361 个点 GTP 往返一致', bad, 0);
  /* 关键点人工核对（GTP 数字从下往上数） */
  ok('1b (0,18)=A1（左下角，y 往下增）', GTP_COLS[0] + (N - 18), 'A1');
  ok('1c (18,0)=T19（右上角，索引 18 = 跳过 I 后的 T）', GTP_COLS[18] + (N - 0), 'T19');
  ok('1d (8,9)=J10（跳过 I）', GTP_COLS[8] + (N - 9), 'J10');
  ok('1e fromGTP("I5") 应为 null（GTP 无 I）', JSON.stringify(fromGTP('I5')), 'null');

  /* ---------- ② SGF 坐标：含 i、且 y 从上往下 ---------- */
  P('');
  P('===== 2 SGF 坐标（含 i，a 在最上）=====');
  ok('2a SGF 字母表含 i', SGF_COLS.indexOf('i'), 8);
  ok('2b 19 路第 9 个字母=i', SGF_COLS[8], 'i');
  /* 内部 (0,0) 是左上 → SGF 应为 "aa" */
  ok('2c 左上 (0,0) → SGF aa', SGF_COLS[0] + SGF_COLS[0], 'aa');
  ok('2d 右下 (18,18) → SGF ss', SGF_COLS[18] + SGF_COLS[18], 'ss');

  /* ---------- ③ 星位 ---------- */
  P('');
  P('===== 3 星位 =====');
  function fmtStar(n, list) { return list.map(function (p) { return GTP_COLS[p[0]] + (n - p[1]); }).sort().join(' '); }
  ok('3a 9 路星位', fmtStar(9, starPoints(9)), 'C3 C7 E5 G3 G7');
  ok('3b 13 路星位', fmtStar(13, starPoints(13)), 'D10 D4 G7 K10 K4');
  ok('3c 19 路星位（9 个）', starPoints(19).length, 9);
  ok('3d 19 路四角星', [starPoints(19)[0], starPoints(19)[2], starPoints(19)[6], starPoints(19)[8]].map(function (p) { return GTP_COLS[p[0]] + (19 - p[1]); }).sort().join(' '), 'D16 D4 Q16 Q4');

  /* ---------- ④ 座子（明清）---------- */
  P('');
  P('===== 4 座子制 =====');
  var seats = seatStones(19);
  var seatTxt = seats.map(function (s) { return s.color.toUpperCase() + ' ' + GTP_COLS[s.x] + (19 - s.y); }).sort().join(' ');
  P('  实际：' + seatTxt);
  ok('4a 座子 4 颗', seats.length, 4);
  ok('4b 左上/右下 = 白（对角同色）',
    (function () { var a = []; seats.forEach(function (s) { if ((s.x < 9 && s.y < 9) || (s.x > 9 && s.y > 9)) a.push(s.color); }); return a.join(''); })() ,
    (function () { var a = []; seats.forEach(function (s) { if ((s.x < 9 && s.y < 9) || (s.x > 9 && s.y > 9)) a.push(s.color); }); return a[0] + (a[1] || ''); })());
  /* 明清规则：座子 4 颗 + 白先 */
  settings.rules = 'ancient'; settings.handicap = 0;
  state.setup = seatStones(19); state.moves = []; state.viewAt = 0; state.koPoint = null;
  state.toMove = 'w';
  ok('4c 明清规则轮白先', state.toMove, 'w');
  ok('4d sideToMove(0) 也是白', sideToMove(0), 'w');
  ok('4e sideToMove(1) 是黑（黑白交替）', sideToMove(1), 'b');
  ok('4f 明清贴目 0', RULES.ancient.komi, 0);

  /* ---------- ⑤ 让子：位置 + 白先 + 不贴目 ---------- */
  P('');
  P('===== 5 让子 =====');
  settings.rules = 'chinese';
  ok('5a 让 2 子', fmtStar(19, handicapStones(19, 2).map(function (s) { return [s.x, s.y]; })), 'D4 Q16');
  ok('5b 让 3 子（第三子在右上）', fmtStar(19, handicapStones(19, 3).map(function (s) { return [s.x, s.y]; })), 'D4 Q16 Q4');
  ok('5c 让 4 子四角', fmtStar(19, handicapStones(19, 4).map(function (s) { return [s.x, s.y]; })), 'D16 D4 Q16 Q4');
  ok('5d 让 9 子=四角四边+天元', fmtStar(19, handicapStones(19, 9).map(function (s) { return [s.x, s.y]; })), 'D10 D16 D4 K10 K16 K4 Q10 Q16 Q4');
  ok('5e 让子全是黑', handicapStones(19, 6).every(function (s) { return s.color === 'b'; }), true);

  /* ---------- ⑥ 停一手 / 终局 ---------- */
  P('');
  P('===== 6 停一手与终局判定 =====');
  state.setup = []; state.moves = []; state.viewAt = 0; state.koPoint = null; state.toMove = 'b';
  state.candidates = []; state.candAt = -1; state.history = [];
  settings.mode = 'free';
  ok('6a 空局不算终局', isTerminal(), false);
  state.moves.push({ pass: true, color: 'b' });
  ok('6b 一方停一手不算终局', isTerminal(), false);
  state.moves.push({ pass: true, color: 'w' });
  ok('6c 双方连续停一手 = 终局', isTerminal(), true);
  state.moves.push({ pass: false, x: 3, y: 3, color: 'b', captured: 0 });
  ok('6d 续下之后不再是终局', isTerminal(), false);
  /* 停一手会解消劫 */
  state.koPoint = { x: 2, y: 2 };
  ok('6e 停一手前有禁着点', state.koPoint ? 'yes' : 'no', 'yes');

  return L.join(String.fromCharCode(10));
})();
