/* 诊断脚本 —— 由 _cdp_runfile.mjs 读出来注入页面。
   ⚠️ 这个文件本身就是**要注入的代码**，不要写模板串、不要写反斜杠转义
      （在模板串里写正则或换行转义会被吃掉或报语法错 —— 已经踩过两次）。 */
(function () {
  var L = [];
  settings.size = 5; N = 5; settings.rules = 'chinese'; settings.komi = 0;
  settings.handicap = 0; settings.mode = 'free';
  state.noGame = false; state.fromRecord = false; state.setup = [];
  var col = 'ABCDEFGHJKLMNOPQRST';
  function P(g) { return { x: col.indexOf(g.charAt(0)), y: N - parseInt(g.slice(1), 10) }; }
  function mk(g, c) { var p = P(g); return { x: p.x, y: p.y, color: c, pass: false, captured: 0 }; }
  state.moves = [mk('A5', 'b'), mk('D1', 'w'), mk('A1', 'b'), mk('E2', 'w'), mk('B2', 'b'), mk('E3', 'w')];
  state.viewAt = 6; state.toMove = 'b'; state.koPoint = null;

  L.push('=== 每手坐标核对（GTP 字母=列、数字=从下往上数）===');
  for (var i = 0; i < state.moves.length; i++) L.push('  ' + state.moves[i].color.toUpperCase() + ' -> x=' + state.moves[i].x + ' y=' + state.moves[i].y);

  var b = boardAt(6);
  L.push('=== boardAt(6)：行 y=0 在最上、列 x=0 在最左 ===');
  L.push('       x=0 1 2 3 4');
  for (var y = 0; y < N; y++) {
    var s = '';
    for (var x = 0; x < N; x++) s += (b[y * N + x] === 1 ? 'X ' : b[y * N + x] === 2 ? 'O ' : '. ');
    L.push('  y=' + y + '   ' + s);
  }
  var e2 = P('E2'), e3 = P('E3'), a2 = P('A2');
  L.push('E2 -> (' + e2.x + ',' + e2.y + ')  该格=' + b[e2.y * N + e2.x]);
  L.push('E3 -> (' + e3.x + ',' + e3.y + ')  该格=' + b[e3.y * N + e3.x]);
  L.push('A2 -> (' + a2.x + ',' + a2.y + ')  该格=' + b[a2.y * N + a2.x]);

  var gE2 = group(b, e2.x, e2.y);
  L.push('白 E2 那组：子数=' + gE2.stones.length + ' 气数=' + gE2.libs.size);
  L.push('=== 黑 A2 的四邻 ===');
  var nb = neighbors(a2.x, a2.y);
  for (var j = 0; j < nb.length; j++) {
    var nx = nb[j][0], ny = nb[j][1];
    var v = b[ny * N + nx];
    L.push('  (' + nx + ',' + ny + ') = ' + v + ' (' + (v === 1 ? '黑' : v === 2 ? '白' : '空') + ')');
  }
  L.push('=== 模拟黑走 A2 ===');
  var b2 = Int8Array.from(b);
  b2[a2.y * N + a2.x] = 1;
  var captured = 0;
  for (var k = 0; k < nb.length; k++) {
    var mx = nb[k][0], my = nb[k][1];
    if (b2[my * N + mx] === 2) {
      var gp = group(b2, mx, my);
      L.push('  邻格(' + mx + ',' + my + ') 是白，该组子数=' + gp.stones.length + ' 气数=' + gp.libs.size);
      if (gp.libs.size === 0) { captured += gp.stones.length; L.push('    -> 无气，提掉 ' + gp.stones.length + ' 子'); for (var q = 0; q < gp.stones.length; q++) b2[gp.stones[q]] = 0; }
    }
  }
  var gs = group(b2, a2.x, a2.y);
  L.push('这一手：提子数=' + captured + '，自己这块=' + gs.stones.length + '子/' + gs.libs.size + '气');
  L.push('【旧判据】提1子+孤子+剩1气 → 成立? ' + (captured === 1 && gs.stones.length === 1 && gs.libs.size === 1));
  var same = true;
  for (var z = 0; z < b2.length; z++) if (b2[z] !== b[z]) { same = false; break; }
  L.push('【正确判据】走完是否完全还原走之前的盘面? ' + same);
  return L.join(String.fromCharCode(10));
})();
