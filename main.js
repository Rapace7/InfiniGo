/* 玄清围弈 · 主进程
 * 职责：建窗口 + 管理 KataGo 子进程 + 把结果桥给界面
 *
 * ★ 双引擎（2026-10-03）
 *   分析引擎 analyze：b11c768nbt.bin.gz        → 胜率 / 候选点，数字要准
 *   对弈引擎 play   ：b18c384nbt-humanv0.bin.gz → AI 落子，支持 humanSLProfile 真实段位
 *
 *   为什么必须分两个进程：
 *   · `humanSLProfile`（rank_9d ~ rank_20k，实测 48 档）**只有 human 权重认**，
 *     拿它给 strong 权重设会报 Unknown human SL network profile；
 *   · 而 human 权重是「模仿人类」，它的胜率标尺偏业余 —— 当分析数字用不准。
 *   两条通道在 IPC 上分开：engine:analyze / engine:play。
 */
const { app, BrowserWindow, ipcMain, shell, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');
const http = require('http');       // LoGos 靠 HTTP 说话（llama-server 托管）

/* ---------- 「基准目录」：开发模式 vs 打包模式 ----------
   ★ 这两种模式下"东西该放哪"完全不同，必须分开：
     · 开发模式（`start.bat` / `npm start`）：代码就在项目目录，一切以 __dirname 为基准。
     · 打包模式（免安装 exe）：代码在 `<安装目录>\resources\app\`，而**用户数据**
       （settings.json / 棋谱 / 引擎日志）不该放那儿 —— 用户找不到，而且连同
       "引擎放旁边"的约定也要以 exe 为准。
       所以打包后基准取 **exe 所在目录**：数据都是用户看得见的文件夹，升级覆盖程序也不丢。
   `app.isPackaged` 在 ready 之前就能用（不需要等 app ready）。 */
const IS_PACKAGED = app.isPackaged;
/* ★ 用 process.execPath 而不是 app.getPath('exe')：
   后者在 app ready 之前调用会抛错，而这个常量是在**模块顶层**求值的 ——
   一抛就是「主进程加载失败 → 窗口一闪就没」（打包版实测退出码 0，很难查）。
   process.execPath 任何时候都能读，打包后它就是 exe 本身。 */
const BASE_DIR = IS_PACKAGED ? path.dirname(process.execPath) : __dirname;

/* ★★ 便携式的关键一步：把 **Electron 自己的用户数据**也拉进程序文件夹。
   它默认写在 `%APPDATA%\RapaceGo`（C 盘的"应用数据"里），里面有页面缓存、
   GPU 缓存、Local Storage 等。不改的话：
     · 软件明明解压在 D 盘，却还要占 C 盘；
     · **把文件夹删了也不干净**（C 盘还留着一份）。
   这个软件要做成「整个文件夹拷走、删掉就彻底卸载」的形态，所以必须挪过来。

   ⚠️ 两个踩过的坑（2026-10-05 实测）：
     ① **不要提前 mkdirSync 建这个目录** —— Chromium 启动时要「把旧缓存搬过来」，
        目录预先存在会让它走成迁移分支；碰上 C 盘有同名旧目录时就报
        `Unable to move the cache: 拒绝访问(0x5)` 然后**整个软件起不来**（退出码 0）。
        交给它自己建最稳。
     ② 必须在 app ready 之前调用 setPath。 */
if (IS_PACKAGED) {
  try {
    const ud = path.join(BASE_DIR, 'userdata');
    app.setPath('userData', ud);
    app.setPath('sessionData', ud);
  } catch (e) { /* 极端情况失败就算了，不影响主功能 */ }
}

/* ---------- 引擎位置 ----------
   ★ 2026-10-04 起**可在界面里改**（左上角「设置」→ 选 katago.exe 和两个权重），
     配置存在软件目录的 settings.json，启动时读它；读不到（首次运行 / 文件坏了）
     就用下面的默认值。环境变量 RAPACEGO_KATAGO 仍然认（临时覆盖用）。 */
const CFG_FILE = path.join(BASE_DIR, 'settings.json');
/* 用 RapaceGo 自己的配置（复制自 KataGo 的 analysis.cfg，改了两处：
   reportAnalysisWinratesAs → SIDETOMOVE、logDir 由启动参数传），不动公共配置。
   ★ engine.cfg 是**程序自带的**文件，所以跟代码走（__dirname），不跟数据走。 */
const CFG = path.join(__dirname, 'engine.cfg');
const LOG_DIR = path.join(BASE_DIR, 'engine-logs');

/* LoGos（讲解模型）的默认目录 —— 2026-10-05 新增第三个「引擎」。
   它和 KataGo 长得不像：KataGo 是「stdin 喂 JSON / stdout 出 JSON」的长驻进程，
   而 LoGos 由 llama-server 托管，**走 HTTP**（进程只管活着，请求从 localhost 端口进）。
   所以引擎管理里给它们分了 kind：'katago' / 'llama'。 */
function defaultPaths() {
  /* 默认约定：引擎就放在**软件目录的上一级**（和 RapaceGo 并列）——
     这样别人 clone 下来，按 README 把 KataGo / LoGos 摆在旁边就能直接用，
     不用先配路径。想放别处有两个办法（优先级从高到低）：
       ① 设置面板里改 → 存进 settings.json，下次打开就用你的；
       ② 环境变量 RAPACEGO_KATAGO / RAPACEGO_LOGOS。
     ★ 这里**不写死盘符** —— 那是本机耦合，换台电脑 / 换个盘就全废。 */
  const up = IS_PACKAGED ? BASE_DIR : path.join(__dirname, '..');
  const root  = process.env.RAPACEGO_KATAGO || path.join(up, 'KataGo');
  const logos = process.env.RAPACEGO_LOGOS  || path.join(up, 'LoGos');
  return {
    katago:        path.join(root, 'engine', 'katago.exe'),
    analyzeWeight: path.join(root, 'weights', 'b11c768nbt.bin.gz'),
    playWeight:    path.join(root, 'weights', 'b18c384nbt-humanv0.bin.gz'),
    coachServer:   path.join(logos, 'llama-server.exe'),
    coachWeight:   path.join(logos, 'LoGos-7B-Q4_K_M.gguf'),
  };
}

/* LoGos 服务的本地端口（llama-server 监听它，我们 POST /completion 找它说话） */
const COACH_PORT = 8137;

/* ---------- 「最近用过的权重」（2026-10-04 用户要求：权重多套并存 + 记住上次用的） ----------
   每次保存设置，就把当前两个权重插到各自列表的**最前面**（自动去重、最多 8 条）。
   前端把它们填进输入框的 datalist —— 想换回某一套时，点一下输入框就能挑，
   不必再走一遍文件对话框。 */
const RECENT_MAX = 8;
function normRecent(v) {
  const one = a => (Array.isArray(a) ? a : [])
    .filter(x => typeof x === 'string' && x.trim())
    .map(s => s.trim())
    .slice(0, RECENT_MAX);
  return {
    analyzeWeight: one(v && v.analyzeWeight),
    playWeight:    one(v && v.playWeight),
    coachWeight:   one(v && v.coachWeight),
  };
}
function withRecent(cur, c) {
  const r = normRecent(cur);
  const put = (list, v) => {
    const s = String(v || '').trim();
    if (!s) return list;
    return [s].concat(list.filter(x => x !== s)).slice(0, RECENT_MAX);   // 最新的排最前
  };
  return {
    analyzeWeight: put(r.analyzeWeight, c && c.analyzeWeight),
    playWeight:    put(r.playWeight,    c && c.playWeight),
    coachWeight:   put(r.coachWeight,   c && c.coachWeight),
  };
}

/* 当前生效的路径（设置面板保存后会被替换，然后重启引擎） */
let PATHS = readConfig();

function readConfig() {
  const d = defaultPaths();
  try {
    const raw = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
    const pick = v => (typeof v === 'string' && v.trim()) ? v.trim() : null;
    return {
      katago:        pick(raw.katago)        || d.katago,
      analyzeWeight: pick(raw.analyzeWeight) || d.analyzeWeight,
      playWeight:    pick(raw.playWeight)    || d.playWeight,
      coachServer:   pick(raw.coachServer)   || d.coachServer,
      coachWeight:   pick(raw.coachWeight)   || d.coachWeight,
      recordsDir:    typeof raw.recordsDir === 'string' ? raw.recordsDir.trim() : '',
      recent:        normRecent(raw.recent),
    };
  } catch (e) {
    return Object.assign(d, {
      recordsDir: '',
      recent: { analyzeWeight: [], playWeight: [], coachWeight: [] },
    });
  }
}

function writeConfig(c) {
  try {
    fs.writeFileSync(CFG_FILE, JSON.stringify(c, null, 2), 'utf8');
    return { ok: true };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

/* 某个引擎该用哪个权重文件 */
function weightOf(key) {
  if (key === 'analyze') return PATHS.analyzeWeight;
  if (key === 'play') return PATHS.playWeight;
  return PATHS.coachWeight;                 // coach（LoGos）
}

/* 某个引擎该用哪个可执行文件 */
function exeOf(e) {
  return e.kind === 'llama' ? PATHS.coachServer : PATHS.katago;
}

/* ★★ human 权重（对弈引擎）的硬性要求：**必须**给出 humanSLProfile，
   否则任何请求都会直接 FATAL：
     "SGFMetadata is required for b18c384nbt-humanv0.bin.gz but was not initialized.
      Did you specify humanSLProfile=...?"
   实测后果：引擎 code=1 退出，整个对弈功能失效（2026-10-03 踩过）。
   这里给引擎级默认档位让进程能正常起来；对局中具体用哪一档，
   由每条请求的 overrideSettings.humanSLProfile 逐手覆盖（无需重启引擎）。 */
const PLAY_DEFAULT_PROFILE = 'rank_3d';
const PLAY_EXTRA_ARGS = ['-override-config', 'humanSLProfile=' + PLAY_DEFAULT_PROFILE];

let win = null;
let quitting = false;      // 正在退出（此时引擎被杀不算「意外退出」，别自动重启）
function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

/* ---------- 引擎实例 ----------
   每个引擎自己一套：进程、就绪标志、id 序号、pending 表、最近查询 id。
   kind：'katago'（stdin/stdout 说 JSON） / 'llama'（HTTP 说，进程本身不管协议） */
function makeEngine(key) {
  return {
    key,
    kind: key === 'coach' ? 'llama' : 'katago',
    weight: weightOf(key),
    proc: null,
    ready: false,
    loading: false,        // ★ 已 spawn、还没就绪（界面上显示「加载中」）
    paused: false,         // ★ 暂停：进程留着、权重留在显存，只是不再自动分析
    lastErr: null,
    restarts: 0,           // 意外退出后的自动重启次数（防死循环）
    restartTimer: null,    // ★ 上面那次自动重启的定时器句柄 —— 「卸载」时要能取消它
    seq: 0,
    lastId: null,          // 最近一次查询，用于 terminateId 终止
    pending: new Map(),    // id -> { resolve, best, timer, done }
    stderrTail: [],
  };
}
const ENGINES = {
  analyze: makeEngine('analyze'),
  play:    makeEngine('play'),
  coach:   makeEngine('coach'),      // LoGos 讲解模型（llama-server）
};
const ENGINE_KEYS = Object.keys(ENGINES);

function statusOf(e) {
  /* state 给界面直接显示用：off=未加载 / loading / ready / paused / error */
  let st = 'off';
  if (e.lastErr) st = 'error';
  else if (e.proc && e.ready && e.paused) st = 'paused';
  else if (e.proc && e.ready) st = 'ready';
  else if (e.proc) st = 'loading';
  return {
    ok: !!e.proc && !e.lastErr,
    ready: e.ready,
    error: e.lastErr,
    model: path.basename(e.weight || ''),
    state: st,
    kind: e.kind,
    paused: !!e.paused,
    pid: e.proc ? e.proc.pid : null,
  };
}

function setStatus() {
  const a = statusOf(ENGINES.analyze);
  /* 兼容旧字段：ok / ready / error / model 仍指「分析引擎」，
     老代码（engineReady 等）不用改就能继续跑。 */
  send('engine:status', Object.assign({
    analyze: statusOf(ENGINES.analyze),
    play:    statusOf(ENGINES.play),
    coach:   statusOf(ENGINES.coach),
  }, a));
}

/* ---------- 启停 ---------- */
function launch(e) {
  if (e.proc) return;
  e.lastErr = null;
  e.paused = false;                // 重新拉起 = 取消暂停

  e.weight = weightOf(e.key);      // ★ 每次启动现读 —— 设置里改了路径后重启就用新的
  const exe = exeOf(e);
  if (!fs.existsSync(exe)) {
    e.lastErr = '找不到引擎：' + exe + '（去左上角「设置」里选一下）';
    setStatus();
    return;
  }
  if (!fs.existsSync(e.weight)) {
    e.lastErr = '找不到权重：' + e.weight;
    console.warn('[engine:' + e.key + '] ' + e.lastErr);
    setStatus();
    return;
  }
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (err) { /* 忽略 */ }

  let args;
  if (e.kind === 'llama') {
    /* LoGos：llama-server 托管。全层进显存（-ngl 99）、开 flash-attn、
       固定端口监听本机 —— 请求从 HTTP 进，不经 stdin。
       -fa on 顺带省 KV，还没坏处（见 2026-10-05 关于 KV 量化的实测）。 */
    args = ['-m', e.weight, '-ngl', '99', '-c', '8192', '-fa', 'on',
            '--port', String(COACH_PORT), '--host', '127.0.0.1'];
  } else {
    /* 日志目录用绝对路径传进去（engine.cfg 里不写死）——
       这样换盘 / 别人 clone 下来都不会指到不存在的目录。
       KataGo 允许多次 -override-config（对弈引擎还会再传一个 humanSLProfile）。 */
    args = ['analysis', '-config', CFG, '-model', e.weight,
            '-override-config', 'logDir=' + LOG_DIR];
    if (e.key === 'play') args.push(...PLAY_EXTRA_ARGS);   // ← 少了这两项引擎会 FATAL
  }

  e.loading = true;                // 界面上显示「加载中」（就绪前）
  e.proc = spawn(exe, args, { windowsHide: true });
  console.log('[engine:' + e.key + '] 启动 pid=' + e.proc.pid + ' 模型=' + path.basename(e.weight));

  if (e.kind === 'katago') {
    /* KataGo 的 stdout 就是协议（一行一条 JSON）；stderr 只当日志收着 */
    readline.createInterface({ input: e.proc.stdout }).on('line', ln => onLine(e, ln));
  } else {
    /* llama-server 的 stdout 是给人看的日志，不解析 —— 全塞进 stderrTail 方便排错 */
    readline.createInterface({ input: e.proc.stdout }).on('line', ln => {
      e.stderrTail.push(ln);
      if (e.stderrTail.length > 200) e.stderrTail.shift();
    });
  }
  readline.createInterface({ input: e.proc.stderr }).on('line', ln => {
    e.stderrTail.push(ln);
    if (e.stderrTail.length > 200) e.stderrTail.shift();
  });

  e.proc.on('exit', code => {
    console.log('[engine:' + e.key + '] 退出 code=' + code);
    e.proc = null; e.ready = false; e.loading = false; e.paused = false;
    for (const [, rec] of e.pending) {
      clearTimeout(rec.timer);
      rec.resolve(rec.best || { error: '引擎已退出' });
    }
    e.pending.clear();
    if (code !== 0 && code !== null) e.lastErr = '引擎意外退出（code ' + code + '）';
    setStatus();

    /* ★ 手动重启（在设置里改完路径）时别走下面那段「意外退出自动重启」——
       我们马上会自己用新路径 launch，两边同时拉会打架。 */
    if (e.manualStop) { e.manualStop = false; return; }

    /* 意外退出就自动拉起来（最多 3 次）——
       在用户眼里这是「AI 突然不动了」，不该让他自己去重启软件。
       ★ 句柄要留着：用户在这 3 秒里点「卸载」的话，得能把这次重启取消掉，
         否则「卸载完过 3 秒它自己又起来了」（2026-10-05 审查发现）。 */
    if (!quitting && code !== 0 && code !== null && e.restarts < 3) {
      e.restarts += 1;
      console.warn('[engine:' + e.key + '] 3 秒后自动重启（第 ' + e.restarts + ' 次）');
      e.restartTimer = setTimeout(() => {
        e.restartTimer = null;
        if (!e.proc && !quitting) launch(e);
      }, 3000);
    }
  });

  e.proc.on('error', err => {
    e.lastErr = '引擎启动失败：' + err.message;
    /* ★ 必须把 proc 清掉：launch() 开头是 `if (e.proc) return`，
       不清的话这个引擎**再也拉不起来**。spawn 失败是真会发生的
       （exe 被杀毒拦下、文件损坏、权限不足）。 */
    e.proc = null; e.ready = false; e.loading = false;
    for (const [, rec] of e.pending) { clearTimeout(rec.timer); rec.resolve({ error: '引擎启动失败' }); }
    e.pending.clear();
    setStatus();
  });

  /* ★★ 给 stdin 挂一个 error 监听 —— 不加会给主进程引来崩溃（P0，2026-10-05 审查发现）。
     KataGo 的请求是往它的 stdin 写（见 analyze）；如果进程刚死、'exit' 事件还没轮到，
     write 会触发 EPIPE，而**没有监听者的 'error' 事件会让 Node 直接抛未捕获异常**。
     真正的失败已经有 pending 超时兜底，这里只要"有人接住"就行。 */
  if (e.proc.stdin) e.proc.stdin.on('error', () => { /* 交给 pending 超时处理 */ });

  probe(e);
}

/* 探针：空盘算 1 次。拿到**正常响应** = 模型加载完毕、可以用了
   （不依赖日志文本匹配）。
   ⚠️ 必须检查 res.error：引擎若中途退出，pending 里的 promise 会被 resolve 成
   { error: '引擎已退出' }；旧代码不检查就当成「就绪」→ 界面显示就绪、
   实际一调用就报「引擎未启动」（2026-10-03 踩过）。 */
function probe(e) {
  if (e.kind === 'llama') { probeCoach(e); return; }

  console.log('[engine:' + e.key + '] 模型加载中（首次约 10~20 秒）...');
  const req = { moves: [], initialStones: [], rules: 'chinese', komi: 7.5, size: 19, maxVisits: 2 };
  if (e.key === 'play') req.profile = PLAY_DEFAULT_PROFILE;   // human 权重必须带档位
  analyze(e, req)
    .then(res => {
      if (!res || res.error || !res.root) {
        console.warn('[engine:' + e.key + '] 探针未通过：' + ((res && res.error) || '无有效响应'));
        return;
      }
      e.restarts = 0;        // 跑起来了 → 重启额度重置（以后再崩还能自动救）
      if (!e.ready) {
        e.ready = true;
        e.loading = false;
        console.log('[engine:' + e.key + '] 就绪');
        setStatus();
      }
    })
    .catch(() => { /* 结果无关紧要 */ });
}

/* LoGos 的就绪判定：它没有 JSON 探针协议，但 llama-server 有个 /health 端点 ——
   **模型加载完才回 200**（加载中会挂着不回）。所以轮询它就行了。
   上限 3 分钟：4.4GB 权重从磁盘读进显存，慢盘可能要一会儿。 */
function coachHealth() {
  return new Promise(resolve => {
    const r = http.request(
      { host: '127.0.0.1', port: COACH_PORT, path: '/health', method: 'GET', timeout: 1500 },
      res => { res.resume(); resolve(res.statusCode === 200); }
    );
    r.on('error', () => resolve(false));
    r.on('timeout', () => { r.destroy(); resolve(false); });
    r.end();
  });
}

function probeCoach(e) {
  console.log('[engine:coach] 讲解模型加载中（4.4GB 进显存，首次约 10~30 秒）...');
  const deadline = Date.now() + 180000;
  const tick = async () => {
    if (!e.proc || e.proc.exitCode !== null) return;      // 进程没了就别再轮（exit 那边会收尾）
    const ok = await coachHealth();
    if (ok) {
      e.restarts = 0;
      if (!e.ready) {
        e.ready = true;
        e.loading = false;
        console.log('[engine:coach] 就绪');
        setStatus();
      }
      return;
    }
    if (Date.now() > deadline) {
      e.lastErr = '讲解模型加载超时（3 分钟）';
      e.loading = false;
      setStatus();
      return;
    }
    setTimeout(tick, 1000);
  };
  setTimeout(tick, 1200);        // 先给它一点启动时间，别一上来就轮
}

function shutdown() {
  quitting = true;
  for (const k of Object.keys(ENGINES)) {
    const e = ENGINES[k];
    if (e.restartTimer) { clearTimeout(e.restartTimer); e.restartTimer = null; }
    if (!e.proc) continue;
    /* KataGo 有优雅退出的 JSON 命令；llama-server 没有 stdin 协议，直接杀。 */
    if (e.kind === 'katago') {
      try { e.proc.stdin.write('{"id":"__quit","action":"quit"}\n'); } catch (err) { /* 忽略 */ }
    }
    const p = e.proc;
    /* ★ 原来等 400ms 才补一刀，有个漏洞：Electron 若在这之前就退干净了，
       这个定时器永远不会跑 → 引擎变**孤儿进程**（用户表现：关了软件显存还在占、
       风扇还转）。所以① 延迟缩短 ② 下面再加一道进程退出时的同步兜底。 */
    setTimeout(() => { try { p.kill(); } catch (err) { /* 忽略 */ } }, e.kind === 'llama' ? 100 : 150);
  }
}

/* 最后一道保险：进程真要退出时同步再杀一遍。
   （process.on('exit') 里只能做同步操作，而 ChildProcess.kill() 正是同步的。） */
process.on('exit', () => {
  for (const k of Object.keys(ENGINES)) {
    const e = ENGINES[k];
    if (e.proc) { try { e.proc.kill(); } catch (err) { /* 忽略 */ } }
  }
});

/* ---------- 按新设置重启引擎 ----------
   和 shutdown 的区别：shutdown 是「程序要关了」（设了 quitting，之后任何情况都不再拉起）；
   这里是「换个路径重来」—— 要停干净、再用新路径拉起。
   两个都停完才开始拉（停是并行的，最多等 1.5 秒），然后错开 1.2 秒起 ——
   免得同时抢磁盘 / 显存初始化（和开机启动那一套一致）。 */
function stopEngine(e, cb) {
  const p = e.proc;
  e.ready = false; e.loading = false; e.paused = false;
  /* ★ 取消「意外退出自动重启」——用户点卸载 = 明确不要它了。
     少了这一句：崩溃后 3 秒内点卸载，引擎会自己又起来（审查发现）。 */
  if (e.restartTimer) { clearTimeout(e.restartTimer); e.restartTimer = null; }
  if (!p) { cb(); return; }
  e.manualStop = true;            // 让 exit 处理跳过程序化的「意外退出自动重启」
  let done = false;
  const fin = () => { if (done) return; done = true; cb(); };
  p.once('exit', fin);
  /* KataGo 走优雅退出；llama-server 没有 stdin 协议 —— 直接 kill。 */
  if (e.kind === 'katago') {
    try { p.stdin.write('{"id":"__quit","action":"quit"}\n'); } catch (err) { /* 忽略 */ }
  }
  setTimeout(() => {
    try { p.kill(); } catch (err) { /* 忽略 */ }
    fin();
  }, e.kind === 'llama' ? 300 : 1500);   // llama 不用等它自己退，杀了就完事
}

/* 按新设置重启引擎。
   ★ 2026-10-05 起引擎改为**手动加载**：这里只把「原本开着的」那几个用新路径拉起来，
     原本没开的就静静停着 —— 用户没点「加载」，不该自己动。 */
function restartEngines() {
  for (const k of ENGINE_KEYS) ENGINES[k].restarts = 0;
  const wasUp = ENGINE_KEYS.filter(k => ENGINES[k].proc || ENGINES[k].ready);
  console.log('[engine] 按新设置重启引擎…（原本开着的：' + (wasUp.join(', ') || '无') + '）');
  let left = ENGINE_KEYS.length;
  const go = () => {
    left -= 1;
    if (left !== 0) return;
    wasUp.forEach((k, i) => setTimeout(() => launch(ENGINES[k]), 100 + i * 1200));
  };
  for (const k of ENGINE_KEYS) stopEngine(ENGINES[k], go);
}

/* ---------- 引擎控制：加载 / 卸载 / 暂停 / 恢复（2026-10-05 新增） ----------
   为什么要有这套：用户打谱、摆棋时根本用不上引擎，不该一开软件就把 4~5GB 权重
   塞进显存。所以默认**一个都不加载**，由用户手动点。
   暂停只对 KataGo 有意义（它局面一变就自动分析）；LoGos 是被动的，平时不干活，
   给它「暂停」没有意义 —— 对应的操作是「中止」（掐断正在生成的讲解）。 */
/* 引擎「组」——一盏灯对应一组进程（和 app.js 里的 ENG_KEYS 一一对应）。
   KataGo 是**两个**进程（分析 + 对弈），对用户来说就是「KataGo」一个东西，
   所以接口既认单引擎名（'analyze'），也认组名（'katago'）。 */
const ENG_GROUPS = { katago: ['analyze', 'play'], coach: ['coach'] };
function engKeysOf(key) {
  return ENG_GROUPS[key] || (ENGINES[key] ? [key] : null);
}

ipcMain.handle('engine:load', (_e, key) => {
  const keys = engKeysOf(key);
  if (!keys) return { error: '未知引擎：' + key };
  for (const k of keys) launch(ENGINES[k]);
  /* launch 是异步的就绪过程，这里立刻回「已开始加载」，界面靠 engine:status 事件刷新 */
  return { ok: true, loading: true };
});

ipcMain.handle('engine:unload', (_e, key) => new Promise(resolve => {
  const keys = engKeysOf(key);
  if (!keys) { resolve({ error: '未知引擎：' + key }); return; }
  if (keys.indexOf('coach') >= 0) coachCancel();      // 讲解在飞 → 先掐掉
  let left = keys.length;
  for (const k of keys) {
    stopEngine(ENGINES[k], () => {
      left -= 1;
      if (left !== 0) return;
      for (const kk of keys) ENGINES[kk].lastErr = null;   // 主动卸载不算错误
      setStatus();
      resolve({ ok: true });
    });
  }
}));

ipcMain.handle('engine:pause', (_e, key) => {
  const keys = engKeysOf(key) || [];
  /* 暂停只对「分析引擎」有意义 —— 它局面一变就自动算。
     对弈引擎是被动的（只在你落子后才动），LoGos 更被动，都没有「暂停」这回事。 */
  const eng = ENGINES.analyze;
  if (keys.indexOf('analyze') < 0) return { error: '这个引擎没有「暂停」—— 它平时不干活，需要时用「中止」' };
  if (!eng.proc || !eng.ready) return { error: '引擎还没加载' };
  eng.paused = true;
  setStatus();
  return { ok: true };
});

ipcMain.handle('engine:resume', (_e, key) => {
  const keys = engKeysOf(key) || [];
  for (const k of keys) if (ENGINES[k]) ENGINES[k].paused = false;
  setStatus();
  return { ok: true };
});

/* ---------- LoGos 讲解：一条 HTTP 管道 ----------
   主进程只干「把 prompt 发给 llama-server、把流式吐出来的字推给界面」。
   prompt 怎么拼（坐标怎么算、棋盘矩阵怎么排、要短还是要长）**全在渲染进程里**——
   以后调措辞只动 app.js，不必碰主进程。 */
let coachReq = null;     // 当前在飞的那条（用于掐断）

function coachCancel() {
  const c = coachReq;
  if (!c) return false;
  coachReq = null;
  c.abort();
  return true;
}

function coachExplain(req) {
  return new Promise(resolve => {
    const e = ENGINES.coach;
    if (!e.proc || !e.ready) { resolve({ error: '讲解模型还没加载' }); return; }
    coachCancel();          // 同一时刻只跑一条（用户又点了一次 = 覆盖旧的）

    const body = JSON.stringify({
      prompt: String(req.prompt || ''),
      n_predict: Math.min(Math.max(req.maxTokens || 400, 32), 2048),
      temperature: typeof req.temperature === 'number' ? req.temperature : 0.3,
      stream: true,
      /* ★ 开着前缀缓存：同一局的着法序列是逐手加长的，前缀能大量复用 ——
         全盘批量分析时这一步省的时间很可观。 */
      cache_prompt: true,
      stop: Array.isArray(req.stop) ? req.stop : [],
    });

    let all = '';
    let buf = '';
    let aborted = false;
    let timedOut = false;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (coachReq && coachReq.self === r) coachReq = null;
      resolve({ text: all, aborted });
    };

    const r = http.request(
      {
        host: '127.0.0.1', port: COACH_PORT, path: '/completion', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      res => {
        if (res.statusCode !== 200) {
          /* ★ 把服务端给的原因读出来 —— llama-server 拒绝请求时会在 body 里说明
             （上下文超限 / 参数不对）。原来直接吞掉，界面只能显示「讲不出来」，
             用户分不清是自己操作的问题还是模型的问题（审查发现）。 */
          let emsg = '';
          res.setEncoding('utf8');
          res.on('data', c => { if (emsg.length < 400) emsg += c; });
          res.on('end', () => {
            if (settled) return;
            settled = true;
            if (coachReq && coachReq.self === r) coachReq = null;
            const clean = emsg.replace(/\s+/g, ' ').trim().slice(0, 160);
            resolve({ error: '讲解服务返回 ' + res.statusCode + (clean ? '：' + clean : ''), text: all });
          });
          return;
        }
        res.setEncoding('utf8');
        res.on('data', chunk => {
          buf += chunk;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line || line === 'data: [DONE]') continue;
            /* llama-server 的流是 SSE（带 "data: " 前缀）；老版本是纯 JSON 行。两种都认。 */
            const js = line.startsWith('data:') ? line.slice(5).trim() : line;
            try {
              const d = JSON.parse(js);
              const piece = typeof d.content === 'string' ? d.content : '';
              if (piece) {
                all += piece;
                send('coach:progress', { id: req.id || null, text: piece, full: all });
              }
            } catch (err) { /* 半行 / 非 JSON（比如 keep-alive 注释），跳过 */ }
          }
        });
        res.on('end', finish);
        res.on('close', finish);
      }
    );

    /* ★ 必须有超时：llama-server 卡住（或半死不活）时这个 promise 会**永远不 resolve** ——
       界面就永远停在「讲解中…」、按钮一直是灰的，用户只能重启软件（审查发现）。
       单次讲解只生成几百 token，120 秒已经非常宽松。 */
    r.setTimeout(120000, () => { timedOut = true; try { r.destroy(); } catch (err) { /* 忽略 */ } });

    r.on('error', err => {
      e.lastErr = null;                       // 连接错不该把引擎标成坏掉
      if (settled) return;
      settled = true;
      if (coachReq && coachReq.self === r) coachReq = null;
      resolve({
        error: timedOut ? '讲解超时（120 秒没出结果）'
          : (aborted ? null : String((err && err.message) || err)),
        text: all, aborted,
      });
    });

    r.write(body);
    r.end();
    coachReq = { self: r, abort: () => { aborted = true; try { r.destroy(); } catch (err) { /* 忽略 */ } } };
  });
}

ipcMain.handle('coach:explain', (_e, req) => coachExplain(req || {}));
ipcMain.handle('coach:cancel', () => ({ ok: coachCancel() }));

/* ---------- 协议 ---------- */
function onLine(e, line) {
  let msg;
  try { msg = JSON.parse(line); } catch (err) { return; }

  if (msg.error) {
    const rec = e.pending.get(msg.id);
    if (rec && !rec.done) {
      clearTimeout(rec.timer); rec.done = true; e.pending.delete(msg.id);
      rec.resolve({ error: String(msg.error) });
    } else {
      console.warn('[engine:' + e.key + '] ' + msg.error);
    }
    return;
  }
  if (msg.warning) { console.warn('[engine:' + e.key + '] ' + msg.warning); return; }
  if (!msg.moveInfos || !msg.id) return;

  const rec = e.pending.get(msg.id);
  if (!rec || rec.done) return;

  const payload = {
    id: msg.id,
    turn: msg.turnNumber,
    root: msg.rootInfo || null,          // { winrate, scoreLead, visits }
    /* ownership = 形势雾的数据源。★ 在顶层，不在 rootInfo 里，也没有 field 标记
       （实测踩过：查 rootInfo.ownership 和 field 都读不到，其实就在 msg.ownership）。
       长度 = boardX × boardY，每点 -1~+1：正=黑倾向，负=白倾向，0=中立。 */
    ownership: msg.ownership || null,
    /* policy = 神经网络原始策略（也就是「人类先验」）。拟人落子按它抽样，见 app.js 的
       pickByHumanPolicy。⚠️ 官方文档里的 humanPolicy 只在「-model 普通 + -human-model 人类」
       时才返回；但**实测方式2（-model 人类模型）的 policy 与方式1 的 humanPolicy 数值完全一致**，
       所以我们直接用它，不必改引擎启动方式。 */
    policy: msg.policy || null,
    moves: msg.moveInfos.slice(0, 8).map(m => ({
      move: m.move, winrate: m.winrate, scoreLead: m.scoreLead,
      /* ★ utility / prior 必须透传：拟人落子（配方 C）要按 humanPrior × exp(utility / 0.5) 抽样，
         缺了它们指数项恒为 1 → 退化成"纯按人类先验抽"（配方 A），
         就少了官方那层「某手开始亏超过约 25% 胜率就压低它概率」的保护。 */
      utility: m.utility, prior: m.prior,
      visits: m.visits, order: m.order, pv: (m.pv || []).slice(0, 8),
    })),
    final: msg.isDuringSearch === false,
  };

  /* 这一回合「实际下的那手」是谁 —— 复盘要拿它和 AI 首选比「重合度」。
     （目损**不靠它**算：引擎会把明显差的手剪枝掉，实测 40% 的回合找不到实际手，
       而那恰恰是最该点评的失误。所以目损走「相邻回合 rootInfo 换算」，见 app.js。） */
  if (rec.moveList && typeof msg.turnNumber === 'number') {
    const real = (rec.moveList[msg.turnNumber] || [])[1] || null;
    payload.actualMove = real;
    if (real) {
      const i = (msg.moveInfos || []).findIndex(x => x.move === real);
      payload.actualRank = i;                      // 0 = 就是 AI 首选；-1 = 被剪枝了
    }
  }

  /* ★ 复盘（多回合）：逐条累积，**收齐再回**。
     原来每条 isDuringSearch===false 都会 resolve → 第一条就把 promise 结掉，
     后面 N-1 条全丢（这是多回合请求最隐蔽的坑）。 */
  if (rec.collect && typeof msg.turnNumber === 'number') {
    rec.turns.push(payload);
    if (e.lastId === msg.id) {
      send('engine:review-progress', { done: rec.turns.length, total: rec.expect });
    }
    if (rec.turns.length >= rec.expect) {
      clearTimeout(rec.timer); rec.done = true; e.pending.delete(msg.id);
      if (e.lastId === msg.id) e.lastId = null;
      rec.turns.sort((a, b) => a.turn - b.turn);
      rec.resolve({ turns: rec.turns });
    }
    return;
  }

  if (payload.final) {
    clearTimeout(rec.timer); rec.done = true; e.pending.delete(msg.id);
    if (e.lastId === msg.id) e.lastId = null;
    rec.resolve(payload);
  } else {
    rec.best = payload;
    /* 只推「最新那次查询」的中途报告 —— 否则切局面时旧查询的残影会闪一下 */
    if (e.lastId === msg.id) send('engine:progress', payload);
  }
}

function analyze(e, req) {
  return new Promise(resolve => {
    if (!e.proc) { resolve({ error: '引擎未启动' }); return; }

    const id = e.key + (++e.seq);
    /* 回合列表：普通分析只算「当前这一手」；AI 复盘传一整个数组，一次拿回整盘逐手结果。
       ★ 复盘要**多算一个末端回合**（turn = 手数）—— 那一回合代表「最后一手落下之后」的局面，
         是算最后一手目损的唯一来源（理由见 renderer/app.js 的 computeLosses）。 */
    const turns = (Array.isArray(req.analyzeTurns) && req.analyzeTurns.length)
      ? req.analyzeTurns.slice()
      : [(req.moves || []).length];
    const collect = turns.length > 1;      // 多回合 = 收集模式，收齐再回（见 onLine）

    const q = {
      id,
      initialStones: req.initialStones || [],
      moves: req.moves || [],
      rules: req.rules || 'chinese',
      komi: (typeof req.komi === 'number') ? req.komi : 7.5,
      boardXSize: req.size || 19,
      boardYSize: req.size || 19,
      analyzeTurns: turns,
      maxVisits: req.maxVisits || 400,
      /* ⚠️ 合法范围 0.001~1000000（实测传 0 引擎直接报
         "Must be number of seconds from 0.001 to 1000000.0"）。
         复盘不要中途报告 —— 给个极大值等于不推，否则 N 个回合会产生 N×4 条消息。 */
      reportDuringSearchEvery: collect ? 1000000 : 0.25,
      includeOwnership: !!req.includeOwnership,
      includePolicy: !!req.includePolicy,      // 拟人落子要用 policy（人类先验）来抽样
    };
    /* ⚠️ 别加 maxMoves / includeMoves / focusMoves —— 实测前两个是**无效字段**
       （引擎回 warning: "Unexpected or unused field, do you have a typo?"），
       加了只会刷警告，不会有任何作用。 */
    /* ★ 真实段位：只有对弈引擎（human 权重）认这个设置；逐请求覆盖即可，
       不必为每个段位重启引擎（实测验证过）。
       ⚠️ 对弈引擎**必须**带档位（漏了会让引擎 FATAL 退出）—— 这里兜底，
       免得以后哪条请求忘了带就把整个对弈引擎搞崩。 */
    if (e.key === 'play') {
      q.overrideSettings = {
        humanSLProfile: req.profile || PLAY_DEFAULT_PROFILE,
        /* 官方「拟人落子」配方明确要求：让人类模型**看最近几手**
           （analysis 默认忽略历史以保持中立，但人类会因最近几手下出不同的棋）。 */
        ignorePreRootHistory: false,
      };
    } else if (req.profile) {
      q.overrideSettings = { humanSLProfile: req.profile };
    }

    if (e.lastId) q.terminateId = e.lastId;    // 新局面前先掐掉旧查询
    e.lastId = id;

    /* 超时兜底：复盘按回合数放宽（实测约 0.5~0.7 秒/手），普通分析固定 90 秒 */
    const budget = collect ? (60000 + turns.length * 6000) : 90000;
    const timer = setTimeout(() => {
      const rec = e.pending.get(id);
      if (rec && !rec.done) {
        rec.done = true; e.pending.delete(id);
        resolve(rec.collect
          ? { turns: rec.turns, incomplete: true }        // 复盘超时：把已收到的交出去
          : (rec.best || { error: '分析超时' }));
      }
    }, budget);

    e.pending.set(id, {
      resolve, best: null, timer, done: false,
      /* 复盘用：收齐 expect 条回合报告再一次性回给前端 */
      collect, expect: turns.length, turns: [], moveList: req.moves || [],
    });
    try { e.proc.stdin.write(JSON.stringify(q) + '\n'); }
    catch (err) {
      clearTimeout(timer); e.pending.delete(id);
      resolve({ error: '写入引擎失败：' + err.message });
    }
  });
}

function cancel(e) {
  if (!e.proc || !e.lastId) return { ok: true };
  const id = e.lastId;
  const rec = e.pending.get(id);
  if (rec && !rec.done) {
    rec.done = true; e.pending.delete(id); clearTimeout(rec.timer);
    /* ★ 必须打上 cancelled 标记：这时候 rec.best 是**搜索中途的半成品**
       （visits 很少、胜率还没收敛）。前端若把它当正常结果上屏，
       胜率条会瞬间跳到极端值（用户实测报过：点数子后胜率条突变、几秒后才恢复）。 */
    rec.resolve(rec.best ? Object.assign({}, rec.best, { cancelled: true }) : { cancelled: true });
  }
  e.lastId = null;
  return { ok: true };
}

/* ---------- 窗口 ---------- */
function createWindow() {
  /* ★ 窗口默认开大一点（2026-10-05 用户要求）——
     左边要新开一栏（手数 + 两个讲解框），不放大棋盘会被挤得没法看。
     按屏幕工作区自适应：大屏开到 1460 宽，小屏按比例缩小，保证不出屏。 */
  let W = 1460, H = 940;
  try {
    const wa = screen.getPrimaryDisplay().workAreaSize;
    W = Math.min(1460, Math.max(1200, Math.round(wa.width * 0.9)));
    H = Math.min(940, Math.max(800, Math.round(wa.height * 0.92)));
  } catch (e) { /* 读不到就用默认值 */ }
  win = new BrowserWindow({
    width: W,
    height: H,
    minWidth: 1020,          // 左栏 + 棋盘 + 右栏 的下限（再窄就得折行了）
    minHeight: 680,
    /* 窗口标题：中文名 + 英文名（英文名是产品对外的名字，2026-10-05 从
       InfiniGo 改成 RapaceGo —— 取自作者的 ID，带个人名片色彩） */
    title: '玄清围弈 · RapaceGo',
    backgroundColor: '#f7f6f3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => setStatus());
}

/* ---------- 桌面快捷方式（Windows） ----------
   ★ 为什么必须用 Electron 自己的 shell.writeShortcutLink，而不是自己造 .lnk：
     它写的是完整 MS-SHLLINK（含 TargetIDList 等各个块）。
     实测过两条弯路（都记下来，别再走）：
       ① 手工拼二进制（pylnk3）新建的 .lnk 缺 TargetIDList —— 文件能读回、
          字段全对，但**Explorer 双击报「系统无法执行指定的程序」**；
       ② PowerShell 的 `New-Object -ComObject WScript.Shell`、以及
          **Python 进程内的 win32com.client.Dispatch**，都被命令沙箱拦死
          （「COM object instantiation can run arbitrary code」/「Known Windows LOLBin」）。
     → 只有这条路既写得出、又能双击打开。
   `-make-shortcut` 是一次性工具：创建完就退出，不开窗口、不启动引擎。 */
function makeDesktopShortcut() {
  if (process.platform !== 'win32') return { error: '只在 Windows 上支持' };
  const name = 'RapaceGo';       // 桌面快捷方式名，跟 exe 一致
  /* 落点默认是桌面。★ `RAPACEGO_SHORTCUT_OUT` 可覆盖 —— 自动化测试时指向项目内的
     _trash/：命令沙箱不允许子进程写项目外的目录，那时 writeShortcutLink 会**返回 false**
     （不抛错，所以不看返回值会以为是「成功但没生效」——这个坑记一下）。 */
  const outDir = process.env.RAPACEGO_SHORTCUT_OUT || app.getPath('desktop');
  const link = path.join(outDir, name + '.lnk');
  const ico = path.join(__dirname, 'assets', 'app.ico');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    /* ★ operation 只能用 'create'：实测 Electron 44 下 'replace' **一律返回 false**
       （哪怕目标文件确实存在且可写），所以要做成幂等就先删旧文件再建。 */
    try { fs.unlinkSync(link); } catch (e) { /* 本来就没有，正常 */ }
    /* target 用 process.execPath：
       · 开发模式下它是 electron.exe，得再给一个「应用目录」参数；
       · 打包后它就是「玄清围弈.exe」本身，**不能再给参数**（给了会被当成要打开的文件）。
       这样双击不会像 start.bat 那样闪一下黑框。 */
    const ok = shell.writeShortcutLink(link, 'create', {
      target: process.execPath,
      args: IS_PACKAGED ? '' : '"' + __dirname + '"',
      cwd: IS_PACKAGED ? path.dirname(process.execPath) : __dirname,
      icon: ico,
      iconIndex: 0,
      description: name,
    });
    return ok ? { ok: true, path: link } : { error: '写入失败（返回 false）—— 目标目录可能不可写：' + outDir };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

/* ---------- IPC ---------- */
ipcMain.handle('engine:status', () => {
  const a = statusOf(ENGINES.analyze);
  return Object.assign({
    analyze: statusOf(ENGINES.analyze),
    play:    statusOf(ENGINES.play),
    coach:   statusOf(ENGINES.coach),
  }, a);
});
/* 分析：胜率 / 候选点 / 曲线 —— 走 strong */
ipcMain.handle('engine:analyze', (_e, req) => analyze(ENGINES.analyze, req || {}));
/* 对弈：AI 落子 —— 走 human，req.profile 指定真实段位 */
ipcMain.handle('engine:play', (_e, req) => analyze(ENGINES.play, req || {}));
ipcMain.handle('engine:cancel', () => cancel(ENGINES.analyze));

/* ---------- 棋谱库（软件目录下的 records/，只放 sgf） ----------
   ★ 存放位置选**软件自己的目录**，不去动用户的「我的棋谱」——那是他自己的文件。
   ★ 删除走**系统回收站**（shell.trashItem），不 fs.unlink：万一误删还能捞回来。
   ★ 文件名统一过 safeRecName()：剥掉路径部分、替换非法字符，防止爬到目录外面去。 */
let RECORDS_DIR = path.join(BASE_DIR, 'records');

/* 棋谱库位置可以改（设置面板 / 棋谱库弹窗里都有入口）。
   用「可变常量」而不是每次现算，是为了让其余十几处引用（reviewPath / coachPath /
   records:* 各种 handler）一行都不用动。
   传 dir 就切到 dir（空串 = 回到默认的 程序目录\records）。 */
function refreshRecordsDir(dir) {
  const want = (dir !== undefined ? dir : (PATHS && PATHS.recordsDir) || '').trim();
  RECORDS_DIR = want || path.join(BASE_DIR, 'records');
  try { fs.mkdirSync(RECORDS_DIR, { recursive: true }); } catch (e) { /* 已存在就算了 */ }
}
refreshRecordsDir();

/* 改位置时把已有棋谱**复制**过去（2026-10-05 用户要求）。
   ★ 只复制、不删老文件 —— 宁可让人多删一次，也不能悄悄把棋谱弄丢。
     同名文件一律跳过，绝不覆盖。 */
function migrateRecords(from, to) {
  const out = { copied: 0, skipped: 0, failed: 0 };
  if (!from || from === to) return out;
  try { if (!fs.existsSync(from)) return out; fs.mkdirSync(to, { recursive: true }); }
  catch (e) { out.failed = 1; return out; }
  let names = [];
  try { names = fs.readdirSync(from); } catch (e) { return out; }
  for (const f of names) {
    const src = path.join(from, f), dst = path.join(to, f);
    try {
      if (!fs.statSync(src).isFile()) continue;      // 只搬文件，不动子目录
      if (fs.existsSync(dst)) { out.skipped += 1; continue; }
      fs.copyFileSync(src, dst);
      out.copied += 1;
    } catch (e) { out.failed += 1; }
  }
  return out;
}

function safeRecName(n) {
  const base = path.basename(String(n || ''));
  const cleaned = base.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名.sgf';
  return cleaned.toLowerCase().endsWith('.sgf') ? cleaned : cleaned + '.sgf';
}

/* 复盘结果的存放路径：跟棋谱同名，加 .review.json 后缀。
   复盘一次要几十秒（一盘 200 手更久），结果只留在内存、关掉就没了太浪费 ——
   存下来，下次对这份棋谱点「AI 复盘」就直接显示，不用重算。 */
function reviewPath(name) {
  return path.join(RECORDS_DIR, safeRecName(name) + '.review.json');
}

/* 逐手讲解的存放路径：<棋谱名>.coach.json。
   跟 review 同一个套路 —— 全盘讲一遍要好几分钟，存下来下次打开直接就有。 */
function coachPath(name) {
  return path.join(RECORDS_DIR, safeRecName(name) + '.coach.json');
}

/* 读一份棋谱的「备注名」—— 就存在 SGF 的 GN（棋局名）字段里，文件名不动。
   棋谱文件都很小（几 KB），直接整读；取不到就返回空串。 */
function readNote(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const m = /GN\[([^\]]*)\]/.exec(text);
    return m ? m[1] : '';
  } catch (e) { return ''; }
}

ipcMain.handle('records:list', () => {
  try {
    return fs.readdirSync(RECORDS_DIR)
      .filter(f => f.toLowerCase().endsWith('.sgf'))
      .map(f => {
        const full = path.join(RECORDS_DIR, f);
        const st = fs.statSync(full);
        return { name: f, note: readNote(full), size: st.size, mtime: st.mtimeMs,
                 hasReview: fs.existsSync(full + '.review.json'),
                 hasCoach: fs.existsSync(full + '.coach.json') };
      })
      .sort((a, b) => b.mtime - a.mtime);          // 最近改的排前面
  } catch (e) { return []; }
});

ipcMain.handle('records:read', (_e, name) => {
  try {
    return { ok: true, text: fs.readFileSync(path.join(RECORDS_DIR, safeRecName(name)), 'utf8') };
  } catch (e) { return { error: String((e && e.message) || e) }; }
});

ipcMain.handle('records:save', (_e, name, text) => {
  try {
    const f = safeRecName(name);
    fs.writeFileSync(path.join(RECORDS_DIR, f), String(text), 'utf8');
    return { ok: true, name: f, dir: RECORDS_DIR };
  } catch (e) { return { error: String((e && e.message) || e) }; }
});

ipcMain.handle('records:rename', (_e, oldName, newName) => {
  try {
    const to = safeRecName(newName);
    fs.renameSync(path.join(RECORDS_DIR, safeRecName(oldName)), path.join(RECORDS_DIR, to));
    try {                                       // 复盘结果跟着改名（没复盘过就跳过）
      const ro = reviewPath(oldName), rn = reviewPath(newName);
      if (fs.existsSync(ro)) fs.renameSync(ro, rn);
    } catch (e2) { }
    try {                                       // 逐手讲解也跟着改名（没讲过就跳过）
      const co = coachPath(oldName), cn = coachPath(newName);
      if (fs.existsSync(co)) fs.renameSync(co, cn);
    } catch (e2) { }
    return { ok: true, name: to };
  } catch (e) { return { error: String((e && e.message) || e) }; }
});

ipcMain.handle('records:delete', async (_e, name) => {
  try {
    await shell.trashItem(path.join(RECORDS_DIR, safeRecName(name)));   // 进回收站，可恢复
    try { await shell.trashItem(reviewPath(name)); } catch (e2) { /* 没复盘过就跳过 */ }
    try { await shell.trashItem(coachPath(name)); } catch (e2) { /* 没讲过就跳过 */ }
    return { ok: true };
  } catch (e) { return { error: String((e && e.message) || e) }; }
});

/* 复盘结果（JSON）：存成 <棋谱名>.review.json，读不到就返回 null */
ipcMain.handle('records:saveReview', (_e, name, json) => {
  try { fs.writeFileSync(reviewPath(name), String(json), 'utf8'); return { ok: true }; }
  catch (e) { return { error: String((e && e.message) || e) }; }
});

ipcMain.handle('records:readReview', (_e, name) => {
  try {
    const rp = reviewPath(name);
    return fs.existsSync(rp) ? { text: fs.readFileSync(rp, 'utf8') } : null;
  } catch (e) { return null; }
});

/* 逐手讲解（JSON）：存成 <棋谱名>.coach.json。读不到返回 null。 */
ipcMain.handle('records:saveCoach', (_e, name, json) => {
  try { fs.writeFileSync(coachPath(name), String(json), 'utf8'); return { ok: true }; }
  catch (e) { return { error: String((e && e.message) || e) }; }
});

ipcMain.handle('records:readCoach', (_e, name) => {
  try {
    const cp = coachPath(name);
    return fs.existsSync(cp) ? { text: fs.readFileSync(cp, 'utf8') } : null;
  } catch (e) { return null; }
});

ipcMain.handle('records:dir', () => RECORDS_DIR);
ipcMain.handle('records:openDir', () => { shell.openPath(RECORDS_DIR); return { ok: true }; });

/* 导入棋谱（2026-10-04 用户要求）：从电脑里挑 SGF，复制进棋谱库。
   为什么需要：棋谱库只读 records/ 目录 —— 用户拿到别人的棋谱或下载的古谱，
   以前只能自己手动拷文件夹，等于没有入口。
   三道关：① 得**像 SGF**（有 `(;` 和 `GM[1]`，挡住误选的图片/压缩包）
          ② 文件名走 safeRecName（basename + 非法字符替换，防路径穿越）
          ③ 重名加 (2)(3)… —— **绝不覆盖**已有棋谱。 */
ipcMain.handle('records:import', async () => {
  try {
    const r = await dialog.showOpenDialog(win, {
      title: '导入棋谱',
      filters: [{ name: '围棋棋谱（SGF）', extensions: ['sgf'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (!r || r.canceled || !r.filePaths || !r.filePaths.length) return { canceled: true };

    const imported = [], failed = [];
    for (const src of r.filePaths) {
      const base = path.basename(src);
      try {
        const text = fs.readFileSync(src, 'utf8');
        if (!/\(\s*;/.test(text) || !/\bGM\[1\]/.test(text)) { failed.push(base + '（不像 SGF）'); continue; }
        let name = safeRecName(base);
        if (fs.existsSync(path.join(RECORDS_DIR, name))) {
          const stem = name.replace(/\.sgf$/i, '');
          let i = 2;
          while (fs.existsSync(path.join(RECORDS_DIR, stem + ' (' + i + ').sgf'))) i += 1;
          name = stem + ' (' + i + ').sgf';
        }
        fs.writeFileSync(path.join(RECORDS_DIR, name), text, 'utf8');
        imported.push(name);
      } catch (e) {
        failed.push(base + '（' + ((e && e.message) || e) + '）');
      }
    }
    return { ok: true, imported, failed };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
});

/* 在桌面创建 / 刷新快捷方式（设置面板里的按钮用） */
ipcMain.handle('app:makeShortcut', () => makeDesktopShortcut());

/* ---------- 设置：KataGo 路径与权重（左上角「设置」） ---------- */

/* 是不是一个「存在的文件」（不是目录、不是不存在） */
function fileOk(p) {
  try { return !!p && fs.statSync(p).isFile(); } catch (e) { return false; }
}

function normalizeConfig(c) {
  const d = defaultPaths();
  const pick = v => (typeof v === 'string' && v.trim()) ? v.trim() : null;
  return {
    katago:        pick(c && c.katago)        || d.katago,
    analyzeWeight: pick(c && c.analyzeWeight) || d.analyzeWeight,
    playWeight:    pick(c && c.playWeight)    || d.playWeight,
    coachServer:   pick(c && c.coachServer)   || d.coachServer,
    coachWeight:   pick(c && c.coachWeight)   || d.coachWeight,
    /* 棋谱库位置（2026-10-05 用户要求可改）。★ 允许为空串 ——
       空 = 用默认（程序目录下的 records\），这也是出厂行为。 */
    recordsDir:    (c && typeof c.recordsDir === 'string') ? c.recordsDir.trim() : '',
  };
}

function configInfo(c) {
  return {
    config: c,
    files: {
      katago:        fileOk(c.katago),
      analyzeWeight: fileOk(c.analyzeWeight),
      playWeight:    fileOk(c.playWeight),
      coachServer:   fileOk(c.coachServer),
      coachWeight:   fileOk(c.coachWeight),
    },
    defaults: defaultPaths(),
    recent: normRecent(c && c.recent),      // 前端填进输入框的 datalist
  };
}

/* 在 llama-server.exe 附近找 LoGos 权重（*.gguf）—— 和 guessWeights 一个思路：
   看 exe 所在目录、它上一级、以及两处下面的 models/。优先文件名带 logos 的。 */
function guessCoach(exePath) {
  const dir = path.dirname(exePath);
  const dirs = [dir, path.dirname(dir), path.join(dir, 'models'), path.join(path.dirname(dir), 'models')];
  const found = [];
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(d); } catch (e) { continue; }
    for (const n of names) if (/\.gguf$/i.test(n)) found.push(path.resolve(d, n));
  }
  const uniq = [...new Set(found)];
  if (!uniq.length) return null;
  const logos = uniq.find(p => /logos/i.test(path.basename(p)));
  return { coachWeight: logos || uniq[0] };
}

/* ★ 在 katago.exe 附近找权重：KataGo 官方布局是
     <root>/engine/katago.exe  +  <root>/weights/*.bin.gz
   所以看「exe 所在目录」「它的上一级」以及这两处下面的 weights/。
   找到的一堆 .bin.gz 里：文件名带 human 的 = 对弈权重，其余 = 分析权重。 */
function guessWeights(exePath) {
  const dir = path.dirname(exePath);
  const roots = [dir, path.dirname(dir)];
  const dirs = [];
  for (const r of roots) { dirs.push(r, path.join(r, 'weights')); }
  const found = [];
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(d); } catch (e) { continue; }
    for (const n of names) if (/\.bin\.gz$/i.test(n)) found.push(path.join(d, n));
  }
  const uniq = [...new Set(found)];
  if (!uniq.length) return null;
  const human = uniq.find(p => /human/i.test(path.basename(p)));
  const strong = uniq.find(p => !/human/i.test(path.basename(p)));
  const out = {};
  if (strong) out.analyzeWeight = strong;
  if (human) out.playWeight = human;
  return Object.keys(out).length ? out : null;
}

ipcMain.handle('settings:get', () => configInfo(PATHS));

/* 弹系统文件选择框 —— 只返回选中的路径和检测结果，**不保存**（前端先给用户看一眼） */
ipcMain.handle('settings:choose', async (_e, kind) => {
  const cur = normalizeConfig(PATHS);
  /* ★ 棋谱库那项选的是**文件夹**，其余是选文件 —— 走的是同一个对话框入口。 */
  const isDir = (kind === 'recordsDir');
  const isGguf = (kind === 'coachWeight');
  const isExe = !isGguf && (kind === 'katago' || kind === 'coachServer');
  const title = isDir ? '选择棋谱库文件夹（棋谱、复盘报告、讲解都会放这儿）'
    : isGguf ? '选择 LoGos 讲解权重（.gguf）'
      : kind === 'coachServer' ? '选择 llama-server.exe'
        : isExe ? '选择 katago.exe' : '选择权重文件（.bin.gz）';
  const opt = {
    title,
    defaultPath: isDir ? (cur[kind] || RECORDS_DIR) : path.dirname(cur[kind] || ''),
    properties: [isDir ? 'openDirectory' : 'openFile'],
  };
  if (!isDir) {
    opt.filters = isExe ? [{ name: '可执行文件', extensions: ['exe'] }]
      : isGguf ? [{ name: 'LoGos 权重', extensions: ['gguf'] }]
        : [{ name: 'KataGo 权重', extensions: ['gz'] }];
  }
  const r = await dialog.showOpenDialog(win, opt);
  if (!r || r.canceled || !r.filePaths || !r.filePaths.length) return { canceled: true };
  const picked = r.filePaths[0];
  if (isDir) {
    let writable = false;
    try { fs.mkdirSync(picked, { recursive: true }); fs.accessSync(picked, fs.constants.W_OK); writable = true; }
    catch (e) { /* 下面把 false 报给界面 */ }
    return { path: picked, ok: writable, isDir: true };
  }
  const out = { path: picked, ok: fileOk(picked) };
  if (kind === 'katago') {
    const sug = guessWeights(picked);
    if (sug) out.suggest = sug;      // 前端把这两个路径自动填上，用户少点两次
  }
  if (kind === 'coachServer') {
    const sug = guessCoach(picked);
    if (sug) out.suggest = sug;      // 同理：顺手把 LoGos 权重也填上
  }
  return out;
});

/* 只检测（不保存）—— 前端每次改了路径都调它，刷新「✓ 已找到 / ★ 找不到」 */
ipcMain.handle('settings:check', (_e, c) => {
  const n = normalizeConfig(c);
  /* 棋谱库：空 = 用默认（程序目录\records，算「没问题」）；
     填了就得真的能写 —— 目录不存在会自动建一下。 */
  let recOk = true;
  if (n.recordsDir) {
    try { fs.mkdirSync(n.recordsDir, { recursive: true }); fs.accessSync(n.recordsDir, fs.constants.W_OK); }
    catch (e) { recOk = false; }
  }
  return {
    katago:        fileOk(n.katago),
    analyzeWeight: fileOk(n.analyzeWeight),
    playWeight:    fileOk(n.playWeight),
    coachServer:   fileOk(n.coachServer),
    coachWeight:   fileOk(n.coachWeight),
    recordsDir:    recOk,
  };
});

ipcMain.handle('settings:save', (_e, c) => {
  const n = normalizeConfig(c);
  const label = {
    katago: 'KataGo 程序', analyzeWeight: '分析权重', playWeight: '对弈权重',
    coachServer: 'llama-server 程序', coachWeight: '讲解模型权重',
  };
  /* ★ KataGo 那三件是必需（下棋/分析全靠它）；LoGos 那两件是**可选** ——
     不装就没有讲解功能，别的照常用。所以只有「填了却找不到」才拦一下。 */
  const bad = ['katago', 'analyzeWeight', 'playWeight'].filter(k => !fileOk(n[k]))
    .concat(['coachServer', 'coachWeight'].filter(k => n[k] && !fileOk(n[k])));
  if (bad.length) {
    return { error: '这些文件找不到：' + bad.map(k => label[k]).join('、') + ' —— 重新选一下再保存' };
  }
  /* 把这次的路径记进「最近用过」列表（详见 withRecent 的注释），
     一起写进 settings.json —— 下次打开设置就能从下拉里挑。 */
  const oldRecordsDir = RECORDS_DIR;
  const full = Object.assign({}, n, { recent: withRecent(PATHS.recent, n) });
  const w = writeConfig(full);
  if (w.error) return { error: '写入 settings.json 失败：' + w.error };
  PATHS = full;
  /* ★ 棋谱库位置变了 → 切过去，并把老位置的棋谱**复制**一份过去（老的不删）。 */
  refreshRecordsDir();
  const moved = migrateRecords(oldRecordsDir, RECORDS_DIR);
  restartEngines();                 // 引擎重启是异步的，界面靠 engine:status 事件知道进度
  return { ok: true, config: PATHS, recordsDir: RECORDS_DIR, moved };
});

/* 棋谱库弹窗里的「更改文件夹」—— 和设置面板是**同一个配置项**、同一套逻辑，
   只是入口不同（用户要求两个地方都能改）。 */
ipcMain.handle('records:setDir', (_e, dir) => {
  const want = String(dir || '').trim();
  if (want) {
    try { fs.mkdirSync(want, { recursive: true }); fs.accessSync(want, fs.constants.W_OK); }
    catch (e) { return { error: '这个文件夹用不了：' + ((e && e.message) || e) }; }
  }
  const old = RECORDS_DIR;
  const cfg = Object.assign({}, PATHS, { recordsDir: want });
  const w = writeConfig(cfg);
  if (w.error) return { error: '写入 settings.json 失败：' + w.error };
  PATHS = cfg;
  refreshRecordsDir(want);
  const moved = migrateRecords(old, RECORDS_DIR);
  return { ok: true, dir: RECORDS_DIR, moved, isDefault: !want };
});

/* 写「备注名」：改 SGF 里的 GN 字段（**不动文件名** —— 用户要求文件名照原样显示）。
   SGF 属性值里不能出现 ] 和 \\，先替换掉。没有 GN 就在开头插一个。 */
ipcMain.handle('records:setNote', (_e, name, note) => {
  try {
    const full = path.join(RECORDS_DIR, safeRecName(name));
    let text = fs.readFileSync(full, 'utf8');
    const clean = String(note || '').replace(/[\[\]\\]/g, ' ').trim();
    if (/GN\[[^\]]*\]/.test(text)) text = text.replace(/GN\[[^\]]*\]/, 'GN[' + clean + ']');
    else text = text.replace(/^\(\s*;/, m => m + 'GN[' + clean + ']');
    fs.writeFileSync(full, text, 'utf8');
    return { ok: true, note: clean };
  } catch (e) { return { error: String((e && e.message) || e) }; }
});

app.whenReady().then(() => {
  /* 一次性工具：electron . --make-shortcut → 建好桌面快捷方式就退出（不开窗口、不启动引擎）。
     给「重装 / 换电脑 / 桌面图标丢了」用，平时由设置面板里的按钮触发。 */
  if (process.env.RAPACEGO_MAKE_SHORTCUT === '1') {
    const r = makeDesktopShortcut();
    /* ★ 结果再落盘一份：electron.exe 是 GUI 子系统程序，stdout 在 Windows 上不一定接得到，
       而 app.exit() 会直接丢缓冲区 —— 跑命令行工具时靠这个文件看结果。 */
    try {
      fs.appendFileSync(path.join(__dirname, '_trash', '_shortcut.log'),
        new Date().toISOString() + '  ' + (r.ok ? 'OK ' + r.path : 'FAIL ' + r.error) + '\n');
    } catch (e) { /* 写不了就算了，不影响功能 */ }
    console.log(r.ok ? '[快捷方式] 已创建：' + r.path : '[快捷方式] 失败：' + r.error);
    app.exit(r.ok ? 0 : 1);
    return;
  }
  createWindow();
  /* ★ 2026-10-05 用户要求：**开机不加载任何引擎**。
     打开软件常常只是想摆棋 / 打谱，用不上 KataGo 和 LoGos ——
     一开就吃掉几 GB 显存没道理。改成用户手动点「加载」（顶栏的引擎状态灯那里）。
     界面靠 engine:status 事件得知三个引擎都处于「未加载」。 */
  setStatus();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  shutdown();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', shutdown);
