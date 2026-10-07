/* 验证「推荐落点讲解」这一块的最终形态（2026-10-07 用户定稿后）：
   ① 讲解卡片里那个「实时推荐落点」勾选项**已删除**，只剩「显示」菜单里那一个
   ② 开关与 state 同步、并被 localStorage 记住
   ③ 快照的「当前局面已变化」提示：切手数该提示、切回来不提示
   ④ 标题不再把 LoGos 摆在最前（避免被读成"LoGos 自己选点"）
   注入页面执行（INJECT 指向本文件）。不写模板串、不写反斜杠转义。 */
(function () {
  var L = [];
  function P(s) { L.push(s); }
  function ok(n, g, w) { L.push((String(g) === String(w) ? '  [V] ' : '  [X] ') + n + '  得=' + g + ' 望=' + w); }

  settings.size = 9; N = 9; settings.rules = 'chinese'; settings.komi = 7.5;
  settings.handicap = 0; settings.mode = 'free';
  state.noGame = false; state.fromRecord = false; state.draft = null;

  var el = function (id) { return document.getElementById(id); };

  P('===== 0 元素与文案 =====');
  ok('0a 讲解卡片里的勾选项已删除', !!el('pick-show-hints'), false);
  ok('0b 有 pick-context 提示条', !!el('pick-context'), true);
  ok('0c 按钮文案', el('btn-pick') ? el('btn-pick').textContent : '(无)', '生成讲解');
  var sub = document.querySelector('.card-title-sub');
  var titleTxt = sub ? sub.parentNode.textContent : '';
  P('  卡片标题: ' + titleTxt);
  ok('0d 标题以「推荐落点讲解」开头', titleTxt.indexOf('推荐落点讲解'), 0);
  ok('0e 标题里点明谁选点谁讲（含 KataGo）', titleTxt.indexOf('KataGo') >= 0, true);

  P('');
  P('===== 1 开关只有「显示」菜单那一个 =====');
  setHintsVisible(true);
  ok('1a 打开后 state.showHints', state.showHints, true);
  ok('1b 显示菜单里的 chk-show 同步', el('chk-show').checked, true);
  setHintsVisible(false);
  ok('1c 关闭后 state 与 chk-show 都关', [state.showHints, el('chk-show').checked].join(','), 'false,false');
  el('chk-show').checked = true; el('chk-show').onchange({ target: el('chk-show') });
  ok('1d 从显示菜单改 → state 跟上', state.showHints, true);

  P('');
  P('===== 2 选择被记住 =====');
  setHintsVisible(true);
  ok('2a localStorage 记住 true', localStorage.getItem('rapacego.showHints'), 'true');
  setHintsVisible(false);
  ok('2b 关掉后记住 false', localStorage.getItem('rapacego.showHints'), 'false');

  P('');
  P('===== 3 快照的「局面已变化」提示 =====');
  state.setup = []; state.moves = []; state.viewAt = 0; state.koPoint = null;
  state.candidates = []; state.candAt = -1; state.history = [];
  state.toMove = 'b';
  var pts = [[2,2],[6,6],[2,6],[6,2]];
  for (var i = 0; i < 4; i++) { state.toMove = (i % 2 === 0) ? 'b' : 'w'; tryPlay(pts[i][0], pts[i][1]); }
  P('  摆了 ' + state.moves.length + ' 手');
  var at4 = 4;
  state.viewAt = at4;
  state.coach.pick = { at: at4, side: 'b', positionKey: pickPositionKey(at4), gen: gameGen, pts: [{ title: '假点', body: '假讲解' }] };
  state.coach.pickPending = null;
  renderPickContext();
  ok('3a 提示条显示出来了', el('pick-context').hidden, false);
  P('  文案: ' + el('pick-context').textContent);
  ok('3b 同局面不算过期', el('pick-context').classList.contains('is-stale'), false);
  state.viewAt = 2; renderPickContext();
  ok('3c 切到第 2 手 → 提示已变化', el('pick-context').classList.contains('is-stale'), true);
  P('  文案: ' + el('pick-context').textContent);
  state.viewAt = 4; renderPickContext();
  ok('3d 切回第 4 手 → 不再提示', el('pick-context').classList.contains('is-stale'), false);

  return L.join(String.fromCharCode(10));
})();
