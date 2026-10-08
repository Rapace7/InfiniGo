/* 量一次帮助弹窗的布局：确认"元素相对滚动内容顶部"的偏移到底怎么算才准。
   上一版我假设 = rect.top − body.rect.top + body.scrollTop，实测对不上，
   所以这里把各个量都打出来，用数据定公式。 */
(function () {
  var L = [];
  function P(s) { L.push(s); }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  return (async function () {
    document.getElementById('btn-help').click();
    await sleep(500);
    var body = document.querySelector('.help-body');

    function dump(label) {
      var br = body.getBoundingClientRect();
      P(label);
      P('  body: scrollTop=' + Math.round(body.scrollTop) + ' clientH=' + body.clientHeight
        + ' scrollH=' + body.scrollHeight + ' rect.top=' + Math.round(br.top)
        + ' 可滚=' + Math.round(body.scrollHeight - body.clientHeight));
      ['help-first', 'help-parts', 'help-feat', 'help-rules', 'help-keys', 'help-data'].forEach(function (id) {
        var el = document.getElementById(id);
        var r = el.getBoundingClientRect();
        var rel = r.top - br.top;
        P('    ' + id.padEnd(12) + ' rect.top=' + Math.round(r.top)
          + '  rel=' + Math.round(rel)
          + '  rel+scrollTop=' + Math.round(rel + body.scrollTop)
          + '  offsetTop=' + Math.round(el.offsetTop));
      });
    }

    dump('=== 滚到顶部时 ===');
    /* 归零后再量，取"绝对偏移"的两种候选算法，比较哪个稳定 */
    body.scrollTop = 0;
    await sleep(200);
    var zero = {};
    var br0 = body.getBoundingClientRect();
    ['help-first', 'help-parts', 'help-feat', 'help-rules', 'help-keys', 'help-data'].forEach(function (id) {
      zero[id] = Math.round(document.getElementById(id).getBoundingClientRect().top - br0.top);
    });
    P('  在 scrollTop=0 时各节 rel: ' + JSON.stringify(zero));

    /* 滚到中间，再用"rel + scrollTop"算一次，看和上面是否一致（一致=公式可靠） */
    body.scrollTop = 600;
    await sleep(400);
    var br1 = body.getBoundingClientRect();
    var mid = {};
    ['help-first', 'help-parts', 'help-feat', 'help-rules', 'help-keys', 'help-data'].forEach(function (id) {
      mid[id] = Math.round(document.getElementById(id).getBoundingClientRect().top - br1.top + body.scrollTop);
    });
    P('  在 scrollTop=600 时各节 rel+scrollTop: ' + JSON.stringify(mid));
    P('  两种算法一致吗: ' + (JSON.stringify(Object.keys(zero).map(function (k) { return zero[k]; }))
      === JSON.stringify(Object.keys(mid).map(function (k) { return mid[k]; }))));

    dump('=== 停在 scrollTop=600 时 ===');

    /* 再看：把 scrollTop 设成某节的"绝对偏移 − 44"，量出来落在哪 */
    var want = mid['help-keys'];
    body.scrollTop = Math.max(0, want - 44);
    await sleep(400);
    var br2 = body.getBoundingClientRect();
    P('  设 scrollTop=' + Math.round(body.scrollTop) + '（目标 ' + (want - 44) + '）后：');
    P('    help-keys rel = ' + Math.round(document.getElementById('help-keys').getBoundingClientRect().top - br2.top));

    document.getElementById('help-close').click();
    return L.join(String.fromCharCode(10));
  })();
})();
