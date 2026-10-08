/* 验证 main.js 的 guessWeights() 能认出**裸 .bin** 权重。
   测试方式：建临时目录造出「engine/katago.exe + weights/*.bin」结构，然后把
   main.js 里 WEIGHT_RE 与 guessWeights 两段切出来，在 vm 沙箱里跑。
   （只切这两个定义 —— 不碰 app.whenReady 那种会连带一堆依赖的段落。）

   为什么要有这个测试：**夸克网盘不允许分享压缩包格式**，用户只能把 .bin.gz
   解压成裸 .bin 再上传，别人下到的就是 .bin。原来只认 .bin.gz，
   于是"手里明明有权重却选不中"。2026-10-08 用户报的。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start);
  assert.ok(a >= 0, '找得到起点: ' + start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(b > a, '找得到终点: ' + end);
  return source.slice(a, b);
}

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapace-weight-'));
  const engineDir = path.join(dir, 'engine');
  const weightsDir = path.join(dir, 'weights');
  fs.mkdirSync(engineDir, { recursive: true });
  fs.mkdirSync(weightsDir, { recursive: true });
  fs.writeFileSync(path.join(engineDir, 'katago.exe'), 'stub');
  for (const n of files) fs.writeFileSync(path.join(weightsDir, n), 'stub');
  const context = vm.createContext({ fs, path, process: { env: {} }, __dirname: dir, console });
  vm.runInContext(section('const WEIGHT_RE =', 'function guessWeights'), context);
  vm.runInContext(section('function guessWeights(exePath)', "ipcMain.handle('settings:get'"), context);
  return { context, exe: path.join(engineDir, 'katago.exe') };
}

test('裸 .bin 权重能被自动识别（夸克网盘那种：解压后的文件）', () => {
  const { context, exe } = fixture(['b11c768nbt.bin', 'b18c384nbt-humanv0.bin']);
  const r = vm.runInContext('guessWeights(' + JSON.stringify(exe) + ')', context);
  assert.ok(r, '应该找到权重');
  assert.match(r.analyzeWeight, /b11c768nbt\.bin$/);
  assert.match(r.playWeight, /humanv0\.bin$/);
});

test('.bin.gz 权重仍然能识别（老行为不能坏）', () => {
  const { context, exe } = fixture(['b11c768nbt.bin.gz', 'b18c384nbt-humanv0.bin.gz']);
  const r = vm.runInContext('guessWeights(' + JSON.stringify(exe) + ')', context);
  assert.ok(r);
  assert.match(r.analyzeWeight, /b11c768nbt\.bin\.gz$/);
  assert.match(r.playWeight, /humanv0\.bin\.gz$/);
});

test('两种混放时也能正确分（human 归对弈、其余归分析）', () => {
  const { context, exe } = fixture(['b11c768nbt.bin', 'b18c384nbt-humanv0.bin.gz']);
  const r = vm.runInContext('guessWeights(' + JSON.stringify(exe) + ')', context);
  assert.ok(r);
  assert.match(r.analyzeWeight, /b11c768nbt\.bin$/);
  assert.match(r.playWeight, /humanv0\.bin\.gz$/);
});

test('没有权重时返回 null（不能瞎猜）', () => {
  const { context, exe } = fixture(['license.txt', 'README.md', 'foo.gz']);
  const r = vm.runInContext('guessWeights(' + JSON.stringify(exe) + ')', context);
  assert.equal(r, null);
});

/* ============================================================================
   下面这组测的是**默认路径的回退** —— 这才是"懒人包开箱不能用"的真正根因：
   defaultPaths() 把权重文件名写死成 `b11c768nbt.bin.gz` / `b18c384nbt-humanv0.bin.gz`，
   而懒人包里放的是解压后又改过名的 `Bot.bin` / `Human.bin`
   （夸克网盘不让分享压缩包，只能解压成 .bin 再传）。
   名字对不上 → 双击懒人包后两个权重路径全指空 → 引擎起不来。
   ============================================================================ */
function fixtureResolve(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapace-resolve-'));
  for (const n of files) fs.writeFileSync(path.join(dir, n), 'stub');
  const context = vm.createContext({ fs, path, console });
  vm.runInContext(section('function resolveWeightPath', 'function defaultPaths'), context);
  return { context, dir };
}
function resolveBoth(context, dir) {
  const q = JSON.stringify(dir);
  return JSON.parse(vm.runInContext(
    'JSON.stringify([resolveWeightPath(' + q + ',"b11c768nbt.bin.gz",false),'
    + ' resolveWeightPath(' + q + ',"b18c384nbt-humanv0.bin.gz",true)])', context));
}

