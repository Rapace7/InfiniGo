/* 渲染进程 ↔ 主进程 的桥（contextIsolation 下唯一通道） */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /* 引擎状态：{ ok, model, ready, error } */
  engineStatus: () => ipcRenderer.invoke('engine:status'),

  /* 当前版本号（如 '0.1.1'）。界面显示在「帮助」面板上 —— 用户靠它判断要不要更新。 */
  appVersion: () => ipcRenderer.invoke('app:version'),

  /* 请求分析（strong 引擎）：{ initialStones, moves, rules, komi, size, maxVisits }
     → Promise<最终报告 | { error }> */
  analyze: req => ipcRenderer.invoke('engine:analyze', req),

  /* 请求 AI 落子（human 引擎）：多一个 profile = 真实段位（如 'rank_3d'）
     → Promise<最终报告 | { error }> */
  playMove: req => ipcRenderer.invoke('engine:play', req),

  /* AI 复盘（整盘逐手）：请求带 analyzeTurns=[0..N]（N = 手数，多算一个末端回合）
     → Promise<{ turns: [...每回合报告] } | { error }>
     进度用 onReviewProgress 订阅 */
  review: req => ipcRenderer.invoke('engine:analyze', req),
  onReviewProgress: cb => ipcRenderer.on('engine:review-progress', (_e, d) => cb(d)),

  /* 取消当前分析（切局面时用） */
  cancel: () => ipcRenderer.invoke('engine:cancel'),

  /* 引擎中途报告（边算边刷） */
  onProgress: cb => ipcRenderer.on('engine:progress', (_e, d) => cb(d)),

  /* 引擎状态变化（就绪 / 出错 / 退出 / 已暂停）
     → { analyze, play, coach } 各含 { state, ready, paused, error, model, pid, kind }
     state: 'off'（未加载）| 'loading' | 'ready' | 'paused' | 'error' */
  onStatus: cb => ipcRenderer.on('engine:status', (_e, d) => cb(d)),

  /* ★ 引擎加载 / 卸载 / 暂停 / 恢复（key = 'analyze' | 'play' | 'coach'）
     2026-10-05 用户要求：引擎**默认不加载**，打开软件不吃显存；
     要用了手动点一下（顶栏的引擎状态灯）。暂停只对 KataGo 有意义，
     LoGos 没有「暂停」（它平时不干活），对应的操作是「中止」。 */
  engine: {
    load:   key => ipcRenderer.invoke('engine:load', key),
    unload: key => ipcRenderer.invoke('engine:unload', key),
    pause:  key => ipcRenderer.invoke('engine:pause', key),
    resume: key => ipcRenderer.invoke('engine:resume', key),
  },

  /* ★ LoGos 讲解（本地 llama-server）
     - prompt 由**渲染进程**拼好（坐标转换/棋盘矩阵/长短要求都在 app.js 里），
       主进程只做「转发 + 掐断」这条管道。
     - explain(req) → Promise<{ text, aborted } | { error }>
       req: { id, prompt, maxTokens, temperature, stop[] }
     - 流式：onProgress 每吐一小段就回调一次 { id, text, full } */
  coach: {
    explain: req => ipcRenderer.invoke('coach:explain', req),
    cancel:  ()  => ipcRenderer.invoke('coach:cancel'),
    onProgress: cb => ipcRenderer.on('coach:progress', (_e, d) => cb(d)),
  },

  /* 在桌面创建 / 刷新快捷方式（设置面板里的按钮用）
     → { ok: true, path } | { error } */
  makeShortcut: () => ipcRenderer.invoke('app:makeShortcut'),

  /* 设置：KataGo 路径与权重（左上角「设置」）
     get    → { config, files:{katago,analyzeWeight,playWeight}, defaults }
     choose → 弹系统文件框，{ path, ok, suggest? } | { canceled:true }（**不保存**）
     check  → { katago, analyzeWeight, playWeight }（只检测）
     save   → 写盘 + 按新路径重启两个引擎 → { ok, config } | { error } */
  settings: {
    get:    ()     => ipcRenderer.invoke('settings:get'),
    choose: kind   => ipcRenderer.invoke('settings:choose', kind),
    check:  c      => ipcRenderer.invoke('settings:check', c),
    save:   c      => ipcRenderer.invoke('settings:save', c),
  },

  /* 棋谱库（软件目录下的 records/，只放 sgf）
     list → [{name, size, mtime}]；read/save/rename/remove → 文件操作；dir → 目录路径 */
  records: {
    list:   ()        => ipcRenderer.invoke('records:list'),
    read:   name      => ipcRenderer.invoke('records:read', name),
    save:   (name, text) => ipcRenderer.invoke('records:save', name, text),
    rename: (a, b)    => ipcRenderer.invoke('records:rename', a, b),
    remove: name      => ipcRenderer.invoke('records:delete', name),
    dir:    ()        => ipcRenderer.invoke('records:dir'),
    openDir: ()       => ipcRenderer.invoke('records:openDir'),
    setDir: dir       => ipcRenderer.invoke('records:setDir', dir),
    /* 导入棋谱：弹系统文件框（可多选）→ 复制进棋谱库
       → { canceled:true } | { ok:true, imported:[文件名], failed:[原因] } | { error } */
    importSgf: ()     => ipcRenderer.invoke('records:import'),
    setNote: (name, note) => ipcRenderer.invoke('records:setNote', name, note),
    saveReview: (name, json) => ipcRenderer.invoke('records:saveReview', name, json),
    readReview: name => ipcRenderer.invoke('records:readReview', name),
    /* ★ 全盘讲解的结果（逐手存下来的一整盘）—— 跟棋谱存在一起，下次打开直接就有 */
    saveCoach: (name, json) => ipcRenderer.invoke('records:saveCoach', name, json),
    readCoach: name => ipcRenderer.invoke('records:readCoach', name),
  },
});
