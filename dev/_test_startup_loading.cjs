const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'source section exists');
  return source.slice(a, b);
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapace-startup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const context = vm.createContext({ fs, path, process: { env: {} }, __dirname: dir,
    BASE_DIR: dir, IS_PACKAGED: true, CFG_FILE: path.join(dir, 'settings.json'),
    RECENT_MAX: 8, console });
  vm.runInContext(section('function defaultPaths()', '/* LoGos 服务')
    + section('function normRecent(v)', '/* 当前生效的路径')
    + section('function readConfig()', 'const ENGINES =')
    + section('function normalizeConfig(c)', 'function configInfo(c)'), context);
  return { context, dir };
}
test('first run and legacy config leave startup loading disabled', t => {
  const { context } = fixture(t);
  for (const config of [undefined, {}, { autoLoadKatago: 'true', autoLoadCoach: 1 }]) {
    if (config) fs.writeFileSync(context.CFG_FILE, JSON.stringify(config));
    const result = vm.runInContext('readConfig()', context);
    assert.equal(result.autoLoadKatago, false);
    assert.equal(result.autoLoadCoach, false);
  }
});
test('each startup preference survives normalization, disk save and reopen', t => {
  const { context } = fixture(t);
  for (const katago of [false, true]) for (const coach of [false, true]) {
    context.input = { autoLoadKatago: katago, autoLoadCoach: coach };
    vm.runInContext('writeConfig(normalizeConfig(input))', context);
    const result = vm.runInContext('readConfig()', context);
    assert.equal(result.autoLoadKatago, katago);
    assert.equal(result.autoLoadCoach, coach);
  }
});
test('startup launches only selected engines and shortcut mode launches none', async () => {
  for (const katago of [false, true]) for (const coach of [false, true]) {
    for (const shortcut of [false, true]) {
      const launches = [], timers = [];
      let windows = 0;
      const context = vm.createContext({
        PATHS: { autoLoadKatago: katago, autoLoadCoach: coach },
        ENGINES: Object.fromEntries(['analyze', 'play', 'coach'].map(key => [key, { key }])),
        launch: e => launches.push(e.key), setStatus() {},
        setTimeout: (fn, delay) => timers.push({ fn, delay }),
        createWindow: () => windows++, BrowserWindow: { getAllWindows: () => [] },
        app: { whenReady: () => Promise.resolve(), on() {}, exit() {} },
        process: { env: { RAPACEGO_MAKE_SHORTCUT: shortcut ? '1' : '' } },
        makeDesktopShortcut: () => ({ ok: true, path: 'test.lnk' }),
        fs: { appendFileSync() {} }, path, __dirname: '/test', console: { log() {} },
      });
      vm.runInContext(section('app.whenReady().then(', "app.on('window-all-closed'"), context);
      await Promise.resolve();
      timers.sort((a, b) => a.delay - b.delay).forEach(timer => timer.fn());
      assert.equal(windows, shortcut ? 0 : 1);
      assert.deepEqual(launches, shortcut ? [] : [...(katago ? ['analyze', 'play'] : []), ...(coach ? ['coach'] : [])]);
    }
  }
});