test('★ 懒人包那种改名过的裸 .bin（Bot.bin / Human.bin）也能自动找到', () => {
  const { context, dir } = fixtureResolve(['Bot.bin', 'Human.bin']);
  const [a, p] = resolveBoth(context, dir);
  assert.equal(path.basename(a), 'Bot.bin', '分析权重应回退到 Bot.bin');
  assert.equal(path.basename(p), 'Human.bin', '对弈权重应回退到 Human.bin（带 human 字样）');
  assert.ok(fs.existsSync(a) && fs.existsSync(p), '两个都必须是真实存在的文件');
});

test('原文件名 .bin.gz 优先（老行为不能坏）', () => {
  const { context, dir } = fixtureResolve(['b11c768nbt.bin.gz', 'b18c384nbt-humanv0.bin.gz', 'Bot.bin', 'Human.bin']);
  const [a, p] = resolveBoth(context, dir);
  assert.match(a, /b11c768nbt\.bin\.gz$/);
  assert.match(p, /b18c384nbt-humanv0\.bin\.gz$/);
});

test('混合时各自回退到能用的那个', () => {
  const { context, dir } = fixtureResolve(['b11c768nbt.bin.gz', 'Human.bin']);
  const [a, p] = resolveBoth(context, dir);
  assert.match(a, /b11c768nbt\.bin\.gz$/);
  assert.equal(path.basename(p), 'Human.bin');
});

test('目录里什么都没有时原样返回、不抛异常', () => {
  const { context, dir } = fixtureResolve([]);
  const [a, p] = resolveBoth(context, dir);
  assert.match(a, /b11c768nbt\.bin\.gz$/);
  assert.match(p, /b18c384nbt-humanv0\.bin\.gz$/);
});

/* ★★ 光修 defaultPaths 只能救"从没配过"的人。而报这个问题的用户**配过了** ——
   他的 settings.json 里存着一条现在不存在的路径（挪过位置 / 手动选过旧文件）。
   所以 normalizeConfig 也必须会回退，否则界面上还是「★ 找不到」、他根本不知道该选哪个。 */
function fixtureNormalize(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapace-norm-'));
  for (const n of files) fs.writeFileSync(path.join(dir, n), 'stub');
  const context = vm.createContext({ fs, path, console });
  vm.runInContext(section('function resolveWeightPath', 'function defaultPaths'), context);
  /* 用一个"指向测试目录"的假 defaultPaths 顶掉真的，免得依赖本机布局 */
  vm.runInContext('function defaultPaths(){ return { katago:"K", analyzeWeight:'
    + JSON.stringify(path.join(dir, 'b11c768nbt.bin.gz')) + ', playWeight:'
    + JSON.stringify(path.join(dir, 'b18c384nbt-humanv0.bin.gz'))
    + ', coachServer:"C", coachWeight:"W", recordsDir:"" }; }', context);
  vm.runInContext(section('function normalizeConfig', 'function configInfo'), context);
  return { context, dir };
}

test('★ 配置里存着失效路径时也要能回退（用户实际遇到的那种）', () => {
  const { context, dir } = fixtureNormalize(['Bot.bin', 'Human.bin']);
  context.cfg = {
    analyzeWeight: path.join(dir, 'b11c768nbt.bin.gz'),   // 故意给一个不存在的旧路径
    playWeight: path.join(dir, 'b18c384nbt-humanv0.bin.gz'),
  };
  const o = JSON.parse(vm.runInContext('JSON.stringify(normalizeConfig(cfg))', context));
  assert.equal(path.basename(o.analyzeWeight), 'Bot.bin');
  assert.equal(path.basename(o.playWeight), 'Human.bin');
  assert.ok(fs.existsSync(o.analyzeWeight) && fs.existsSync(o.playWeight), '回退结果必须是真实存在的文件');
});

test('配置为空时用默认值（不改老行为）', () => {
  const { context, dir } = fixtureNormalize(['b11c768nbt.bin.gz', 'b18c384nbt-humanv0.bin.gz']);
  const o = JSON.parse(vm.runInContext('JSON.stringify(normalizeConfig({}))', context));
  assert.match(o.analyzeWeight, /b11c768nbt\.bin\.gz$/);
  assert.match(o.playWeight, /b18c384nbt-humanv0\.bin\.gz$/);
});

test('配置有效时原样保留（绝不能把用户手动选的覆盖掉）', () => {
  const { context, dir } = fixtureNormalize(['Bot.bin', 'Human.bin', 'MyOwn.bin']);
  context.cfg = { analyzeWeight: path.join(dir, 'MyOwn.bin'), playWeight: path.join(dir, 'Human.bin') };
  const o = JSON.parse(vm.runInContext('JSON.stringify(normalizeConfig(cfg))', context));
  assert.equal(path.basename(o.analyzeWeight), 'MyOwn.bin', '用户明确选的文件不能被回退逻辑换掉');
});


