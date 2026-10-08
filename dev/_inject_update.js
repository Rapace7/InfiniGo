/* 验证「检查更新」这一块（2026-10-08 用户要求）：
   ① app.info() 能读到当前版本号
   ② app.checkUpdate() 真发一次请求、返回最新版本、判断对不对
   ③ settings:save 不会把 store（上次检查时间）冲掉   ← 容易漏的接线
   ④ 下载地址是 /releases/latest（永远指向最新版） */
(function () {
  var L = [];
  function P(s) { L.push(s); }
  function ok(n, g, w) { L.push((String(g) === String(w) ? '  [V] ' : '  [X] ') + n + '  得=' + g + ' 望=' + w); }

  return (async function () {
    P('===== ① app.info()：当前版本号 =====');
    var info = await window.api.app.info();
    P('  ' + JSON.stringify(info));
    ok('能读到版本号', /^\d+\.\d+\.\d+$/.test(String(info.version)), true);
    ok('下载地址指向 releases/latest（永远最新）', /\/releases\/latest$/.test(String(info.downloadUrl)), true);

    P('');
    P('===== ② app.checkUpdate()：真去问一次 GitHub =====');
    var r = await window.api.app.checkUpdate();
    P('  ' + JSON.stringify(r));
    if (r && r.ok) {
      ok('拿到了最新版本号', /^\d+\.\d+\.\d+$/.test(String(r.latest)), true);
      ok('本地版本和它一致（我们刚发的就是最新）', r.upToDate, true);
      ok('upToDate 是布尔而非"说不准"', r.uncertain, false);
      P('  用的哪条路: ' + r.via + '（api=官方接口 / web=网页兜底）');
    } else {
      P('  ★ 检查失败（可能是网络/限流）：' + (r && r.error));
      P('  这本身不算 bug —— 但要确认失败时**没有**谎报"已是最新"');
      ok('失败时不谎报已是最新', r && r.upToDate === undefined, true);
    }

    P('');
    P('===== ③ settings:save 不能把 store 冲掉 =====');
    var before = await window.api.settings.get();
    P('  保存前 store: ' + JSON.stringify(before.config.store));
    var saved = await window.api.settings.save(Object.assign({}, before.config));
    ok('保存成功', !!(saved && saved.ok), true);
    var after = await window.api.settings.get();
    P('  保存后 store: ' + JSON.stringify(after.config.store));
    ok('store 还在（没被保存流程冲掉）',
      JSON.stringify(after.config.store) === JSON.stringify(before.config.store), true);

    P('');
    P('===== ④ 设置面板里的控件都在 =====');
    ok('版本号显示位', !!document.getElementById('app-version'), true);
    ok('检查更新按钮', !!document.getElementById('btn-check-update'), true);
    ok('去下载页按钮', !!document.getElementById('btn-open-download'), true);
    return L.join(String.fromCharCode(10));
  })();
})();
