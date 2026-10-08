/* 验证帮助顶部的直达目录（2026-10-08 用户要求）：
   ① 目录在不在、六个按钮齐不齐
   ② 点一下是否真的跳到对应小节（位置要落在可视区顶部附近，不能被吸顶目录盖住）
   ③ 滚动时当前小节是否自动高亮
   ④ 每次打开帮助是否回到第一节（上一版翻到一半的位置不该留着） */
(function () {
  var L = [];
  function P(s) { L.push(s); }
  function ok(n, g, w) { L.push((String(g) === String(w) ? '  [V] ' : '  [X] ') + n + '  得=' + g + ' 望=' + w); }

  return (async function () {
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var body = document.querySelector('.help-body');

    P('===== ① 目录与按钮 =====');
    var nav = document.getElementById('help-nav');
    ok('目录存在', !!nav, true);
    var links = nav ? Array.prototype.slice.call(nav.querySelectorAll('a')) : [];
    P('  按钮: ' + links.map(function (a) { return a.textContent.trim(); }).join(' / '));
    ok('六个按钮', links.length, 6);

    var ids = ['help-first', 'help-parts', 'help-feat', 'help-rules', 'help-keys', 'help-data'];
    var missing = ids.filter(function (id) { return !document.getElementById(id); });
    ok('六个小节都有锚点', missing.length, 0);
    ok('按钮的 data-help 和小节 id 一一对应',
      links.map(function (a) { return a.dataset.help; }).join(','), ids.join(','));

    P('');
    P('===== ② 点按钮能不能跳到对应位置 =====');
    /* 把帮助打开（走真实入口） */
    document.getElementById('btn-help').click();
    await sleep(400);

    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var id = a.dataset.help;
      a.click();
      await sleep(360);
      var el = document.getElementById(id);
      var rel = Math.round(el.getBoundingClientRect().top - body.getBoundingClientRect().top);
      /* 期望：这一节的标题落在滚动区顶部附近（0~70px，让吸顶目录压不住它）。
         ★ 例外：**靠底部的小节物理上滚不到顶部**（它下面的内容不够长，
           scrollTop 已经到底了）—— 那种情况只要求"真的滚到底了"，
           否则会把正常现象误判成 bug（第一版就误判了「四种规则」）。 */
      var atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
      var good = (rel >= -8 && rel <= 70) || (atBottom && rel > 0);
      P('  点「' + a.textContent.trim() + '」→ ' + id + ' 落在顶部 ' + rel + 'px'
        + (atBottom ? '（已滚到底，下面内容不够）' : ''));
      ok('   跳到位', good, true);
    }

    P('');
    P('===== ③ 滚动时高亮当前小节 =====');
    var on1 = nav.querySelector('a.on');
    P('  末次点击后高亮: ' + (on1 ? on1.textContent.trim() : '(无)'));
    ok('有且只有一个高亮', nav.querySelectorAll('a.on').length, 1);
    ok('高亮的就是刚点的那节', on1 && on1.dataset.help, 'help-data');

    /* 手动滚回最上面 → 高亮应回到第一节 */
    body.scrollTop = 0;
    body.dispatchEvent(new Event('scroll'));
    await sleep(260);
    var on2 = nav.querySelector('a.on');
    P('  滚回顶部后高亮: ' + (on2 ? on2.textContent.trim() : '(无)'));
    ok('滚到顶部高亮第一节', on2 && on2.dataset.help, 'help-first');

    P('');
    P('===== ④ 重开帮助是否回到第一节 =====');
    body.scrollTop = body.scrollHeight;              // 先滚到底
    await sleep(150);
    P('  滚到底后 scrollTop = ' + Math.round(body.scrollTop) + '（可滚范围 ' + Math.round(body.scrollHeight - body.clientHeight) + '）');
    document.getElementById('help-close').click();
    await sleep(200);
    P('  关闭后 mask 有 open 类吗: ' + document.getElementById('help').classList.contains('open'));
    document.getElementById('btn-help').click();     // 再打开
    /* 诊断：立刻看一次，再看 0.4s / 1.6s 后 —— 如果立刻是对的、后来又跑了，
       说明是 scroll-behavior:smooth 在"平滑动过去"。 */
    P('  刚打开 scrollTop = ' + Math.round(body.scrollTop));
    var t1 = Math.round(body.scrollTop);
    await sleep(400);
    P('  0.4s 后 scrollTop = ' + Math.round(body.scrollTop));
    await sleep(1200);
    P('  1.6s 后 scrollTop = ' + Math.round(body.scrollTop));
    ok('重开后滚回顶部', body.scrollTop <= 4, true);
    var on3 = nav.querySelector('a.on');
    ok('重开后高亮第一节', on3 && on3.dataset.help, 'help-first');

    document.getElementById('help-close').click();
    return L.join(String.fromCharCode(10));
  })();
})();
