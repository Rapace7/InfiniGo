/* 对弈学习器 · 棋盘 + 完整对局设置（引擎尚未接入） */

let N = 19;
/*★ **两套坐标字母表，各自独立，绝对不能合并** —— 这是本文件最容易搞错的地方：

   ① `GTP_COLS`（跳 I，A B C D E F G H J K …）：界面显示的坐标、发给引擎的 GTP 坐标。
      围棋传统上跳过 I（I 和 J 形近、也怕和数字 1 混），业界一致。

   ② `SGF_COLS`（**含 i**，a b c d e f g h i j …）：棋谱文件（SGF 格式）的坐标。
      SGF 规范里 a=1 … h=8, **i=9**, j=10 … s=19，**不跳 i**。

   ★ 为什么能确定 SGF 用 i：拿本机 21433 份真实职业棋谱统计过 —— 坐标字母 i 出现
     164101 次（例：`;W[id]` 就是第 9 列），而且第 16 列是 `p` 不是 `q`
     （若跳 i，19 列会排到 q）。两种写法在这些棋谱里都能验出来。
   ★ 曾经踩过的坑：我一度认为"两套表不一致 = bug"，把 SGF 导出也改用 GTP_COLS，
     结果导出的棋谱从第 9 列起全部错位（`[GTP字母+数字]` 这种写法根本不是 SGF）。
     **判断"哪一套对"要看它服务的外部规范，不能只看两套表是否一致。** */
const GTP_COLS = 'ABCDEFGHJKLMNOPQRST';
const SGF_COLS = 'abcdefghijklmnopqrs';
const idx = (x, y) => y * N + x;

const settings = {
  color: 'b',        // 我执：b / w / r(随机)
  size: 19,
  mode: 'play',      // play = 人机对弈（只能下自己那方）；free = 摆棋（两边随便下）
  rules: 'chinese',  // 默认中国规则
  level: 'rank_3d',  // 对手棋力 = KataGo 人类棋风模型的真实段位档位（见 RANKS）
  handicap: 0,
  komi: 7.5,
  clock: 'none',     // 计时档位：none / blitz / rapid / slow / pro / world
  visits: 500,       // 分析搜索量：每个局面让引擎思考多少步（越大越准、越慢）。见 VISIT_OPTS
  /* AI 复盘的搜索量 —— ★ 2026-10-04 用户要求「点 AI 复盘后手动设置，默认 500」：
     刻意**不跟随**底栏的「计算深度」——复盘是整盘逐手算，慢得多，
     值不值得调深应当由用户在点的那一刻决定（会弹面板让他选）。 */
  reviewVisits: 500,
  humanLike: false,  // 拟人落子：按「该段位人类会下哪」的概率抽样，而不是取最优（见 pickAIMove）
};

/* 分析搜索量档位（用户要求可调，并指出「500 和 1600 之间缺得有点多」）。
   ★ 怎么定的：实测（19 路，同一局面重复跑）——
       500 visits → 单次分析约 0.4 秒，首选点与前 4 候选**与 1600 完全一致**（布局、中盘都是）
       1600 visits → 约 0.7 秒；只有**复杂中盘**的首选点会在两三个好点间跳（候选集合仍是同一批）
     所以默认 500，在 500~1600 之间补了 800 / 1200 两档。
   ★ 改档位**立即生效**：maxVisits 是每个分析请求自带的参数，
     改完下一次分析就用新值，**不必重开对局、也不必重启程序**。 */
const VISIT_OPTS = [
  [100, '极快'], [200, '很快'], [300, '快'], [500, '标准'],
  [800, '较深'], [1000, '深'], [1500, '更深'], [2000, '很深'], [3000, '最深'],
];

/* 规则集 —— 贴目默认值与座子按各家规则带出；
   kata 是传给 KataGo 的规则名（2026-10-03 实测确认可用）：
     chinese      AREA 数子 · tax=NONE
     japanese     TERRITORY 数目 · tax=SEKI
     korean       TERRITORY 数目 · tax=SEKI
     ancient-area AREA 数子 · tax=ALL（还棋头）← 明清规则  */
const RULES = {
  chinese:  { label: '中国规则', sgf: 'Chinese',  komi: 7.5, kata: 'chinese',
              seats: false, tax: 'NONE' },
  japanese: { label: '日本规则', sgf: 'Japanese', komi: 6.5, kata: 'japanese',
              seats: false, tax: 'SEKI' },
  korean:   { label: '韩国规则', sgf: 'Korean',   komi: 6.5, kata: 'korean',
              seats: false, tax: 'SEKI' },
  ancient:  { label: '明清规则', sgf: 'Chinese',  komi: 0,   kata: 'ancient-area',
              seats: true,  tax: 'ALL' },
};

/* 座子制（明清规则）：四角星位各一子、**对角同色**。
   古谱白先，摆完座子轮白走。

   ★★ 颜色分配（2026-10-07 规则审查改正，原来**黑白放反了**）：
        **黑子在「右上角 + 左下角」，白子在「左上角 + 右下角」。**
        依据：座子制比赛的通行规则原文 ——
          「开局前预置四枚座子……黑座子放置于右上角和左下角的四四位，白座子依此类推」
        （见 https://www.cczzwq.cn/emlog/?post=11 ；另见维基「座子制」条目）
        原来写成「左上/右下 = 黑」，正好反了 —— 古谱摆出来白黑互换，
        等于这套规则的颜色约定是错的。
   ⚠️ 边界：`mid` 是中央索引（19 路为 9）。星位在 (line,line) 与 (n-1-line,n-1-line) 上，
      所以 (x<mid && y<mid) = 左上、(x>mid && y>mid) = 右下 —— 这两个是**白**。 */
function seatStones(n) {
  const mid = (n - 1) / 2;
  const corners = starPoints(n).filter(([x, y]) => x !== mid && y !== mid);
  return corners.map(([x, y]) => ({
    x, y,
    /* 左上(小,小) 与 右下(大,大) 为白；右上(大,小) 与 左下(小,大) 为黑 */
    color: ((x < mid && y < mid) || (x > mid && y > mid)) ? 'w' : 'b',
  }));
}

const state = {
  moves: [],
  viewAt: 0,
  toMove: 'b',
  /* ★ 这份棋是「打开棋谱」来的（＝打谱）—— 选点讲解对它禁用：
     那是别人的棋，不该替人支招。由 applyRecord 置真、applyNewGame 清掉。 */
  fromRecord: false,
  /* ★ 当前打开的棋谱文件名（含 .sgf）—— 全盘讲解要**存回这份棋谱名下**
     （存成 <棋谱名>.coach.json，见 main.js 的 coachPath）。
     新对局时清空：没有棋谱就没地方存。 */
  recName: '',
  /* 棋谱自带的解说词（SGF 的 C[]，只取主分支）：下标 = 第几手（0 = 开局前）。
     只在「打谱」（state.fromRecord）时有内容；新开局的棋谱没有解说词。 */
  sgfComments: [],
  /* 棋谱根节点的说明文字（题集出处、这是第几图、谁整理的），**不属于任何一手**。
     ★ 为什么单独一个字段：原来它和「第 0 手」共用 comments[0] 这个键，
       而根节点后面通常还跟着 `;B[xx]` 那一手（它的键也是 0）→ 后者把前者覆盖掉，
       于是这段说明整段读不出来（实测抽样 300 份真实棋谱：18 份的根节点说明就是这么丢的，
       而在被 tokenizer 劈错的文件里丢得更彻底）。
     ★ 显示位置：右下角「解说词」框在「（开局前）」那一档里显示它 ——
       不另开一块界面（用户定的：软件不做做题功能，也不必多一张卡）。 */
  rootComment: '',
  /* 这份棋谱里「换了一道题」的位置（手数）。SGF 的题集用 `zz` 分隔，
     抽样 3000 份真实棋谱：2.97% 的文件含它。只有一条的显示提示，两条以上才有意义。 */
  quizTips: [],
  /* ★ 两条讲解的「存法」不一样（2026-10-05 用户定的）：
       · 分析讲解 explain[at] —— **跟手数走**：点评第 at 手，切到哪手就看哪手。
         之前只存最后一次，所以「讲完第 2 手点回第 1 手，框里还挂着第 2 手的内容」。
       · 选点讲解 pick —— **不跟手数走**：它是「此刻该走哪」的一张快照，
         点完就想留着看，切手数不该把它弄没（用户原话：就显示刚才讲解的就行）。
         所以只存一份，并记下它对应第几手 —— 显示时标出来，免得和眼前的局面混淆。
       · busy.x —— 正在生成的那一手（-1 = 空闲），避免刷新时把打字机的内容抹掉。 */
  coach: { explain: {}, pick: null, busy: { explain: -1, pick: -1 },
           /* 全盘讲解进行中时是 { done, total }（否则 null）——
              用来① 挡住重复点击 ② 决定按钮是否可点。见 runBatchCoach。 */
           batch: null },
  /* ★ 未开局（2026-10-04 用户要求）：软件打开时**不直接进对局**，而是停在
     一个「什么都还没定」的中性状态 ——
       · 棋盘点不动（tryPlay 直接挡掉）
       · 胜率条停在中性（五五开、不发分析请求，所以也不跳）
       · 对局信息四项全显示「未定」
       · 棋盘中央一个大胶囊按钮，引导去新建对局
     退出这个状态的只有两条路：点「新对局 → 开始」（applyNewGame），
     或打开一份棋谱（applyRecord，它会切摆棋模式）。 */
  noGame: true,
  showHints: (() => { try { return localStorage.getItem('rapacego.showHints') === 'true'; } catch { return false; } })(), // 首次默认关，之后沿用用户选择
  showCoords: false, // 棋盘边缘显示 A–T / 1–19（默认关）
  soundOn: true,     // 落子音效（默认开）
  clock: { on: false },   // 对局计时（applyNewGame 里按 settings.clock 填充）
  candidates: [],
  candAt: -1,        // 上面这批候选点是「第几手」算出来的（≠ viewAt 时说明还没跟上，画淡一点）
  ownership: null,   // 形势数据：长度 N*N，每点 -1~+1（正=黑倾向/负=白倾向/绝对值=归属强度）
  ownAt: -1,         // 这批 ownership 是第几手的
  showTerritory: false,  // 形势显示总开关（默认关；底栏「形势」，快捷键 X）
  terrStyle: 'fog',      // 形势画法：'fog' 雾（+死子变淡） / 'blocks' 方块
  showNums: false,       // 盘上显示手数（底栏「手数」，快捷键 M）
  rootVisits: 0,         // 最近一次分析的搜索量（「计算中… 320」那个数字）
  /* ★ 每一手那个胜率是「用多少搜索量算出来的」（history 的伴随数组，索引对齐）。
     2026-10-06 晚新增，为了治「手数后面的涨跌数字会自己跳」。
     来龙去脉：引擎每 0.25 秒推一次**中间报告**，每份报告都会写一次 history ——
     于是同一手会被写十几遍，而列表读的是**最后一次**的值（= 搜索量最大的那次）。
     实测（_cdp_jump.mjs，连落 6 手）：同一手被写 4~14 次，首次写入只有 150 访问量、
     末次 515；胜率极差最大到 **8.06%**（27.7% → 19.7% → 32.9%）。
     用户看到的正是「下完显示亏，过会儿点回去看又不亏了」。
     有了它就能判断「新结果是不是比已有的更可信」，见 rememberEval。 */
  histVisits: [],
  showPV: false,         // 变化图：鼠标停在推荐点上满 1 秒 → 显示后续变化（底栏「变化图」，快捷键 B）
  pv: null,              // 当前正在显示的变化：{ x, y, list: ['Q16','D4',...] }；null = 不显示
  setup: [],         // 让子 / 座子
  myColor: 'b',
  /* 双方名字 —— 右侧 ID 栏显示、导出棋谱时写进 SGF 的 PB / PW。
     '' = 没设过 → 按模式回落到 PLAYER / KATAGO / PLAYER1 / PLAYER2。
     打开棋谱时用棋谱里的 PB/PW 填进来，用户也可以点着名字直接改。 */
  names: { b: '', w: '' },
  thinking: false,   // AI 思考中 → 不显示落子预览方块
  koPoint: null,     // 打劫禁着点（简单劫）
  /* 逐手评估数据（走势曲线用）—— **两条都存**，因为曲线有两种纵轴（用户要的切换）：
       history[n] = 第 n 手之后的黑方胜率（0..1）
       leads[n]   = 第 n 手之后的黑方领先目数（正 = 黑优）
     ★ 视角固定成**黑方**：引擎给的原始值是「轮到走棋那一方」的，
       照那个画每落一手曲线就要翻一次，没法看；统一成黑方才能连成一条线。 */
  history: [],
  leads: [],
  histVisits: [],        // 每一手胜率的「精度」伴随数组（见 state.histVisits 的注释）
  curveMode: 'win',  // 走势图纵轴：'win' 黑方胜率 / 'lead' 黑方领先目数
  draft: null,       // 试下（打草稿）：null = 不在试下；否则见 enterDraft()
  result: null,      // 终局结果 { winner, lead, unit, resign, by, terminal }；null = 尚未结束
  lastEval: null,    // 最近一次分析的 { blackWin, lead } —— AI 判断要不要认输要用
  /* AI 复盘结果（整盘逐手重算后填）：
     { losses: [每手目损], stats: {...}, name: 棋谱文件名, at: 手数 }
     null = 当前局面没有复盘数据（手数列表/走势图就不画目损） */
  review: null,
};

let hover = null;    // 鼠标悬停的交叉点 {x, y}
let pvTimer = null;  // 「悬停满 1 秒才显示变化图」的定时器

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

let px = 600, pad = 22, gap = 31;

/* ---------------- 星位与让子 ---------------- */

function starPoints(n) {
  if (n === 9) return [[2, 2], [6, 2], [2, 6], [6, 6], [4, 4]];
  if (n === 13) return [[3, 3], [9, 3], [3, 9], [9, 9], [6, 6]];
  return [[3, 3], [9, 3], [15, 3], [3, 9], [9, 9], [15, 9], [3, 15], [9, 15], [15, 15]];
}

/* 让子位置（2–9 子）。星位按棋盘路数算：
   19 / 13 路星位在第 4 线（索引 3 / n-4），9 路在第 3 线（索引 2 / n-3）—— 原来写死 e-3，
   在 9 路盘上会摆到错误的位置。 */
function handicapStones(n, count) {
  const line = n >= 13 ? 3 : 2;          // 距边的路数（索引）
  const a = line;                        // 近边
  const b = n - 1 - line;                // 远边
  const m = Math.floor(n / 2);           // 边星 / 天元
  const P = {
    ne: [b, a], nw: [a, a],          // 右上、左上
    sw: [a, b], se: [b, b],          // 左下、右下
    mid: [m, m],                     // 天元
    w: [a, m], e: [b, m],            // 左边星、右边星
    n: [m, a], s: [m, b],            // 上边星、下边星
  };
  const map = {
    2: ['ne', 'sw'],
    /* ★ 让 3 子的第三子放**右上（se）**，不是左上（nw）—— 2026-10-07 规则审查改正。
       通行摆法（也见 KataGo 的 `place_free_handicap 3` 输出 `Q16 D4 Q4`）是：
         二子：右下(ne) + 左下(sw)          ← 对角
         三子：再加**右下方的对角那颗的右上角**？不 —— 是加**右下角(se, 即 Q4)**。
       也就是三子占据「左下、右下、右上」三个角，**左上留空**。
       原来写成 'nw'（左上），于是三子局变成了"左上+左下+右下" —— 与通行摆法差一个角。
       （2/4~9 子都是对的，只有 3 子这一档错；实测对照见 dev/_hc_check.mjs。） */
    3: ['ne', 'sw', 'se'],
    4: ['ne', 'sw', 'nw', 'se'],
    5: ['ne', 'sw', 'nw', 'se', 'mid'],
    6: ['ne', 'sw', 'nw', 'se', 'w', 'e'],              // 四角 + 左右边星
    7: ['ne', 'sw', 'nw', 'se', 'w', 'e', 'mid'],
    8: ['ne', 'sw', 'nw', 'se', 'w', 'e', 'n', 's'],    // 四角 + 四边星
    9: ['ne', 'sw', 'nw', 'se', 'w', 'e', 'n', 's', 'mid'],
  };
  return (map[count] || []).map(k => ({ x: P[k][0], y: P[k][1], color: 'b' }));
}

/* ---------------- 绘制 ---------------- */

/* 候选点配色：颜色代表次序（一选最显眼）
   注意：原来的「绿 + 黄」在木色棋盘上几乎分不出来（实测截图里连开发者自己都会认反），
   所以第三个改成偏橙的琥珀色 —— 四色的 R/G/B 分布拉得很开，一眼能分。 */
const HINT_COLORS = [
  { line: '33,113,214',  text: '#0f4f96', name: '蓝' },   // 第一选
  { line: '28,158,102',  text: '#12694a', name: '绿' },   // 第二选
  { line: '225,150,15',  text: '#8a5a00', name: '琥珀' }, // 第三选
  { line: '216,72,60',   text: '#8c2a20', name: '红' },   // 第四选
];

function resize() {
  const wrap = canvas.parentElement;
  const size = Math.max(300, Math.min(wrap.clientWidth, wrap.clientHeight) - 6);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  px = size;
  /* 留白要放得下坐标：开坐标时边距给大一些，否则字母/数字会压到棋盘外 */
  pad = size * (state.showCoords ? 0.056 : 0.037);
  gap = (size - pad * 2) / (N - 1);
  draw();
  renderCurve();     // 曲线 canvas 宽度跟着窗口变
}

const pxOf = (x, y) => [pad + x * gap, pad + y * gap];

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawStone(cx, cy, color, radius) {
  const r = radius || gap * 0.455;
  ctx.save();
  ctx.shadowColor = 'rgba(80,60,20,.28)';
  ctx.shadowBlur = gap * 0.14;
  ctx.shadowOffsetY = gap * 0.05;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 7);
  const sg = ctx.createRadialGradient(cx - r * .35, cy - r * .35, r * .1, cx, cy, r);
  if (color === 'b') { sg.addColorStop(0, '#5a5a58'); sg.addColorStop(1, '#1b1b1a'); }
  else { sg.addColorStop(0, '#ffffff'); sg.addColorStop(1, '#e2e0da'); }
  ctx.fillStyle = sg;
  ctx.fill();
  ctx.restore();
  if (color === 'w') {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
    ctx.strokeStyle = 'rgba(140,135,125,.5)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function draw() {
  const b = boardAt(state.viewAt);
  ctx.clearRect(0, 0, px, px);

  // 棋盘底
  const g = ctx.createLinearGradient(0, 0, px, px);
  /* 2026-10-04：底色由浅米黄 #f2dfba/#e9d3a8 调深为「中深」档（用户拍板）。
     起因见下方形势雾注释：**底色越亮，白雾能推的蓝通道幅度越小**
     （实测白雾色差 浅底 64 → 中深 105）。棋盘线/星位已连带加深，见下。 */
  g.addColorStop(0, '#dfc48f');
  g.addColorStop(1, '#d4b47c');
  ctx.fillStyle = g;
  roundRect(0, 0, px, px, 6);
  ctx.fill();

  // 网格
  /* 网格线随底色加深：旧的 #b08d5b 在中深底上色差只有 76（浅底时是 130），会糊掉；
     #8a6a3a 在同样底色上是 137，比原来还清楚一点。 */
  ctx.strokeStyle = '#8a6a3a';
  ctx.lineWidth = Math.max(0.8, px / 900);
  for (let i = 0; i < N; i++) {
    const p = pad + i * gap;
    ctx.beginPath(); ctx.moveTo(pad, p); ctx.lineTo(px - pad, p); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p, pad); ctx.lineTo(p, px - pad); ctx.stroke();
  }

  // 星位
  ctx.fillStyle = '#8a6a3a';          // 星位，与网格线同色
  for (const [sx, sy] of starPoints(N)) {
    const [cx, cy] = pxOf(sx, sy);
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.5, gap * 0.075), 0, 7); ctx.fill();
  }

  /* 棋盘坐标（可开关）：底边 A–T、���边 1–N 从下往上数。
     ★ 用 GTP_COLS 而不是另写一份字母表 —— 之前这里、toGTP、SGF 导出各有一份，
       三份表一旦改了一处忘了另一处，坐标就会错位（真发生过，见第 4 行注释）。 */
  if (state.showCoords) {
    const cols = GTP_COLS;
    ctx.fillStyle = 'rgba(122,94,58,.74)';
    ctx.font = `${Math.max(9, gap * 0.38).toFixed(1)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < N; i++) {
      ctx.fillText(cols[i], pad + i * gap, px - pad + gap * 0.56);
      ctx.fillText(String(N - i), pad - gap * 0.56, pad + i * gap);
    }
  }

  /* 形势雾（画在棋盘线之上、棋子之下） */
  drawTerritory();

  /* 候选点：虚线圆 + 半透明，颜色代表次序（蓝=一选，绿/琥珀/红依次）
     数字带一位小数，按半径算字号并用 measureText 兜底，保证不越出虚线圆
     ⚠️ 人机对弈时只在「轮到我方」才画 —— 否则你一落子、AI 还没走，
        屏幕上会冒出「对手该怎么下」的点，对你没用、看着还像出错。摆棋模式则一直显示。 */
  /* ★ 只画「跟当前局面匹配」的那一批（candAt === viewAt）。
     过期的候选点（上一个局面算的）**一律不画** —— 它们的位置在当前局面上已经没有意义，
     画出来只会让人困惑。之前这里做的是「淡着显示旧的」当过渡，被用户否掉了：
     「KaTrain 就没有这个，所有选点都是一下就算好的」（2026-10-04）。
     代价是换局面后有一段约 1~2 秒的空白 —— 用下面那句「计算中…」补上反馈。 */
  const hintsFresh = state.candAt === state.viewAt;
  const hintsVisible = state.showHints && hintsFresh
    && (settings.mode !== 'play' || isMyTurn());
  if (hintsVisible && state.candidates.length) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    state.candidates.forEach((c, i) => {
      const [cx, cy] = pxOf(c.x, c.y);
      if (b[idx(c.x, c.y)] !== 0) return;

      const col = HINT_COLORS[Math.min(i, HINT_COLORS.length - 1)];
      const r = gap * 0.44;

      ctx.beginPath();                                   // 极淡底色，帮数字压住木纹
      ctx.arc(cx, cy, r, 0, 7);
      ctx.fillStyle = `rgba(${col.line},0.13)`;
      ctx.fill();

      ctx.setLineDash([gap * 0.11, gap * 0.075]);        // 虚线圆
      ctx.lineWidth = Math.max(1.2, gap * 0.055);
      ctx.strokeStyle = `rgba(${col.line},0.9)`;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
      ctx.setLineDash([]);                               // 用完立刻复位，否则会影响别的描边

      /* 数字必须完整落在虚线圆内：上限取「直径的 72%」（左右各留 14% 余量），
         起始字号也压到半径的 0.74 —— 之前 0.82 / 上限 86% 时，四位数字会顶到虚线上。 */
      let fs = Math.max(8, r * 0.74);
      ctx.font = `bold ${fs.toFixed(1)}px "Microsoft YaHei", sans-serif`;
      while (ctx.measureText(c.label).width > r * 1.44 && fs > 7) {
        fs -= 0.5;
        ctx.font = `bold ${fs.toFixed(1)}px "Microsoft YaHei", sans-serif`;
      }
      ctx.fillStyle = col.text;
      ctx.fillText(c.label, cx, cy + fs * 0.03);
    });
    ctx.globalAlpha = 1;          // 立刻复位，别影响后面画的元素
  }

  /* 「计算中… 320」—— 局面换了、新候选点还没补满时的反馈。
     带上搜索量：一眼看出「在算、而且数字在涨」（KaTrain 的选点圈里也是这个意思）。
     没有它，那段时间容易被当成「推荐点坏了」（这是之前用户报过的现象）。
     放在棋盘最上沿，不挡棋子。仅在「在看最新局面」时显示（回看历史时不必提示）。 */
  if (state.showHints && !hintsFresh && !state.noGame && state.viewAt === state.moves.length
      && (settings.mode !== 'play' || isMyTurn())) {
    ctx.fillStyle = 'rgba(38, 30, 18, .42)';
    ctx.font = `${Math.max(10, gap * 0.40).toFixed(1)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(state.rootVisits > 0 ? ('计算中… ' + state.rootVisits) : '计算中…',
      px / 2, Math.max(2, pad - gap * 0.9));
  }

  /* 变化图（悬停推荐点满 1 秒后显示）—— 判定条件统一放在 pvVisible() 里 */
  if (pvVisible()) drawPV();

  /* 棋子 —— 一律按 boardAt() 的结果画（含让子），不能按手顺画：
     手顺里被提掉的子仍在 moves 中，照手顺画会把死子留在盘上。
     让子/座子也已并入 boardAt（它先摆 setup 再重放手顺），不重复绘制。 */
  /* 手数（可选）：先算出每个交叉点上的子是第几手落的。
     只数到 viewAt（回看时手数跟着回看位置走）；同一位置后下的会覆盖前面的值。 */
  const nums = state.showNums ? (() => {
    const m = new Map();
    for (let k = 0; k < state.viewAt; k++) {
      const mv = state.moves[k];
      if (!mv || mv.pass) continue;
      m.set(idx(mv.x, mv.y), k + 1);
    }
    return m;
  })() : null;

  for (let i = 0; i < N * N; i++) {
    if (b[i] === 0) continue;
    const sx = i % N, sy = (i / N) | 0;
    const [cx, cy] = pxOf(sx, sy);
    ctx.globalAlpha = stoneAlphaAt(sx, sy, b[i]);   // 死子变淡（形势雾）
    drawStone(cx, cy, b[i] === 1 ? 'b' : 'w');
    ctx.globalAlpha = 1;

    /* 盘上手数：**只写小数字，不画圆底**（原来画了个大圆，太抢眼）。
       颜色用**棋盘线的深棕** —— 用户要求「双方一个颜色」，黑白子共用一个色看着统一。
       注：不用棋盘底色的浅棕，那个在白子上几乎看不清（实测色差只有 80；深棕是 140/240）。 */
    if (nums) {
      const n = nums.get(i);
      if (n) {
        const s = String(n);
        const k = s.length >= 3 ? 0.27 : s.length === 2 ? 0.33 : 0.38;
        ctx.fillStyle = '#8a6a3a';
        ctx.font = `${Math.max(7.5, gap * k).toFixed(1)}px "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s, cx, cy + gap * 0.015);
      }
    }
  }

  /* 最后一手标记 —— 野狐风格：棋子**右下角**的直角三角形
     · 直角顶点朝圆心（但**不侵入中心的手数数字** —— 数字高度约 ±0.12gap，所以顶点取 0.13gap）
     · 两个锐角正好落在棋子的**圆周**上（一个在右、一个在下）
     · 斜边朝右下，整个三角形都在棋子内部的右下方
     为什么不画在正中心：那会和手数数字重叠（用户原话「挡住手数了」）。
     几何：直角顶点 A(cx+a, cy+a)，两个锐角 B(cx+e, cy+a) / C(cx+a, cy+e)，
           e = √(R²−a²) 保证 B、C 恰好贴在圆边。 */
  if (state.viewAt > 0) {
    const m = state.moves[state.viewAt - 1];
    const bi = m ? idx(m.x, m.y) : -1;
    if (m && !m.pass && bi >= 0 && b[bi] !== 0) {
      const [cx, cy] = pxOf(m.x, m.y);
      const R = gap * 0.455;                             // 棋子半径（与 drawStone 一致）
      const a = gap * 0.13;                              // 直角顶点到圆心的横/纵距离
      const e = Math.sqrt(Math.max(0, R * R - a * a));   // 锐角在圆周上的另一坐标
      ctx.beginPath();
      ctx.moveTo(cx + a, cy + a);                        // 直角顶点（朝圆心）
      ctx.lineTo(cx + e, cy + a);                        // 锐角①：向右，落在圆边
      ctx.lineTo(cx + a, cy + e);                        // 锐角②：向下，落在圆边
      ctx.closePath();
      ctx.fillStyle = b[bi] === 1 ? '#e8574a' : '#c0392b';
      ctx.fill();
    }
  }

  // 落子预览小方块：悬停空点、轮到我下、且 AI 没在思考时显示
  if (hover && state.viewAt === state.moves.length && !state.thinking &&
      b[idx(hover.x, hover.y)] === 0) {
    const [hx, hy] = pxOf(hover.x, hover.y);
    const side = gap * 0.46, half = side / 2, rr = gap * 0.08;
    const isBlack = state.toMove === 'b';
    ctx.globalAlpha = isBlack ? 0.58 : 0.80;
    ctx.fillStyle = isBlack ? '#1b1b1a' : '#ffffff';
    roundRect(hx - half, hy - half, side, side, rr);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (!isBlack) {
      ctx.strokeStyle = 'rgba(120,115,105,.6)';
      ctx.lineWidth = 1;
      roundRect(hx - half, hy - half, side, side, rr);
      ctx.stroke();
    }
  }
}

/* ---------------- 规则 ---------------- */

function neighbors(x, y) {
  const out = [];
  if (x > 0) out.push([x - 1, y]);
  if (x < N - 1) out.push([x + 1, y]);
  if (y > 0) out.push([x, y - 1]);
  if (y < N - 1) out.push([x, y + 1]);
  return out;
}

function group(b, x, y) {
  const color = b[idx(x, y)];
  const seen = new Set();
  const stack = [[x, y]];
  const stones = [];
  const libs = new Set();
  while (stack.length) {
    const [cx, cy] = stack.pop();
    const k = idx(cx, cy);
    if (seen.has(k)) continue;
    seen.add(k);
    stones.push(k);
    for (const [nx, ny] of neighbors(cx, cy)) {
      const nk = idx(nx, ny);
      if (b[nk] === color) { if (!seen.has(nk)) stack.push([nx, ny]); }
      else if (b[nk] === 0) libs.add(nk);
    }
  }
  return { stones, libs };
}

function boardAt(n) {
  const b = new Int8Array(N * N);
  for (const s of state.setup) b[idx(s.x, s.y)] = s.color === 'b' ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const m = state.moves[i];
    if (m.pass) continue;
    const c = m.color === 'b' ? 1 : 2;
    b[idx(m.x, m.y)] = c;
    for (const [nx, ny] of neighbors(m.x, m.y)) {
      if (b[idx(nx, ny)] === 3 - c) {
        const gp = group(b, nx, ny);
        if (gp.libs.size === 0) gp.stones.forEach(k => { b[k] = 0; });
      }
    }
  }
  return b;
}

/* ---------------- 落子 ---------------- */

function tryPlay(x, y, byAI) {
  /* ★ 还没开局：棋盘点了不该有反应（用户要求：启动后先停在「未开局」，
     得先新建对局或打开棋谱）。AI 不会在这个状态下落子，所以只提示人手点的情况。 */
  if (state.noGame) {
    if (!byAI) flash('还没开局 —— 点棋盘中间的「新建对局」开始');
    return false;
  }
  if (state.viewAt !== state.moves.length) { flash('回看中不能落子，先跳到最新'); return false; }

  /* 人机对弈模式下，只能下自己那一方（AI 自己落子时用 byAI 跳过这个检查）
     试下（打草稿）时不受限制 —— 试下就是要两边都摆一摆 */
  if (!byAI && !state.draft && settings.mode === 'play' && !isMyTurn()) {
    flash('现在轮到' + (sideToMove(state.viewAt) === 'b' ? '黑棋' : '白棋') + '，对手还没下');
    return false;
  }

  const b = boardAt(state.moves.length);
  if (b[idx(x, y)] !== 0) return false;

  // 打劫禁着点
  if (state.koPoint && state.koPoint.x === x && state.koPoint.y === y) {
    flash('打劫：此处暂时不能下，得先在他处走一手');
    return false;
  }

  const c = state.toMove === 'b' ? 1 : 2;
  b[idx(x, y)] = c;

  let captured = 0, capAt = null;
  for (const [nx, ny] of neighbors(x, y)) {
    if (b[idx(nx, ny)] === 3 - c) {
      const gp = group(b, nx, ny);
      if (gp.libs.size === 0) {
        captured += gp.stones.length;
        capAt = { x: nx, y: ny };
        gp.stones.forEach(k => { b[k] = 0; });
      }
    }
  }
  // 提子后自己仍无气 → 自杀，非法
  if (group(b, x, y).libs.size === 0) return false;

  /* ★★★ 打劫（Ko）—— **照抄 KaTrain 的写法**（不是我琢磨的启发式）。
     来源：github.com/sanderland/katrain  `katrain/core/game.py`
       第 156 行：  ko_or_snapback = len(self.last_capture) == 1 and self.last_capture[0] == move
       第 187 行：  if ko_or_snapback and len(self.last_capture) == 1 and not ignore_ko:
                        raise IllegalMoveException("Ko")

     翻译成这里的话 —— 状态只有一个：**上一手（对方那一手）提掉了哪一点**。
       「这一手是不是在上一手单子被提的那一点回提」 AND 「这一手也只提 1 子」 → 判劫
     就这两条，没有别的条件、也不需要预判未来。

     为什么这两条就够了（KaTrain 的设计，我之前绕了四版才看明白）：
       · 真劫：对方提走我一子 → 我在那一点回提、只提 1 子 → 判劫 ✓
       · 倒扑：我回提会一口气提走 ≥2 子 → 第二条不成立 → 放行 ✓
       · "提掉一个本来就只剩 1 气的子"：上一手提的**不是**我要下的这一点
         → 第一条不成立 → 放行 ✓
     我前面四版分别用「提1子+孤子+只剩1气」「把被提子放回去再比」
     「比 boardAt(n)/boardAt(n-1)」「模拟对方回提再比快照」——全都是在**预判未来**，
     而预判要处理提子、要吃透 boardAt 的索引语义，我就栽在那些细节上。
     KaTrain 不预判，只看"上一手干了什么"，所以它不会错。 */
  const prev = state.moves[state.moves.length - 1];        // 上一手（对方那一手）
  const 回提上一手被提的那一点 = !!(prev && !prev.pass && prev.captured === 1
    && prev.capAt && prev.capAt.x === x && prev.capAt.y === y);
  if (回提上一手被提的那一点 && captured === 1) {
    flash('打劫：不能立刻提回，得先在他处走一手');
    return false;
  }
  /* 禁着点（给界面画"此处暂时不能下"）：我这一手提了 1 子 → 那一点就是禁着点。
     （对方在那儿回提会还原局面。他若在那儿下别的、或提多子，规则自然放行。） */
  state.koPoint = (captured === 1 && capAt) ? { x: capAt.x, y: capAt.y } : null;

  state.moves.push({ x, y, color: state.toMove, captured, capAt: capAt || undefined });
  clearCoachAt(state.moves.length);      // 这个手号上的旧讲解作废（悔棋换了别的棋，见函数注释）
  clockSwitch();                         // 结算本手用时，换对方
  state.toMove = state.toMove === 'b' ? 'w' : 'b';
  state.pv = null;                       // 变化图只对当前局面有效，落了子就收掉
  state.viewAt = state.moves.length;
  syncUI();
  /* ★ 落子音效**放在重绘之后**起播（可在「显示」菜单里关掉）。
     为什么不能提前：syncUI 里要把整张盘重画一遍（形势雾是 N×N 逐点画，很吃主线程），
     而短音效只有 0.08~0.09 秒 —— 起播紧接着被主线程占住，开头会被啃掉，
     听感上就是「这一下怎么这么轻」。setTimeout 0 让它排在本帧绘制之后，
     人耳分辨不出这点延迟（见 playStoneSound 的注释②）。 */
  setTimeout(playStoneSound, 0);
  return true;
}

/* ---------- 从手顺反推禁着点（悔棋 / 打开棋谱之后要重算） ----------
   为什么需要它：打劫的禁着点是**由上一手决定的**，而悔棋会换掉上一手 ——
   所以悔棋之后必须重算，不能清成 null（清了就等于放行，用户 2026-10-07 报过）。
   反过来，悔棋**退掉一个"在别处走"的手**之后，劫其实又成立了，禁着点该回来。

   ★★ 判据与 tryPlay **完全一致**（KaTrain 那两条）：
        上一手（对方那一手）只提了 1 子 → 它提的那一点就是禁着点。
      不预判未来、不模拟、不比盘面 —— 只看"上一手干了什么"。 */
function koFromBoard(b, moves) {
  const last = moves[moves.length - 1];
  if (!last || last.pass || last.captured !== 1 || !last.capAt) return null;
  return { x: last.capAt.x, y: last.capAt.y };
}

/* ★ 悔棋之后补上每手的 `capAt`（"这一手提掉了哪一点"）—— 打劫判据要用它。
   为什么需要补：`capAt` 是落子时算出来的，而 `boardAt()` 重放出来的旧棋谱
   （以及悔棋前存下来的手顺）里没有这个字段。没有它，`tryPlay` 里
   "是不是在上一手被提点回提"就永远为假 → 打劫形同失效
   （实测踩到：悔棋后能无视禁着点直接提劫，用户 2026-10-07 报过）。

   算法（最直白，不做任何推理）：
     对每一手，比"这一手走之前"和"走之后"的盘面 —— 在它**四邻**里，
     **之前是敌子、之后变空**的那一格，就是它提掉的那一点。
   ⚠️ 只在需要时调（悔棋后 / 打开棋谱后）。 */
function rebuildCapAt() {
  /* ※ 索引语义要记牢：`boardAt(n)` = **走完第 n 手之后**的盘面
     （`boardAt(0)` = 开局、还没走；`boardAt(1)` = 第 1 手走完）。
     所以对第 i 手（0-based 下标）：走之前 = `boardAt(i)`、走之后 = `boardAt(i + 1)`。
     ⚠️ 我第一版写成了 `boardAt(i)` / `boardAt(i-1)`，整个错开一手 ——
        于是 `capAt` 一个个都算不出来（实测：悔棋后打劫判据形同失效）。 */
  const before0 = () => {                      // 第 0 手"走之前"= setup 的盘面（等价 boardAt(0)）
    const b = new Int8Array(N * N);
    for (const s of state.setup) b[idx(s.x, s.y)] = s.color === 'b' ? 1 : 2;
    return b;
  };
  for (let i = 0; i < state.moves.length; i++) {
    const m = state.moves[i];
    m.capAt = undefined;
    if (m.pass || !m.captured) continue;       // 没提子 → 不可能是劫的那一手
    const prevBoard = (i === 0) ? before0() : boardAt(i);        // 这一手之前
    const after = boardAt(i + 1);                               // 这一手之后
    const me = m.color === 'b' ? 1 : 2;
    for (const [nx, ny] of neighbors(m.x, m.y)) {
      const k = idx(nx, ny);
      if (prevBoard[k] === 3 - me && after[k] === 0) { m.capAt = { x: nx, y: ny }; break; }
    }
  }
}

canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const x = Math.round((mx - pad) / gap);
  const y = Math.round((my - pad) / gap);
  if (x < 0 || x >= N || y < 0 || y >= N) return;
  const [cx, cy] = pxOf(x, y);
  if (Math.hypot(mx - cx, my - cy) > gap * 0.48) return;
  tryPlay(x, y);
});

/* 悬停：吸附到最近的交叉点（只记坐标，是否空点在 draw 里判） */
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  let next = null;

  if (!state.noGame && state.viewAt === state.moves.length && !state.thinking) {
    const x = Math.round((mx - pad) / gap);
    const y = Math.round((my - pad) / gap);
    if (x >= 0 && x < N && y >= 0 && y < N) {
      const [cx, cy] = pxOf(x, y);
      if (Math.hypot(mx - cx, my - cy) <= gap * 0.48) next = { x, y };
    }
  }

  const same = (hover === null && next === null) ||
               (hover && next && hover.x === next.x && hover.y === next.y);
  if (same) return;
  hover = next;
  updatePV();          // 悬停在「推荐点」上满 1 秒 → 显示后续变化（开关见底栏「变化图」）
  draw();
});

canvas.addEventListener('mouseleave', () => {
  clearTimeout(pvTimer); pvTimer = null;
  if (hover || state.pv) { hover = null; state.pv = null; draw(); }
});

/* ---------------- 界面 ---------------- */

const $ = id => document.getElementById(id);

function syncUI() {
  const total = state.moves.length;
  $('slider').max = total;
  $('slider').value = state.viewAt;
  $('counter').textContent = `${state.viewAt} / ${total}`;

  const R = RULES[settings.rules] || RULES.chinese;
  const sizeTxt = N === 19 ? '' : `${N} 路 · `;
  const hcTxt = R.seats ? '座子 · ' : (state.setup.length ? `让 ${state.setup.length} 子 · ` : '');
  const koTxt = `贴目 ${settings.komi}`;

  /* 两个引擎各自的就绪状态 —— 分析引擎挂了胜率不出来，对弈引擎挂了 AI 不落子，
     必须分开提示，否则用户只会看到「AI 不动」而不知道卡在哪。
     ★ 2026-10-05 起引擎**默认不加载**：「没加载」是正常状态，不再说成「启动中」——
       只在真出错、或正在加载时说一句；平时状态由顶栏那两盏灯负责。 */
  const engTxt = engineNote ? '引擎异常'
    : engineReloading ? '引擎重启中…'
      : ((engStates.analyze === 'loading' || (settings.mode === 'play' && engStates.play === 'loading'))
        ? '引擎加载中…' : '');
  const head = state.noGame
    ? '未开局 · 点棋盘中央的「新建对局」开始'
    : total === 0
      ? `${sizeTxt}${hcTxt}${koTxt}`
      : `${sizeTxt}${hcTxt}${state.viewAt === total ? '进行中' : '回看中'} · 第 ${state.viewAt} 手 · 轮${sideToMove(state.viewAt) === 'b' ? '黑' : '白'}走` + quizTxt();
  /* 试下（草稿）期间状态栏必须一直提醒 —— 否则过一会儿就忘了自己在草稿里，
     回头还以为「明明下过怎么会没了」。 */
  const draftTxt = state.draft ? '试下中（草稿 · 不影响正式对局）' : '';
  /* 拟人落子开着时要常驻提示 —— 否则过一会儿就忘了 AI 正在「按人类概率挑手」，
     会觉得它怎么突然变弱、或下了怪手。 */
  const humanTxt = settings.humanLike ? '拟人落子' : '';
  $('status').textContent = [head, engTxt, draftTxt, humanTxt].filter(Boolean).join(' · ');

  /* 讲解框跟着**当前手数**刷新（切手数 / 讲解完成 / 开新局都会走到这里）。
     它自己会挡掉重复调用（同一手不重画），所以放 syncUI 里开销很小。 */
  renderCoachPanels();

  /* ★ 引擎还没就绪（或还没算出第一个局面）→ 胜率条两头不显示「黑 —」「白 —」，
     改一句「AI 准备中」（用户要求）：否则刚启动那几秒看着像"算完了、但两边都是横杠"。
     `lastEval` 有值 = 至少算过一次，就不再回退到这句话。
     ⚠️ 反过来（就绪了 / 又有数据了）也要**照着 lastEval 把数字画回来** ——
        否则「AI 准备中」会一直残留：改这几个文本的只有 applyAnalysis，
        而局面没变时分析是**不会重跑**的（shownAt 已经等于 viewAt）。 */
  if (state.noGame) {
    /* ★ 未开局：胜率条停在中性（五五开、两头都是 0.0 目）。
       之所以「不动」，是因为这个状态下**根本不发分析请求**（见 scheduleAnalysis）——
       不是把数字钉住、等它来覆盖。 */
    $('bar-black').style.width = '50%';
    $('eval-wr').textContent = '黑 50.0%';
    $('eval-wr-w').textContent = '白 50.0%';
    $('eval-lead').textContent = '0.0 目';
    $('eval-lead-w').textContent = '0.0 目';
  } else if (!engineReady || !state.lastEval) {
    /* ★ 用户要求：胜率条上**不再显示「正在加载」**（引擎状态挪到顶栏灯上了）。
       这里换成中性的一句，顺便告诉用户该干什么。 */
    const st = engStates.analyze;
    $('eval-wr').textContent = engineNote ? '引擎异常' : (st === 'loading' ? '加载中…' : '未分析');
    $('eval-wr-w').textContent = '';
    $('eval-lead').textContent = engineNote ? ''
      : (st === 'loading' ? '模型正在读入显存…'
        : (st === 'paused' ? '已暂停（顶栏可恢复）' : '点顶栏的 KataGo 加载'));
    $('eval-lead-w').textContent = '';
  } else {
    const bw = state.lastEval.blackWin, ld = state.lastEval.lead;
    const sg = v => (v < 0 ? '\u2212' : '+') + Math.abs(v).toFixed(1);
    $('bar-black').style.width = (bw * 100).toFixed(1) + '%';
    $('eval-wr').textContent = '黑 ' + (bw * 100).toFixed(1) + '%';
    $('eval-wr-w').textContent = '白 ' + ((1 - bw) * 100).toFixed(1) + '%';
    $('eval-lead').textContent = sg(ld) + ' 目';
    $('eval-lead-w').textContent = sg(-ld) + ' 目';
  }

  /* 试下按钮：常态不填色，处于试下状态才填色 */
  $('btn-draft').classList.toggle('on', !!state.draft);
  $('btn-draft').title = state.draft
    ? '取消试下，回到进入试下之前的局面'
    : '试下：在此处存档，两边随便接着下（不影响正式对局）';

  $('btn-undo').disabled = total === 0;
  $('btn-save').disabled = total === 0;
  $('btn-score').disabled = total === 0;
  $('btn-resign').disabled = total === 0 || !!state.result;
  /* 未开局时「停一手 / 试下」也要置灰 —— 没有对局，这两个动作没有意义
     （disable 之后连快捷键调 .click() 也点不动，不用另加判断）。 */
  $('btn-pass').disabled = state.noGame;
  $('btn-draft').disabled = state.noGame;
  $('sel-terr').disabled = !state.showTerritory;   // 形势关掉时，偏好下拉跟着置灰
  /* 未开局：棋盘中央那个大胶囊按钮（引导新建对局）；
     引擎起不来时，按钮下面再给一条「去设置」的指路 —— 打包给别人时，
     对方第一眼看到的就是这条路（用户要求：不要自动弹窗，给个入口就行）。 */
  $('board-gate').hidden = !state.noGame;
  $('gate-tip').hidden = !(state.noGame && !!engineNote);
  /* ★ 引擎起不来的**具体原因**（2026-10-07 新增）。engineNote 里现在可能是
     main.js 从引擎 stderr 捞出来的原话转写（比如「权重文件太新：它需要更高版本的
     KataGo 引擎…」）—— 那句话比「引擎没起来」有用得多，得让它露出来。 */
  const why = $('gate-why');
  if (why) { why.hidden = !(state.noGame && !!engineNote); why.textContent = engineNote || ''; }

  /* ★ 各开关的勾选状态**统一从 state 画回来**（单一来源）。
     以前只同步了 chk-human，其余全靠 index.html 上的 `checked` 属性 ——
     那样一旦 HTML 和 state 初值不一致，就会出现「开关显示是开的、其实没生效」
     （2026-10-04 改启动默认值时差点踩到）。 */
  $('chk-show').checked = state.showHints;
  $('chk-coords').checked = state.showCoords;
  $('chk-nums').checked = state.showNums;
  $('chk-pv').checked = state.showPV;
  $('chk-sound').checked = state.soundOn;
  $('chk-terr').checked = state.showTerritory;
  $('chk-human').checked = settings.humanLike;     // 拟人落子（在 settings 里，不在 state）

  /* 对局信息 —— 只留 4 项（规则 / 计时 / 让子 / 贴目）。
     ★ 删项的**同时必须删掉这里的赋值**：`$('info-mode').textContent` 这种写法
     在元素不存在时会抛 TypeError，**把整个 syncUI 打断**（界面就再也不更新了）。
     省下的高度自动让给下面的手数栏（它 `flex:1`）。 */
  const short = t => String(t).replace(/（[^）]*）|\([^)]*\)/g, '').trim();

  /* 未开局：四项全写「未定」—— 规则、计时、让子、贴目这会儿都还没定下来 */
  if (state.noGame) {
    for (const id of ['info-rules', 'info-clock', 'info-hc', 'info-komi']) $(id).textContent = '未定';
  } else {
    $('info-rules').textContent = short(R.label);
    $('info-clock').textContent = (CLOCK_PRESETS[settings.clock] || CLOCK_PRESETS.none).label;
    $('info-komi').textContent = String(settings.komi);
    $('info-hc').textContent = R.seats
      ? '座子 4 子'
      : (state.setup.length ? '让 ' + state.setup.length + ' 子' : '不让');
  }

  /* 数子结果随局面变化：悔棋 / 续下之后若不再终局，就收起结果条。
     认输是终局，不动它 —— 认了就是认了。 */
  /* ★ 用「是在第几手时数的」判断，**不要**用 isTerminal()：
     手动数子时局面本来就不是终局，原写法（!isTerminal() 就清）会把结果**当场清掉** ——
     用户看到的就是「点了数子按钮什么都没发生」（2026-10-04 实测报过）。
     改成「局面变过才收起」：
       · 终局数子 → 悔棋 / 续下 → at ≠ viewAt → 收起 ✓
       · 手动数子 → 局面没动 → 留着 ✓；一旦落子 → at ≠ viewAt → 收起 ✓
     认输是终局，不动它 —— 认了就是认了。 */
  if (state.result && !state.result.resign && state.result.at !== state.viewAt) state.result = null;
  renderVerdict();

  draw();

  /* AI 该下就先让 AI 下（两个查询会互相打断，所以二选一）；否则刷新显示分析 */
  renderCurve();
  renderMoveList();
  renderCommentBox();    // 右下角「解说词」框跟着当前手数走（棋谱自带的那种）
  renderClocks();        // 名字（PLAYER / KATAGO / PLAYER1 / PLAYER2）随模式变

  /* ★ 人机对弈：AI 该下就让它下；**同时也发一次分析** ——
     分析走 strong 引擎、AI 落子走 human 引擎，是两个独立进程，互不干扰。
     为什么必须同时发：用户落子后轮到 AI，若只跑 AI 不分析，用户刚下那一手的局面
     就永远没被评估过 → 手数列表里那一手没有「涨跌」（用户报过的现象）。
     ⚠️ 以前这里是 `if / else` 二选一，理由写着「两个查询会互相打断」——
        那是**单引擎时代**的限制，2026-10-03 拆成双引擎后已经不成立了。 */
  if (needAIMove()) scheduleAIMove();
  scheduleAnalysis();

  /* 双方都停一手 → 自动判终局（约 4~5 秒出结果）
     试下中不判：草稿里的 pass 不算终局 */
  if (!state.draft && isTerminal() && !state.result) scheduleScore();
}

let flashTimer = null;
function flash(msg) {
  const el = $('status');
  el.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(syncUI, 1800);
}

function gotoView(n) {
  state.viewAt = Math.max(0, Math.min(state.moves.length, n));
  clockTouch();          // 跳转后本手重新计时，免得把翻谱的时间算进去
  syncUI();
}

$('btn-first').onclick = () => gotoView(0);
$('btn-prev').onclick = () => gotoView(state.viewAt - 1);
$('btn-next').onclick = () => gotoView(state.viewAt + 1);
$('btn-last').onclick = () => gotoView(state.moves.length);
$('slider').oninput = e => gotoView(+e.target.value);

/* ---------------- 试下（打草稿） ----------------
   点「试下」= 在此处存档暂停，两边随便接着下（像打草稿）；
   再点一下 = 取消试下，**完整**回到点之前的状态。

   实现：进入时给整个局面拍一张快照，试下期间就在真实数据上随便下
   （相当于临时切成摆棋），退出时用快照整体盖回来。
   —— 用整体覆盖而不是逐项回滚：逐项回滚最容易漏字段（history / 打劫点 / 计时…），
      漏一个就会留下「回不去」的残迹。
   试下期间：AI 不自动落子、计时暂停、胜率曲线与导出的棋谱都不受影响。 */

function enterDraft() {
  if (state.draft) return;
  if (state.viewAt !== state.moves.length) { flash('回看中不能试下，先跳到最新一手'); return; }

  state.draft = {
    from: state.moves.length,
    snap: {
      moves: state.moves.slice(),
      viewAt: state.viewAt,
      toMove: state.toMove,
      koPoint: state.koPoint,
      candidates: state.candidates.slice(),
      candAt: state.candAt,
      history: state.history.slice(),
      histVisits: state.histVisits.slice(),
      result: state.result,
      lastEval: state.lastEval,
      clock: JSON.parse(JSON.stringify(state.clock)),   // 全是数字/布尔，可深拷贝
    },
  };
  state.clock.paused = true;      // 「存档暂停」—— 试下期间不走表
  syncUI();
  flash('已进入试下 · 两边都能下，不影响正式对局');
}

function exitDraft() {
  if (!state.draft) return;
  const s = state.draft.snap;
  state.moves = s.moves;
  state.viewAt = s.viewAt;
  state.toMove = s.toMove;
  state.koPoint = s.koPoint;
  state.candidates = s.candidates;
  state.candAt = s.candAt;
  state.history = s.history;
  state.histVisits = s.histVisits || [];
  resetAnalysisState();                  // history 被整体换回来了 → 欠账与上屏标记一起作废重来
  Object.assign(state.clock, s.clock);   // 保持同一个 clock 对象（renderClocks 一直指着它）
  state.result = s.result;
  state.lastEval = s.lastEval;
  state.draft = null;
  syncUI();
  flash('已退出试下 · 回到原局面');
}

function toggleDraft() { state.draft ? exitDraft() : enterDraft(); }

/* ---------------- 终局判定 / 数子 ---------------- */

/* 单位：中日韩「数目」→ 目；中国 / 明清「数子」→ 子。
   实测确认（9 路、双方都停一手）：
     中国（贴 7.5）scoreLead = -7.3   理论 -7.5
     日本（贴 6.5）scoreLead = -6.4   理论 -6.5
     明清（不贴目）scoreLead = +0.5   理论 0
   → KataGo 已经按各自规则算好了，**还棋头是它内置的**，我们直接用差值即可。
   精度：2000 visits 时误差约 ±0.2 子（200 visits 差到 0.4，所以终局查询用 2000）。 */
const SCORE_UNIT = { chinese: '子', ancient: '子', japanese: '目', korean: '目' };

/* 最后两手都是 pass = 双方都停手 = 终局 */
function isTerminal() {
  const n = state.moves.length;
  if (n < 2) return false;
  return !!(state.moves[n - 1].pass && state.moves[n - 2].pass);
}

let scoreBusy = false;
let scoreTimer = null;

function scheduleScore(delay) {
  clearTimeout(scoreTimer);
  scoreTimer = setTimeout(() => runScore(true), delay === undefined ? 700 : delay);
}

async function runScore(silent) {
  /* ★ 正在数子时又点了一次 → **排队等前一次跑完**，而不是静默忽略。
     （被忽略的表现是「点了没反应」，用户会以为按钮坏了。实测踩过一次。） */
  let waited = 0;
  while (scoreBusy && waited < 60000) { await new Promise(r => setTimeout(r, 200)); waited += 200; }
  if (!engineReady) {
    if (!silent) needEngine('analyze', '数子');   // 没加载 → 提示 + 把「加载」菜单弹出来
    return;
  }
  if (!state.moves.length) { if (!silent) flash('还没落子，没什么可数的'); return; }

  scoreBusy = true;
  const gen = gameGen;                       // ★ 这次数子属于哪一局
  /* ★★ 把「数的是第几手」**在这一刻定下来**（2026-10-06 审查发现）。
     请求用的是 `state.viewAt`、而结果里的 `at` 原来读的是 **await 之后**的 viewAt ——
     如果用户在等引擎的那一两秒里翻看了别的局面（滑块 / 点手数列表），
     结果就会被记到**错误的那一手**上；而且因为 `at === viewAt`，
     「局面变过就收起结果条」那条清理也不会触发，于是错的结果一直挂着。
     典型触发：点数子 → 等的时候顺手拖滑块 → 结果条上的结论其实属于另一手。 */
  const at0 = state.viewAt;
  const btn = $('btn-score');
  const oldTxt = btn.textContent;
  btn.disabled = true;
  if (!silent) btn.textContent = '数子中…';

  try {
    /* ★ 关键：必须让引擎看到「连续两个 pass」，它才会走**终局结算**而不是形势评估。
       实测踩过：空盘 + 两个 pass 引擎给 -0.9，而理论终局值是 -7.5 ——
       因为它看到还有 81 个空点可下，认为这局还没结束。 */
    window.api.cancel();                       // 终局查询优先，掐掉正在跑的分析
    const ms = state.moves.slice(0, at0)      // ★ 用定下来的 at0，不用当前的 viewAt
      .map(m => [m.color === 'b' ? 'B' : 'W', m.pass ? 'pass' : toGTP(m.x, m.y)]);
    /* ★ 必须让引擎看到「**连续两个** pass」，它才会走终局结算。只补一手是不够的 ——
       那样最后两手是「一手棋 + 一个 pass」：既不算终局，**又等于那一方白白放弃一手**，
       结果会严重偏向对方（实测：8 手均势局面数出「白胜 21.2 子」）。
       正确做法：轮谁走、谁先 pass，然后对方也 pass —— 补两手。 */
    const turn = sideToMove(state.viewAt);
    if (!ms.length || ms[ms.length - 1][1] !== 'pass') {
      ms.push([turn === 'b' ? 'B' : 'W', 'pass']);
      ms.push([turn === 'b' ? 'W' : 'B', 'pass']);
    } else {
      // 最后一手已经是 pass（真终局局面）→ 只差对方这一手
      ms.push([turn === 'b' ? 'B' : 'W', 'pass']);
    }

    const res = await window.api.analyze({
      initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
      moves: ms,
      rules: (RULES[settings.rules] || RULES.chinese).kata,
      komi: settings.komi,
      size: N,
      maxVisits: 2000,
    });

    /* ★ 换了局（新对局 / 打开棋谱）→ 这次数子作废：
       否则刚开的新盘上会冒出上一局的胜负结果（用户重开一局时能实际看到）。 */
    if (gen !== gameGen) return;

    if (!res || res.error || !res.root) {
      if (!silent) flash('数子失败：' + ((res && res.error) || '引擎无响应'));
      return;
    }

    /* 视角：scoreLead 是「轮到走棋那一方」的（engine.cfg 里 SIDETOMOVE），换算成黑方 */
    const cp = String(res.root.currentPlayer || '').toUpperCase();
    const side = cp === 'B' ? 'b' : cp === 'W' ? 'w' : 'b';
    const raw = res.root.scoreLead;
    const blackLead = side === 'b' ? raw : -raw;

    state.result = {
      winner: blackLead > 0 ? 'b' : 'w',
      lead: Math.abs(blackLead),
      unit: SCORE_UNIT[settings.rules] || '子',
      resign: false,
      by: 'score',
      terminal: isTerminal(),
      /* ★ 记下「是在第几手时数的」：手动数子（局面非终局）时局面没变，结果应当留着；
         一旦落子/悔棋导致 viewAt 变化就自动收起（见 syncUI 里那句清理）。
         ⚠️ 用**发起时**定下来的 at0，不用当前的 viewAt —— 等引擎的那一两秒里
         用户可能拖了滑块，那样结果会被记到错误的手上（2026-10-06 审查发现）。 */
      at: at0,
    };
    syncUI();
  } finally {
    scoreBusy = false;
    /* ★ 数子期间被压住的分析，这里补一次（否则要等下次落子才更新）；
       而且数子前调过 window.api.cancel()，当前局面的分析被掐掉过 → 用 force 重算。 */
    scheduleAnalysis(0, true);
    btn.disabled = false;
    btn.textContent = oldTxt;
  }
}

/* 认输：loser = 认输方，by = 'user' | 'ai' */
function doResign(loser, by) {
  if (state.result || !state.moves.length) return;
  state.result = {
    winner: loser === 'b' ? 'w' : 'b',
    lead: null,
    unit: SCORE_UNIT[settings.rules] || '子',
    resign: true,
    by: by || 'user',
    terminal: true,
  };
}

/* AI 认输：落后太多就投子（围棋惯例），免得用户单方面屠龙、局面僵在那里 */
function aiWantsResign() {
  const e = state.lastEval;
  if (!e) return false;
  const aiSide = state.myColor === 'b' ? 'w' : 'b';
  const aiWin = aiSide === 'b' ? e.blackWin : 1 - e.blackWin;
  const aiLead = aiSide === 'b' ? e.lead : -e.lead;
  return state.moves.length >= 30 && aiWin < 0.03 && aiLead < -20;
}

function renderVerdict() {
  const box = $('verdict');
  const r = state.result;
  if (!r) { box.hidden = true; return; }
  /* ★ 用户手动按过叉 → 尊重它，别再自己冒出来（2026-10-06 审查发现）。
     新的一次数子 / 认输会整个替换 state.result，那时没有 dismissed 标记，照常显示。 */
  if (r.dismissed) { box.hidden = true; return; }

  const sideTxt = r.winner === 'b' ? '黑方' : '白方';
  let main, sub = [];
  if (r.resign) {
    /* ★ 超时要单独一条文案（2026-10-04 加超时判负时发现的）：
       超时也走 doResign（resign: true），如果只按「谁认输」渲染，
       结果条会写成「KATAGO 认输」—— 双人对弈时更是完全说不通。 */
    if (r.by === 'timeout') {
      main = sideTxt + '胜';
      sub.push((r.winner === 'b' ? '白方' : '黑方') + '超时判负');
    } else {
      main = r.by === 'user' ? '你认输' : 'KATAGO 认输';
      sub.push('本局结束');
    }
  } else {
    main = sideTxt + '胜';
    sub.push(r.lead.toFixed(1) + ' ' + r.unit);
    if (!r.terminal) sub.push('当前局面 · 非终局');
  }
  $('verdict-text').innerHTML = '<b>' + main + '</b>'
    + (sub.length ? ' <span class="vsub">' + sub.join(' · ') + '</span>' : '');
  box.hidden = false;
}

$('btn-score').onclick = () => { state.result = null; renderVerdict(); runScore(false); };
$('btn-resign').onclick = () => {
  if (state.result || !state.moves.length) return;
  doResign(state.myColor, 'user');
  flash('已认输 · ' + (state.myColor === 'b' ? '白' : '黑') + '方胜');
  syncUI();
};
$('verdict-close').onclick = () => {
  /* ★ 记下「用户手动关掉了」（2026-10-06 审查发现）：原来只把 box.hidden 设成 true，
     而下一次 syncUI → renderVerdict 又会 `box.hidden = false` 把它显示回来 ——
     表现为「点了叉，过一会儿结果条自己又冒出来」。
     记在 state.result 上（新的一次数子/认输会整个替换掉它，所以下次有结果照样会显示）。 */
  if (state.result) state.result.dismissed = true;
  $('verdict').hidden = true;
};

$('btn-draft').onclick = toggleDraft;

$('btn-undo').onclick = () => {
  /* ★ 正在回看历史手时不许悔棋（2026-10-06 审查发现）。
     落子 / 停一手 / 试下都有这条约定（「回看中不能落子，先跳到最新」），**只有悔棋漏了** ——
     于是「看着第 50 手点悔棋」撤掉的是**最后一手**、画面还跳到 99 手，
     用户会以为软件撤错了手（他心里的"这一手"就是眼前看着的那一手）。 */
  if (state.viewAt !== state.moves.length) { flash('回看中不能悔棋，先跳到最新'); return; }
  if (!state.moves.length) return;
  /* 试下时不能退过存档点 —— 那等于把草稿起点也吃掉，退出试下后就亏了 */
  const floor = state.draft ? state.draft.from : 0;
  if (state.moves.length <= floor) {
    if (state.draft) flash('已经退到试下的起点了');
    return;
  }
  state.moves.pop();
  /* 人机对弈模式：撤到「又轮到自己」为止 —— 否则 AI 会立刻把这一手补回来，看着像没撤。
     试下时不做这个联动：草稿里你想退几手就退几手。 */
  if (!state.draft) {
    while (settings.mode === 'play' && state.moves.length &&
           sideToMove(state.moves.length) !== state.myColor) {
      state.moves.pop();
    }
  }
  state.toMove = sideToMove(state.moves.length);
  /* ★★ 禁着点必须**重新算出来**，不能清成 null（2026-10-07 用户报的真 bug）。
     原来这里写的是 `state.koPoint = null;`，注释说「局面变了，打劫禁着点随之失效」——
     那句话只对了一半：**退掉了提劫那一手**时它确实该失效，但**退到"刚提完劫"那个局面**时
     它必须重新成立。清成 null 的后果就是用户报的：
       白提劫 → 我禁着 → 我在别处走一手 → 白在别处走 → 我悔棋回到"白提完劫"
       → 这时我居然能**直接提回去**（违反禁着点）。
     复现证据见 dev\_cdp_ko_user.mjs（用用户自己那份 GN[打劫BUG] 棋谱走的整条链）。
     ★ 同一处还有个反向错：悔棋**退掉一个"在别处走"的手**之后，劫其实又成立了
       （禁着点该回来），而原来是一律清 null —— 两个方向都错。 */
  state.koPoint = koFromBoard(boardAt(state.moves.length), state.moves);
  /* ★ 顺手补上每手的 `capAt`（"这一手提掉了哪一点"）——
     打劫判据要靠它判断"这一手是不是在上一手被提的那点回提"。
     悔棋之后手顺被截断，重算一遍最省心（只在悔棋时做，开销可忽略）。 */
  rebuildCapAt();
  state.pv = null;               // 变化图基于当前候选点，局面变了就失效
  state.viewAt = state.moves.length;
  /* ★ 局面变短了 → 必须截断分析队列与走势数据（truncateAnalysisTo 的注释里有实测数据）。
     漏了这一步会导致「悔棋后分析彻底停住」，用户 2026-10-06 报过。 */
  truncateAnalysisTo(state.moves.length);
  syncUI();
  /* syncUI 里会 scheduleAnalysis()，它按新的 viewAt 重新入队 —— 但**当前局面这一项
     若 history 里已经有值就不会入队**（scheduleAnalysis 的去重条件），
     而悔棋后的局面恰恰是「算过但画面要重画」的。所以这里显式强制重算当前局面。 */
  scheduleAnalysis(0, true);
};

$('btn-pass').onclick = () => {
  if (state.viewAt !== state.moves.length) { flash('回看中不能落子，先跳到最新'); return; }
  state.moves.push({ pass: true, color: state.toMove });
  clearCoachAt(state.moves.length);      // 该手号上的旧讲解作废
  state.toMove = state.toMove === 'b' ? 'w' : 'b';
  state.koPoint = null;          // 脱先一手，劫自然消解
  state.viewAt = state.moves.length;
  syncUI();
};

/* 这个开关只管「棋盘上画不画推荐点」——右侧胜率是客观数据，始终显示。
   ★ 全软件只有**这一个**开关（「显示」菜单里，快捷键 T）。
     2026-10-07：外部 PR 曾在「推荐落点讲解」卡片里也加过一个同名开关，用户要求删掉 ——
     **两处重复只会让人搞不清该信哪个**，而且两个控件必须时刻同步、很容易漏。
     顺手加了 localStorage 记住选择（原来是启动默认关，每次都得重开）。 */
function setHintsVisible(visible) {
  state.showHints = !!visible;
  $('chk-show').checked = state.showHints;
  try { localStorage.setItem('rapacego.showHints', String(state.showHints)); } catch { /* 记不住也能用 */ }
  draw();
}
$('chk-show').onchange = e => setHintsVisible(e.target.checked);

$('chk-coords').onchange = e => {
  state.showCoords = e.target.checked;
  resize();          // 边距要跟着变（留白要放得下坐标）
};

$('chk-sound').onchange = e => {
  state.soundOn = e.target.checked;
  if (state.soundOn) playStoneSound();   // 打开时给个反馈，方便试听
};

/* 形势显示：总开关 + 画法偏好（雾 / 方块）。位置在底栏「音效」旁边。 */
$('chk-terr').onchange = e => {
  state.showTerritory = e.target.checked;
  if (!state.showTerritory) { state.ownership = null; state.ownAt = -1; }   // 关掉就清，别留残影
  syncUI();
  /* ★ 这个开关决定要不要向引擎要 ownership 数据（includeOwnership）→ 当前局面必须
     强制重算一遍，否则打开开关后要等到下一手才有雾（syncUI 那次不会重算已上屏的局面）。 */
  scheduleAnalysis(0, true);
};
$('sel-terr').onchange = e => { state.terrStyle = e.target.value; draw(); };

/* 拟人落子 —— 官方配方「How to get stronger human-style play」。
   不开：从候选里取首选（强，但不像人；而且如官方所说「搜索量给多了会比标称段位强」）。
   开了：按人类概率抽样，明显要崩的手会被压下去（见 pickAIMove / pickByHumanPolicy）。 */
$('chk-human').onchange = e => {
  settings.humanLike = e.target.checked;
  flash(settings.humanLike ? '拟人落子：开 · 按该段位人类的概率挑手' : '拟人落子：关 · 取最优手');
  syncUI();
};

/* 盘上显示手数（快捷键 M）—— 复盘时看「这是第几手」 */
$('chk-nums').onchange = e => { state.showNums = e.target.checked; draw(); };

/* 变化图（快捷键 B）：鼠标停在推荐点上约 1 秒 → 显示这一手之后的预计变化 */
$('chk-pv').onchange = e => {
  state.showPV = e.target.checked;
  if (!state.showPV) { clearTimeout(pvTimer); pvTimer = null; state.pv = null; }
  draw();
};

/* ---------------- 底栏「显示」下拉（2026-10-04 用户选的方案 A） ----------------
   原来 6 个开关 + 形势画法下拉平铺在底栏，1240 宽的窗口下把底栏挤成三行
   （第三行只剩「认输 / 导出棋谱」，右边一大片空）。收进这个菜单后底栏回到一行。
   ★ 只是搬了个位置：里面 chk-xxx / sel-terr 的 id 全没变 —— 所以上面那些 onchange
     绑定、快捷键 T/Z/M/B/Y/X、以及 syncUI 的「开关状态统一从 state 画」统统不用改。 */
const DISP_MENU = $('disp-menu');
const closeDispMenu = () => { DISP_MENU.hidden = true; };

$('btn-disp').onclick = e => {
  e.stopPropagation();          // 别让下面那个「点外面关闭」在同一趟点击里立刻把它关掉
  DISP_MENU.hidden = !DISP_MENU.hidden;
};
/* 点菜单外面 / 按 Esc → 收起。
   （在菜单里点开关**不**收 —— 想连着开好几个是最常见的用法。） */
document.addEventListener('click', e => {
  if (!DISP_MENU.hidden && !$('disp').contains(e.target)) closeDispMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !DISP_MENU.hidden) closeDispMenu();
});

function buildSGF() {
  const R = RULES[settings.rules] || RULES.chinese;
  /* ★ 双方名字写进 PB / PW —— 别的棋谱软件（以及本软件自己再打开时）就能看到
     谁执黑谁执白，不用再靠 PLAYER / KATAGO 猜。
     SGF 属性值里不能出现 ] 和 \，先剔掉；太长也截一下。 */
  const sgfn = v => String(v || '').replace(/[\[\]\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
  let s = `(;GM[1]FF[4]SZ[${N}]CA[UTF-8]AP[RapaceGo:0.3]KM[${settings.komi}]RU[${R.sgf}]`
    + `PB[${sgfn(clockName('b'))}]PW[${sgfn(clockName('w'))}]`;
  if (R.seats) s += 'GC[明清规则：座子制 · 还棋头]';
  if (R.seats || settings.handicap) {
    const bs = state.setup.filter(p => p.color === 'b').map(p => `[${SGF_COLS[p.x]}${SGF_COLS[p.y]}]`).join('');
    const ws = state.setup.filter(p => p.color === 'w').map(p => `[${SGF_COLS[p.x]}${SGF_COLS[p.y]}]`).join('');
    if (!R.seats) s += `HA[${settings.handicap}]`;   // 座子不是让子，不写 HA
    if (bs) s += `AB${bs}`;
    if (ws) s += `AW${ws}`;
  }
  /* 试下（草稿）里的手**不写进棋谱** —— 那是草稿，不是这一局 */
  const upto = state.draft ? state.draft.from : state.moves.length;
  /* 终局结果写进 RE[] —— 棋谱软件（围棋APP、CGoban 等）能直接读到胜负 */
  const r = state.result;
  if (r) {
    s += 'RE[' + (r.winner === 'b' ? 'B+' : 'W+')
      + (r.resign ? 'Resign' : r.lead.toFixed(1)) + ']';
    s += 'C[' + (r.resign
      ? (r.by === 'user' ? '认输' : 'AI 认输')
      : (r.winner === 'b' ? '黑方胜' : '白方胜') + r.lead.toFixed(1) + r.unit) + ']';
  }
  for (const m of state.moves.slice(0, upto)) {
    s += ';' + (m.color === 'b' ? 'B' : 'W') + (m.pass ? '[]' : `[${SGF_COLS[m.x]}${SGF_COLS[m.y]}]`);
  }
  return s + ')';
}

/* ---------------- 棋谱库（打开 / 存进来 / 备注 / 删除） ----------------
   位置：软件目录下的 records/（见 main.js 的 RECORDS_DIR）。
   为什么不放用户的「我的棋谱」：那是他自己的目录，不该由软件往里写。
   删除一律走系统回收站（主进程里的 shell.trashItem），误删能捞回来。 */

/* 解析 SGF —— **只取主分支**。
   · 坐标：标准 SGF 是两个字母（如 pd），第一个是列、第二个是行，**行从最上面开始数** ——
     正好和我们的内部坐标 (x=列, y=行, y=0 在最上) 一一对应，不用做任何转换。
   · 变体：SGF 里第一个 '(' 是根节点，**之后再出现的 '(' 都是变体** → 到那里就截断。
   · 认得出：SZ / KM / RU / AB / AW / ;B[xx] / ;W[xx] / 空 [] = 停一手。 */
function parseSGF(text) {
  const s = String(text || '');

  /* ---------- 1) 切成 token：括号 / 节点 ----------
     ★ 一个节点里可以有多组「标识 + 若干值」，例如 `;AB[pd]AW[dd]C[注释]`
       —— 所以不能只挑 `;[BW][..]`，得把每组标识+值都正经读出来。
     ★ 属性值里的 `\]` 是 SGF 的转义，要当普通字符，否则值里带方括号就把 token 切歪。
     ★ 2026-10-06：改成**按节点分组**（`{ props, at, end }`）并记下每个节点在**原文里的位置** ——
       props 分组是为了正确取出「这一手的 C[] 解说词」（同一节点里 C 写在 B 前还是后都不影响）；
       at/end 是为了以后「在软件里改解说词 → 只替换原棋谱里那一个 C[]」时能精确落刀。 */
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '(' || c === ')') { toks.push(c); i++; continue; }
    if (c !== ';') { i++; continue; }
    const at = i;                                      // 节点起点（';' 的位置）
    i++;
    const props = [];
    for (;;) {
      /* ★★ 2026-10-06 修正（用户报「棋谱说明（根节点那段）读不出来」）。
         原写法是：
               while (i < s.length && /\s/.test(s[i])) i++;   // 跳过标识前的空白
               let id = '';
               while (/[A-Za-z]/.test(s[i])) { id += s[i]; i++; }
               if (!id) break;                                // ← 这里就错了
         `/\s/` 把**换行**也算进去，而 SGF 的属性值允许跨行 ——
         真实棋谱大量这么写（题集的摆子几十个点分两三行、解说词本身也是多行）：
               AB[qh]…[im]<CRLF>[kn]…[ch]AW[qf]…C[手筋辞典…<CRLF>…第55图 黑先]
         于是「跳过空白后正好遇到 `[`（下一个值）」被误判成「这个节点读完了」，
         节点被从中间劈开：
           ① 这个属性剩下的值归到了下一个节点 → AB/AW 摆子点数变少（初始局面就是错的）；
           ② 同一节点后面的属性整组丢失 —— 最常见的就是 `C`（棋谱说明）
              和 `AW` 一起丢，这就是「根节点那段说明读不出来」的真因。
         实测抽样 300 份真实棋谱：**71 份（23.7%）被劈错**，其中一份的节点数
         从正确的 8 个虚增到 57 个。
         修法：只有「跳过空白后既不是标识、也不是值的开头」才认为节点结束。 */
      let j = i;
      while (j < s.length && /\s/.test(s[j])) j++;        // 标识前的空白（含换行）
      let id = '';
      while (j < s.length && /[A-Za-z]/.test(s[j])) { id += s[j]; j++; }
      if (!id) {
        if (j < s.length && s[j] === '[') i = j;          // 值接着写 → 本属性还没完
        else break;                                      // 这个节点读完了
      } else {
        i = j;
      }
      const vals = [], valAt = [];
      /* ★ 另一个同类修正：**值之间**也可能夹着换行
         （`AW[fc][fb]<CRLF>[fa][ed]…` 这种写法很常见）。
         原循环条件 `while (s[i] === '[')` 遇到换行就退出，于是这个属性
         只读到换行前的那几个值，剩下的全被劈走 —— 摆子少、解说词只剩第一行。
         现在每读完一个值先跳过空白，再看有没有下一个值。 */
      for (;;) {
        let k = i;
        while (k < s.length && /\s/.test(s[k])) k++;
        if (k >= s.length || s[k] !== '[') break;
        i = k;
        i++;
        valAt.push(i);                                   // 值正文起点（'[' 之后）
        let v = '';
        while (i < s.length) {
          if (s[i] === '\\') { v += s[i] + (s[i + 1] === undefined ? '' : s[i + 1]); i += 2; continue; }
          if (s[i] === ']') break;
          v += s[i]; i++;
        }
        vals.push(v);
        i++;                                             // 越过 ']'
      }
      props.push({ id: id.toUpperCase(), vals, valAt });
    }
    toks.push({ props, at, end: i });
  }

  /* ---------- 2) 走主分支 ----------
     ★★ 2026-10-06 修正（用户报「导入棋谱只加载了前 N 手」）。
     SGF 里 `(;A;B(;C)(;D))` 这种结构，**主分支 = 每个分支点的第一个子节点**（A,B,C），
     不是「遇到第一个 ( 就收工」—— 旧写法正是后者，于是真实棋谱只要在中盘挂一个
     变化图，后面全部丢掉。
     实测本机 21433 份职业棋谱（抽样 1500 份）：
       正确主线 106760 手 vs 旧写法 103282 手 → **16.9% 的文件被截断**；
       最惨的一份原 305 手只剩 3 手；AlphaGo 对李世石那局原 280 手只剩 15 手。
     （旧写法当初是为了解决「注释里的括号被当成分支」而写的 —— 那个问题现在由
       第 1 步的 tokenizer 自然解决了：括号在属性值里根本不会被当成 token。） */
  const nodes = [];                                      // 主分支上的属性节点（按出现顺序）
  const skipTree = k => {                                // 跳过一整棵子树
    let d = 0;
    while (k < toks.length) {
      if (toks[k] === '(') d++;
      else if (toks[k] === ')') { d--; if (d === 0) return k + 1; }
      k++;
    }
    return k;
  };
  const walk = k => {                                    // k 指向 '('
    if (toks[k] !== '(') return k;
    k++;
    while (k < toks.length) {
      const t = toks[k];
      if (t === ')') return k + 1;
      if (t === '(') {
        k = walk(k);                                     // 第一个子 = 主分支，继续往下走
        while (toks[k] === '(') k = skipTree(k);          // 其余兄弟整块跳过
        continue;
      }
      nodes.push(t);
      k++;
    }
    return k;
  };
  const head = toks.indexOf('(');
  if (head >= 0) walk(head);                             // 只解析第一棵树（一个文件可能串着好几局）

  /* ---------- 3) 取出棋谱自带的东西 ----------
     C[] = 这个节点上的**解说词**（很多棋谱有，实测抽查 600 份里 353 份带 —— 见开发记录）。
     归属：带 B/W 的节点 → 属于**这一手**；根节点 → 属于「开局前」（下标 0）。
     ★ 必须按**节点**扫（同一节点里 C 写在 B 前或后都不能错位），所以第 1 步分了组。 */
  const firstProp = id => {
    for (const nd of nodes) {
      for (const p of nd.props) if (p.id === id && p.vals.length) return p.vals[0];
    }
    return null;
  };
  const allPts = id => {
    const out = [];
    for (const nd of nodes) {
      for (const p of nd.props) {
        if (p.id !== id) continue;
        for (const v of p.vals) {
          if (v.length === 2) out.push({ x: v.charCodeAt(0) - 97, y: v.charCodeAt(1) - 97 });
        }
      }
    }
    return out;
  };
  /* SGF 值里的转义：`\]` → `]`、`\\` → `\`（换行是原文里的换行，保留） */
  const unsgf = v => String(v).replace(/\\([\s\S])/g, '$1');

  /* ★ 盘面大小必须**在遍历之前**读出来 —— 下面判越界坐标要用它
     （最典型的是 `zz` 这种题集分隔标记，不判就会算出下标 500 越出 361 格的盘面）。
     SZ 出现在根节点，而 nodes 就是从根节点开始按主分支收集的，所以扫得到。 */
  /* nodes 是 { props, at, end }，SZ 在 props 内；复用属性读取器，
     避免把节点当成属性后永远回退到 19 路。 */
  const declaredSize = parseInt(firstProp('SZ'), 10);
  const boardSize = declaredSize >= 2 && declaredSize <= 52 ? declaredSize : 19;

  const moves = [], comments = [], mainLine = [], seps = [];
  /* 根节点（棋谱开头那个节点）的说明文字 —— 单独存，不占「第 0 手」那个键。
     实测抽样 300 份真实棋谱：116 份的根节点带 C（38%），
     其中一部分以前**整段读不出来**（被后面第 0 手的 C、或被 tokenizer 劈错吃掉）。 */
  let rootComment = '';
  for (const nd of nodes) {
    /* 先看这个节点是不是一手棋（一次扫全部 props，所以 C 的位置无关） */
    let movesHere = [];
    for (const p of nd.props) {
      if (p.id !== 'B' && p.id !== 'W') continue;
      const color = p.id === 'B' ? 'b' : 'w';
      const v = p.vals.length ? p.vals[0] : '';
      if (!v) { movesHere.push({ color, pass: true }); continue; }   // [] = 停一手
      if (v.length !== 2) continue;
      /* ★ 这里用 charCode-97 而不是查表 —— SGF 是 a=1…h=8,**i=9**,j=10…s=19，
         与界面/GTP 那套「跳过 I」的字母表**不同**（见文件顶部 SGF_COLS 的注释）。 */
      const x = v.charCodeAt(0) - 97, y = v.charCodeAt(1) - 97;
      /* ★ 越界坐标不能当真实一手棋（2026-10-06 审查发现，真实棋谱里 2.97% 出现）。
         最常见的是 `;W[zz]` / `;B[zz]` —— 它不是坏数据，而是**死活题集里两张题
         之间的分隔标记**（前一节点的解说词正好写着「以上为第 N 图正解」）。
         原来的错：算成 x=25,y=25 → 下标 500，而盘面只有 361 格，
         TypedArray **静默忽略越界写、不报错** → 那手棋凭空消失，
         但它仍算进手数 → 后面全部手顺错位、黑白颠倒。
         现在：不生成 move（这一手在盘上不存在），并记成 sep 让上层知道
         「这里换了一道题」—— 具体要不要分段显示，见 renderCommentBox 的用法。 */
      if (!Number.isFinite(x) || !Number.isFinite(y) ||
          x < 0 || y < 0 || x >= boardSize || y >= boardSize) {
        seps.push(moves.length + (movesHere.length - 1));
        continue;
      }
      movesHere.push({ color, x, y });
    }
    moves.push(...movesHere);
    /* 再收这个节点上的解说词，并记下它在**原文里的位置**（编辑时要用它精确落刀）
       ★ 根节点说明的归属：**主分支上第一个没有落子的节点**（它不属于任何一手）。
         为什么这么定（实测 300 份真实棋谱校出来的，三种形态都得覆盖）：
           a) 死活题集：第一个节点就是根节点，摆子 AB/AW 和说明 C 都在这上面
              （`(;AB[…]AW[…]C[手筋辞典…第55图 黑先]…`）；
           b) 古谱（当湖十局那类）：第一个节点只有 FF/PB/RE 这些元数据，
              摆子写在第二个节点上 —— 但说明也在第一个节点上；
           c) 目录页 / 只有元数据的棋谱：第一个节点没有摆子，
              只有一句 C（实测 `00_mulu.sgf` 是《兼山堂弈谱》目录、`Shusai-092.sgf`
              是「Moves after 128 not recorded」）—— 这两种原来**整段读不出来**。
         所以判据只能是「第一个没有落子的节点」，不能加「必须带摆子」这个条件。 */
    const isRoot = movesHere.length === 0 && !rootComment;
    let cSpan = null;
    for (const p of nd.props) {
      if (p.id !== 'C' || !p.vals.length) continue;
      if (p.valAt && p.valAt.length) cSpan = [p.valAt[0], p.valAt[0] + p.vals[0].length];
      /* ★★ 2026-10-06 深夜补（用户报「一点开编辑，所有文段自动划分并加空行」）。
         真凶：有些棋谱（实测用户那份「绝艺解说」的职业棋谱）换行写的是
         **`\r\r\n`（CR CR LF）**，全文 690 处；而 `<div pre-wrap>` 把它渲染成
         「一个换行」，`<textarea>` 按 HTML 规范只保留 LF → `\r\r\n` 变成 `\n\n`
         → **显示是紧凑的、编辑框里每句之间多一个空行**。
         也就是说：这段文字在文件里本来就"多了一个 CR"，只是在只读显示时看不出来。
         修法：解析时就用 nlForSGF 归一化（把 `\r\r\n` / 裸 CR / 裸 LF 全归成 CRLF）。
         这样显示与编辑拿到的是**同一个值**，而且写回磁盘的也是同一个口径（幂等）。 */
      /* 紧一点：把连续空行收成一个（见 tightenSGFText 的注释） */
      const txt = tightenSGFText(nlForSGF(unsgf(p.vals[0])));
      if (!txt.trim()) continue;
      if (isRoot) rootComment = txt;
      else comments[movesHere.length ? moves.length : 0] = txt;
    }
    mainLine.push({
      at: nd.at, end: nd.end,
      /* isRoot：这一条代表「根节点那段说明」。保存根节点说明时用它找落刀位置。 */
      isRoot: isRoot,
      moveIdx: movesHere.length ? moves.length : 0,
      cSpan,
    });
  }
  /* 盘面大小：上面已按 nodes 里的 SZ 算过 boardSize，这里直接用同一个值，
     **不重新解析** —— 两份口径（一个不限范围、一个限 2~52）万一哪天不一致，
     就会出现「按 19 路拦越界、却按 52 路开棋盘」这种错位。 */
  const size = boardSize;
  const kmRaw = firstProp('KM');
  const komi = kmRaw === null ? null : parseFloat(kmRaw);
  const ab = allPts('AB'), aw = allPts('AW');
  const ru = String(firstProp('RU') || '').toLowerCase();
  let rules = 'chinese';
  if (ru.indexOf('japan') >= 0) rules = 'japanese';
  else if (ru.indexOf('korea') >= 0) rules = 'korean';
  else if (ru.indexOf('chinese') >= 0 && komi === 0 && ab.length === 2 && aw.length === 2) {
    rules = 'ancient';       // 明清：导出时 RU 也写 Chinese，靠「座子各 2 + 不贴目」认出来
  }
  /* 双方名字（别的软件导出的棋谱大多有；没有就是 null） */
  const pb = firstProp('PB'), pw = firstProp('PW');
  return {
    ok: moves.length > 0 || ab.length > 0, size, komi, rules, ab, aw, moves, pb, pw,
    comments, rootComment, mainLine,
    /* 「换了一道题」的位置（题集里 `zz` 分隔标记所在的手数）。
       我们**不做分支树、也不做多题分段显示**（用户定的：只显示主干），
       但保留这个信息 —— 将来若要做「第 3 题」这类提示，不用再改解析器。 */
    seps
  };
}

/* ---------- 换行符归一（2026-10-06）----------
   ★ 用户报的现象：「显示没空行 → 点编辑有空行 → 保存后有空行」。
   根因：真实棋谱里换行**大多写的是 CRLF**（实测抽样 2000 份，根节点解说词里
   251 份含 CRLF）。而 HTML 的 <textarea> 有一条规范行为：
   **通过 .value 读回来时，CRLF 会被规范化成 LF**。于是：
     显示（div + pre-wrap）   拿到原文的 CRLF
     编辑（textarea.value） 拿到规范化后的 LF
   写回时把 ta.value 原样塞回 SGF —— 那处 CRLF 就被换成了 LF。
   同一个文件里 LF 与别处的 CRLF 混排，换个查看器打开，空行就冒出来了。

   修：写回前统一成 CRLF（Windows 上 SGF 的通行写法，也是原文件的口径）。
   ★ 顺序要紧：必须**先合并 CRLF 再统一转回 CRLF** ——
     少这一步会变成 CRCRLF，那才是真的多出一个空行。 */
function nlForSGF(t) {
  const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
  return String(t == null ? '' : t)
    .split(CR + LF).join(LF)      // CRLF → LF
    .split(CR).join(LF)          // 落单的 CR → LF
    .split(LF).join(CR + LF);    // LF → CRLF
}

/* ---------- 把连续空行收成一个（2026-10-06 深夜，用户第二次报同一个现象）----------
   ★ 用户的原话：「一点开编辑，所有文段自动划分并加空行」。
   第一轮我只修了 `\r\r\n`（CR CR LF）——那确实是一种"假空行"。但用户又发来截图，
   指着第 38 手说还有。查下去才明白：**他嫌的不是假空行，是空行本身**。
   实测他这份「绝艺解说」职业棋谱（499 条 C[]）：25 条带换行，
      · 21 条是 `\r\r\n`（第一轮修的）
      · 4 条是正常的 `\r\n\r\n`（段落空行）
   两种在他的界面上都是「每句之间空一行」。而棋谱解说大多是**一句一行**的弹幕体，
   空行只是导出工具排版留下的，读起来反而散。
   所以这里再收一道：**连续两个及以上的换行压成一个**。
   ★ 三处一致：显示（div）、编辑（textarea）、写回磁盘都用这个口径 ——
     用户第一次报的正是"显示和编辑不一样"，不能再留这种缝。
   ★ 非破坏性：只影响**界面与写回**的呈现；原文件在被用户主动保存前一字不动。 */
function tightenSGFText(t) {
  const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
  const CRLF = CR + LF;
  const parts = String(t == null ? '' : t).split(CRLF);
  /* ★ 第一版这里写错了两次，都记下来（判据/实现各错一次）：
     ① 条件写成 `blank(p) && out.length && 上一个 === ''` ——
        `'a'` 之后第一个空串会被 push，第二个空串来比较时比的是 `'a'`，
        于是一个也压不掉（实测输出与输入一模一样）。
     ② 我又想"保留一个空行当段落分隔"，但用户要的是**紧凑**：
        他这份棋谱的解说是一句一行的弹幕体（「等于芈昱廷和李钦诚的位置互换」
        这种），空行只是导出工具排版留下的 —— 留着就是"每句之间空一行"。
     所以现在：**空行一律去掉**（含只在空白字符的行、含首尾）。 */
  const kept = parts.filter(p => p.replace(/\s/g, '') !== '');
  return kept.join(CRLF);
}

/* ---- 把某一手（或根节点）的解说词写回 SGF 文本（2026-10-06） ----
   做法：**只在原文里替换/插入那一个节点上的 C[]**，其余字符一个都不动。
   为什么必须这么做（而不是用 buildSGF 重新生成一份）：
   我们的导出只写主分支、不认识变体/别的属性 —— 拿它覆盖用户下载来的棋谱，
   会把变体、引擎信息、别的注释**全部抹掉**。所以这里把文件当"文本"处理，
   靠 parseSGF 交出来的节点位置精确落刀。
   at：手数；at === -1 表示**根节点那段说明**（它不属于任何一手）。
   返回 { ok, text } 或 { error }。 */
function patchSGFComment(text, at, newText) {
  const p = parseSGF(text);
  const ent = at === -1
    ? (p.mainLine || []).find(x => x.isRoot)
    : (p.mainLine || []).find(x => !x.isRoot && x.moveIdx === at);
  if (!ent) {
    return { error: at === -1 ? '这份棋谱的根节点上没有说明文字' : '这份棋谱里找不到第 ' + at + ' 手' };
  }
  /* ★ 写回前把换行统一成 CRLF（见上面 nlForSGF 的注释） */
  const esc = nlForSGF(newText).replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
  if (ent.cSpan) {
    if (!newText) {
      /* 清空 → 把整个 C[..] 删掉（'C[' 在值的左两格：标识 1 字符 + '['） */
      const s = ent.cSpan[0] - 2, e = ent.cSpan[1] + 1;
      return { ok: true, text: text.slice(0, s) + text.slice(e) };
    }
    return { ok: true, text: text.slice(0, ent.cSpan[0]) + esc + text.slice(ent.cSpan[1]) };
  }
  if (!newText) return { ok: true, text };          // 本来没有、又要清空 → 什么都不用做
  /* 没有 C[] → 插在这个节点最后一个属性的后面 */
  return { ok: true, text: text.slice(0, ent.end) + 'C[' + esc + ']' + text.slice(ent.end) };
}

/* 把解析出来的棋谱装进当前局面。
   srcName = 棋谱库里的文件名（有它才能把讲解存回这份棋谱旁边） */
function applyRecord(rec, srcName) {
  if (!rec || !rec.ok) { flash('这份棋谱读不出手顺（格式可能不常见）'); return; }
  /* ★ 换棋谱时先退出解说词编辑态（2026-10-06）。
     不退的话：① 框里还留着上一份棋谱的半截文字，render 又不敢重画
     （「正在编辑就返回」那道守卫），于是那段文字会跟着走进新棋谱 ——
     用户以为在改新棋谱，实际在改旧的。 */
  exitCommentEdit();
  state.recName = String(srcName || '');
  settings.size = [9, 13, 19].indexOf(rec.size) >= 0 ? rec.size : 19;
  settings.rules = RULES[rec.rules] ? rec.rules : 'chinese';
  settings.komi = (rec.komi !== null && !isNaN(rec.komi)) ? rec.komi : RULES[settings.rules].komi;
  settings.handicap = 0;                 // 让子 / 座子由 setup 表达
  settings.mode = 'free';                // 打开棋谱按「摆棋」看：两边都能接着摆
  state.noGame = false;                  // ★ 打开棋谱就是「有内容了」：解除未开局状态
  state.fromRecord = true;               // ★ 打谱：选点讲解对它禁用（别人的棋，不替人支招）
  clearCoachPanels();                    // 换了棋谱 → 两个框清空（「全盘讲解」按钮这时才露出来）
  N = settings.size;
  state.setup = [
    ...rec.ab.map(p => ({ x: p.x, y: p.y, color: 'b' })),
    ...rec.aw.map(p => ({ x: p.x, y: p.y, color: 'w' })),
  ];
  state.moves = rec.moves.slice();
  /* ★ 棋谱自带的解说词（SGF 的 C[]，主分支逐手）—— 右下角那个「解说词」框就是显示它。
     没有就是空数组（多数自己导出的棋谱没有）。 */
  state.sgfComments = Array.isArray(rec.comments) ? rec.comments.slice() : [];
  /* 棋谱**根节点**的说明文字（题集出处、第几图、谁整理的）——
     单独存，不跟「第 0 手」抢键。它在解说词框的「（开局前）」那一档显示。 */
  state.rootComment = String(rec.rootComment || '');
  /* 一份题集里串了多道题时的分界位置（`zz` 分隔标记所在的手数）——
     只用来显示「第 N 题 / 共 M 题」，**不做切换**。 */
  state.quizTips = Array.isArray(rec.seps) ? rec.seps.slice() : [];
  /* 棋谱里带的双方名字 → 右侧 ID 栏（没有就留空，回落到默认叫法） */
  const cleanName = v => String(v || '').replace(/[\[\]\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
  state.names = { b: cleanName(rec.pb), w: cleanName(rec.pw) };
  state.toMove = sideToMove(state.moves.length);
  /* ★ 打开棋谱时**不拦打劫**（KaTrain 第 135 行同理：重放棋谱用 `ignore_ko=True`，
     因为那些手的合法性无法追溯、而且往往本来就是"打完劫之后"的局面）。
     但**禁着点要算出来** —— 用户接着往下摆时得受劫规则约束。
     先补 `capAt`（棋谱手顺里没有这个字段），再反推禁着点。 */
  state.koPoint = null;
  rebuildCapAt();
  state.koPoint = koFromBoard(boardAt(state.moves.length), state.moves);
  state.viewAt = state.moves.length;
  state.candidates = []; state.candAt = -1;
  state.ownership = null; state.ownAt = -1;
  state.history = [];
  state.leads = [];
  state.histVisits = [];
  resetAnalysisState();         // 换了棋谱：旧的分析欠账 / 「已上屏」标记全部作废
  state.result = null;
  state.draft = null;
  state.lastEval = null;
  state.review = null;          // 换了棋谱 → 上一次的复盘数据作废
  state.pv = null;              // 变化图也收掉（候选点马上就变了）
  setSeg('seg-mode', 'free');
  clockReset();
  resize();
  syncUI();
  flash('已打开棋谱 · ' + state.moves.length + ' 手 · ' + RULES[settings.rules].label);
  /* ★ 这份棋谱以前做过「全盘讲解」的话，把讲解读回来（用户要求：
     结果跟棋谱一起保存，下次打开还要能看到）。异步读、不挡打开。 */
  if (state.recName) loadCoachForRecord(state.recName);
}

/* 存进棋谱库 */
async function saveToRecords() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const realMoves = state.draft ? state.draft.from : state.moves.length;   // 草稿不进棋谱
  const name = `${stamp}-${realMoves}手.sgf`;
  const r = await window.api.records.save(name, buildSGF());
  if (!r || r.error) { flash('保存失败：' + ((r && r.error) || '未知')); return null; }
  flash('已存进棋谱库 · ' + r.name + '（顶栏「棋谱库」里能看到）');
  return r;
}

$('btn-save').onclick = () => { saveToRecords(); };   // 原先下载到系统，现在改存进棋谱库

/* ---------- 棋谱库弹窗 ---------- */
const REC_MASK = $('records');

const fmtRecTime = ms => {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* 棋谱库的搜索词 —— 纯前端过滤（列表本来就在内存里，不必再读盘）。
   打开面板时**不清空**：连着看好几份棋谱时，搜索词留着更方便。 */
let recFilter = '';

async function refreshRecords() {
  const ul = $('reclist');
  const all = (await window.api.records.list()) || [];
  /* ★ 搜索/筛选（2026-10-04 用户要求）：备注名 + 文件名 一起模糊匹配 */
  const kw = recFilter.toLowerCase();
  const list = kw ? all.filter(it => ((it.note || '') + ' ' + it.name).toLowerCase().includes(kw)) : all;
  const cnt = $('rec-count');
  if (cnt) {
    cnt.textContent = all.length
      ? (kw ? '筛出 ' + list.length + ' / 共 ' + all.length + ' 份' : '共 ' + all.length + ' 份')
      : '';
  }
  ul.textContent = '';
  if (!all.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '棋谱库还是空的 —— 下完棋点底栏「导出棋谱」就会存进来';
    ul.appendChild(li);
    return;
  }
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '没有匹配「' + recFilter + '」的棋谱';
    ul.appendChild(li);
    return;
  }
  for (const it of list) {
    const li = document.createElement('li');
    /* 两行显示（用户要求「显示备注名和文件名」）：
       上行 = 备注名（存在 SGF 的 GN 字段里）；下行 = **真实文件名**（灰色小字）。
       没写过备注时就只显示文件名一行，免得两行是同一串东西。 */
    const info = document.createElement('div');
    info.className = 'rec-info';
    const hasNote = !!(it.note && it.note.trim());
    const nm = document.createElement('span');
    nm.className = 'rec-name';
    nm.textContent = hasNote ? it.note : it.name.replace(/\.sgf$/i, '');
    nm.title = hasNote ? (it.note + '\n文件：' + it.name) : it.name;
    info.appendChild(nm);
    if (hasNote) {
      const fn = document.createElement('span');
      fn.className = 'rec-file';
      fn.textContent = it.name;
      info.appendChild(fn);
    }
    const meta = document.createElement('span');
    meta.className = 'rec-meta';
    meta.textContent = Math.max(1, Math.round(it.size / 1024)) + ' KB · ' + fmtRecTime(it.mtime)
      + (it.hasReview ? ' · 已复盘' : '')
      + (it.hasCoach ? ' · 带讲解' : '');
    const mk = (label, title, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.onclick = fn;
      return b;
    };
    li.append(info, meta,
      mk('打开', '载入这份棋谱', () => openRecord(it.name)),
      /* AI 复盘：整盘逐手重算 → 出报告 + 在手数列表/走势图上标失误。
         叫「AI 复盘」而不是「复盘」，免得和棋谱软件里那个「一步一步翻」的meaning 混。
         ★ 2026-10-04 用户要求：点完之后**先手动选搜索量**（默认 500），所以这里
           只负责开选档面板，真正开跑在 openReviewSetup 里。 */
      (() => {
        const b = mk('AI 复盘', '整盘逐手重算，出一份报告（点开会先让你选搜索量）', () => openReviewSetup(it));
        b.classList.add('primary');
        return b;
      })(),
      /* 复盘报告：打开**上一次复盘存下来的报告**（records/<棋谱名>.review.json）。
         ★ 用户要求：没有报告时置灰点不了；新报告生成时会覆盖旧的 —— 所以这里永远是「最新那一份」。 */
      (() => {
        const b = mk('复盘报告',
          it.hasReview ? '打开已存的复盘报告（最新的那一份 · 会载入这份棋谱）'
            : '这份棋谱还没复盘过 —— 先点「AI 复盘」',
          () => openSavedReview(it.name, it.note));
        if (!it.hasReview) b.disabled = true;
        return b;
      })(),
      /* 备注：写在 SGF 的 GN 字段里，**不改文件名**。
         （Electron 里 window.prompt() 用不了 → 就地展开一个输入框） */
      mk('备注', '写一个备注名（存进棋谱的 GN 字段，文件名不动）', () => {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = it.note || '';
        inp.placeholder = '给这份棋谱写个备注…';
        const ok = document.createElement('button');
        ok.textContent = '确定';
        const no = document.createElement('button');
        no.textContent = '取消';
        const commit = async () => {
          const r = await window.api.records.setNote(it.name, inp.value);
          if (r && r.error) flash('备注失败：' + r.error);
          else flash(r && r.note ? '备注：' + r.note : '已清空备注');
          refreshRecords();
        };
        ok.onclick = commit;
        no.onclick = () => refreshRecords();
        inp.onkeydown = e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') refreshRecords();
        };
        li.textContent = '';
        li.append(inp, ok, no);
        inp.focus(); inp.select();
      }),
      /* 删除：不用 confirm（Electron 里不可靠）→ 就地变「确认删除？」按钮，3 秒后自动还原 */
      mk('删除', '移到系统回收站（可以恢复）', function () {
        if (this.dataset.armed !== '1') {
          this.dataset.armed = '1';
          this.textContent = '确认删除？';
          this.classList.add('danger');
          setTimeout(() => {
            if (this.dataset.armed === '1') {
              this.dataset.armed = '';
              this.textContent = '删除';
              this.classList.remove('danger');
            }
          }, 3000);
          return;
        }
        this.dataset.armed = '';
        window.api.records.remove(it.name).then(r => {
          flash(r && r.error ? '删除失败：' + r.error : '已移到回收站');
          refreshRecords();
        });
      }),
    );
    ul.appendChild(li);
  }
}

async function openRecord(name) {
  const r = await window.api.records.read(name);
  if (!r || r.error) { flash('读取失败：' + ((r && r.error) || '未知')); return; }
  REC_MASK.classList.remove('open');
  applyRecord(parseSGF(r.text), name);
}

$('btn-records').onclick = async () => {
  REC_MASK.classList.add('open');
  const d = await window.api.records.dir();
  $('rec-dir').textContent = d || '';
  refreshRecords();
};
$('rec-close').onclick = () => REC_MASK.classList.remove('open');
$('rec-open-dir').onclick = () => window.api.records.openDir();
/* 「更改文件夹…」：和「设置」里那一项是**同一个配置项**，只是入口不同（用户要求两个地方都能改）。
   改完会把已有棋谱**复制**一份过去（老的留着不删），并如实报复制了几份、跳过几份。 */
$('rec-change-dir').onclick = async () => {
  const r = await window.api.settings.choose('recordsDir');
  if (!r || r.canceled) return;
  if (!r.ok) { flash('这个文件夹用不了 —— 可能没写权限，换一个试试'); return; }
  const res = await window.api.records.setDir(r.path);
  if (!res || res.error) { flash(res && res.error || '换不了'); return; }
  $('rec-dir').textContent = res.dir || '';
  await refreshRecords();
  const m = res.moved || { copied: 0, skipped: 0, failed: 0 };
  let tip = '棋谱库已改到：' + (res.dir || '');
  if (m.copied) tip += '；已把 ' + m.copied + ' 份棋谱复制过去';
  if (m.skipped) tip += '；' + m.skipped + ' 份同名文件已存在，没覆盖';
  if (m.failed) tip += '；有 ' + m.failed + ' 份没搬成';
  if (m.copied) tip += '。**老位置的没删**，确认新地方对了你自己删掉就行。';
  flash(tip);
};
$('rec-save-now').onclick = async () => {
  if (!state.moves.length) { flash('还没落子，没什么可存的'); return; }
  await saveToRecords();
  refreshRecords();
};

/* 搜索框：边打边筛（列表不大，直接重渲染最简单可靠） */
$('rec-search').oninput = () => {
  recFilter = $('rec-search').value.trim();
  refreshRecords();
};

/* 导入棋谱（2026-10-04 用户要求）：弹系统文件框（可多选），主进程负责复制进棋谱库。
   校验、重名、非法文件都在主进程做 —— 前端只管把结果显示出来。 */
$('rec-import').onclick = async () => {
  const btn = $('rec-import');
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '导入中…';
  let r;
  try { r = await window.api.records.importSgf(); }
  catch (e) { r = { error: String(e) }; }
  btn.disabled = false; btn.textContent = old;

  if (!r || r.canceled) return;                     // 用户把选择框关掉了：什么都不做
  if (r.error) { flash('导入失败：' + r.error); return; }
  const okN = (r.imported || []).length;
  const bad = r.failed || [];
  if (okN && !bad.length) flash('已导入 ' + okN + ' 份棋谱');
  else if (okN) flash('导入 ' + okN + ' 份，跳过 ' + bad.length + ' 份：' + bad.join('；'));
  else flash('没能导入：' + (bad.join('；') || '没选到可用的 SGF 文件'));
  refreshRecords();
};
REC_MASK.addEventListener('click', e => { if (e.target === REC_MASK) REC_MASK.classList.remove('open'); });

/* HTML 转义：棋谱备注名是用户输入，塞进 innerHTML 前必须转义 */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* ---------------- AI 复盘（整盘逐手重算） ----------------
   流程：顶栏「AI 复盘」→ 选棋谱 → 引擎**一次请求**算完每一手 → 出报告，
   并把每手的「目损」标到右下角手数列表和胜率走势图上。

   ★ 为什么不逐手发请求：KataGo 的 analysis 支持 analyzeTurns 数组，
     一次请求就能把整盘每一手都算完（实测 ≈ 0.6 秒/手），逐手发会慢一个数量级。 */

/* 复盘每手的搜索量。
   历程：写死 200（快但糙）→ 跟随底栏「计算深度」→ ★ 2026-10-04 用户拍板
   「点 AI 复盘后手动设置，默认 500」：每次点「AI 复盘」先弹面板让他当场选档
   （见 openReviewSetup），选完写进 settings.reviewVisits。
   好处：不会因为底栏调到 3000 就把一次复盘意外拖成十几分钟，也不会因为底栏是 100
   就把目损算得太糙 —— 复盘该算多深，由点的那一刻决定。 */
function reviewVisits() { return settings.reviewVisits || 500; }

/* 复盘耗时估算（给选档面板看的参考）。实测约 0.4 秒/手（500 visits），按比例换算。 */
function reviewEta(nMoves, visits) {
  const sec = Math.max(1, Math.round(nMoves * 0.4 * (visits / 500)));
  return sec < 60 ? '约 ' + sec + ' 秒' : '约 ' + (sec / 60).toFixed(1) + ' 分钟';
}

/* 失误分级 —— 档位照抄 KaTrain 的 12 / 6 / 3 / 1.5 / 0.5 目 */
const LOSS_LEVELS = [
  { th: 12,  cls: 'lv5', label: '严重失误' },
  { th: 6,   cls: 'lv4', label: '大失误' },
  { th: 3,   cls: 'lv3', label: '失误' },
  { th: 1.5, cls: 'lv2', label: '小失误' },
  { th: 0.5, cls: 'lv1', label: '轻微' },
];
const lossLevel = v => LOSS_LEVELS.find(l => v >= l.th) || null;

/* 段位估算 —— ⚠️ **启发式**：按「整盘平均目损」粗略换算。
   没有官方标准，也没有「标准人类棋手」可对照（KataGo 官方对档位的措辞是「模仿」而非「等同」）。
   真正的校准方式是：挑一档跟 AI 下几盘看胜负。UI 上必须把这句话写给用户。 */
const RANK_BY_LOSS = [
  [1.0, '约 3 段以上'], [1.6, '约 1~2 段'], [2.4, '约 1~3 级'],
  [3.5, '约 4~8 级'], [5.0, '约 9~13 级'], [7.0, '约 14~18 级'],
  [Infinity, '约 18 级以下'],
];
const estRank = avg => (avg === null ? '—' : (RANK_BY_LOSS.find(r => avg < r[0]) || RANK_BY_LOSS[RANK_BY_LOSS.length - 1])[1]);

let reviewBusy = false;
/* 复盘的「进门取号」：每次点「开始复盘」同步 +1。
   用来挡住「判定与上锁之间那几毫秒内连点两次」的双开 —— 见 runReview 里的说明。 */
let reviewSeq = 0;

/* KataGo 的 scoreLead 是「**当前走棋方**视角」（跟 ownership / winrate 同一套视角规则），
   所以要比较两回合必须统一换算。这里统一成「黑方领先多少目」。 */
function blackLeadOf(root) {
  if (!root || typeof root.scoreLead !== 'number') return null;
  return String(root.currentPlayer || '').toUpperCase() === 'W' ? -root.scoreLead : root.scoreLead;
}

/* 逐手目损：拿相邻两个回合的「黑方领先」相减。
   turns[t] = 第 t 手**落下之前**的局面（t = 0..N —— 多算的那个 N 是「最后一手之后」，
   专门用来补出最后一手的损失，否则最后一手永远算不出来）。
   黑下的手 → 黑领先的减少量；白下的手 → 白领先的减少量（等价于黑领先的增加量）。

   ★ 为什么不用「AI 首选的分 − 实际手的分」：引擎会把明显差的手**剪枝掉**
     （实测 40% 的回合找不到实际手，而那恰恰是最该被点评的失误）。
     根节点评估则是**每一手都有**，覆盖率 100%，且实测与前者结果吻合
     （同一盘最大失误：这条路算 4.59 目 / 前者算 5.05 目）。 */
function computeLosses(turns) {
  const out = [];
  for (let t = 0; t + 1 < turns.length; t++) {
    const a = blackLeadOf(turns[t] && turns[t].root);
    const b = blackLeadOf(turns[t + 1] && turns[t + 1].root);
    if (a === null || b === null) { out.push(null); continue; }
    const isBlack = String(((turns[t] || {}).root || {}).currentPlayer || '').toUpperCase() !== 'W';
    out.push(Math.max(0, isBlack ? (a - b) : (b - a)));
  }
  return out;
}

/* 分段：按手数比例切（布局 / 中盘 / 终盘）。用比例而不是固定手数 —— 9 路棋谱只有几十手，
   固定写「1-50 手是布局」就全归到布局里了。 */
function segOf(i, n) {
  if (n <= 0) return 0;
  const r = i / n;
  return r < 0.3 ? 0 : (r < 0.75 ? 1 : 2);
}
const SEG_NAMES = ['布局', '中盘', '终盘'];

/* 复盘结果结构（**v2**，2026-10-04）：
   ★ 为什么改：v1 把**黑白双方**的目损混在一起算平均、混在一起数失误。
     实测一份 115 手的棋谱：混算得到「平均目损 0.35 目 · 3 手失误（最大 8.6 目）」，
     拆开却是 —— 黑方 0.23 目、**0 手失误**；白方 0.47 目、3 手失误（最大 8.6 目）。
     也就是说那些失误**全是白方下出来的**，却被算成了"这盘棋的水平"，
     还被拿去换算「估算水平」。复盘是为了看**自己**下得怎么样 ——
     混算等于替对手背一半锅、或把自己的问题稀释一半。
   v2 结构：{ v:2, losses:[每手目损], sides:{b:{…},w:{…}}, blunders:{b:[],w:[]} }
     sides[x] = { nMov, avg, est, n3, n6, n12, aiFirst, aiKnown, worst, segs }
     segs = [布局/中盘/终盘] 各 { name, n, avg, worst }
   （v1 报告**没有 sides 字段** → 打开时提示重新复盘，见 showReviewReport。） */
function buildReview(nMoves, turns) {
  const losses = computeLosses(turns);

  /* 这一手是谁下的：以「落下之前轮谁走」为准（turns[t].root.currentPlayer，权威），
     拿不到才退回棋谱里的手顺颜色。 */
  const sideOf = t => {
    const cp = String(((turns[t] || {}).root || {}).currentPlayer || '').toUpperCase();
    if (cp === 'B') return 'b';
    if (cp === 'W') return 'w';
    const m = state.moves[t];
    return (m && m.color === 'w') ? 'w' : 'b';
  };

  /* 与 AI 首选重合：turns[t].moves[0] 是引擎给该回合的第一推荐，
     turns[t].actualMove 是实际下的那手（主进程从请求的 moves 里取）。黑白分开记。 */
  const hit = { b: 0, w: 0 }, known = { b: 0, w: 0 };
  /* ★ 认「AI 首选」要用 `order === 0`，**别假定 moveInfos[0] 就是首选**
     （2026-10-06 审查发现）：引擎的 moveInfos 是按**访问次数**排的，不保证第一项是 order 0；
     而主进程只透传前 8 条。本文件别处（pickAIMove）早就是
     `find(m => m.order === 0) || infos[0]` 的写法，这里当时没跟上 ——
     判错会让报告里「与 AI 首选一致 N/M」和失误清单的「AI 想下 X」指错点。 */
  const firstMove = info => {
    const ms = (info && info.moves) || [];
    const f = ms.find(m => m.order === 0);
    return f ? f.move : (ms[0] ? ms[0].move : null);
  };
  for (let t = 0; t < nMoves; t++) {
    const info = turns[t];
    if (!info || !info.actualMove || !info.moves || !info.moves.length) continue;
    const sd = sideOf(t);
    known[sd]++;
    if (firstMove(info) === info.actualMove) hit[sd]++;
  }

  /* 每方一组指标（平均目损 / 失误档位 / 分段 / 与 AI 重合） */
  const sides = {};
  for (const sd of ['b', 'w']) {
    const vals = [];
    for (let t = 0; t < nMoves; t++) {
      if (sideOf(t) === sd && typeof losses[t] === 'number') vals.push(losses[t]);
    }
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    const cnt = th => vals.filter(v => v >= th).length;

    /* 分段：按手数比例切（布局 / 中盘 / 终盘）—— 9 路棋谱只有几十手，
       固定写「1-50 手是布局」会全归到布局里，所以用比例。 */
    const segs = [0, 1, 2].map(k => {
      const sub = [];
      for (let t = 0; t < nMoves; t++) {
        if (sideOf(t) !== sd || segOf(t, nMoves) !== k) continue;
        if (typeof losses[t] === 'number') sub.push(losses[t]);
      }
      return {
        name: SEG_NAMES[k], n: sub.length,
        avg: sub.length ? sub.reduce((s, v) => s + v, 0) / sub.length : null,
        worst: sub.length ? Math.max(...sub) : null,
      };
    });

    sides[sd] = {
      nMov: vals.length, avg, est: estRank(avg),
      n3: cnt(3), n6: cnt(6), n12: cnt(12),
      aiFirst: hit[sd], aiKnown: known[sd],
      worst: vals.length ? Math.max(...vals) : null,
      segs,
    };
  }

  /* 失误清单：黑白分开，各自按目损从大到小，最多 8 条（只留 ≥3 目的「失误」档） */
  const blunders = { b: [], w: [] };
  for (let t = 0; t < nMoves; t++) {
    const v = losses[t];
    if (typeof v !== 'number' || v < 3) continue;
    const best = firstMove(turns[t]);   // 同上：用 order===0 认首选，别假定 moves[0]
    blunders[sideOf(t)].push({ t, loss: v, best });
  }
  blunders.b.sort((x, y) => y.loss - x.loss);
  blunders.w.sort((x, y) => y.loss - x.loss);

  return {
    v: 2,
    losses, sides,
    blunders: { b: blunders.b.slice(0, 8), w: blunders.w.slice(0, 8) },
    nBlunder: blunders.b.length + blunders.w.length,
  };
}

/* ---------------- 复盘界面 ---------------- */

const RV_MASK = $('review');

/* 最近一次的进度（重开进度窗要用 —— 见 showReviewAgain） */
let lastReviewProgress = { done: 0, total: 0 };

/* 复盘还在跑时又被点（AI 复盘 / 复盘报告 / 重新复盘 / 点遮罩）——
   把进度窗**重新打开**，而不是只弹一句提示：看不到进度会让人以为卡死了。 */
function showReviewAgain() {
  /* ★ 全盘讲解跑的也是这条「整盘逐手」通路 —— 别把复盘那个进度窗弹出来（审查发现）。 */
  if (state.coach.batch) { flash('全盘讲解正在跑 —— 它跑了整盘分析，等它完再复盘'); return; }
  RV_MASK.classList.add('open');
  showReviewProgress(lastReviewProgress.done, lastReviewProgress.total);
  flash('AI 正在复盘，算完会自动出报告');
}

function showReviewProgress(done, total) {
  lastReviewProgress = { done: done || 0, total: total || 0 };
  RV_MASK.classList.add('open');
  $('review-body').innerHTML =
    '<div class="rv-wait">AI 正在逐手重算…</div>'
    + '<div class="rv-bar"><i style="width:' + (total ? Math.round(done / total * 100) : 0) + '%"></i></div>'
    + '<div class="rv-wait-sub">' + done + ' / ' + total + ' 手 · 每手 ' + reviewVisits() + ' 次搜索</div>'
    + '<div class="rv-wait-tip">实测约 0.3~0.6 秒/手（一盘 200 手约 1~2 分钟）。期间请不要落子 —— 整盘算完才会出报告。</div>';
}

function showReviewReport() {
  const R = state.review;
  if (!R) return;
  RV_MASK.classList.add('open');
  const f = v => (v === null || v === undefined || isNaN(v)) ? '—' : v.toFixed(1);
  const n = state.moves.length;
  /* 这份报告是**按多少步搜索**算出来的 —— 从报告自己身上读（而不是读当前设置的档位），
     这样看旧的报告时显示的也永远是它当时的真实档位。 */
  const rv = R.visits || reviewVisits();
  const segRange = k => {          // 该段覆盖的手数区间（给用户看的）
    const a = Math.floor(n * [0, 0.3, 0.75][k]) + 1;
    const b = Math.floor(n * [0.3, 0.75, 1][k]);
    return a + '–' + b + ' 手';
  };

  let h = '';
  h += '<h2>AI 复盘 <span class="rv-name">' + esc(R.name || '') + '</span></h2>';
  h += '<div class="rv-sub">共 ' + n + ' 手 · 每手 ' + rv + ' 次搜索 · <b>黑白分开统计</b></div>';

  /* ★ 旧版报告（v1 把黑白混算，口径已经变了）—— 不显示那份数据，直接请用户重算。
     拿错口径的数字下判断比没有数字更糟。 */
  if (!R.sides || !R.sides.b || !R.sides.w) {
    h += '<div class="rv-warn">这份报告是<b>旧版算法</b>生成的（黑白双方混在一起算），'
      + '数据口径已经变了，所以这里<b>不再显示</b>。点下面的「重新复盘」按新算法重算一份就行'
      + '（每手 ' + rv + ' 步，一盘约 1 分钟）。</div>';
    h += '<div class="mfoot"><button id="review-again" class="primary">重新复盘</button>'
      + '<div class="spacer"></div><button id="review-close">关闭</button></div>';
    $('review-body').innerHTML = h;
    bindReviewReport(R, false);
    return;
  }

  const kv = (lb, val) => '<div class="rv-kv"><span>' + lb + '</span><b>' + val + '</b></div>';
  const sideName = sd => (sd === 'b' ? '黑方' : '白方');

  /* ---------- 两张画像并排（黑方 / 白方） ---------- */
  h += '<div class="rv-sides">';
  for (const sd of ['b', 'w']) {
    const s = R.sides[sd] || {};
    h += '<div class="rv-side">'
      + '<div class="rv-side-h"><i class="dot ' + sd + '"></i>' + sideName(sd)
      + '<span class="rv-dim">' + (s.nMov || 0) + ' 手</span></div>'
      + kv('平均目损', f(s.avg) + '<span class="rv-un">目</span>')
      + kv('估算水平', '<span class="rv-est">' + esc(s.est || '—') + '</span>')
      + kv('最大单手', f(s.worst) + '<span class="rv-un">目</span>')
      + kv('与 AI 首选一致', s.aiFirst + '<span class="rv-un">/ ' + s.aiKnown + '</span>')
      + kv('失误（≥3 目）', s.n3 + '<span class="rv-un">手</span>')
      + '<div class="rv-kv-sub">其中 ≥6 目 ' + s.n6 + '，≥12 目 ' + s.n12 + '</div>'
      + '</div>';
  }
  h += '</div>';

  /* ---------- 分段表（黑/白各两列） ---------- */
  h += '<table class="rv-seg"><tr><th></th>'
    + '<th>黑方均损</th><th>黑方最大</th><th>白方均损</th><th>白方最大</th></tr>';
  for (let k = 0; k < 3; k++) {
    const b = R.sides.b.segs[k], w = R.sides.w.segs[k];
    h += '<tr><td>' + esc(b.name) + ' <span class="rv-dim">' + segRange(k) + '</span></td>'
      + '<td>' + f(b.avg) + '</td><td>' + f(b.worst) + '</td>'
      + '<td>' + f(w.avg) + '</td><td>' + f(w.worst) + '</td></tr>';
  }
  h += '</table>';

  /* ---------- 失误清单（黑白分开列） ---------- */
  h += '<div class="rv-h">最大失误 <span class="rv-dim">（点一下跳到那一手）</span></div>';
  for (const sd of ['b', 'w']) {
    const list = (R.blunders && R.blunders[sd]) || [];
    h += '<div class="rv-bl-h"><i class="dot ' + sd + '"></i>' + sideName(sd) + '</div>';
    if (!list.length) {
      h += '<div class="rv-bl-empty">没有 ≥3 目的失误 —— 这一方下得挺稳。</div>';
      continue;
    }
    h += '<ul class="rv-bl">';
    for (const b of list) {
      const m = state.moves[b.t];
      if (!m) continue;
      const pt = m.pass ? '停一手' : GTP_COLS[m.x] + (N - m.y);
      const lv = lossLevel(b.loss);
      h += '<li data-n="' + (b.t + 1) + '"><span class="rv-no">第 ' + (b.t + 1) + ' 手</span>'
        + '<span class="rv-pt">' + pt + '</span>'
        + '<span class="rv-loss rv-' + (lv ? lv.cls : '') + '">亏 ' + b.loss.toFixed(1) + ' 目</span>'
        + '<span class="rv-best">AI 想下 ' + (b.best || '—') + '</span></li>';
    }
    h += '</ul>';
  }

  h += '<div class="rv-note">「估算水平」是按<b>该方自己的平均目损</b>粗略换算的启发式，仅供参考 —— '
    + 'KataGo 的段位档是「模仿某段位棋手」，官方并没有给出与真实段位的换算表。'
    + '想知道准的，挑一档跟 AI 下几盘看胜负更实在。目损本身是数值估计，'
    + rv + ' 次搜索时有零点几目的噪声。</div>';

  /* 这次的结果已经写进 records/<棋谱名>.review.json —— 下次不用重算，点「复盘报告」直接看 */
  h += '<div class="rv-sub" style="margin:10px 0 0;color:var(--text-dim)">这份报告已经存下来了：'
    + '关掉后想再看，到棋谱库点这份棋谱的「复盘报告」就行（新复盘会覆盖这一份）。</div>';

  h += '<div class="mfoot"><button id="review-again" title="换个搜索量重新算一遍（会覆盖已存的报告）">重新复盘</button>'
    + '<div class="spacer"></div><button id="review-close">关闭</button></div>';
  $('review-body').innerHTML = h;
  bindReviewReport(R, true);
}

/* 报告底部的按钮绑定（新版/旧版共用）。v2 = 新版才有「点失误跳过去」。 */
function bindReviewReport(R, v2) {
  $('review-close').onclick = () => RV_MASK.classList.remove('open');
  const again = $('review-again');
  if (again) again.onclick = () => {
    /* 重新复盘 = 回到选档面板（用户要求搜索量在点的时候定） */
    openReviewSetup({ name: R.file || (R.name + '.sgf'), note: R.name, hasReview: true });
  };
  if (!v2) return;
  $('review-body').querySelectorAll('.rv-bl li[data-n]').forEach(li => {
    li.onclick = () => { gotoView(+li.dataset.n); };   // 跳过去看那一手（弹窗留着，方便对照）
  });
}

/* ---------------- 「AI 复盘」的搜索量选择面板 ----------------
   ★ 2026-10-04 用户：「AI复盘搜索量我建议在点AI复盘后进行手动设置，默认500，可以调其他档」。
   复用复盘弹窗（#review）：先渲染选档面板，点「开始复盘」才真正开跑。 */
function openReviewSetup(it) {
  /* 已经在跑了就别再开选档面板（同一个弹窗，会盖掉进度）—— 直接把进度窗亮出来 */
  if (reviewBusy) { showReviewAgain(); return; }
  const name = (it && it.name) || '';
  const note = (it && it.note) || '';
  const hasReview = !!(it && it.hasReview);
  /* 读一下棋谱，只为在手数上给出「整盘大概多久」的估算 */
  window.api.records.read(name).then(rd => {
    const p = (rd && !rd.error) ? parseSGF(rd.text) : null;
    renderReviewSetup(name, note, (p && p.ok && p.moves) ? p.moves.length : 0, hasReview);
  }).catch(() => renderReviewSetup(name, note, 0, hasReview));
}

function renderReviewSetup(name, note, nMoves, hasReview) {
  RV_MASK.classList.add('open');
  const cur = reviewVisits();
  const labelOf = v => (VISIT_OPTS.find(o => o[0] === v) || ['', ''])[1];

  let seg = '<div class="seg rv-picks" id="rv-picks">';
  for (const [v, lb] of VISIT_OPTS) {
    seg += '<button data-v="' + v + '"' + (v === cur ? ' class="on"' : '')
      + ' title="' + esc(lb) + ' · ' + v + ' 次搜索">' + v + '</button>';
  }
  seg += '</div>';

  let h = '';
  h += '<h2>AI 复盘 <span class="rv-name">' + esc(note || name.replace(/\.sgf$/i, '')) + '</span></h2>';
  h += '<div class="rv-sub">整盘逐手重算' + (nMoves ? '（共 ' + nMoves + ' 手）' : '')
    + ' —— 每手算多少步由你定：越大越准，也越慢。</div>';
  h += seg;
  h += '<p class="rv-pick-note" id="rv-pick-note"></p>';
  if (hasReview) {
    h += '<div class="rv-sub" style="margin:0 0 12px;color:var(--text-dim)">'
      + '这份棋谱已经有一份报告了；重新复盘会用新结果<b>覆盖</b>它。'
      + '只想再看看上次的结果 → 点「看已存报告」。</div>';
  }
  h += '<div class="mfoot">'
    + (hasReview ? '<button id="rv-view">看已存报告</button>' : '')
    + '<div class="spacer"></div>'
    + '<button id="rv-cancel">取消</button>'
    + '<button id="rv-go" class="primary">开始复盘</button>'
    + '</div>';
  $('review-body').innerHTML = h;

  const noteEl = $('rv-pick-note');
  const refresh = v => {
    const eta = reviewEta(nMoves || 200, v);
    noteEl.textContent = '每手 ' + v + ' 步' + (labelOf(v) ? '（' + labelOf(v) + '）' : '')
      + ' · ' + (nMoves ? '这盘 ' + nMoves + ' 手，整盘 ' + eta : '一盘 200 手大约 ' + eta);
  };

  let pick = cur;
  $('rv-picks').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      $('rv-picks').querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      pick = parseInt(b.dataset.v, 10);
      refresh(pick);
    };
  });
  refresh(pick);

  $('rv-cancel').onclick = () => RV_MASK.classList.remove('open');
  const vw = $('rv-view');
  if (vw) vw.onclick = () => openSavedReview(name, note);
  $('rv-go').onclick = () => {
    settings.reviewVisits = pick;      // 记住这次的选择，下次默认就是它
    runReview(name);
  };
}

/* 打开**已存的复盘报告**（棋谱库每行的「复盘报告」按钮 / 选档面板里的「看已存报告」）。
   ★ 永远只有最新一份：新复盘会覆盖旧的（main.js 的 records:saveReview 直接写同一个文件）。 */
async function openSavedReview(name, note) {
  if (reviewBusy) { showReviewAgain(); return; }
  const cached = await window.api.records.readReview(name);
  if (!cached || !cached.text) { flash('这份棋谱还没有复盘报告 —— 先点「AI 复盘」算一份'); return; }
  let rv = null;
  try { rv = JSON.parse(cached.text); } catch (e) { rv = null; }
  if (!rv || !Array.isArray(rv.losses)) { flash('报告文件读不出来，请重新复盘'); return; }

  const rd = await window.api.records.read(name);
  if (!rd || rd.error) { flash('读取棋谱失败：' + ((rd && rd.error) || '未知')); return; }
  const p = parseSGF(rd.text);
  if (!p || !p.ok) { flash('棋谱解析失败，看不了报告'); return; }

  REC_MASK.classList.remove('open');
  applyRecord(p, name);                 // 载入棋谱（会清掉旧复盘），报告里「跳到那一手」才能用
  state.review = rv;
  if (!state.review.name) state.review.name = note || name.replace(/\.sgf$/i, '');
  state.review.file = name;
  if (Array.isArray(rv.history)) state.history = rv.history;
  if (Array.isArray(rv.leads)) state.leads = rv.leads;      // 旧报告没有这一项 → 目差模式会提示重算
  /* ★ 复盘的每一手都是同一档搜索量一起算的 → 精度标记统一按报告里记的那一档填。
     旧报告没记这一项的话退回「已够准」，免得它被随手一次粗算改写掉。 */
  if (Array.isArray(rv.history)) state.histVisits = rv.history.map(() => rv.visits || reviewVisits());
  renderMoveList();
  renderCurve();
  showReviewReport();
}

/* 真正跑复盘（选档面板点「开始复盘」后进来）。
   ★ 不再自动用缓存：报告由「复盘报告」按钮负责看；点「AI 复盘」就是要重算一份新的。 */
async function runReview(name) {
  if (reviewBusy) { showReviewAgain(); return; }
  if (!engineReady) { needEngine('analyze', '复盘'); return; }
  /* ★ 进门取号（2026-10-06 审查发现 + 定的修法）。
     原来判定与上锁之间隔着一个 await（读棋谱文件），那几毫秒里再点一次
     「开始复盘」会**真的开第二遍**（两份整盘请求、还会互相覆盖同一份报告文件）。
     修法不是「提前上锁」—— reviewBusy 是给后台分析当闸门用的，早置会让分析多停一段，
     而且提前上锁意味着每条提前 return 都要补复位，**漏一处就锁死**（比偶发双开严重得多）。
     改成同步取号 + 在一次 await 之后校验：连点时**先来的那个主动退出**，
     最坏情况也只是退回原来的行为，不会锁死、不会多做一份。 */
  const myRun = ++reviewSeq;
  const rd = await window.api.records.read(name);
  if (myRun !== reviewSeq) return;               // 期间又点了一次 → 这次作废，交给后来者
  if (!rd || rd.error) { flash('读取失败：' + ((rd && rd.error) || '未知')); return; }
  const p = parseSGF(rd.text);
  if (!p || !p.ok || !p.moves.length) { flash('这份棋谱里没有手顺，复盘不了'); return; }

  REC_MASK.classList.remove('open');
  applyRecord(p, name);                 // 载入棋谱（顺便切摆棋模式、清掉上一次复盘）
  const n = state.moves.length;
  const gen = gameGen;                  // ★ 这次复盘属于哪一局（applyRecord 刚把它 +1 过）

  reviewBusy = true;
  showReviewProgress(0, n + 1);
  const req = {
    initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
    moves: state.moves.map(m => [m.color === 'b' ? 'B' : 'W', m.pass ? 'pass' : toGTP(m.x, m.y)]),
    rules: (RULES[settings.rules] || RULES.chinese).kata,
    komi: settings.komi,
    size: N,
    maxVisits: reviewVisits(),
    /* 0..n：多算一个「最后一手之后」的回合 —— 最后一手的目损只能从它算出来 */
    analyzeTurns: Array.from({ length: n + 1 }, (_, i) => i),
  };
  let res;
  try { res = await window.api.review(req); }
  catch (e) { res = { error: String(e) }; }
  reviewBusy = false;
  /* 复盘期间分析是被压住的（runAnalysis 见了 reviewBusy 直接 return）→ 复盘一结束就补一次，
     让棋盘的胜率条 / 推荐点重新长出来（force：复盘把 history 整盘重写了，当前局面得重算）。 */
  scheduleAnalysis(0, true);

  /* ★ 复盘期间用户换了局（点了新对局 / 又打开了另一份棋谱）→ 这次复盘整体作废：
     否则会把**上一份棋谱的目损**画到当前这盘上，报告还会存到别的棋谱名下。 */
  if (gen !== gameGen) { RV_MASK.classList.remove('open'); return; }

  if (!res || res.error) { RV_MASK.classList.remove('open'); flash('复盘失败：' + ((res && res.error) || '未知')); return; }
  const turns = res.turns || [];
  if (turns.length < 2) { RV_MASK.classList.remove('open'); flash('复盘没拿到足够数据'); return; }

  state.review = buildReview(n, turns);
  state.review.name = name.replace(/\.sgf$/i, '');
  /* 顺手把胜率走势也填满：复盘每个回合都带 winrate（同样是「当前走棋方视角」，
     要换算成黑方胜率）。这样打开一份旧棋谱复盘后，走势图也是完整的一整盘。 */
  /* 走势数据：胜率和目差**各填一份**（都换算成黑方视角）—— 曲线两种纵轴要用 */
  const isWhiteTurn = x => String((x && x.root || {}).currentPlayer || '').toUpperCase() === 'W';
  state.history = turns.map(x => {
    const wr = x.root && x.root.winrate;
    if (typeof wr !== 'number') return undefined;
    return isWhiteTurn(x) ? 1 - wr : wr;
  });
  state.leads = turns.map(x => {
    const sl = x.root && x.root.scoreLead;
    if (typeof sl !== 'number') return undefined;
    return isWhiteTurn(x) ? -sl : sl;
  });
  /* ★ 整盘复盘的每一手都是**同一档搜索量**一起算出来的 → 精度标记统一填上。
     填了它，rememberEval 之后就不会用零散的中间报告去改写这些格
     （否则复盘完再随手看一下某手，那一手的涨跌就会被一次粗算覆盖掉）。 */
  state.histVisits = turns.map(() => reviewVisits());
  renderMoveList();      // 手数列表要标目损
  renderCurve();         // 走势图要标失误点
  if (res.incomplete) flash('复盘提前结束（超时），数据可能不全');
  /* ★ 把结果存下来（含胜率走势 + 这次用的搜索量）——
     records/<棋谱名>.review.json，**同一个文件直接覆盖** → 永远只有最新一份（用户要求）。
     以后点「复盘报告」就能直接看，不用重算。 */
  state.review.file = name;
  state.review.visits = reviewVisits();     // 报告里要显示「这是按多少步算出来的」
  state.review.history = state.history.slice();
  state.review.leads = state.leads.slice();
  try { await window.api.records.saveReview(name, JSON.stringify(state.review)); }
  catch (e) { /* 存不下也不影响本次查看 */ }
  refreshRecords();      // 让棋谱库里的「已复盘」标记和「复盘报告」按钮立刻变亮
  showReviewReport();
}

/* 点遮罩空白处关掉复盘弹窗 —— ★ 但**复盘进行中不许关**：
   否则用户以为是「取消了」，其实后台还在算（弹窗没了、界面又能点了 ——
   用户报的「灰色背景还能点击」就是点在这儿：一点就把进度窗关掉了）。 */
if (RV_MASK) RV_MASK.addEventListener('click', e => {
  if (e.target !== RV_MASK) return;
  if (reviewBusy) { showReviewAgain(); return; }
  RV_MASK.classList.remove('open');
});
/* ★ 加 !state.coach.batch：全盘讲解也会走这条「整盘逐手」的通路（它借了复盘接口），
   但它有自己的进度条 —— 别把「复盘」那个弹窗弹出来。 */
window.api.onReviewProgress(d => { if (reviewBusy && d && !state.coach.batch) showReviewProgress(d.done, d.total); });

/* ⚠️ 顶栏不再单独放「AI 复盘」按钮（2026-10-04 用户拍板）：
   复盘入口就是棋谱库每行的「AI 复盘」按钮 —— 两个入口反而多余。
   ★ 教训：删按钮时**必须同时删掉对应的 `$('id').onclick = ...`**，
     否则 `null.onclick = ...` 会抛 TypeError，**把它后面所有顶层代码全部中断**
     （键盘、初始化、启动逻辑都在后面）。 */


/* ---------------- 新对局面板 ---------------- */

function initSeg(id, apply) {
  const box = $(id);
  box.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      box.querySelectorAll('button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      apply(btn.dataset.v);
    };
  });
}

function setSeg(id, val) {
  const box = $(id);
  box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(val)));
}

initSeg('seg-color', v => { settings.color = v; });
initSeg('seg-size', v => { settings.size = +v; });
/* ★ 让子棋按标准**不贴目**（让子本身就是补偿，再贴就是双重补偿）。
   实测（2026-10-04）：让 3 子时多贴 7.5 目 = 白方白拿 7 目多 —— 引擎**不会**替我们
   处理这件事，得我们自己把贴目带去 0。取消让子则回到该规则的默认贴目。 */
initSeg('seg-handicap', v => {
  settings.handicap = +v;
  settings.komi = settings.handicap ? 0 : (RULES[settings.rules] || RULES.chinese).komi;
  setSeg('seg-komi', settings.komi);
});
initSeg('seg-komi', v => { settings.komi = +v; });

/* 对局类型（AI 对弈 / 摆棋·双人）—— 2026-10-04 用户要求「新对局面板分两块」：
   「我执」这个词只在**有 AI 的时候**才成立，摆棋/双人没有「我方」，
   所以那两行直接收起来（原来摆棋时还让人挑「我执」，纯属自找歧义）。
   ★ 这里直接改 settings.mode（跟面板里其它项一样是即时生效的设置），
     并把顶栏那个模式开关一起点亮，免得两处显示不一致。
   ★ 这里**不弹**「AI 执哪一方」的确认框（那个只在从顶栏切换时才弹）——
     面板里同屏就摆着「我执」那一行，比弹窗说得更清楚。 */
initSeg('seg-ntype', v => {
  settings.mode = v;
  setSeg('seg-mode', v);
  syncNewGameRows();
});

/* 按对局类型显隐面板里的行。注意 CSS 里有一条 `.mrow[hidden]{display:none}` ——
   .mrow 是 flex，不显式写就会被 display:flex 压过去（本项目踩过好几次）。 */
function syncNewGameRows() {
  const play = settings.mode === 'play';
  $('row-color').hidden = !play;      // 我执
  $('row-level').hidden = !play;      // 对手棋力
  $('level-note').hidden = !play;     // 档位说明（跟着对手棋力走）
  const hint = $('m-hint');
  if (hint) {
    hint.textContent = play
      ? '提示：学棋用「人类棋风」对手 + 让子，最容易看出「正常该往哪下」。'
      : '提示：两边都由你下，方便接着研究变化。让 N 子＝黑方开局先摆 N 个黑子，摆完由白方先走（让子局按标准不贴目）。';
  }
}

/* 模式切换：人机对弈 / 摆棋。切过去若正好轮到 AI，syncUI 会自动让它落子 */
initSeg('seg-mode', v => {
  if (state.draft) exitDraft();     // 切模式前先退出试下，免得「草稿」和「摆棋」语义打架
  /* ★ 摆棋 → AI 对弈：**先问一句 AI 执哪一方**（用户要求，见 openTakeover）。
     此刻 settings.mode 还是 'free' —— 用户点「取消」就等于什么都没发生；
     但 initSeg 已经把顶栏按钮点亮了，所以要先把它还原。 */
  if (v === 'play' && settings.mode === 'free') {
    setSeg('seg-mode', settings.mode);
    openTakeover();
    return;
  }
  settings.mode = v;
  syncUI();
});

/* ---------------- 摆棋 → AI 对弈：先确认「AI 执哪一方」（2026-10-04 用户要求） ----------------
   为什么必须问：摆棋模式下**两边都是用户在摆**，「我方」在切换那一刻没有定义 ——
   不问就只能沿用上次开新局时设的 myColor（界面上看不见），而且一切过去
   如果正好轮到那一方，AI 会立刻自己落一手，人完全没准备。 */
const TK_MASK = $('takeover');
let tkAI = 'w';          // 弹窗里选的「AI 执哪一方」

/* 弹窗里那行动态说明 —— 关键是把「点确定之后会发生什么」讲清楚：
   会不会 AI 立刻走一手 / 还是轮到你走。 */
function syncTakeoverNote() {
  const side = sideToMove(state.viewAt);
  const aiCol = tkAI === 'b' ? '黑' : '白';
  const myCol = tkAI === 'b' ? '白' : '黑';
  $('tk-note').textContent = '摆棋时两边都是你在摆，切换后由 AI 接手一方。'
    + (side === tkAI
      ? 'AI 执' + aiCol + '，正好轮到它 —— 点确定它会立刻走一手；你执' + myCol + '。'
      : 'AI 执' + aiCol + '，你执' + myCol + ' —— 点确定后轮到你走。');
}

function openTakeover() {
  const side = sideToMove(state.viewAt);
  $('tk-turn').textContent = '当前轮到 ' + (side === 'b' ? '黑' : '白') + ' 落子';
  /* 默认：AI 执「你现在的对方」—— 也就是沿用原设置不动，最少意外
     （想换成「让 AI 接着下当前这一手」，点另一边即可）。 */
  tkAI = state.myColor === 'b' ? 'w' : 'b';
  setSeg('seg-tk-color', tkAI);
  syncTakeoverNote();
  TK_MASK.classList.add('open');
}

function cancelTakeover() {
  TK_MASK.classList.remove('open');
  setSeg('seg-mode', settings.mode);    // 顶栏开关还原到「摆棋」（它已经被点亮了）
}

$('tk-cancel').onclick = cancelTakeover;
TK_MASK.addEventListener('click', e => { if (e.target === TK_MASK) cancelTakeover(); });
initSeg('seg-tk-color', v => {
  tkAI = v;
  if (TK_MASK.classList.contains('open')) syncTakeoverNote();
});

$('tk-ok').onclick = () => {
  TK_MASK.classList.remove('open');
  settings.mode = 'play';
  /* ★ 顶栏那个开关也要点亮到「人机对弈」——
     不然设置切过去了、按钮还停在「摆棋」上，两处显示打架
     （用户 2026-10-04 报的就是这个：从摆棋切过来后「人机对弈」没亮）。 */
  setSeg('seg-mode', 'play');
  /* 「AI 执 X」→ 我执另一方。settings.color 一并定下来（原来是「随机」也变成确定的），
     否则下次开新局又会随掉。 */
  const mine = tkAI === 'b' ? 'w' : 'b';
  settings.color = mine;
  state.myColor = mine;
  syncUI();       // 若正好轮到 AI，这里就会让它接手落子
};

/* 走势图纵轴切换：黑方胜率（%）/ 黑方领先目数。两者视角都是**黑方**，只是量纲不同。 */
initSeg('seg-curve', v => {
  state.curveMode = (v === 'lead') ? 'lead' : 'win';
  renderCurve();
});

/* 规则联动：切换规则时带出该规则的默认贴目；明清规则（座子制）下不能再让子 */
function syncRulesUI(rules, withKomi) {
  const R = RULES[rules] || RULES.chinese;
  if (withKomi) settings.komi = settings.handicap ? 0 : R.komi;   // ★ 有让子就不贴目
  setSeg('seg-komi', settings.komi);
  const dis = !!R.seats;
  const box = $('seg-handicap');
  box.querySelectorAll('button').forEach(b => { b.disabled = dis; });
  box.classList.toggle('off', dis);
  if (dis) { settings.handicap = 0; setSeg('seg-handicap', 0); }
}

$('m-rules').onchange = () => syncRulesUI($('m-rules').value, true);

/* ---------- 对手棋力下拉（真实段位） ----------
   顶栏 sel-level 与面板 m-level 都从 RANKS 生成，避免两处手写不同步。 */
function fillLevelSelects() {
  for (const id of ['sel-level', 'm-level']) {
    const sel = $(id);
    if (!sel) continue;
    sel.textContent = '';
    for (const g of RANK_GROUPS) {
      const og = document.createElement('optgroup');
      og.label = g;
      for (const r of RANKS) {
        if (r.group !== g) continue;
        const o = document.createElement('option');
        o.value = r.v;
        o.textContent = r.label;
        og.appendChild(o);
      }
      if (og.children.length) sel.appendChild(og);
    }
    sel.value = settings.level;
  }
}

/* 选中档位 → 显示「这个档位大概什么水平」
   （用户原话：我想先知道对方的水平，然后再开始跟他下） */
function refreshLevelNote() {
  const r = RANK_MAP.get(settings.level) || RANK_MAP.get('rank_3d');
  const note = $('level-note');
  if (note && r) note.textContent = r.label + ' · ' + r.note;
  const sel = $('sel-level');
  if (sel && r) sel.title = r.label + '：' + r.note;
}

function setLevel(v) {
  settings.level = RANK_MAP.has(v) ? v : 'rank_3d';
  $('sel-level').value = settings.level;
  $('m-level').value = settings.level;
  refreshLevelNote();
}

/* 顶栏改难度要立刻生效（原来只同步了下拉，settings 没跟着变） */
$('sel-level').onchange = () => { setLevel($('sel-level').value); syncUI(); };
$('m-level').onchange = () => { setLevel($('m-level').value); syncUI(); };

/* ---------- 分析搜索量（「计算深度」）----------
   生成下拉 + 说明当前档位的「快慢 / 精度」取舍。
   耗时数字是**实测**出来的（见 VISIT_OPTS 注释），不是估的。 */
/* 分析搜索量（「计算深度」）—— **两处下拉共用一个设置**：
   底栏（随时调，用户 2026-10-04 要求「要在下面设一个出来」）+ 「新对局」面板。 */
function fillVisitSelect() {
  const panel = $('m-visits');       // 面板：带档位名，看得懂
  if (panel) {
    panel.textContent = '';
    for (const [v, name] of VISIT_OPTS) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = name + ' · ' + v + ' 次';
      panel.appendChild(o);
    }
  }
  const bar = $('sel-visits');       // 底栏：只写「N 步」，省地方
  if (bar) {
    bar.textContent = '';
    for (const [v] of VISIT_OPTS) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = v + ' 步';
      bar.appendChild(o);
    }
  }
  setVisits(settings.visits);
}

/* 设定搜索量：写进 settings，并让两个下拉保持一致 */
function setVisits(v) {
  const n = parseInt(v, 10);
  settings.visits = VISIT_OPTS.some(o => o[0] === n) ? n : 500;
  for (const id of ['m-visits', 'sel-visits']) {
    const el = $(id);
    if (el) el.value = String(settings.visits);
  }
  refreshVisitsNote();
}

/* 改档位 → 立即生效。★ 热切换：maxVisits 是**每个分析请求自带的参数**，
   runAnalysisOnce 每次现读 settings.visits，所以改完下一次分析就用新值，
   不用重开对局、不用重启程序。这里顺手重算一次，免得用户要等下一手才看到效果。 */
function applyVisits(v) {
  setVisits(v);
  flash('计算深度：每手 ' + settings.visits + ' 步 · 已生效');
  scheduleAnalysis(0, true);      // ★ force：档位变了，当前局面要用新搜索量重算一遍
}

function refreshVisitsNote() {
  const note = $('visits-note');
  if (!note) return;
  const v = settings.visits;
  /* 耗时按实测点（500→0.4s、1600→0.7s、3000→约 1.2s）内插 */
  const sec = v <= 150 ? '约 0.1 秒' : v <= 250 ? '约 0.2 秒' : v <= 400 ? '约 0.3 秒'
    : v <= 600 ? '约 0.4 秒' : v <= 900 ? '约 0.5 秒' : v <= 1200 ? '约 0.6 秒'
      : v <= 1700 ? '约 0.75 秒' : v <= 2500 ? '约 1.0 秒' : '约 1.3 秒';
  note.textContent = '每手思考 ' + v + ' 步 · ' + sec + '出推荐点。' + (
    v <= 300 ? '最快；复杂局面的选点会飘。' :
      v <= 800 ? '速度与精度平衡，日常看棋够用。' :
        '更稳；推荐点出现更慢。'
  );
}

$('m-visits').onchange = e => applyVisits(e.target.value);
$('sel-visits').onchange = e => applyVisits(e.target.value);

function openNewGame() {
  $('m-rules').value = settings.rules;
  setLevel(settings.level);
  setSeg('seg-color', settings.color);
  setSeg('seg-size', settings.size);
  setSeg('seg-handicap', settings.handicap);
  setSeg('seg-komi', settings.komi);
  setSeg('seg-ntype', settings.mode);   // 对局类型跟着当前的模式走
  $('m-clock').value = settings.clock;
  fillVisitSelect();                     // 搜索量下拉（值同步 + 说明文字）
  syncRulesUI(settings.rules, false);   // 只做禁用联动，不覆盖用户选过的贴目
  syncNewGameRows();                     // 按类型显隐「我执」「对手棋力」
  $('newgame').classList.add('open');
}

$('btn-new').onclick = openNewGame;
$('btn-gate-new').onclick = openNewGame;   // ★ 未开局时棋盘中央那个大按钮（同一入口）
/* 引擎没起来时，中央那条提示里的「去设置」（openSettings 是函数声明，会提升） */
$('gate-setup').onclick = () => openSettings();
$('m-cancel').onclick = () => $('newgame').classList.remove('open');
$('newgame').onclick = e => { if (e.target === $('newgame')) $('newgame').classList.remove('open'); };

$('m-start').onclick = () => {
  settings.rules = $('m-rules').value;
  setLevel($('m-level').value);
  settings.clock = $('m-clock').value;
  /* 类型以面板上亮着的那一个为准（点它时已经改过 settings.mode，这里再对齐一次） */
  const nt = $('seg-ntype').querySelector('.on');
  if (nt) settings.mode = nt.dataset.v;
  applyNewGame();
  $('newgame').classList.remove('open');
};

/* idle = true → 只把界面摆成「未开局」的中性样子（**软件启动时**用，见文件末尾的启动段）。
   点「新对局 → 开始」时不传这个参数，等于真的开一局。 */
function applyNewGame(idle) {
  N = settings.size;
  state.fromRecord = false;     // 新开的局不是打谱
  state.sgfComments = [];       // 新开局没有「棋谱自带的解说词」
  state.rootComment = '';       // 也没有「棋谱说明」（那是某份棋谱根节点上的文字）
  state.quizTips = [];           // 也不是题集，没有「第几题」
  state.recName = '';           // ★ 也不是某份棋谱了 —— 讲解没有存放处（全盘讲解按钮会收起）
  clearCoachPanels();           // 讲解只在对局期间保留（用户要求：开新局就清）
  const R = RULES[settings.rules] || RULES.chinese;

  if (R.seats) {
    state.setup = seatStones(N);      // 明清规则：四角座子（黑白各二）
    state.toMove = 'w';               // 古谱白先
  } else if (settings.handicap) {
    state.setup = handicapStones(N, settings.handicap);
    state.toMove = 'w';
  } else {
    state.setup = [];
    state.toMove = 'b';
  }

  state.moves = [];
  state.candidates = [];
  state.candAt = -1;
  state.ownership = null;
  state.ownAt = -1;
  state.history = [];               // 走势数据随之清空（胜率 + 目差两条）
  state.leads = [];
  state.histVisits = [];            // ★ 精度标记一起清（它跟 history 是一对，见 state 注释）
  resetAnalysisState();             // 换局：旧的分析欠账 / 「已上屏」标记全部作废
  state.viewAt = 0;
  state.thinking = false;
  state.koPoint = null;
  state.draft = null;              // 新对局：退出试下状态
  state.result = null;             // 新对局：清掉终局结果
  state.lastEval = null;
  state.review = null;             // 新对局：清掉上一次的复盘数据（目损标记）
  state.pv = null;                 // 新对局：收掉变化图
  state.names = { b: '', w: '' };  // 新对局：名字回到默认（人机 PLAYER/KATAGO、摆棋 PLAYER1/2）
  state.noGame = !!idle;           // ★ 启动时停在「未开局」；「新对局 → 开始」时解除
  hover = null;

  if (settings.color === 'r') state.myColor = Math.random() < 0.5 ? 'b' : 'w';
  else state.myColor = settings.color;

  setSeg('seg-mode', settings.mode);
  clockReset();          // 计时按新设置重置（不限时则隐藏计时面板）
  resize();
  syncUI();
}

/* ---------------- 引擎分析 ---------------- */

/*单次分析的目标搜索量。
   ★ 2026-10-04 从 1600 降到 500 —— 这是「推荐点要实时出现」的关键。
     问题不在我们的显示逻辑，而在**引擎一次只能算一个请求**：
     旧局面的分析要跑满 1600 visits（约 2~3 秒）才轮到新局面，
     所以落子后推荐点要等 3 秒多才更新（实测 3275ms / 3156ms 两次）。
     中途报告机制本来是好的（引擎每 0.25 秒推一次），但被这个时长拖住了。
     实测对比（三个局面各跑 3 次，见 _diag_visits.js）：
       500 visits：0.4 秒，布局/中盘的首选点与前 4 候选**和 1600 完全一致**；
                  只有复杂中盘的首选点会在两三个好点之间跳（前 4 候选集合仍相同）
       1600 visits：0.7 秒，胜率波动更小（0.2% vs 0.7%）
     → 慢一倍换来的精度提升很小，而响应速度是**能直接感觉到的**，所以选 500。
   ★ 2026-10-04 后续：用户要求「做成可调」，所以这个常量只当**默认值**用，
     实际取值在 settings.visits（「新对局」面板 → 计算深度，见 VISIT_OPTS）。 */
const ANALYZE_VISITS = 500;
/* 搜索量低于此值时先不显示候选点。
   ★ 2026-10-04 从 150 降到 20 —— 用户对照 KaTrain 指出：
     「计算中不是棋盘上啥都不显示，而是会显示推荐选点，选点圈里还显示搜索次数，
       就算搜的不多，也先在棋盘上显示出来」。
     我们本来也是边搜边刷的（引擎每 0.25 秒推一次中途报告 → applyAnalysis），
     但 150 这道门槛把开头 1~2 秒整个挡住了 → 棋盘空白。
     降到 20 后，落子约 0.1 秒就有第一批点可画，观感变成「实时出现、数字往上走」。
     只保留一个极低门槛，是为了滤掉 visits=0/1 那种纯噪声（点的排序会乱跳）。 */
const HINT_MIN_VISITS = 20;

/* 渲染端等一次分析请求回来最多等多久（毫秒）——见 runAnalysisOnce 里的 Promise.race。
   取值理由：
     · 正常一次分析 0.4~1.5 秒（500 visits，实测中位 472ms）；
     · 引擎切到一个全新局面重建搜索树最慢约 1~3 秒；
     · 就算「计算深度」调到最大档（用户能选到的上限）也远在 25 秒内。
   25 秒是「不可能有这么慢的正常请求」的界线 —— 超过它就不是慢，是那条路断了。
   ⚠️ 别调太小：调成 5 秒会在深档位下把正常请求误判成超时，反而让分析一直在重排。 */
const ANALYZE_TIMEOUT_MS = 25000;

/* ★ 分析链路的轻量埋点（2026-10-07 新增）。
   为什么要它：用户报「AI 落子后马上悔棋，选点/形势有时卡住不显示」，
   但标准时序在测试环境里跑十轮都不卡 —— 说明是**竞态**，光看界面复现不了。
   有这组计数就能在卡住的那一刻回答"它到底卡在哪一步"：
     start    = 进入一轮分析循环
     okCount  = 这一轮里成功算完几次局面
     failEarly= runAnalysis 开头的提前 return（分别是 scoreBusy / reviewBusy / 引擎没就绪 / busy）
     failOnce = runAnalysisOnce 返回 false（出错 / 被取消 / 超时）
     breakAt  = 循环为什么退出（guard 用尽 / 换局 / 数子 / 复盘 / 引擎掉了 / 算失败）
     skipHuge = 队列里那些「at 已经大于手数」被跳过的次数
   只读写几个数字，不改任何行为（Ctrl+Shift+D 会把它打出来）。 */
const anaDiag = {
  start: 0, okCount: 0, failEarly: { score: 0, review: 0, notReady: 0, busy: 0 },
  failOnce: 0, breakAt: {}, skipHuge: 0, lastFailWhy: '', lastAt: 0,
  note(why) { this.breakAt[why] = (this.breakAt[why] || 0) + 1; this.lastFailWhy = why; this.lastAt = Date.now(); },
};

/* ★ 分析链路曾经有过一个"把关键决定写进文件"的日志（v0.1.17 加的），
   用来定位「推荐点偶尔不出来」那个偶发问题 —— **问题解决后就撤掉了**（v0.1.18）。
   撤掉的理由（用户提的）：它太占地方 —— 实测玩 20 秒就写 63.8 KB，约 11 MB/小时，
   而且是**同步写盘**（每次 appendFileSync 都阻塞主进程）。
   本软件要尽量轻，不做"像手机 APP 那样一直产生垃圾文件"的事。

   ⚠️ 以后万一再需要它：别恢复成"常开写文件"，改成
     · 只在用户按 Ctrl+Shift+D 时**把它打到状态栏**（那已经是现成的自检），或者
     · 加个显式开关，默认关。
   下面是保留的空函数（调用点先留着，方便将来一行切换；不发 IPC、不写盘，零成本）。 */
function alog(msg) { /* 已撤：见上面的说明 */ }

/* 连续超时计数（成功一次就归零）。超时后要主动重排一次，但不能无限重排 ——
   引擎真挂了的时候，无限重排会变成每 25 秒一次的无效空转，日志和界面都在刷。 */
let anaTimeouts = 0;
/* 「anaBusy 是什么时候置上的」——给顶栏那个「刷新」按钮判断"是真卡了还是正在算"。
   置上时间超过 REFRESH_STUCK_MS 就一定不是正常请求（正常一次 0.4~1.5 秒）。 */
let anaBusySince = 0;
const REFRESH_STUCK_MS = 12000;

const toGTP = (x, y) => GTP_COLS[x] + (N - y);

function fromGTP(s) {
  const m = /^([A-Ta-t])(\d{1,2})$/.exec(String(s).trim());
  if (!m) return null;
  const x = GTP_COLS.indexOf(m[1].toUpperCase());
  if (x < 0 || x >= N) return null;
  const y = N - parseInt(m[2], 10);
  if (y < 0 || y >= N) return null;
  return { x, y };
}

/* 第 n 手之后轮谁走（让子局 / 明清座子局都是白先） */
function sideToMove(n) {
  const first = state.setup.length ? 'w' : 'b';
  return (n % 2 === 0) ? first : (first === 'b' ? 'w' : 'b');
}

let engineReady = false;       // 分析引擎（strong 权重）：胜率 / 候选点 / 走势曲线
let engineReadyPlay = false;   // 对弈引擎（human 权重）：AI 落子 + 真实段位档位
let coachReady = false;        // ★ LoGos 讲解模型（2026-10-05 新增）
let engineNote = '';
let coachNote = '';            // ★ 讲解模型自己的错误（它坏了不该算「引擎异常」——不装也能下棋）
/* ★ 三个引擎各自的原始状态：'off' 未加载 / 'loading' / 'ready' / 'paused' / 'error'
   顶栏那两个状态灯直接照它画。
   为什么单独存一份：引擎从「开机自动加载」改成「手动加载」了 ——
   「未加载」是**正常状态**、不是故障，界面必须能区分「没加载」和「挂了」。 */
let engStates = { analyze: 'off', play: 'off', coach: 'off' };
/* 在「设置」里改完路径 → 引擎正在按新配置重启（状态栏常驻提示，就绪后自动清掉）。
   ⚠️ 必须在 syncUI 之前声明：syncUI 会读它，而 syncUI 在启动时就会被调用（TDZ 会炸）。 */
let engineReloading = false;
let anaTimer = null;
/* 屏幕上这批结果（胜率条 / 候选点 / 形势雾）是「第几手之后」的局面算出来的。
   -1 = 还没有。与 state.viewAt 不等 → 说明当前看的这个局面还没分析上屏。 */
let shownAt = -1;

/* 待补算的手数队列（只为补 history —— 胜率走势曲线与手数列表的「涨跌」都靠它）。
   ★★ 为什么必须有这个队列（2026-10-04 用户报「手数列表里胜率涨跌有时候不显示，
      还得我点一下才有；是不是还没来得及分析完就下一手了」——正是如此）：
      旧逻辑是「只算当前局面 + 200ms 防抖」，而**防抖会把还没轮到算的那个局面直接丢掉**：
      人机对弈时用户落子后轮到 AI，AI（human 模型、400 visits）经常在 200ms 内就回了手，
      下一个 syncUI 的 clearTimeout 一来，就把「用户刚下那一手之后的局面」的定时器清掉 ——
      那个局面从此再没有任何一次分析 → history[n] 缺一格 → 第 n 手的涨跌永远算不出来。
      用户「点一下那一手」（gotoView → 重新分析）才把它补上，现象完全对得上。
   改法：入队在**防抖之前**（只要这个局面还没算过就先记下来），当前局面算完再按顺序补上，
   一个都不漏 —— 也就是用户要的「分析引擎独立于当前手数，到了下几手也要把前面的算好」。 */
let anaQueue = [];
let anaForceCur = false;   // 当前局面是否要强制重算（改了计算深度 / 数子之后刷新画面）

/* 补账队列的长度上限（2026-10-06 晚新增）。
   为什么要限：补账和历史曲线用的是**同一个引擎**（选点优先，见 runAnalysis 的循环顺序），
   队列无限长的话，用户连点几十手之后引擎会长时间忙于补旧账 ——
   实测**不会**拖慢选点（选点永远排在前面，且新请求会掐掉正在跑的补账：
   有欠账时选点延迟中位 377ms，无欠账 470ms，见 _cdp_priority.mjs），
   但曲线要很久才补齐、而且引擎没有空闲。
   取 40：正常一局连点几十手也补得完；真到 40 以上说明用户在极快地连点，
   那种节奏下"最近 40 手的涨跌还准"就够了，更早的等下一次落子慢慢补。 */
const ANA_QUEUE_MAX = 40;

function scheduleAnalysis(delay, force) {
  /* ★ 未开局：**一次分析都不发**（用户要求「胜率条五五开不动」）。
     这是「不动」的根子 —— 数字由 syncUI 画成中性，而且没有请求来覆盖它。
     注意要放在入队**之前**：否则会在队列里留一条永远没人处理的欠账。 */
  if (state.noGame) { alog('schedule 未开局 → 不发'); return; }
  const at = state.viewAt;
  const why = [];
  if (force) { anaForceCur = true; why.push('force'); }
  /* 入队（去重）。试下（草稿）里的局面不记 —— 那些手等会儿会被整体丢掉，算了也是白算。 */
  const draftSkip = (state.draft && at > state.draft.from);
  if (draftSkip) why.push('草稿内跳过入队');
  else if (typeof state.history[at] === 'number') why.push('history已有→不入队');
  else if (anaQueue.indexOf(at) >= 0) why.push('队列已有');
  if (!draftSkip
    && typeof state.history[at] !== 'number'
    && anaQueue.indexOf(at) < 0) {
    anaQueue.push(at);
    /* ★ 超长就丢掉最旧的那几条（见 ANA_QUEUE_MAX）。丢的是「最久以前那一手」，
       它多半已经不在用户视线里；当前局面和最近几手永远留着。 */
    if (anaQueue.length > ANA_QUEUE_MAX) anaQueue.splice(0, anaQueue.length - ANA_QUEUE_MAX);
  }
  clearTimeout(anaTimer);
  /* ★ 这里**不要**加「取消正在跑的分析」。试过（2026-10-04）：
     取消确实能让旧请求停下（搜索量不再增长），但**总耗时不降**（1026ms vs 1032ms）——
     因为瓶颈是「引擎切换到一个新局面的第一批结果本身要约 0.8 秒」（要重建搜索树）。
     既然没有收益，就不留这个异步竞态（cancel 晚一步到主进程会误杀刚发出的新请求）。 */
  anaTimer = setTimeout(runAnalysis, delay === undefined ? 200 : delay);
  /* ★ 关键节点记一行：这一笔排了没有、为什么没排、当前各处状态。
     卡住之后回看这一段，就能知道"那一刻到底有没有人动手"。 */
  alog('schedule at=' + at + ' delay=' + (delay === undefined ? 200 : delay)
    + ' 入队=' + (why.some(w => w.indexOf('→') >= 0 || w === '队列已有') ? '否(' + why.join(',') + ')' : '是')
    + ' q=[' + anaQueue.join(',') + '] shownAt=' + shownAt + ' candAt=' + state.candAt
    + ' busy=' + anaBusy + ' force=' + anaForceCur + ' hist[' + at + ']=' + (typeof state.history[at] === 'number' ? '有' : '无'));
  /* ★ 顺手挂一次「卡住自愈」检查：只在「算过但没上屏」时才会真的排定时器 */
  scheduleStallRecovery();
}

/* 换了棋谱 / 开了新局 → 旧的欠账和「已上屏」标记全部作废 */
function resetAnalysisState() {
  anaQueue = [];
  shownAt = -1;
  clearTimeout(anaTimer);
  clearTimeout(anaStallTimer); anaStallTimer = null;
  anaStallWatched = -1; anaStallTries = 0;
  gameGen++;        // ★ 换局 / 换棋谱：作废在飞的那次分析（见 gameGen 的注释）
}

/* ★★ 自愈网：「算过但没上屏」的状态卡住时，自己再算一次（2026-10-07 新增）。
   治的是什么：`shownAt`（算过）与 `candAt`（真上屏了）**不一致**时，
   `runAnalysis` 会以为当前局面已算过而跳过它、`scheduleAnalysis` 又会因
   `history[at]` 有值而去重 —— 两头都不动手，那个局面就永远停在「计算中… N」上。
   （根因已在 `runAnalysisOnce` 修掉：只有 `applyAnalysis` 真上屏才记 shownAt。
     这里再兜一道，万一还有别的路径造成同样不一致，它能自己纠正，
     用户不用靠"再落一手"把它撞好。）

   为什么用**一次性定时器**而不是常驻轮询：只在"看起来卡了"的时候才排一次，
   自限、不空转。 */
let anaStallTimer = null;
let anaStallWatched = -1;       // 正在自愈哪个手数（-1 = 没有）
let anaStallTries = 0;          // 这一手已经自愈过几次
const ANA_STALL_MAX_TRIES = 20; // 上限（防死循环）；每次间隔 6 秒，20 次 ≈ 2 分钟
function scheduleStallRecovery() {
  const cur = state.viewAt;
  if (state.noGame || cur <= 0) return;
  if (state.viewAt !== state.moves.length) return;   // 回看历史时不算卡（那时本来不画选点）
  if (shownAt !== cur || state.candAt === cur) {
    /* 没卡（要么还没算、要么已上屏）→ 清掉这一手的计数，下次卡住能从头再来 */
    if (anaStallWatched === cur) { anaStallWatched = -1; anaStallTries = 0; }
    return;
  }
  if (anaStallWatched !== cur) { anaStallWatched = cur; anaStallTries = 0; }
  /* ★★ 反复尝试，不是"只试一次"（2026-10-07 踩的坑）。
     第一版写的是 `if (anaStallWatched === cur) return;` —— 想避免重复排定时器，
     结果**卡住之后这个值一直等于 cur**，于是之后每次 scheduleAnalysis 都在这里 return，
     自愈定时器**再也不会排**：第一次没救回来就永久卡住。
     用户实测就是这个现象（「过了很久也没修好，没用自己修」）。
     正解：卡住期间**每 6 秒重试一次**，直到好为止（有次数上限防死循环）。 */
  if (anaStallTries >= ANA_STALL_MAX_TRIES) return;
  if (anaStallTimer) return;                     // 已经有一个在等着了
  anaStallWatched = cur;
  anaStallTries++;
  anaStallTimer = setTimeout(() => {
    anaStallTimer = null;
    if (state.viewAt !== cur || state.candAt === cur) { anaStallWatched = -1; anaStallTries = 0; return; }   // 期间自己好了
    alog('★ 自愈第 ' + anaStallTries + ' 次：检测到「算过但没上屏」（shownAt=' + shownAt
      + ' candAt=' + state.candAt + ' viewAt=' + cur + '）→ 强制重算');
    console.warn('[分析] 自愈第 ' + anaStallTries + ' 次：重算第 ' + cur + ' 手');
    anaDiag.note('自愈：算过但没上屏');
    anaForceCur = true;
    scheduleAnalysis(0, true);
    /* ★★ 关键：**自己续排下一次**（2026-10-07 踩的坑）。
       不能指望用户再操作一次来触发 scheduleAnalysis —— 卡住的时候他往往正盯着屏幕等，
       **不会再点任何东西**，那样自愈就只试了一次、失败一次就再也不动。
       （第一版就是这么错的：写成"同一手数只排一次"，结果卡住后永远不再排。） */
    anaStallWatched = -1;          // 让下一次判断重新走一遍
    scheduleStallRecovery();       // 若仍然卡着，6 秒后再来一次
  }, 6000);
}

/* ★★ 悔棋 / 停一手 / 任何「局面变短」的操作之后必须调用（2026-10-06 实测定位）。
 *
 * 症状：悔棋后 KataGo 的分析**彻底停住**（搜索量不涨、胜率条不再更新）。
 * 实测数据（_cdp_undo.mjs）：落 10 手后悔棋 3 次 →
 *     moves=7，但队列 q=[5,6,7,8,9,10]（**8/9/10 已是��存在的局面**），
 *     history 的有效项数涨到 11（**比手数还多**），visits 恒定在 515 不动。
 *
 * 两个根因（缺一不可）：
 *   ① **队列没截断** —— 里面留着比当前手数大的 at。runAnalysisOnce(8) 会去算
 *      `state.moves.slice(0, 8)`，可moves 只有 7 —— 请求发出去算的是第 7 手，
 *      回来却按「第 8 手」写进 history（rememberEval(at) 用的是传入的 at）。
 *      结果：**脏数据灌进 history/leads**，而且这些永远算不完的欠账
 *      把 anaBusy 一直占着（busy 卡在 true）→ 真正的当前局面再也排不上队。
 *   ② **history / leads 没截断** —— 已撤销的那些手的走势数据留在数组里。
 *      走势曲线会画出不存在的「第 8、9、10 手」，点进手数列表也能看到幽灵数据。
 *
 * 只做① 不做 ② 的话，曲线仍然是错的；反过来 ① 会让分析继续卡死。
 */
function truncateAnalysisTo(len) {
  /* 队列里超过新手数的一律丢掉（它们代表的局面已经不存在了）。
     注意是「过滤」不是「清空」—— 当前局面那一项还要留着，它是对的。 */
  anaQueue = anaQueue.filter(at => at <= len);
  /* history / leads 截断到 len+1 个元素（索引 at 表示「第 at 手之后」，
     所以合法索引是 0..len）。多出来的直接砍掉。 */
  if (state.history.length > len + 1) state.history.length = len + 1;
  if (state.leads.length > len + 1) state.leads.length = len + 1;
  /* ★ histVisits（每格的精度）必须跟着一起截 —— 它是 history 的伴随数组，
     错位一格就等于拿别的手的精度去判断这一格要不要改写（2026-10-06 晚新增）。 */
  if (state.histVisits.length > len + 1) state.histVisits.length = len + 1;
  /* candAt / ownAt 也别指着不存在的局面，否则候选点和形势雾会被当成过期的画淡。 */
  if (state.candAt > len) state.candAt = -1;
  if (state.ownAt > len) { state.ownership = null; state.ownAt = -1; }
  /* ★★★ `shownAt` 必须与 `candAt` **同进同退**（2026-10-07 日志定位到的真根因）。
     它们是"同一批结果"的一对记号：
       candAt = 这批候选点是第几手算的（画盘用）
       shownAt = 屏幕上这批结果算的是第几手（要不要重算用，判据 shownAt !== cur）
     ⚠️ 原来这里只写了 `if (shownAt > len) shownAt = -1;` —— 只管了"大于新长度"这一种情况。
        而悔棋**退到某一手**时会出现：candAt（假设 6）> len（2）→ 被清成 -1；
        但 shownAt 恰好**等于** 2（≤ len）→ 原样留着。
        于是"这批选点废了"与"这个局面显示过了"同时成立 —— 死结：
          · runAnalysis 判 `shownAt !== cur` 为假 → 跳过当前局面，不重算
          · scheduleAnalysis 又因 `history[cur]` 有值 → 不入队
        两头都不动手 → **那个局面永远不再分析**，界面就是
        「计算中… N 定住不动、推荐点永远不出来」。
        实测证据：调试实例的《分析链路.log》里出现
          「run 认为已算过但 candAt=-1 ≠ viewAt=2」+ 前后都是 busy=false/force=false/hist[2]=有。
     所以规矩是：**candAt 若失效，shownAt 一起失效**（要废一起废）。 */
  if (state.candAt === -1) shownAt = -1;
  else if (shownAt > len) shownAt = -1;
  /* 曲线 / 手数列表不用在这里刷 —— 调用方紧接着就 syncUI()，那里会重画。
     在这里刷等于每悔棋一次多两次全量重绘。 */
}

/* ★★ 落子 / 停一手后，把「该手号」上留着的旧讲解清掉（2026-10-06 审查发现）。
   为什么必须清：讲解是**按手号**存的（`state.coach.explain[at]`，at = 第几手），
   而悔棋不会动这些数据 —— 于是「悔棋 → 换一手重下」之后，
   新落的第 k 手会去查 `explain[k]`，拿到的是**上一手（旧那手）的讲解**：
     · 框里写着旧手的坐标和理由，盘上却是另一手；
     · 做「全盘讲解」时它被当成「已讲过」跳过（`if (!state.coach.explain[at])`）；
     · `saveCoachFile` 会把这份错内容写进 `<棋谱名>.coach.json` —— **之后永远不再重讲**。
   手号是唯一的失效依据（我们没存局面指纹），所以在**写入的同一处**把它清掉最稳：
   `tryPlay` / 停一手 / AI 停一手 三个落子点都调它。 */
function clearCoachAt(at) {
  const ex = state.coach && state.coach.explain;
  if (ex && at && ex[at]) delete ex[at];
}

/* ★ 单飞（同一时刻只允许一次分析在飞）—— 2026-10-04 实测定位出的 bug：
   原来每次落子都发一个分析请求，而 main.js 里**每个新请求都会 `terminateId` 掐掉前一个**
   （见 main.js 的 analyze()）。落子快过分析时，引擎陷进「启停风暴」：
   实测连续落子（间隔 1 秒）12 手 → ownership 卡在旧局面**一动不动**，
   停止落子后还要等约 **20 秒**才追上（落后 11 手）。用户报的就是「形势变着变着就停下来了」。
   改法：任何时刻最多一个请求在飞；没轮上的局面进 anaQueue，跑完接着补。
   效果：不会雪崩，且一定会收敛到最新局面，欠下的历史也会补齐。 */
let anaBusy = false;      // 是否已有一次分析在跑
let anaPoke = false;      // 跑的过程中又被调度过 → 跑完再看一眼

/* ★ 「棋局代次」：换局 / 换棋谱时 +1。**凡是「发请求 → 等结果 → 写状态」的地方都要用它**，
   回来时对不上就整体丢弃 —— 否则属于上一局的结果会落到这一局上。
   为什么必须有它（2026-10-04 实测踩到）：换局时旧请求还在飞，回来时判断条件可能"恰好"成立 ——
     · 分析：`at === state.viewAt`（旧局第 0 手 vs 新局 viewAt=0）
     · AI 落子：`state.moves.length === expectLen`（两边都是空盘，都是 0）
     · 数子 / 复盘：压根没有局面校验，直接写 state.result / state.review
   现象分别是「未开局状态下走势图还挂着数据」「重开一局后 AI 往空盘上落一手」
   「新局上冒出上一局的胜负」。
   （同一局内换局面的情况由 `at !== state.viewAt` 那条管着，两者互补。） */
let gameGen = 0;
let anaReqGen = -1;       // 当前在飞的那个**分析**请求属于哪一代（onProgress 用）

async function runAnalysis() {
  anaDiag.start++;
  /* ★ 数子期间**不发分析请求**：否则新分析会在 main.js 里 terminateId 掐掉数子查询，
     数子就会拿到半成品或直接失败（用户报过「点完数子按钮好像没发生什么」）。
     数子跑完会主动补一次分析，见 runScore 的 finally。 */
  if (scoreBusy) { anaDiag.failEarly.score++; anaDiag.note('数子中提前return'); alog('run 数子中 → 不发'); return; }
  /* ★ 复盘同理：复盘是一次「整盘逐手」的长请求，被分析掐掉就白跑了（可能要等两分钟）。
     复盘结束后会主动刷一次界面，见 runReview。 */
  if (reviewBusy) { anaDiag.failEarly.review++; anaDiag.note('复盘/讲解中提前return'); alog('run 复盘/讲解中 → 不发'); return; }
  if (!engineReady) { anaDiag.failEarly.notReady++; anaDiag.note('引擎未就绪提前return'); alog('run 引擎未就绪 → 不发'); return; }
  if (anaBusy) { anaPoke = true; anaDiag.failEarly.busy++; alog('run 已有请求在飞 → 只登记 poke'); return; }
  anaBusy = true;
  anaBusySince = Date.now();                     // ★ 给「刷新」按钮判断卡死用
  const gen = gameGen;                            // ★ 这一轮属于哪一代
  alog('run 开始 代=' + gen + ' q=[' + anaQueue.join(',') + '] viewAt=' + state.viewAt
    + ' shownAt=' + shownAt + ' candAt=' + state.candAt + ' force=' + anaForceCur);
  try {
    /* 上限只是防止意外死循环（正常一轮只会跑十几次）。 */
    for (let guard = 0; guard < 500; guard++) {
      if (scoreBusy || reviewBusy || !engineReady) { anaDiag.note('数子/复盘/引擎掉了 中断循环'); alog('run 循环中断：数子/复盘/引擎掉了'); break; }
      if (gen !== gameGen) { anaDiag.note('换局中断循环'); alog('run 循环中断：换局/换棋谱（代 ' + gen + '→' + gameGen + '）'); break; }   // ★ 换局 / 换棋谱了：剩下的欠账全部作废

      /* ① 先算**当前看着的局面** —— 胜率条 / 候选点 / 形势雾要它上屏（最高优先）。 */
      const cur = state.viewAt;
      if (shownAt !== cur || anaForceCur) {
        const ok = await runAnalysisOnce(cur);
        if (ok) { anaDiag.okCount++; anaForceCur = false; }
        else { anaDiag.failOnce++; anaDiag.note('runAnalysisOnce 返回 false'); alog('run 当前局面 at=' + cur + ' 这一趟没成功 → 退出循环'); break; }
        continue;
      }
      /* ★ 走到这里就说明「认为当前局面已算过」—— 这是最可疑的一条路，
         因为如果 candAt 却没跟上，那这个局面就再也不会被重算。
         记一行，卡住时一眼能看出来。 */
      if (state.candAt !== cur) {
        alog('★ run 认为已算过但 candAt=' + state.candAt + ' ≠ viewAt=' + cur
          + '（跳过当前局面，去补欠账；若此处反复出现就是卡住的源头）');
      }

      /* ② 再补欠账：把队列里「还没有 history」的手数从旧到新算出来（只写 history，不动画面）。 */
      const at = anaQueue.shift();
      if (at === undefined) break;               // 没有欠账了
      /* ★★ 越界欠账直接丢（2026-10-06 实测定位到的坑）。
         悔棋后队列里会残留比当前手数大的 at（那些局面已经不存在了）。
         若不拦：runAnalysisOnce(8) 会去算 `moves.slice(0, 8)` —— moves 只有 7 手，
         引擎算的其实是第 7 手，回来却按「第 8 手」写进 history[8]，
         **JS 数组会因此扩容**（实测 7 手的 history 长度涨到 11）。
         这些幽灵数据让 anaBusy 长期占着（busy 卡在 true），
         真正的当前局面再也排不上队 → **用户看到的现象就是「悔棋后分析停住了」**。 */
      if (at > state.moves.length) { anaDiag.skipHuge++; continue; }
      if (typeof state.history[at] === 'number') continue;   // 已经补上了（比如刚作为当前局面算过）
      if (at === cur) continue;                  // 当前局面刚算过
      await runAnalysisOnce(at);
    }
  } finally {
    anaBusy = false;
    /* 跑的过程中又被调度过 → 再来一轮（比如补账期间用户又落了一手） */
    if (anaPoke) { anaPoke = false; scheduleAnalysis(0); }
  }
}

/* 分析第 at 手之后的局面。
   · at === state.viewAt：结果上屏（胜率条 / 候选点 / 形势雾）。
   · at ≠ state.viewAt：只把这一手的胜率写进 history（补历史欠账），**绝不碰画面**
     —— 画面代表「当前局面」，不能被别的局面的结果污染。
   返回 true 表示这次请求有结果（可以继续下一件事）；false = 没就绪 / 出错 / 被取消。 */
async function runAnalysisOnce(at) {
  if (!(window.api && window.api.analyze)) return false;
  if (!engineReady) {
    if (!state.noGame) $('eval-wr').textContent = 'AI 准备中';
    return false;
  }
  if (typeof at !== 'number') at = state.viewAt;
  const gen = gameGen;          // ★ 记下这一请求属于哪一代（换局后就作废）
  anaReqGen = gen;             // onProgress 的中间报告也按它过滤

  const req = {
    initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
    moves: state.moves.slice(0, at)
      .map(m => [m.color === 'b' ? 'B' : 'W', m.pass ? 'pass' : toGTP(m.x, m.y)]),
    rules: (RULES[settings.rules] || RULES.chinese).kata,
    komi: settings.komi,
    size: N,
  };

  /* ★ 局面变了**不要清空**候选点 —— 清空会造成 3~4 秒的空窗（用户实测报过：
     AI 落子后推荐点整块消失，像坏了一样）。旧点由 draw() 按 candAt 识别为「过期」并淡化，
     新结果一到就整体替换。 */

  /* 只发一次查询：引擎每 0.25 秒推一次中间报告（onProgress），
     胜率与候选点会随搜索量自然收敛 —— 这才是真正的「先粗后精」，
     且不会出现两段式那种「先显示一批点、再整批换掉」的闪动。

     ★★ 渲染端超时兜底（2026-10-06 晚新增）。
     为什么必须自己再兜一层：主进程那边虽然有 90 秒超时，但**渲染端这一侧
     同样有"回不来"的路**（IPC 通道异常、页面被挂起、主进程那条 promise 因为
     任何原因没 settle）。一旦那一次 await 永不返回，`anaBusy` 就永远占着 ——
     后果不是"这一手没算"，而是**整个分析链路停摆**：
     选点不再刷新、胜率条冻住、棋盘上方那行「计算中… N」定在一个数字上不动，
     点悔棋、回看、落子都不管用，只能重启软件。这正是用户报的现象。
     加这一层之后，最坏情况是「这一手晚 25 秒」，而不是整个软件卡死。 */
  let res;
  try {
    res = await Promise.race([
      window.api.analyze(Object.assign({
        maxVisits: settings.visits || ANALYZE_VISITS,   // ★ 每次请求现读 —— 所以改档位是**热切换**
        includeOwnership: state.showTerritory,   // 形势雾的数据（不增加搜索量）
      }, req)),
      new Promise(r => setTimeout(() => r({ error: '分析请求超时（渲染端 25 秒没有响应）' }), ANALYZE_TIMEOUT_MS)),
    ]);
  } catch (e) {
    res = { error: String((e && e.message) || e) };
  }

  /* ★ 这一趟期间**换过局 / 换过棋谱** → 这次结果整体作废（一个字段都不写）。
     放在所有分支之前：连「记 history」都不做，那些手已经不属于现在这盘棋了。 */
  if (gen !== gameGen) { alog('once at=' + at + ' 作废：期间换过局（代 ' + gen + '→' + gameGen + '）'); return false; }

  /* ★ 被 cancel 掐掉的结果是**搜索中途的半成品**（visits 很少、胜率还没收敛）——
     绝不能上屏，否则胜率条会瞬间跳到一个极端值、过几秒又弹回来
     （用户实测报过这个现象；根因是 runScore 里的 window.api.cancel()）。 */
  if (res && res.cancelled) {
    /* ★★ 自愈（2026-10-07 新增）：如果被掐掉的正是**当前局面**那一趟，
        那么"重算当前局面"这个意图必须留着、而且要**主动重排一次**。
        为什么：`runAnalysis` 拿到 false 就 break，`anaBusy` 随即放开；
        而 anaForceCur 虽然还是 true，但**没有任何东西会再触发一次 schedule** ——
        如果这一刻正好没有落子/回看这类操作，分析就永远停在那儿
        （表现就是用户报的「选点 / 形势突然卡住不显示」，而且不会自己好）。
        典型触发：数子（runScore 里会 cancel）与悔棋/落子挤在一起的时候。 */
    if (at === state.viewAt) {
      anaForceCur = true;
      if (!anaTimer) anaTimer = setTimeout(runAnalysis, 120);
    }
    alog('once at=' + at + ' 被取消（cancelled）→ 重排；viewAt=' + state.viewAt);
    return false;
  }
  if (!res || res.error) {
    const timedOut = !!(res && res.error && res.error.indexOf('超时') >= 0);
    if (timedOut) {
      /* ★ 超时 = 请求回不来了。**必须主动重排一次**，否则 anaForceCur 会一直挂着、
         而 anaBusy 已经放开 —— 没人再触发的话分析就永远停在这儿（就是"卡死"）。
         限流：连续 3 次仍不回来就不再重排，明确报错并让用户看到该怎么办。 */
      anaTimeouts += 1;
      if (anaTimeouts <= 3) {
        console.warn('[分析] 第 ' + anaTimeouts + ' 次请求超时，重排一次');
        setTimeout(() => scheduleAnalysis(0, true), 200);
      } else {
        engineNote = '分析引擎连续无响应 —— 顶栏「KataGo」里卸载后重新加载';
        console.error('[分析] 连续 ' + anaTimeouts + ' 次超时，停止重排');
        flash(engineNote);
      }
    }
    if (at === state.viewAt) {
      $('eval-wr').textContent = timedOut ? '分析超时' : '分析失败';
      $('eval-wr-w').textContent = '';
      /* ★ 有引擎级错误（比如**权重与引擎版本不匹配**）时优先显示它 ——
         那一句是 main.js 从引擎 stderr 里捞出来的原话转写，用户照着就能解决。
         显示在这里（右侧胜率卡）是因为它**任何局面下都看得见**，
         而棋盘中央那条提示只在「未开局」时才有（见 syncUI 里的 gate-tip）。 */
      $('eval-lead').textContent = engineNote || (res && res.error ? res.error : '');
      $('eval-lead-w').textContent = '';
    }
    alog('once at=' + at + ' 失败返回 false：' + ((res && res.error) || '未知')
      + '（引擎就绪=' + engineReady + ' viewAt=' + state.viewAt + '）');
    return false;
  }
  anaTimeouts = 0;                 // 有结果回来了 → 计数归零

  /* 补历史欠账（at ≠ 当前局面）：只记这一手的胜率，画面别动。 */
  if (at !== state.viewAt) {
    if (((res.root && res.root.visits) || 0) >= HINT_MIN_VISITS) {
      /* ★ 带上这次的搜索量（第四个参数）—— 门槛靠它判断「够不够准」，见 rememberEval */
      rememberEval(at, blackWinFrom(res, at), blackLeadFrom(res, at), (res.root && res.root.visits) || 0);
    }
    return true;
  }

  /* 当前局面：上屏（applyAnalysis 里也会顺手记下这一手的胜率）。
     ★★ 2026-10-07 修的**真 bug**：原来这里无条件写 `shownAt = at`，
        可 `applyAnalysis` 内部有提前 return（搜索量不够 / 报文与当前局面不符时直接返回）。
        那样一来：**候选点没画上去，却被标记成"这个局面已经显示过了"** ——
        而 `runAnalysis` 的判据是 `shownAt !== cur`，于是这个局面**永远不再重算**。
        用户看到的就是「棋盘上方那行『计算中… N』定住不动、推荐点永远不出现」。
        （实测证据：用户按 Ctrl+Shift+D 读出来的自检是
          「看第2手·选点: 还没算过·搜索量: 200·请求: 空闲·空跑0」——
          搜索量 200 说明请求发出去过、也回过进度，但 candAt 仍是 -1，
          队列空、没有请求失败 → 只可能是"被当成已显示、于是不再算"。）
        所以现在只认 `applyAnalysis` 真上屏了才记 shownAt。 */
  if (applyAnalysis(res, at)) { shownAt = at; alog('once at=' + at + ' ✓ 上屏成功 candAt=' + state.candAt + ' 候选点=' + state.candidates.length + ' visits=' + ((res.root && res.root.visits) || 0)); }
  else { alog('★ once at=' + at + ' 未上屏（applyAnalysis 返回 false）→ shownAt 不记，下轮会重算；visits=' + ((res.root && res.root.visits) || 0) + ' viewAt=' + state.viewAt); }
  draw();
  return true;
}

/* 引擎给的是「轮到走棋那一方」的胜率 —— 统一换算成黑方视角再上屏 */
/* 记下「第 at 手落下后的黑方胜率」—— 胜率走势曲线与手数列表的「涨跌」都靠它。
   试下（草稿）里的手**不记**：那些手等会儿会被整体丢掉，写进曲线就是脏数据。

   ★ 为什么单独抽出来（2026-10-04）：人机对弈时用户落子后立刻轮到 AI，
     那一手**等不到属于自己的分析**（见 syncUI 里的调度 + runAnalysisOnce 的作废分支），
     所以要能在「结果已作废」的路径上也把这一手的胜率留下来。

   ★★ 搜索量门槛（2026-10-06 晚新增，治「数字自己跳」）：
     这个函数是全盘**唯一**写 history 的地方，而它会被每一次分析结果调用 ——
     包括引擎每 0.25 秒推一次的**中间报告**（那时搜索量才 150 左右，胜率还没收敛）。
     原来是无条件覆盖，于是同一手被写十几遍、数字跟着乱跳。

     实测（_cdp_jump.mjs，连落 6 手后逐步回看）：
       at=1 被写 6 次，访问量 151/298/463/515/515/515，胜率极差 0.62%
       at=4 被写 4 次，访问量 152/312/471/514，          胜率极差 1.63%
       at=5 被写 5 次，访问量 168/340/515/515/515，      胜率极差 1.69%
       at=6 被写 14 次（含悔棋重下），                   胜率极差 **8.06%**
         → 27.7% → 19.7% → 32.9%，正是用户说的「原本算亏的，再点一次就不亏了」。
       列表里的涨跌是 (history[i] − history[i−1])×100，所以极差还会被放大。

     现在的规矩（两道，缺一不可）：
       ① **粗算只许记账、不许覆盖**：搜索量不到目标值（底栏「计算深度」）的 90% 时，
          只在这一格**本来是空的**时候写进去（先给个暂行值）；已经记过的一律不动。
       ② **精算才许改写，且不许倒退**：达到 90% 才允许覆盖已有记录，而且不能比已有记录更低。

     ⚠️ 曾经写成「新值是旧值的 1.25 倍就允许覆盖」—— 实测那是**形同虚设**
        （_cdp_gate.mjs）：中间报告的访问量是 122 → 294 → 489 → 515 逐级涨的，
        每一级都比上一级高 2.4 倍，于是每一级都通过了 1.25 倍那道门，数字照跳不误。
        「逐级放宽」对逐级增长的报告序列没有任何拦截力 —— 必须用**目标值的绝对比例**当门槛。
     ⚠️ 别改成「永不覆盖」：早期算的那几手会永远停在粗算值上，回看也不会变准。 */
function rememberEval(at, blackWin, blackLead, visits) {
  if (!(at >= 0)) return;
  if (state.draft && at > state.draft.from) return;
  /* ★★ 越界拒收（2026-10-06）。这是 history / leads 的**唯一写入口**，
     所以在这里拦一次就够 —— 上面 runAnalysis 里的过滤是第二道防线（少一次无效请求）。
     为什么必须拦：JS 的 `arr[99] = v` 会**把数组扩容到 100**，
     于是「7 手棋」的 history 长度变成 11（实测），
     走势曲线会画出根本不存在的第 8、9、10 手，手数列表里也有幽灵数据。
     场景：悔棋后队列里残留了已撤销手数的欠账，那次请求回来就写越界了。 */
  if (at > state.moves.length) return;

  const v = (typeof visits === 'number' && visits > 0) ? visits : 0;
  const target = settings.visits || ANALYZE_VISITS;        // 底栏「计算深度」
  const SETTLED = target * 0.9;                            // 「够准」的搜索量门槛
  if (typeof state.history[at] === 'number') {             // 这一格已经有值了
    const old = state.histVisits[at] || 0;
    if (v < SETTLED) return;              // ① 粗算不许覆盖
    if (v < old) return;                  // ② 不许倒退（用更少的搜索量改写）
  }
  if (typeof blackWin === 'number') state.history[at] = blackWin;
  if (typeof blackLead === 'number') state.leads[at] = blackLead;
  state.histVisits[at] = v;                                // 记住这一格的「精度」
  renderCurve();
  renderMoveList();          // 列表里的「这一手涨跌」也要跟着刷新
}

/* 这一手的胜率「算准了没有」——手数列表用它决定显示数字还是「…」。
   为什么要问这个（2026-10-06 晚）：引擎每 0.25 秒推一次中间报告，刚落子那 0.3 秒
   只有 130 左右的搜索量，胜率离收敛值差得远（实测同一手 122 → 515 之间差了 3%）。
   如果这时就把数字摆出来，用户会看到它过一会儿自己变一个值 —— 那正是他报的
   「下完显示一个数字，过会儿再看又不是这个数」。
   改成：没算准就显示「…」，算准了才出数字。数字一旦出现就不会再变。 */
function evalSettled(at) {
  const target = settings.visits || ANALYZE_VISITS;
  return (state.histVisits[at] || 0) >= target * 0.9;
}

/* 引擎给的是「轮到走棋那一方」的胜率 —— 统一换算成黑方视角（at 只用于兜底判断该谁走） */
function blackWinFrom(p, at) {
  const cp = String((p.root && p.root.currentPlayer) || '').toUpperCase();
  const side = cp === 'B' ? 'b' : cp === 'W' ? 'w' : sideToMove(at);
  return side === 'b' ? p.root.winrate : 1 - p.root.winrate;
}

/* 同上，换算「黑方领先目数」（正 = 黑优）—— 走势图「目差」纵轴用 */
function blackLeadFrom(p, at) {
  const root = p && p.root;
  if (!root || typeof root.scoreLead !== 'number') return undefined;
  const cp = String(root.currentPlayer || '').toUpperCase();
  const side = cp === 'B' ? 'b' : cp === 'W' ? 'w' : sideToMove(at);
  return side === 'b' ? root.scoreLead : -root.scoreLead;
}

/* p = 分析结果；at = 这是「第几手之后」的局面。
   ★ 只对**当前看着的局面**调用（at === state.viewAt）—— 补历史欠账的结果不许走这里。
   ★★ 返回值（2026-10-07 新增）：**真把东西画上屏了**才返回 true。
     调用方（runAnalysisOnce）用它决定要不要把这一手记成「已显示」（shownAt）——
     以前无条件记，于是"没画上屏也算显示过"，那个局面就再也不重算了。
     ⚠️ 两个"没上屏"的情况都要返回 false：
        ① 报文跟当前局面不符（at ≠ viewAt，比如请求期间用户又落了一子 / AI 应了一手）；
        ② 搜索量还太少（< HINT_MIN_VISITS），候选点先不更新。 */
function applyAnalysis(p, at) {
  if (!p || !p.root) return false;
  if (typeof at !== 'number') at = state.viewAt;
  /* ① 报文与当前局面不符：这不是"当前局面的结果"，一个字段都不该写。
     为什么必须挡：请求在飞的时候用户落子 / AI 应手，回来的报文属于**上一个**局面；
     照它画候选点就会把别的局面的点画到当前棋盘上。 */
  if (at !== state.viewAt) return false;

  /* 视角：以引擎返回的 currentPlayer 为准（权威）。
     引擎（RapaceGo/engine.cfg 里 reportAnalysisWinratesAs = SIDETOMOVE）返回的
     winrate / scoreLead / moveInfos[].winrate 全部是「**轮到走棋那一方**」的视角 ——
     已用极端贴目的对照实验验证过（轮白走时 scoreLead<0 表示白方落后）。
     所以这里只做一次「轮走方 → 黑方」的换算，不能再多转一次。 */
  const cp = String((p.root && p.root.currentPlayer) || '').toUpperCase();
  const side = cp === 'B' ? 'b' : cp === 'W' ? 'w' : sideToMove(at);

  const blackWin = side === 'b' ? p.root.winrate : 1 - p.root.winrate;
  const whiteWin = 1 - blackWin;
  const lead = side === 'b' ? p.root.scoreLead : -p.root.scoreLead;   // 正 = 黑领先

  $('bar-black').style.width = (blackWin * 100).toFixed(1) + '%';      // 条：左段黑、右段白
  $('eval-wr').textContent = '黑 ' + (blackWin * 100).toFixed(1) + '%';
  $('eval-wr-w').textContent = '白 ' + (whiteWin * 100).toFixed(1) + '%';
  /* 目数也两端各给一份：黑方 +9.3 表示黑领先 9.3 目，白方就是 −9.3（落后） */
  const signed = v => (v < 0 ? '\u2212' : '+') + Math.abs(v).toFixed(1);
  $('eval-lead').textContent = signed(lead) + ' 目';
  $('eval-lead-w').textContent = signed(-lead) + ' 目';

  /* 存一份给「AI 要不要认输」判断用（它需要知道自己落后多少） */
  state.lastEval = { blackWin, lead };

  /* 形势（ownership）—— 放在 HINT_MIN_VISITS 那道门槛**之前**：
     雾是「渐变收敛」的，早一点显示出来观感更好（看不清就淡一点，不该从无到有地跳）

     ⚠️ ★ ownership 是「**相对当前走棋方**」的，不是固定黑方！实测（同一局面换谁走）：
        轮到白 → 白那侧 +0.998 / 黑那侧 −0.998
        轮到黑 → 黑那侧 +0.997 / 白那侧 −0.999
        跟 winrate / scoreLead 同一套视角规则，必须一起换算，否则整盘雾会反色。 */
  if (p.ownership && p.ownership.length === N * N && state.showTerritory) {
    const cpBlack = String((p.root && p.root.currentPlayer) || '').toUpperCase() === 'B';
    state.ownership = cpBlack ? p.ownership : p.ownership.map(v => -v);   // 统一存成「黑方占优为正」
    state.ownAt = at;
  }

  /* 候选点
     - 数字 = **轮到走棋那一方的胜率**（"我下这里，我能有多少胜率"）—— 直接取引擎原值。
       执白的人看到的就是白方胜率；若换算成黑方胜率，他会把自己 0.7% 读成 99%，会误导判断。
     - 排序 = 按「轮走方胜率」降序。引擎的 moveInfos 是按访问次数排的，**不是按胜率**；
       若换成黑方视角再降序，轮白走时就会把白棋最差的手排到第一。
     - 再滤掉搜索量太少的点（胜率方差极大、经常虚高）。
     - 搜索量还小时（< HINT_MIN_VISITS）先不动，保留上一批（此时各点排序会乱跳）。 */
  const totalV = (p.root && p.root.visits) || 0;
  /* 「计算中… 320」要显示它 —— 放在门槛**之前**，这样搜索量还很低时也能看到它在涨 */
  state.rootVisits = totalV;
  /* ② 极低搜索量（<20）时数据纯噪声，候选点先不更新 → **没上屏，返回 false**。
     这一步很要紧：只有它返回 false，调用方才会把这一手记成"还没显示"、
     下一轮重新算（否则这个局面永远停在"计算中…"上）。 */
  if (totalV < HINT_MIN_VISITS) return false;

  /* 记下「第几手时黑方胜率多少」——胜率走势曲线与手数列表都靠它。
     试下（草稿）里下的手**不记**：那些手等会儿会被整体丢掉，写进曲线就是脏数据。
     ★ 第四个参数 = 这次结果的搜索量（totalV），门槛用它判断「够不够准」。 */
  rememberEval(at, blackWin, lead, totalV);

  /* 候选点的过滤门槛 —— ★ 2026-10-04 实测（_cdp_cand.mjs，连续落 8 手，共 39 次采样）：
     引擎**每次都返回 8 个候选**，但原来那道「按总搜索量 1.5%」的比例门槛，
     在「搜索高度集中」的局面（500 步几乎全给了唯一好手）会把 7 个次要点全滤掉、
     只剩 1 个 —— 实测约 40% 的手都这样，正是用户报的「很多时候只显示一个选点」。
     现在：可信的（visits ≥ 总搜索量 1%）优先；不足 3 个时放宽补足，别只给一个。
     visits ≥ 2 是硬下限 —— 一次都没被回访的点基本是神经网络的先验噪声，胜率不可信。 */
  const strongV = Math.max(3, totalV * 0.01);
  const usable = (p.moves || [])
    .map(m => {
      const pt = fromGTP(m.move);
      if (!pt) return null;
      const win = m.winrate;                   // 引擎原值 = 轮走方视角
      /* pv = 这一手之后的预计变化（主进程只透传前 8 手）。悬停「变化图」用它。
         ⚠️ 引擎给的 pv **包含这一手本身**（pv[0] 就是 m.move），所以画的时候要跳过第一个。 */
      return { x: pt.x, y: pt.y, win, visits: m.visits, label: (win * 100).toFixed(1), pv: m.pv || null };
    })
    .filter(c => c && c.visits >= 2);
  let pick = usable.filter(c => c.visits >= strongV);
  if (pick.length < 3) pick = usable;          // 可信点太少 → 放宽（宁可多给几个参考）
  state.candidates = pick.sort((a, b) => b.win - a.win).slice(0, 4);
  state.candAt = at;                           // 记下这批点是第几手的（draw 用它判断过期没）
  return true;                                 // ★ 真上屏了 → 调用方可以记 shownAt
}

/* ---------------- AI 对弈 ---------------- */

/* ★ 对手棋力 = KataGo 人类棋风模型的「真实段位档位」（humanSLProfile）
 *
 * 为什么换掉原来那套：
 *   旧版靠「降 visits + 随机挑点」来降低水平 —— 那些数值是我估的、**从未校准**，
 *   标着「业余 3 段」并不等于真业余 3 段（用户实测就发现"不匹配会输得很惨"）。
 *   现在用权重自带的真实档位：**选什么段位，就真的按那个水平下**。
 *   实测（同一局面，300 visits）：rank_9d 首选 C3 / rank_1d 首选 C3 /
 *   rank_10k 首选 Q3 / rank_20k 首选 Q3 —— 连"对局面强弱的自我认知"都不同。
 *
 * ⚠️ 两个前提（别忘）：
 *   ① 只有 **human 权重**（b18c384nbt-humanv0）认这个档位，strong 权重会报
 *      `Unknown human SL network profile` → 所以对弈必须走独立的 play 引擎。
 *   ② 档位可**逐请求覆盖**（`overrideSettings.humanSLProfile`），不必为每个段位重启引擎。
 *
 * ★ 文案的准确边界（2026-10-04 对着官方文档重写过一次，别再凭印象编）：
 *   · `rank_*` / `preaz_*` 这一批（20 级 ~ 9 段）是**一把连续的业余段位尺子**，
 *     **不是职业段位表** —— 官方原文只有 "Imitate human players of the given rank"，
 *     **没公布对标哪个体系**；最高档 9d 的位置是「业余顶尖 / 接近职业边缘」，
 *     **不是职业九段**。（之前我按常识写了「职业顶尖」之类，那是没依据的，已删。）
 *   · 明确标着职业的只有 `proyear_*`（官方用词："pro and strong insei"）。
 *   · 高段之间几乎分不出来：实测同一局面 rank_7d / 8d / 9d 的首选点相同。
 *   · 「约业余 X 段」是圈内通行换算、**不是官方数据**，各地差异还很大 ——
 *     所以那个「约」字别去掉。
 * visits 不决定档位（档位由网络本身决定），给固定值就行。
 */

/* 下拉分组。2026-10-04 用户要求：现代段位**不要再切块** ——
   原来分「职业/强业余」「业余高段」「业余级位」「入门」四块，
   可这条 20 级~9 段本来就是连续的，切块反而误导（"5 段"被归进"职业"那一块，
   其实它是业余）。现在合成一块，名字直接写明「非职业」。 */
const RANK_GROUPS = [
  '现代段位（非职业）',                          // 0 — rank_* 29 档
  '前AI时代段位（非职业）',                      // 1 — preaz_*
  '职业棋风 · 按年份（1800–2023）',              // 2 — proyear_*
];

/* [档位值, 显示名, 分组下标, 一句话水平说明]
   ★ 说明是「圈内粗略换算 + 典型特征」，**不是官方标定** —— 官方没有换算表。
   「约业余 X 段」指网络平台的段位体系（野狐/弈城那种 1d~9d），
   和「中国业余段位制」（1~5 段靠比赛升、6 段省级冠军、7 段全国冠军、8 段荣誉）
   只是大体对应，各地含金量差别很大。 */
const RANK_ROWS = [
  ['rank_9d', '9 段', 0, '业余顶尖 · 接近职业边缘'],
  ['rank_8d', '8 段', 0, '强业余 · 省级冠军那个层次'],
  ['rank_7d', '7 段', 0, '业余 6 段上下'],
  ['rank_6d', '6 段', 0, '业余 5 段偏强'],
  ['rank_5d', '5 段', 0, '约业余 5 段'],
  ['rank_4d', '4 段', 0, '约业余 4 段'],
  ['rank_3d', '3 段', 0, '约业余 3 段 · 布局定式熟练'],
  ['rank_2d', '2 段', 0, '约业余 2 段 · 会攻杀，偶尔漏算'],
  ['rank_1d', '1 段', 0, '约业余 1 段 · 刚入段'],
  ['rank_1k', '1 级', 0, '冲段水平 · 比业余 1 段略差'],
  ['rank_2k', '2 级', 0, '级位上游 · 定式基本会，官子还糙'],
  ['rank_3k', '3 级', 0, '级位上游 · 中盘能打，容易上头'],
  ['rank_4k', '4 级', 0, '级位中游 · 会算局部死活'],
  ['rank_5k', '5 级', 0, '级位中游 · 全局观还在建立'],
  ['rank_6k', '6 级', 0, '级位中下 · 常下出无理手'],
  ['rank_7k', '7 级', 0, '级位下游 · 死活容易看错'],
  ['rank_8k', '8 级', 0, '级位下游 · 会被简单骗着骗到'],
  ['rank_9k', '9 级', 0, '入门偏上 · 知道该先占角'],
  ['rank_10k', '10 级', 0, '入门 · 知道基本下法，布局随缘'],
  ['rank_11k', '11 级', 0, '初学 · 常常不知道该下哪'],
  ['rank_12k', '12 级', 0, '初学 · 只会连络和逃跑'],
  ['rank_13k', '13 级', 0, '初学 · 吃子看得见，算气常错'],
  ['rank_14k', '14 级', 0, '刚会算气 · 一块棋常被白吃'],
  ['rank_15k', '15 级', 0, '刚会算气 · 不太顾全局'],
  ['rank_16k', '16 级', 0, '新手 · 会下，但常自填眼'],
  ['rank_17k', '17 级', 0, '新手 · 分不清先后手'],
  ['rank_18k', '18 级', 0, '新手 · 刚懂规则'],
  ['rank_19k', '19 级', 0, '新手 · 刚懂规则，下得较慢'],
  ['rank_20k', '20 级', 0, '刚学 · 只会连子和吃子'],
];

/* ★ 三套档位都是 **KataGo 引擎内置**的 humanSLProfile 系列 —— 我们只是接线，
     一行「棋力算法」都没有自己写（下面那些人话说明是照段位含义写的，不是算出来的）：
       ① rank_*    现代开局风格的段位（主表，29 档，默认用这套，**业余段位标尺**）
       ② preaz_*   2016 年 AlphaZero 之前那种开局风格（**同一把尺子**，只是开局旧）
       ③ proyear_* 按年份模仿**职业**棋手 / 强院生（1800~2023，**每年一档**；
                   实测越界（1799 / 2024）引擎只报 error，不会崩）
     ⚠️ 三点官方说明（实测查证，别当它们不存在）：
        · 措辞是「**模仿**（imitate）」而非「等同」，官方也没公布对标哪个段位体系；
        · 只有 proyear_* 明确是职业，rank_/preaz_ 都是业余段位标尺（见上面的注释）；
        · **搜索量给多了会比标称段位强** —— 搜索会解掉该段位解不出的战术。
          想让它真的「像那个段位」，要打开「拟人落子」（按该段位人类的概率抽样）。 */
const RANK_ROWS_ALL = RANK_ROWS.slice();
for (const [v, label, , note] of RANK_ROWS) {
  RANK_ROWS_ALL.push(['preaz_' + v.slice(5), label, 1, note]);
}
for (let y = 2023; y >= 1800; y--) {
  RANK_ROWS_ALL.push(['proyear_' + y, y + ' 年', 2, '模仿 ' + y + ' 年前后的职业棋手 / 强院生']);
}
const RANKS = RANK_ROWS_ALL.map(([v, label, gi, note]) =>
  ({ v, label, group: RANK_GROUPS[gi], note }));
const RANK_MAP = new Map(RANKS.map(r => [r.v, r]));

/* AI 每手搜索量。档位由网络决定，visits 只影响这手算得稳不稳 —— 给个够用的固定值。
   （别再用 visits 当难度旋钮：那样既费时间又不准，低段位照样能算得比标称强。） */
const AI_VISITS = 400;

let aiBusy = false;
let aiRetry = 0;         // AI 这一手没落成时的重试计数（防止局面被打断后停摆）
let aiTimer = null;

function isMyTurn() {
  /* 试下时两边都能下 → 一直算「轮到我」，这样推荐点照常显示（正在探索，正需要它） */
  if (state.draft) return true;
  return sideToMove(state.viewAt) === state.myColor;
}

function needAIMove() {
  return settings.mode === 'play'
    && !state.noGame            // ★ 未开局：AI 也不落子（否则执白时一启动它就自己下起来了）
    && !state.draft              // ★ 试下（草稿）时 AI 不自动落子 —— 是你在摆，不是在下棋
    && !state.result             // ★ 本局已结束（数子出结果 / 认输）→ 不再落子
    && engineReadyPlay           // ★ 是「对弈引擎」就绪，不是分析引擎
    && !aiBusy
    && state.viewAt === state.moves.length
    && !isMyTurn();
}

function scheduleAIMove(delay) {
  clearTimeout(aiTimer);
  aiTimer = setTimeout(maybeAIMove, delay === undefined ? 120 : delay);
}

/* 从结果里挑一手。
   ★ 现在水平由「档位」决定（human 模型带 profile），这里**不用再随机降级** ——
   直接取它的首选，那本来就是该段位最可能下的一手。
   只留一点点变化（前二里偶尔换一个），免得同一局面每次都一模一样。 */
const AI_ALT_CHANCE = 0.15;
function pickAIMove(res) {
  const infos = res.moves || [];
  if (!infos.length) return null;

  /* 引擎首选是 pass（该收束了）→ 直接 pass。官方配方里也是这么处理的。 */
  const first = infos.find(m => m.order === 0) || infos[0];
  if (first && String(first.move).toLowerCase() === 'pass') return 'pass';

  /* ---- 拟人落子：按人类概率抽样 ---- */
  if (settings.humanLike) {
    const picked = pickByHumanPolicy(res, infos);
    if (picked) return picked;
    /* 万一拿不到 policy，退回下面的取首选（总比不落子强） */
  }

  /* ---- 默认：取首选（前二里偶尔换一个，免得同一局面每次都一模一样） ---- */
  const top = infos.slice(0, 2);                 // 引擎已按 order 排，第 0 个就是首选
  const i = (top.length > 1 && Math.random() < AI_ALT_CHANCE) ? 1 : 0;
  const mv = top[i].move;
  if (!mv) return null;
  if (String(mv).toLowerCase() === 'pass') return 'pass';
  return fromGTP(mv);
}

/* 按人类概率挑一手（拟人落子专用）。权重 = humanPrior × exp(utility / 0.5)。
   · humanPrior：优先用 policy 数组里该点的概率 —— 实测它就是**人类先验**
     （同一局面同一档位，方式2 的 policy 与方式1 的 humanPolicy 数值完全一致）；
     拿不到 policy 就退回引擎给的 prior。
   · exp(utility / 0.5)：**保护项**，官方原话是「跟着 humanPrior 走，但某手一旦开始亏
     超过 0.5 utility（约 25% 胜率）就平滑压低它的概率」—— 这就是"不会连着下烂棋"的原因。
     参数缺失时 exp(0)=1，退化成纯按人类概率抽（官方配方 A）。
   实测这条分布下：9 段只有 7 个非零点、20 级有 26 个，段位越高越集中。 */
function pickByHumanPolicy(res, infos) {
  const pol = res.policy;
  const hasPol = Array.isArray(pol) && pol.length === N * N + 1;   // 最后一个元素是 pass 的概率
  const bag = [];
  for (const m of infos) {
    const pt = fromGTP(m.move);                  // pass / 非法坐标会返回 null，自动被滤掉
    if (!pt) continue;
    const hp = hasPol ? Math.max(0, pol[pt.y * N + pt.x]) : Math.max(0, m.prior || 0);
    if (!(hp > 0)) continue;                     // 人类压根不会下的点，不进袋子
    const u = (typeof m.utility === 'number') ? m.utility : 0;
    bag.push({ pt, w: hp * Math.exp(u / 0.5) });
  }
  if (!bag.length) return null;

  let total = 0;
  for (const x of bag) total += x.w;
  if (!(total > 0)) return null;

  let r = Math.random() * total;
  for (const x of bag) { r -= x.w; if (r <= 0) return x.pt; }
  return bag[bag.length - 1].pt;
}

async function maybeAIMove() {
  if (!needAIMove()) return;
  aiBusy = true;
  state.thinking = true;                 // 思考中：不显示落子预览方块
  draw();

  let retry = false;
  try {
    /* AI 认输判断：落后太多就投子。放在发请求之前 —— 没必要为一个已输的局面再算一遍。 */
    if (aiWantsResign()) {
      const aiSide = state.myColor === 'b' ? 'w' : 'b';
      doResign(aiSide, 'ai');
      flash('KATAGO 认输 · ' + (aiSide === 'w' ? '黑' : '白') + '方胜');
      syncUI();
      return;
    }
    const req = {
      initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
      moves: state.moves.slice(0, state.viewAt)
        .map(m => [m.color === 'b' ? 'B' : 'W', m.pass ? 'pass' : toGTP(m.x, m.y)]),
      rules: (RULES[settings.rules] || RULES.chinese).kata,
      komi: settings.komi,
      size: N,
      maxVisits: AI_VISITS,
      profile: settings.level,      // ★ 真实段位（rank_3d 这种）→ 对弈引擎逐请求覆盖
      /* 拟人落子要用 policy（人类先验）来抽样。⚠️ includePolicy 是**外层字段**
         —— 官方文档明确：除了它和 maxVisits，其余参数都必须放 overrideSettings，否则无效。 */
      includePolicy: settings.humanLike,
    };
    const expectLen = state.moves.length;
    const gen = gameGen;                      // ★ 这一手属于哪一局
    /* ★ 走「对弈引擎」（human 权重）—— 分析引擎不参与落子，
       否则两条请求会在同一个进程里互相 terminate。 */
    const res = await window.api.playMove(req);

    /* ★ 换了局（新对局 / 打开棋谱）→ 这手整体作废。
       光看手数不够：两边都是空盘时 `state.moves.length` 都是 0，下面的检查会"恰好通过"，
       于是 AI 把**上一局**算出的那一手落到了新盘上（重开一局时能实际看到）。 */
    if (gen !== gameGen) {
      /* ★★ 但作废之后**必须给新局重排一次**（2026-10-06 审查发现）。
         原来这里直接 return，`retry` 仍是 false，finally 里那句
         `if (retry && needAIMove())` 就不会排 —— 而新局启动时的 syncUI()
         也会因为此刻 `aiBusy` 还是 true 而跳过（needAIMove 要求 !aiBusy）。
         结果：新局若轮到 AI 走，**AI 不动、用户也动不了**（不是他的回合），
         界面看着像卡死，要等下一次任意 UI 刷新（引擎状态变化、提示条到点）才自己好。
         ★ 不计入 aiRetry —— 这不是"失败"，只是局面换了，不该占用重试额度。
         ★ 用 0 延迟：这个定时器会排在本次 finally 之后跑，那时 aiBusy 已经放开了。 */
      scheduleAIMove(0);
      return;
    }
    /* 期间局面被改动了（悔棋 / 回看 / 切模式后手动落子）→ 这手作废 */
    if (state.moves.length !== expectLen || state.viewAt !== state.moves.length) { retry = true; return; }
    if (!res || res.error) {
      /* ★ 也走重试（下面的 finally 里那套 aiRetry 上限 3 次）。
         原来这里直接 return → 引擎偶尔超时/出错一次，AI 就停在那儿不动了，
         要等「引擎状态变化」才有下一个触发点 —— 用户只能自己动一下（审查发现）。 */
      retry = true;
      flash('AI 这一步没算出来（' + ((res && res.error) || '未知') + '），重试中…');
      return;
    }

    const pick = pickAIMove(res);
    if (pick === 'pass') {
      aiRetry = 0;
      state.moves.push({ pass: true, color: sideToMove(state.moves.length) });
      clearCoachAt(state.moves.length);    // 该手号上的旧讲解作废
      state.viewAt = state.moves.length;
      syncUI();
    } else if (pick) {
      aiRetry = 0;
      tryPlay(pick.x, pick.y, true);
    } else {
      retry = true;
      flash('AI 没找到可下的点');
    }
  } finally {
    aiBusy = false;
    state.thinking = false;
    draw();

    /* ★ 关键：这一手没落成（局面中途变了 / 引擎没给点），但仍然轮到 AI —— 必须重新安排，
       否则就停摆了：用户下不了（不是他的回合），AI 也不动。
       （2026-10-03 用户实测：人机对弈 → 摆棋 → 再切回人机对弈，AI 就不下了） */
    if (retry && needAIMove()) {
      if (aiRetry < 3) { aiRetry += 1; scheduleAIMove(500); }
      else { aiRetry = 0; flash('AI 连续几次没能落子，请检查引擎是否正常'); }
    }
  }
}


if (window.api) {
  /* 从状态里取某个引擎的字段。
     ⚠️ 主进程为兼容旧字段，把「分析引擎」的 ok/ready/error 平铺到了顶层 ——
     这里优先读 s.analyze / s.play，读不到才退回顶层。 */
  const readEngineState = (s, key) => {
    if (!s) return { ready: false, error: '' };
    const sub = s[key];
    if (sub) return { ready: !!sub.ready, error: sub.error || '' };
    /* 兼容旧版主进程：顶层平铺的那套字段属于「分析引擎」。只对 analyze 回退 ——
       新引擎（coach）**不能**跟着回退，否则会被误判成就绪。 */
    if (key === 'analyze') return { ready: !!s.ready, error: s.error || '' };
    return { ready: false, error: '' };
  };

  const applyEngineStatus = s => {
    const a = readEngineState(s, 'analyze'), p = readEngineState(s, 'play'),
      c = readEngineState(s, 'coach');
    engineReady = !!a.ready;
    engineReadyPlay = !!p.ready;
    coachReady = !!c.ready;
    /* ★ 只有 KataGo 的故障才算「引擎异常」—— 讲解模型没配/没加载不该影响下棋。 */
    engineNote = a.error || p.error || '';
    coachNote = (s && s.coach && s.coach.error) || '';
    /* 三个引擎的原始状态（画状态灯用）；主进程没给 state 就按 ready/error 推断 */
    const stOf = (sub, r) => (sub && sub.state) || (r.ready ? 'ready' : (r.error ? 'error' : 'off'));
    engStates = {
      analyze: stOf(s && s.analyze, a),
      play:    stOf(s && s.play, p),
      coach:   stOf(s && s.coach, c),
    };
    renderEngines();
    /* 任一引擎刚就绪都刷一次：
       分析引擎就绪 → 立刻算当前局面；对弈引擎就绪 → 轮到 AI 就让它落子。 */
    syncUI();
    checkEngineReloaded();      // 「设置」里改完路径的重启 → 两个都就绪才算重启完成
  };

  /* ---------- 顶栏引擎状态灯（2026-10-05 新增） ----------
     引擎改成手动加载后，用户需要一眼看到「谁在跑 / 谁没跑 / 谁挂了」。
     点一下弹出操作菜单（加载 / 暂停 / 恢复 / 卸载），菜单内容按当前状态现生成。 */
  /* 一盏灯 = 一组进程：
       katago = 分析引擎 + 对弈引擎（**两个**进程，合在一起管 —— 对用户来说就是「KataGo」）
       coach  = LoGos 一个进程
     灯的状态取这一组的「合成状态」，取更"要紧"的那个。 */
  const ENG_KEYS = { katago: ['analyze', 'play'], coach: ['coach'] };
  const ENG_META = {
    katago: { on: 'KataGo', tip: '算胜率、目差、推荐点、形势、复盘，也负责 AI 落子' },
    coach:  { on: 'LoGos（讲解模型）', tip: '用大白话讲棋（分析讲解 / 推荐落点讲解 / 全盘讲解）' },
  };
  const ENG_STATE_TXT = { off: '未加载', loading: '加载中…', ready: '就绪', paused: '已暂停', error: '出错', partial: '部分就绪' };

  function engStateOf(key) {
    const list = (ENG_KEYS[key] || []).map(k => engStates[k] || 'off');
    if (list.includes('error')) return 'error';
    if (list.includes('loading')) return 'loading';
    if (list.every(s => s === 'off')) return 'off';
    /* ★ 暂停必须排在「就绪」前面：否则「分析已暂停 + 对弈没加载」会走到下面的兜底、
       显示成绿灯「就绪」—— 而这时候点「数子」根本不会算（2026-10-05 审查发现）。 */
    if (list.includes('paused')) return 'paused';
    if (list.every(s => s === 'ready')) return 'ready';
    return 'partial';      // 起了几个、还有没起的
  }
  let engMenuKey = null;

  function renderEngines() {
    for (const el of document.querySelectorAll('.engines .eng')) {
      const k = el.dataset.key;
      const st = engStateOf(k);
      el.dataset.state = st;
      const meta = ENG_META[k];
      el.title = meta.on + ' —— ' + ENG_STATE_TXT[st] + '\n' + meta.tip + '\n（点一下看能做什么）';
    }
    /* 菜单开着时状态变了（比如「加载中」变成「就绪」）→ 菜单内容跟着刷新 */
    if (engMenuKey) {
      const el = document.querySelector('.engines .eng[data-key="' + engMenuKey + '"]');
      if (el) openEngineMenu(engMenuKey, el, true);
    }
  }

  function closeEngineMenu() {
    $('engmenu').hidden = true;
    engMenuKey = null;
  }

  function openEngineMenu(key, anchorEl, keepOpen) {
    if (!keepOpen && engMenuKey === key) { closeEngineMenu(); return; }
    const meta = ENG_META[key];
    /* ★ 菜单项按**每个子引擎**的实际情况出，而不是看聚合出来的那一个状态：
       KataGo 是「分析 + 对弈」两个进程，可能出现「分析起来了、对弈没起」。
       原来的写法在这种组合下既不给「加载」也不给「暂停/卸载」，
       用户想把缺的那个补起来却没有入口（2026-10-05 审查发现）。 */
    const subs = (ENG_KEYS[key] || []).map(k => engStates[k] || 'off');
    const anyOff = subs.some(s => s === 'off' || s === 'error');
    const anyReady = subs.some(s => s === 'ready');
    const anyPaused = subs.some(s => s === 'paused');
    const anyLoading = subs.some(s => s === 'loading');

    const rows = [];
    if (anyLoading) rows.push({ act: null, label: '正在加载…请稍候' });
    if (anyOff) rows.push({ act: 'load', label: '加载（第一次约十几秒）' });
    /* 暂停只对「分析引擎」有意义 —— 它局面一变就自动分析。
       对弈引擎是被动的（只在你落子后才动），LoGos 更被动，都没有「暂停」这回事。 */
    if (anyReady && key === 'katago') rows.push({ act: 'pause', label: '暂停分析（不自动算棋）' });
    if (anyPaused) rows.push({ act: 'resume', label: '恢复分析' });
    if (anyReady || anyPaused) rows.push({ act: 'unload', label: '腾出显存（卸载）' });
    if (!rows.length) rows.push({ act: null, label: '（没有可执行的操作）' });

    const st = engStateOf(key);
    const menu = $('engmenu');
    menu.textContent = '';
    const head = document.createElement('div');
    head.className = 'mhead';
    head.textContent = meta.on + ' · ' + ENG_STATE_TXT[st];
    menu.appendChild(head);
    for (const r of rows) {
      const b = document.createElement('button');
      b.textContent = r.label;
      if (!r.act) { b.disabled = true; b.style.color = 'var(--text-dim)'; b.style.cursor = 'default'; }
      else b.onclick = () => { closeEngineMenu(); doEngineAct(key, r.act); };
      menu.appendChild(b);
    }
    menu.hidden = false;
    /* 定位：贴在按钮正下方；右边超出窗口就往回收一点 */
    const r = anchorEl.getBoundingClientRect();
    const w = menu.offsetWidth || 170;
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    menu.style.top = (r.bottom + 6) + 'px';
    engMenuKey = key;
  }

  async function doEngineAct(key, act) {
    const list = ENG_KEYS[key] || [key];
    let err = '';
    for (const k of list) {
      /* 「暂停 / 恢复」只对分析引擎做 —— 对弈引擎是被动的，暂停它没有含义。 */
      if ((act === 'pause' || act === 'resume') && k !== 'analyze') continue;
      const f = window.api.engine && window.api.engine[act];
      if (typeof f !== 'function') { err = '这个操作不可用'; break; }
      const r = await f(k);
      if (r && r.error) err = r.error;
    }
    if (err) { flash(err); return; }
    if (act === 'load') flash(ENG_META[key].on + ' 正在加载，好了会自己变绿');
    if (act === 'unload') flash(ENG_META[key].on + ' 已卸载');
  }

  /* ★ 引擎没加载时，点需要它的功能 → 提示 + 把操作菜单直接弹到眼前
     （2026-10-05 用户拍板的 A 方案：不静默、也不偷偷自己加载）。
     返回 true = 已经处理了，调用方直接 return 就行。 */
  function needEngine(key, what) {
    const ready = key === 'coach' ? coachReady : (key === 'play' ? engineReadyPlay : engineReady);
    if (ready) return false;
    const group = key === 'coach' ? 'coach' : 'katago';
    const nm = ENG_META[group].on;
    const st = engStateOf(group);
    if (st === 'loading') { flash(nm + ' 正在加载，稍等一下……'); return true; }
    flash(nm + ' 还没加载' + (what ? '，' + what + '得先有它' : '') + ' —— 点下面「加载」');
    const el = document.querySelector('.engines .eng[data-key="' + group + '"]');
    if (el) openEngineMenu(group, el, true);       // 把菜单弹出来，省得再去找
    return true;
  }
  window.needEngine = needEngine;

  for (const el of document.querySelectorAll('.engines .eng')) {
    el.onclick = e => { e.stopPropagation(); openEngineMenu(el.dataset.key, el); };
  }
  document.addEventListener('click', e => {
    if ($('engmenu').hidden) return;
    if (e.target.closest('#engmenu') || e.target.closest('.engines')) return;
    closeEngineMenu();
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeEngineMenu(); });

  window.api.engineStatus().then(applyEngineStatus);

  /* ---------- 顶栏「刷新」按钮（2026-10-06 晚新增，用户要求） ----------
     用途：出现「推荐点不显示 / 棋盘上方『计算中… N』定住不动」时的**急救键**。
     为什么必须有它（而不是只靠自动恢复）：分析链路上有两条"等引擎回话"的路
     （主进程 90 秒、渲染端 25 秒），但都可能因为别的原因没兜住；
     一旦那一次 await 永不返回，`anaBusy` 就永远占着 → 整个分析链路停摆，
     用户能做的只有重启软件。有了它，用户自己点一下就放开、重排、并顺手救引擎。

     三步，顺序不能反：
       ① **放开前端卡住的闸门**（anaBusy / anaPoke / 超时计数），并把「待重算」意图留着；
       ② **问一遍引擎真实状态**；灯是 error / 显示就绪但引擎其实不可用 → 卸载再加载（真重启）；
       ③ **重排一次分析** —— 引擎若在重启，等它就绪后 onStatus → syncUI 会自己再排。
     ★ 不是"卡了才做"：没卡的时候点它也有用（相当于刷新状态 + 重排一次当前局面），
       所以按钮不做任何"你不需要点"的拦截，点了就有反馈。 */
  const btnRefresh = $('btn-engine-refresh');
  if (btnRefresh) {
    btnRefresh.onclick = async e => {
      e.stopPropagation();
      if (btnRefresh.dataset.busy === '1') return;          // 防连点
      btnRefresh.dataset.busy = '1';
      const wasStuck = anaBusy && anaBusySince && (Date.now() - anaBusySince > REFRESH_STUCK_MS);
      const waited = anaBusySince ? Math.round((Date.now() - anaBusySince) / 1000) : 0;

      /* ① 放开闸门 */
      anaBusy = false;
      anaPoke = false;
      anaTimeouts = 0;
      anaBusySince = 0;
      anaForceCur = true;        // 逼它把当前局面重算一遍（选点/胜率重新上屏）
      /* ★ 欠账也一起清掉（2026-10-06 晚，实测 _cdp_refresh.mjs）。
         原来只清了闸门、留着队列，于是状态栏写着「清了 N 条待补账」而队列其实还在
         —— 文案和事实不符，而且那份队列可能正是"卡住"的残留（里面混着已撤销手数）。
         清掉它，让分析从当前局面干净地重来一遍；欠的历史会由后续落子重新入队。 */
      const pending = anaQueue.length;
      anaQueue = [];

      let note = '已刷新';
      if (wasStuck) note += '（原来卡了 ' + waited + ' 秒）';
      if (pending) note += '（清了 ' + pending + ' 条待补账）';

      try {
        /* ② 引擎状态：先自己查一遍（别信界面上可能已经过期的灯） */
        let s = null;
        try { s = await window.api.engineStatus(); } catch (err) { s = null; }
        applyEngineStatus(s);
        const a = readEngineState(s, 'analyze');

        /* 灯说就绪、但分析请求其实回不来（engineNote 有内容）→ 真重启一次。
           ⚠️ 只在**已经出过错**或**状态灯是 error** 时重启 ——
              不能看见"就绪"就重启（那会把正常使用的引擎白白断掉十几秒）。 */
        const broken = !!(s && s.analyze && (s.analyze.state === 'error' || a.error));
        if (broken) {
          note += ' · 引擎不正常，正在重启';
          flash(note);
          await window.api.engine.unload('katago').catch(() => { });
          /* 等进程真正退干净再拉 —— launch() 开头是 `if (e.proc) return`，
             退不干净就拉不起来（这个坑在 main.js 里踩过）。 */
          await new Promise(r => setTimeout(r, 1500));
          const r = await window.api.engine.load('katago').catch(() => null);
          note += (r && r.error) ? ('（重启失败：' + r.error + '）') : '（十几秒后变绿）';
        }
      } catch (err) {
        note += ' · 刷新时出错：' + ((err && err.message) || err);
      }

      /* ③ 重排分析 + 让 AI 如果该走就走（顺序无所谓，两者各自有闸门） */
      scheduleAnalysis(0, true);
      if (needAIMove()) scheduleAIMove(0);
      draw();
      flash(note);
      setTimeout(() => { btnRefresh.dataset.busy = '0'; }, 400);
    };
  }
  /* 版本号填到「帮助」面板上 —— 用户判断「要不要更新」的唯一依据（包名不带版本号）。 */
  window.api.appVersion().then(v => { const el = $('help-ver'); if (el) el.textContent = 'v' + v; }).catch(() => { });
  window.api.onStatus(applyEngineStatus);
  /* 边算边刷（引擎每 0.25 秒推一次中途报告）。
     ★ 必须过滤掉「不是当前局面」的报告：补历史欠账的请求也会推中途报告（它成了主进程
       眼里的「最近一次查询」），不过滤就会把**别的局面**的候选点/胜率画到当前棋盘上。
       p.turn = 这条报告是「第几手之后」的局面（= 当时请求的 analyzeTurns）。 */
  window.api.onProgress(p => {
    /* ★ 换局 / 换棋谱之后，旧请求的中间报告一律不要（anaReqGen 还停在上一代）——
       否则它们会往刚清空的界面上写数据。 */
    if (anaReqGen !== gameGen) return;
    /* ★★ 只认分析引擎的报告（2026-10-06 审查发现）。
       对弈引擎（AI 思考时）用的也是同一个通道，但它是人类棋风权重 + 你选的段位档，
       数字和分析引擎不一样；而它那次请求的手数恰好等于当前手数，
       下面那条「手数过滤」拦不住它 —— 结果 AI 每走一步胜率条就闪一下、
       还会污染走势曲线和 state.lastEval。主进程现在也会带 `engine` 且只推分析引擎的，
       这里再挡一道（两边都拦，任一侧改动都不会漏）。 */
    if (!p || p.engine !== 'analyze') return;
    if (typeof p.turn === 'number' && p.turn !== state.viewAt) return;
    applyAnalysis(p, state.viewAt);
    draw();
  });
}

/* ---------------- 落子音效 ---------------- */

/* 素材取自九宫争鼎开发包（game/assets/audio/go_stone_*.wav，44.1k/16bit/单声道，0.08–0.20 秒）
   5 个变体随机播（且不与上一手重复），避免听腻。

   ★★ 2026-10-06 重写（用户报「有时候声音特别小、几乎听不见」）。三个原因，一起修：

   ① **同一个元素被连续重播**：原来只有 5 个 Audio 元素全局轮流用，播之前先
      `a.currentTime = 0` —— 而如果那个元素**还在播**，这就等于对正在播放的元素做 seek，
      Chromium 会把声音掐断、或从中间接上，听起来就是「变轻了」甚至没声。
      改法：每种音效预备 3 个副本（共 15 个元素，启动时全部预载），
      播放时优先挑**没在播的那个** —— 不再去动正在播的元素。
   ② **起播撞上重绘**：落子后紧接着要重画整张盘（形势雾是 N×N 逐点画，很吃主线程）。
      在重绘**之前**起播的话，音频管线刚建好就被主线程占住，
      两个只有 0.08/0.09 秒的短音效会被啃掉开头 —— 这也是「有时候」的来源。
      改法：由调用方把起播挪到重绘之后（见 tryPlay 里的 setTimeout）。
   ③ **整体偏轻**：实测 5 个音效的 RMS 是 8.4%~11.3%，旧代码又统一压到 volume 0.5。
      现在按实测 RMS 归一、基准提到 0.85（数值见 SOUND_GAIN）。 */
const SOUND_FILES = ['go_stone_0.wav', 'go_stone_1.wav', 'go_stone_2.wav', 'go_stone_3.wav', 'go_stone_4.wav'];
/* 每个音效的音量：按实测 RMS 归一（基准 0.85 = RMS 11.3% 的那个）。
   实测值 RMS%：0→8.4  1→11.3  2→10.9  3→9.4  4→10.9
   0 和 3 比基准轻，补到 1.0 封顶（真值 1.14 / 1.02，封顶后仍比其余略轻一点，可接受）。 */
const SOUND_GAIN = [1.0, 0.85, 0.88, 1.0, 0.88];
const SOUND_COPIES = 3;                 // 每种 3 个副本 → 连点也不会撞上正在播的
const SOUND_POOL = [];
SOUND_FILES.forEach((f, i) => {
  for (let k = 0; k < SOUND_COPIES; k++) {
    const a = new Audio('../assets/audio/' + f);
    a.volume = SOUND_GAIN[i] === undefined ? 0.85 : SOUND_GAIN[i];
    a.preload = 'auto';
    SOUND_POOL.push({ el: a, file: i });
  }
});
let lastSoundFile = -1;

function playStoneSound() {
  if (!state.soundOn || !SOUND_POOL.length) return;
  /* 优先挑「没在播」的副本；极端连点导致全在播时，才退而用全部（概率极低） */
  const free = SOUND_POOL.filter(x => x.el.paused || x.el.ended);
  let pool = free.length ? free : SOUND_POOL;
  /* 别和上一手用同一个音效（同一个文件听着会腻） */
  const other = pool.filter(x => x.file !== lastSoundFile);
  if (other.length) pool = other;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  lastSoundFile = pick.file;
  try { pick.el.currentTime = 0; pick.el.play().catch(() => { }); } catch (e) { /* 出声失败不打断对局 */ }
}

/* ---------------- 对局计时 ---------------- */

/* 档位按**真实赛事**定（2026 现役）：
   围甲 / 三星杯 / 烂柯杯 = 每方 2 小时 + 5×60 秒读秒；
   应氏杯 / LG 杯 / 梦百合杯 = 每方 3 小时（LG 是 5×40 秒读秒）。
   注意围棋用「读秒」（每次 N 秒、共 M 次，用完再超时才判负），
   不是国际象棋那种每手加时 —— 只有超快棋那档用「每手加时」。 */
const CLOCK_PRESETS = {
  none:  { label: '不限时' },
  blitz: { label: '超快棋',   main: 300,   add: 5 },
  rapid: { label: '快棋',     main: 1800,  byo: 30, byoN: 3 },
  slow:  { label: '慢棋',     main: 3600,  byo: 60, byoN: 5 },
  pro:   { label: '职业赛',   main: 7200,  byo: 60, byoN: 5 },
  world: { label: '世界大赛', main: 10800, byo: 60, byoN: 5 },
};

/* 双方名字：人机对弈 → 人 PLAYER / AI KATAGO；摆棋（等于本地双人）→ PLAYER1 / PLAYER2 */
/* 没设过名字时的默认叫法（按模式区分） */
function defaultName(color) {
  if (settings.mode === 'free') return color === 'b' ? 'PLAYER1' : 'PLAYER2';
  return color === state.myColor ? 'PLAYER' : 'KATAGO';
}

/* 右侧显示的名字：用户改过的 / 棋谱带来的 优先，都没有才回落到默认。
   ★ 名字**和计时无关** —— 不计时也要显示、也要能改（原来它俩绑在一起：
     `renderClocks()` 一开头就是 `if (!c.on) return`，不限时那两行名字压根不会被更新）。 */
function clockName(color) {
  return (state.names && state.names[color]) || defaultName(color);
}

/* 把名字画到右侧两栏（读秒标记只在计时时叠加）。
   唯一改 cid-* 文本的地方 —— 正在改名（里面挂了 input）时跳过，别把用户正在打的字覆盖掉。 */
function renderNames() {
  const c = state.clock;
  for (const col of ['b', 'w']) {
    const el = $('cid-' + col);
    if (!el || el.querySelector('input')) continue;
    const name = clockName(col);
    let txt = name;
    if (c && c.on) {
      const d = clockDisplay(col);
      if (d.phase === 'byo') txt = name + ' · 读秒' + Math.max(0, d.n);
    }
    el.textContent = txt;
  }
}

/* 点名字就地改名（回车 / 失焦确认，Esc 取消）—— 像棋谱库的「备注」那样。
   改完立刻生效：右侧显示、导出棋谱写进 PB/PW 都用它。 */
function bindClockName(color) {
  const el = $('cid-' + color);
  if (!el) return;
  el.title = '点一下可以改这个名字（导出棋谱时会写进棋谱的双方名）';
  el.classList.add('editable');
  el.onclick = () => {
    if (el.querySelector('input')) return;
    const old = el.textContent;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = 24;
    inp.value = (state.names && state.names[color]) || '';
    inp.placeholder = defaultName(color);
    let closed = false;
    const done = ok => {
      if (closed) return;
      closed = true;
      const v = ok ? inp.value.trim().slice(0, 24) : null;
      if (ok) {
        state.names[color] = v;
        /* ★ 必须把输入框**从 DOM 里摘掉**：renderNames 见到 el 里挂着 input 会跳过
           （免得覆盖用户正在打的字）—— 不摘掉的话名字栏会一直是空白。
           （实测踩过：state.names 明明存进去了，界面上却是空的。） */
        el.textContent = '';
        syncUI();                     // syncUI → renderNames 把新名字画上去
      } else {
        el.textContent = old;
      }
    };
    inp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      if (e.key === 'Escape') { done(false); }
      e.stopPropagation();            // 别让输入框里的按键触发全局快捷键
    };
    inp.onblur = () => done(true);
    el.textContent = '';
    el.appendChild(inp);
    inp.focus();
    inp.select();
  };
}

function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function clockReset() {
  const P = CLOCK_PRESETS[settings.clock] || CLOCK_PRESETS.none;
  const c = state.clock;
  c.key = settings.clock;
  c.on = !!P.main;
  c.main = P.main || 0;
  c.byo = P.byo || 0;
  c.byoN = P.byoN || 0;
  c.add = P.add || 0;
  c.b = { t: c.main, n: c.byoN };
  c.w = { t: c.main, n: c.byoN };
  c.side = sideToMove(0);                    // 让子 / 座子局是白先
  c.phase = 'main';
  c.since = performance.now();
  c.running = c.on;
  c.expired = null;
  c.paused = false;                          // 新对局一定要解除「试下暂停」
  beepedSec = -1;                            // 读秒报时状态一并复位

  /* ★ 这里**不要**再写 `$('clock-card').hidden = !c.on` ——
     CSS 里 `.clock-card { display: flex }` 的特异性会把 `hidden` 的 display:none 顶掉，
     写了也没用（是个静默失效的写法）。而且**名字栏就住在计时卡里**，
     真的把它藏起来，不限时的时候就看不到双方名字了。
     所以 HTML 上那个 hidden 属性也已经删掉（2026-10-04 代码审查发现）。
     不计时时把时间显示成 --:--（见 renderClocks），别留着上一局的数字。 */
  renderClocks();      // 不计时时它会把时间位换成灰色占位 --:--（见 .ctime.off）
}

/* 落子后结算：扣掉本手用时，换对方 */
function clockSwitch() {
  const c = state.clock;
  if (!c.on || c.expired || c.paused) return;   // 试下（草稿）期间不走表
  const now = performance.now();
  const el = Math.max(0, (now - c.since) / 1000);
  const st = c[c.side];

  if (c.phase === 'main') {
    st.t = Math.max(0, st.t - el);
    if (c.add) st.t += c.add;               // 超快棋：每手加时
  }
  /* 读秒阶段不扣总时间 —— 读秒是「每手独立给 N 秒」 */

  c.side = c.side === 'b' ? 'w' : 'b';
  c.phase = c[c.side].t > 0 ? 'main' : 'byo';
  c.since = now;
  beepedSec = -1;             // 换手 → 读秒报时的「响过哪一秒」要重算，否则下一手不响
  renderClocks();
}

/* 悔棋 / 停一手 / 跳转时调用：重置本手起点，不结算（时间不倒退，规则如此） */
function clockTouch() {
  if (state.clock.on) state.clock.since = performance.now();
}

function clockDisplay(color) {
  const c = state.clock;
  const st = c[color];
  const isTurn = (color === c.side) && c.running && !c.expired
    && state.viewAt === state.moves.length;   // 回看历史手时暂停，不给双方扣时间
  const el = isTurn ? Math.max(0, (performance.now() - c.since) / 1000) : 0;
  if (st.t > 0) return { sec: Math.max(0, st.t - el), phase: 'main', n: st.n };
  if (c.byo > 0) return { sec: Math.max(0, c.byo - el), phase: 'byo', n: st.n };
  return { sec: 0, phase: 'main', n: st.n };
}

function renderClocks() {
  const c = state.clock;
  /* 不限时：时间位留一串**灰占位**（--:--，见 .ctime.off）让名字当主角，
     高度也和计时时一致（切换时不会跳）。名字栏是常显的，跟计时无关。 */
  if (!c.on) {
    for (const col of ['b', 'w']) {
      const t = $('ctime-' + col);
      if (t) { t.textContent = '--:--'; t.classList.add('off'); }
    }
    renderNames();
    return;
  }
  for (const col of ['b', 'w']) {
    const t = $('ctime-' + col);
    if (t) t.classList.remove('off');
  }
  [['b', 'clock-b', 'ctime-b'], ['w', 'clock-w', 'ctime-w']].forEach(([col, box, tm]) => {
    const d = clockDisplay(col);
    const bx = $(box);
    bx.classList.toggle('active', col === c.side && !c.expired);
    bx.classList.toggle('byo', d.phase === 'byo' && d.sec > 0);
    bx.classList.toggle('out', c.expired === col);
    $(tm).textContent = fmtClock(d.sec);
  });
  renderNames();      // 名字 + 读秒标记（每 tick 跟着走）
}

/* ★ 超时判负（2026-10-04 用户要求）——
   原来超时只 flash 一句「超时」就完事，棋局还能接着下，计时等于白设。
   统一走 doResign（by='timeout'），结果条会正常弹出。 */
function expireClock(side, reason) {
  const c = state.clock;
  if (c.expired) return;
  c.expired = side;
  c.running = false;
  doResign(side, 'timeout');
  renderClocks();
  flash((side === 'b' ? '黑方' : '白方') + '超时 · 判负（' + reason + '）');
  syncUI();
}

/* 读秒提示音：用 Web Audio **现场合成**一个短促的「滴」——
   不用音频素材（assets 里只有落子声），也不用联网。
   真实对局里裁判在最后 10 秒会一秒一念，这里照着做。 */
let beepCtx = null;
function playBeep() {
  if (!state.soundOn) return;                 // 跟落子音效共用底栏那个开关
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    beepCtx = beepCtx || new AC();
    if (beepCtx.state === 'suspended') beepCtx.resume();
    const t = beepCtx.currentTime;
    const o = beepCtx.createOscillator();
    const g = beepCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g); g.connect(beepCtx.destination);
    o.start(t); o.stop(t + 0.09);
  } catch (e) { /* 出不了声就不出，绝不能影响对局 */ }
}

/* 读秒最后 10 秒：每秒一声。同一秒只响一次（tick 是 250ms 一次，不判重会连响四声）。 */
let beepedSec = -1;
function maybeBeepSecond() {
  const c = state.clock;
  if (!c.on || !c.running || c.expired) { beepedSec = -1; return; }
  const d = clockDisplay(c.side);
  const sec = Math.ceil(d.sec);
  if (d.phase !== 'byo' || sec <= 0 || sec > 10) { beepedSec = -1; return; }
  if (sec === beepedSec) return;
  beepedSec = sec;
  playBeep();
}

function clockTick() {
  const c = state.clock;
  if (!c.on || !c.running || c.expired || c.paused) return;   // 试下（草稿）期间暂停
  const now = performance.now();
  const el = Math.max(0, (now - c.since) / 1000);
  const st = c[c.side];

  if (c.phase === 'main') {
    if (el >= st.t) {
      /* 主时间走完：有读秒就进读秒，**没读秒的直接判负**。
         （原来只写了「有读秒」那一半 —— 万一有 byo = 0 的档位，时间会停在 00:00
           既不进读秒也不判负，一直卡着。） */
      if (c.byo > 0) { st.t = 0; c.phase = 'byo'; c.since = now; }
      else { expireClock(c.side, '主时间用完，本局不读秒'); return; }
    }
  } else if (c.byo > 0) {
    if (el >= c.byo) {
      st.n -= 1;                                                    // 读秒一次用完，扣一次
      if (st.n < 0) { expireClock(c.side, '读秒次数已用尽'); return; }
      c.since = now;                                                // 还有次数 → 重新读一次
    }
  }
  renderClocks();
  maybeBeepSecond();        // 读秒最后 10 秒每秒一响
}

setInterval(clockTick, 250);

/* ---------------- 形势显示（ownership）----------------
   数据源：分析请求里 includeOwnership:true → 顶层 ownership 数组（长度 N*N，-1~+1）。
   **不增加搜索量**（引擎本来就在算），只多传几百个数。

   ★ 颜色按 KaTrain 实机截图定的（不是照抄配置，是**看着它的画面反推的**）：
     - 它的棋盘底色是暖木色，白雾 = **比底色更亮的暖白**，黑雾 = **深褐**（不是纯黑）
     - **几乎铺满整个盘面**：连接近中立的点也有很淡的色调，深浅表示归属强弱
     ⚠️ 别把「第一版整盘全是黑雾」归因到颜色上 —— **真因是符号搞反了**
        （ownership 是相对当前走棋方的，见上面那段），当时白雾被画成了黑雾。
        另有观感问题：硬边方块 + 中立点不画 → 盘面很碎，已由下面的「小贴图放大」解决。 */
/* ===== 形势显示：参数**照抄 KaTrain 的 Theme 默认值**（katrain/gui/theme.py）
   OWNERSHIP_COLORS = {B:[0,0,0.10,0.75], W:[0.92,0.92,1.0,0.80]}
   OWNERSHIP_GAMMA = 1.33 · BLOCKS_THRESHOLD = 0.3 · MARK_SIZE = 0.42 · STONE_MIN_ALPHA = 0.85

   ★★ 一条我判断错了、后来改回来的（用户质疑后重算，别重犯）：
      我一度认为「我们棋盘浅（当时 #f2dfba→#e9d3a8 米黄；**2026-10-04 已按用户拍板调深为
      #dfc48f→#d4b47c「中深」档，白雾色差 64→105**），KaTrain 的白雾(0.92,0.92,1.0)涂上去=没涂」，
      于是擅自把白雾改成淡天蓝。**这个推断是错的** —— 我只看了亮度，漏了色相：
          棋盘底色 B 通道 0.729，白雾 B 通道 1.00，α=0.8 叠加后 B=0.946 → **差 0.22，偏蓝很明显**。
      结论：**白雾照抄 KaTrain 原值，不做任何"适配"**。底色深浅不影响它可见。 */
const TERR_B = [0.0, 0.0, 0.10, 0.75];
const TERR_W = [0.92, 0.92, 1.0, 0.80];   // 照抄 KaTrain，不偏离
const TERR_GAMMA = 1.33;
const TERR_BLOCK_TH = 0.3;
const TERR_BLOCK_MARK = 0.42;
const TERR_STONE_MIN = 0.85;

/* 离屏贴图：做法完全照抄 KaTrain 的 draw_territory_color ——
   把 N×N 个归属值画成一张 **(N+2)×(N+2) 的小贴图**（外圈 alpha=0，让边缘平滑衰减），
   再一次性拉伸铺满棋盘。放大时由浏览器插值 → 得到**连续的雾**。
   ⚠️ 两个关键点，第一版都做错了：
     ① 必须比棋盘多 1 行/列（否则边缘是硬的）；
     ② alpha 直接取 |ownership|，**中立的点要完全透明** —— 我自己加过 A_MIN 铺底，
        结果整盘糊成一片。 */
let terrCv = null, terrCx = null, terrIm = null;

function drawTerritory() {
  const o = state.ownership;
  if (!state.showTerritory || !o || o.length !== N * N) return;

  const blocksMode = state.terrStyle === 'blocks';
  const W = N + 2;

  if (!terrCv) { terrCv = document.createElement('canvas'); terrCx = terrCv.getContext('2d'); }
  if (terrCv.width !== W) {
    terrCv.width = W; terrCv.height = W;
    terrIm = terrCx.createImageData(W, W);
  }
  const d = terrIm.data;

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const gx = x - 1, gy = y - 1;
      const i = (y * W + x) * 4;
      if (gx < 0 || gx >= N || gy < 0 || gy >= N) { d[i + 3] = 0; continue; }   // 外圈透明
      const v = o[gy * N + gx];
      let a = Math.min(1, Math.abs(v));
      if (blocksMode) a = a > TERR_BLOCK_TH ? 1 : 0;
      a = Math.pow(a, 1 / TERR_GAMMA);          // Gamma 曲线（KaTrain 有，我第一版漏了）
      if (a <= 0) { d[i + 3] = 0; continue; }
      const col = v > 0 ? TERR_B : TERR_W;
      d[i] = (col[0] * 255) | 0;
      d[i + 1] = (col[1] * 255) | 0;
      d[i + 2] = (col[2] * 255) | 0;
      d[i + 3] = (a * col[3] * 255) | 0;        // 基础 alpha × 归属强度
    }
  }
  terrCx.putImageData(terrIm, 0, 0);

  ctx.save();
  /* blocks = 硬边方块（nearest）；雾 = 平滑插值（linear）—— 与 KaTrain 的 mag_filter 一致 */
  ctx.imageSmoothingEnabled = !blocksMode;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  /* 贴图第 (x+1) 个像素对应交叉点 x → 起点在棋盘左上一格半的地方 */
  const x0 = pad - gap * 1.5;
  ctx.drawImage(terrCv, x0, x0, gap * (N + 2), gap * (N + 2));
  ctx.restore();
}

/* 画形势。画在棋盘线之上、棋子之下（子压在上层不受影响）。
   ⚠️ 这里曾出现「同一个函数定义了两遍」——后定义的会覆盖先定义的，
      导致改了半天不生效。改这类函数后务必 grep 一遍函数名，确认只有一处。 */

/* 棋子上的形势叠加 —— 公式照抄 KaTrain 的 draw_stone：
     这块地归它（player == owner）→ alpha = MIN + (1-MIN)×|ownership|（归属越强越实）
     不是它的地          → alpha = MIN（固定最低，也就是"死子"）
   TERR_STONE_MIN = 0.85 也照抄 KaTrain（我起初用 0.5，太夸张、会让人误以为已经提掉了）。 */
function stoneAlphaAt(x, y, stone) {
  if (!state.showTerritory || state.terrStyle !== 'fog') return 1;
  const o = state.ownership;
  if (!o || o.length !== N * N) return 1;
  const v = o[y * N + x];
  const owner = v > 0 ? 1 : -1;              // 1 = 黑占优 / -1 = 白占优
  /* ★★ 2026-10-06 审查发现：传进来的 `stone` 是**棋盘数组的值**（1=黑、2=白），
     而 owner 是 **±1** 的约定 —— 必须先把 stone 也换成 ±1 再比。
     原来直接写 `stone === owner`：白棋是 2，永远不等于 -1，
     于是**所有白子在形势雾里都被当成死子、一直画成半透明**（黑棋却正常）。
     一直没人报，是因为它看起来像"雾的样式"。 */
  const mine = stone === 1 ? 1 : (stone === 2 ? -1 : 0);
  if (mine === owner) return TERR_STONE_MIN + (1 - TERR_STONE_MIN) * Math.abs(v);
  return TERR_STONE_MIN;
}

/* 变化图（PV）：鼠标在推荐点上停 1 秒 → 把「这一手之后预计会怎么走」画在盘上。
   画成**半透明棋子 + 序号**，压在真棋子之上（它是假设，不是盘面，所以用透明度区分）。
   数据来自引擎给每个候选点的 pv（主进程只透传前 8 手）。 */
function drawPV() {
  const P = state.pv;
  if (!P || !P.list || !P.list.length) return;
  const b = boardAt(state.viewAt);
  const first = sideToMove(state.viewAt);     // pv 第 1 手的落子方（= 现在该谁走）
  const seen = new Set();
  let n = 0;                                   // 画出来的序号（1 开始）
  P.list.forEach((mv, k) => {
    const pt = fromGTP(mv);
    if (!pt) return;                           // pass 或不认识的坐标
    if (k === 0 && pt.x === P.x && pt.y === P.y) return;   // pv[0] 通常就是这个推荐点本身，它已有标记，别重复画
    const key = pt.x + ',' + pt.y;
    if (seen.has(key)) return;
    seen.add(key);
    /* 盘上已有子的点跳过（PV 里提子后重下的情况）—— 盖在真子上反而看不清 */
    if (b[idx(pt.x, pt.y)] !== 0) return;
    const [cx, cy] = pxOf(pt.x, pt.y);
    /* 落子方按 pv 里的位置 k 定（k=0 是该走的一方），不要用 n —— 跳过第一个不影响手顺 */
    const isB = (k % 2 === 0) ? (first === 'b') : (first !== 'b');
    ctx.globalAlpha = 0.66;
    drawStone(cx, cy, isB ? 'b' : 'w');
    ctx.globalAlpha = 1;
    n++;
    ctx.fillStyle = isB ? '#f2f2f2' : '#1b1b1a';
    ctx.font = `bold ${Math.max(8, gap * 0.34).toFixed(1)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), cx, cy + gap * 0.01);
  });
}

/* 变化图「现在该不该画」—— 所有条件集中在这里，draw() 和测试都用它。
   ★ 刻意不要求「那个点还在推荐列表里」：分析每隔几秒出一批新候选，列表会换人，
     若要求它还在列表里，变化图会在你看的时候**闪掉**（实测踩过）。
     局面没变（candAt === viewAt）时，这个变化图依然有效。
   ★ 也刻意**不依赖 mouseleave 事件**：鼠标不在那儿了，条件自然不成立 ——
     只靠事件清理的话，窗口失焦/事件被吞都会留下残影。 */
function pvVisible() {
  const P = state.pv;
  if (!P) return false;
  if (!state.showPV || !state.showHints) return false;
  if (settings.mode === 'play' && !isMyTurn()) return false;      // 和推荐点同一套规则
  if (!hover || hover.x !== P.x || hover.y !== P.y) return false; // 鼠标得还停在那儿
  return state.candAt === state.viewAt;                           // 局面没变（变了就作废）
}

/* 变化图的触发：鼠标停在**推荐点**上满 1 秒才显示。
   为什么要等 1 秒：鼠标扫过棋盘时会一路经过候选点，立刻显示的话屏幕上会一直闪东西。
   （用户 2026-10-04 明确要求「悬停在推荐点上保持 1 秒然后显示后续变化」） */
function updatePV() {
  clearTimeout(pvTimer); pvTimer = null;
  /* 人机对弈时只在轮到我方才显示 —— 和推荐点同一套规则，
     否则你刚落子、AI 还没走，画面上会冒出「对手该怎么下」的变化。 */
  const allowed = state.showPV && (settings.mode !== 'play' || isMyTurn());
  const c = (allowed && hover)
    ? state.candidates.find(k => k.x === hover.x && k.y === hover.y)
    : null;
  if (!c || !c.pv || c.pv.length < 2) {
    if (state.pv) { state.pv = null; draw(); }
    return;
  }
  if (state.pv && state.pv.x === c.x && state.pv.y === c.y) return;   // 已经在显示这个点了
  state.pv = null;                                                    // 换点了：先收掉旧的
  pvTimer = setTimeout(() => {
    state.pv = { x: c.x, y: c.y, list: c.pv };
    draw();
  }, 1000);
}

/* ---------------- 胜率走势 / 手数列表 ---------------- */

/* 走势曲线有两种纵轴（用户 2026-10-04 拍板「两种都给，加切换」）：
     · win  = 黑方胜率（0~100%），50% 那条虚线是「均势」
     · lead = 黑方领先目数（正 = 黑优），0 那条线是「均势」
   ★ 视角固定为**黑方** —— 引擎给的原始值是「轮到走棋那一方」的，
     照它画每落一手曲线就要上下翻一次，没法看；统一成黑方才连得成一条线。
   ★ 两种都**按本局实际范围自适应量程**：否则一盘势均力敌的棋，曲线会全挤在
     均势线附近，看不出"这一手亏了多少"（实测九个点只占屏幕高度的 5%）。
   ★ 量程自适应之后**必须把范围标出来**（右上角那行）—— 否则会被误读成
     "每盘都这么激烈"：一盘一路碾压的棋铺满之后看着也很刺激，
     但右上角会老老实实写着"全程 85% ~ 96%"。 */
function renderCurve() {
  const cv = $('curve');
  const w = cv.clientWidth || 268, h = cv.clientHeight || 76;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const isLead = state.curveMode === 'lead';
  const src = isLead ? state.leads : state.history;
  const pT = 14, pB = 14, pL = 30, pR = 5;     // 上下各留一行：左上角写模式、右上角写量程
  const W = Math.max(1, w - pL - pR), H = Math.max(1, h - pT - pB);

  /* 左上角：这图画的是哪条轴（**视角是黑方**，必须写出来） */
  c.font = '9px "Microsoft YaHei", sans-serif';
  c.fillStyle = 'rgba(0,0,0,.38)';
  c.textAlign = 'left'; c.textBaseline = 'top';
  c.fillText(isLead ? '黑方领先（目）' : '黑方胜率', 2, 1);

  const sg = v => (v > 0 ? '+' : (v < 0 ? '\u2212' : '')) + Math.abs(v).toFixed(1);

  /* 有数据的手数范围 —— 没数据的地方不占宽度 */
  const idx = Object.keys(src).map(Number)
    .filter(i => typeof src[i] === 'number').sort((a, b) => a - b);

  if (!idx.length) {
    c.fillStyle = 'rgba(0,0,0,.26)';
    c.font = '11px "Microsoft YaHei", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText((isLead && Object.keys(state.history).length)
      ? '没有目差数据 · 重新复盘一次就有了'
      : (state.noGame ? '还没有对局' : '逐手走一遍就会画出来'), w / 2, pT + H / 2);
    return;
  }

  /* 量程 = 本局实际范围 + 12% 余量；跨度太小时撑到最小跨度，
     免得一两个点的正常抖动被放大成"剧烈起伏"（胜率最小 22 个百分点、目差最小 6 目）。 */
  const vals = idx.map(i => src[i]);
  let mn = Math.min(...vals), mx = Math.max(...vals);
  const minSpan = isLead ? 6 : 0.22;
  if (mx - mn < minSpan) { const m0 = (mx + mn) / 2; mn = m0 - minSpan / 2; mx = m0 + minSpan / 2; }
  const pad = (mx - mn) * 0.12;
  let lo = mn - pad, hi = mx + pad;
  if (!isLead) { lo = Math.max(0, lo); hi = Math.min(1, hi); }   // 胜率不越出 0~100%

  const i0 = idx[0], i1 = idx[idx.length - 1];
  const X = i => pL + (i1 <= i0 ? W / 2 : W * ((i - i0) / (i1 - i0)));
  const Y = v => pT + H - H * ((v - lo) / (hi - lo));
  const MID = isLead ? 0 : 0.5;                                   // 「均势」线

  /* 右上角：本局量程（自适应之后必须标出来，否则会被误读） */
  c.fillStyle = 'rgba(0,0,0,.38)';
  c.textAlign = 'right'; c.textBaseline = 'top';
  c.fillText(isLead
    ? (sg(lo) + ' ~ ' + sg(hi) + ' 目')
    : (Math.round(lo * 100) + '% ~ ' + Math.round(hi * 100) + '%'), w - 2, 1);

  /* 均势线（胜率 50% / 目差 0）+ 左侧标注 */
  if (MID >= lo && MID <= hi) {
    const ym = Y(MID);
    c.strokeStyle = 'rgba(0,0,0,.14)';
    c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(pL, ym); c.lineTo(pL + W, ym); c.stroke();
    c.setLineDash([]);
    c.fillStyle = 'rgba(0,0,0,.32)';
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('均势', 2, ym);
  }

  const pts = idx.map(i => [i, src[i]]);

  /* 面积 + 折线 */
  c.beginPath();
  pts.forEach(([i, v], k) => { const x = X(i), y = Y(v); if (k) c.lineTo(x, y); else c.moveTo(x, y); });
  c.strokeStyle = '#2f6f5e';
  c.lineWidth = 1.6;
  c.stroke();
  c.lineTo(X(pts[pts.length - 1][0]), pT + H);
  c.lineTo(X(pts[0][0]), pT + H);
  c.closePath();
  c.fillStyle = 'rgba(47,111,94,.13)';
  c.fill();

  /* 单点也画个圆点，否则看不出有数据 */
  if (pts.length === 1) {
    c.beginPath(); c.arc(X(pts[0][0]), Y(pts[0][1]), 2.4, 0, 7);
    c.fillStyle = '#2f6f5e'; c.fill();
  }

  /* 复盘的失误点：标在曲线上，一眼看出哪几手掉得多（≥1.5 目）。
     两种模式标的**是同一手**，只是纵轴值换成当前模式的那条数据。 */
  if (state.review) {
    for (let t = 0; t < state.review.losses.length; t++) {
      const v = state.review.losses[t];
      if (typeof v !== 'number' || v < 1.5) continue;
      const i = t + 1;                                   // 第 t+1 手
      if (i < i0 || i > i1) continue;
      const hv = src[i];
      if (typeof hv !== 'number') continue;
      c.beginPath();
      c.arc(X(i), Y(hv), v >= 6 ? 3.4 : 2.4, 0, 7);
      c.fillStyle = v >= 12 ? '#8e1b0f' : (v >= 6 ? '#c0392b' : '#e08a2e');
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,.85)';
      c.lineWidth = 1;
      c.stroke();
    }
  }

  /* 当前看的那一手 */
  if (state.viewAt >= i0 && state.viewAt <= i1) {
    c.strokeStyle = 'rgba(198,64,44,.5)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(X(state.viewAt), pT); c.lineTo(X(state.viewAt), pT + H); c.stroke();
  }

  /* 底部标**手数**刻度 */
  c.fillStyle = 'rgba(0,0,0,.5)';
  c.font = '9px "Microsoft YaHei", sans-serif';
  c.textBaseline = 'top';
  const ticks = (i0 === i1) ? [i0] : [i0, Math.round((i0 + i1) / 2), i1];
  ticks.forEach((v, k) => {
    c.textAlign = k === 0 ? 'left' : (k === ticks.length - 1 ? 'right' : 'center');
    c.fillText(String(v) + '手', X(v), pT + H + 3);
  });
}

let lastScrolledAt = -1;      // 列表上次自动滚到的手数（免得边算边刷时反复把用户拽回来）

function renderMoveList() {
  const ul = $('movelist');  const total = state.moves.length;
  if (!total) { ul.innerHTML = '<li class="empty">还没有落子</li>'; return; }

  let html = '';
  for (let i = 0; i < total; i++) {
    const m = state.moves[i];
    const side = m.color === 'b' ? '黑' : '白';
    const pt = m.pass ? '停一手' : GTP_COLS[m.x] + (N - m.y);

    /* 右侧标记：有复盘数据就显示**目损**（比胜率涨跌直观，且是我们逐手算出来的）；
       没有复盘数据时退回「胜率涨跌 %」。 */
    let dl = '';
    const rvLoss = state.review ? state.review.losses[i] : null;
    if (typeof rvLoss === 'number') {
      const lv = lossLevel(rvLoss);
      const t = '这一手亏 ' + rvLoss.toFixed(1) + ' 目' + (lv ? '（' + lv.label + '）' : '');
      dl = rvLoss < 0.05
        ? '<span class="dl rv-ok" title="' + t + '">0</span>'
        : '<span class="dl ' + (lv ? 'rv-' + lv.cls : '') + '" title="' + t + '">−' + rvLoss.toFixed(1) + '</span>';
    } else {
      /* 这一手让「下棋方」的胜率变化了多少（黑方胜率下降 = 白棋走得好）
         ★ 必须等这一手**算准了**才显示数字（evalSettled）。
           否则刚落子那 0.3 秒的粗算值会先摆出来，过一会儿又变成收敛值 ——
           用户看到的就是「数字自己跳」。没算准就先显示「…」。 */
      const h = state.history[i + 1], prev = state.history[i];
      if (typeof h === 'number' && typeof prev === 'number' && evalSettled(i + 1)) {
        const d = (h - prev) * 100 * (m.color === 'b' ? 1 : -1);
        if (Math.abs(d) >= 0.05) {
          dl = `<span class="dl ${d < 0 ? 'bad' : ''}">${d > 0 ? '+' : ''}${d.toFixed(1)}%</span>`;
        }
      } else if (typeof h === 'number' && !evalSettled(i + 1)) {
        /* 还在算 → 给个占位，让用户知道这里会有数字（不是坏了） */
        dl = '<span class="dl calc" title="这一手还在算，算准了才显示涨跌">…</span>';
      }
    }
    /* 试下（草稿）里下的手单独标出来 —— 免得过一会儿忘了自己在草稿里 */
    const isDraft = state.draft && (i + 1) > state.draft.from;
    html += `<li data-n="${i + 1}" class="${state.viewAt === i + 1 ? 'cur' : ''}${isDraft ? ' draft' : ''}">`
      + `<span class="no">${i + 1}</span><span class="st">${side}</span>`
      + `<span class="pt">${pt}</span>`
      + (isDraft ? '<span class="dft">草</span>' : '')
      + dl + '</li>';   // 「涨跌」靠 margin-left:auto 顶到最右，所以草稿标记要放它前面
  }
  ul.innerHTML = html;
  ul.querySelectorAll('li[data-n]').forEach(li => {
    li.onclick = () => gotoView(+li.dataset.n);
  });

  /* 当前那一手滚进可视区（只在「看的那手」变化时滚，免得边算边刷新时一直把用户拽回来） */
  const cur = ul.querySelector('li.cur');
  if (cur && lastScrolledAt !== state.viewAt) {
    cur.scrollIntoView({ block: 'nearest' });
    lastScrolledAt = state.viewAt;
  }
}

/* ---------------- 解说词框（棋谱自带的 C[]，2026-10-06 用户要求） ----------------
   参照 MultiGo 的那个框：显示**当前看着的这一手**在棋谱文件里写的解说。
   数据来自 parseSGF 交出来的 comments（**只取主分支** —— 我们不做分支树，用户定的）。
   编辑：直接改棋谱文件里那一个 C[]（见 patchSGFComment），第一次覆盖前会留 .bak。 */

/* 「第几题 / 共几题」的提示文字（2026-10-06）。
   ★ 放在**顶栏状态行**里，不做成浮层 —— 实测棋盘四周只有 3px（上方）/
     34px（左右）的空隙，任何浮层都会盖住棋盘；而顶栏本来就写着「第 N 手」，
     题号跟它是同一类信息，凑在一起最自然，还不占额外地方。

   一份题集会把多道题串在一个 SGF 里，用 `zz` 标记分界（实测抽样 3000 份里 2.97% 的文件有，
   全库 21433 份里 538 份）。我们**只显示位置，不做切换**：
   「跳到第 3 题」是另一个功能（要改手数范围、改引擎请求、改历史），
   做一半只会让人以为能点、点了没反应。 */
function quizPos() {
  const seps = state.quizTips || [];
  if (seps.length < 1) return null;
  const at = state.viewAt;
  let n = 1;
  for (const s of seps) if (at >= s) n++;          /* 分界那一手就归下一题（>= 不是 >） */
  return { n, total: seps.length + 1 };
}
/* 顶栏里用的一段文字；不是题集就返回空串 */
function quizTxt() {
  if (state.noGame) return '';
  const q = quizPos();
  if (!q || q.total < 2) return '';
  return ` · ${q.total === 2 ? '第 ' + q.n + ' 题（共 2 题）' : '第 ' + q.n + ' 题 / 共 ' + q.total + ' 题'}`;
}

function renderCommentBox() {
  const box = $('cbox');
  if (!box) return;
  /* 正在编辑时**不要**覆盖用户的输入 —— syncUI 会频繁调用本函数 */
  if (box.querySelector('textarea')) return;

  const at = state.viewAt;
  const list = state.sgfComments || [];
  /* ★ 棋谱说明（根节点那段文字）：在「开局前」这一档显示。
     它不属于任何一手 —— 实测抽样 300 份真实棋谱里 116 份（38%）有这段。
     以前它和「第 0 手」共用 comments[0] 这个键，被后面那一手覆盖掉 → 整段读不出来。 */
  const rootTxt = at === 0 ? String(state.rootComment || '') : '';
  const txt = rootTxt || (list[at] || '');
  const canEdit = !!state.fromRecord && !!state.recName;
  const btn = $('cbox-edit');
  btn.disabled = !canEdit;
  btn.title = canEdit
    ? (rootTxt ? '改这段棋谱说明（存回这份棋谱文件；第一次改会先留一份 .bak 备份）'
               : '改这一手的解说词（存回这份棋谱文件；第一次改会先留一份 .bak 备份）')
    : (rootTxt ? '只有「打开棋谱」时才能改棋谱说明' : '只有「打开棋谱」时才能改解说词');
  $('cbox-at').textContent = state.noGame ? '（棋谱自带）'
    : (at === 0 ? (rootTxt ? '（开局前 · 棋谱说明）' : '（开局前）') : '（第 ' + at + ' 手）');

  if (txt) { box.textContent = txt; return; }
  const ph = document.createElement('div');
  ph.className = 'ph';
  ph.textContent = state.noGame
    ? '打开一份棋谱后，这里显示棋谱里自带的解说词。'
    : (canEdit ? '这一手没有解说词 —— 点「编辑」可以补上。' : '这一手没有解说词。');
  box.replaceChildren(ph);
}

/* 点「编辑」→ 就地变成输入框（保存/取消） */
/* 退出解说词编辑态。
   ★ 这个函数是 2026-10-06 补的：原来「取消」按钮直接调 renderCommentBox()，
     而 renderCommentBox 开头有一句「正在编辑（框里有 textarea）就别动它」
     —— 于是取消时 textarea 还在框里，第一行就 return，**永远退不出去**。
     翻手也救不了（syncUI 走的同一个函数）。用户报「点编辑后退不出去」，实测确认：
     连点、翻手都不行；而保存失败那条路会保留输入，本意是让人改完再存，
     结果也因为退不出去而变成卡死。

     所以「退出」必须有自己的一条路：**先把 textarea 拆掉，再让 render 重画**。 */
function exitCommentEdit() {
  const box = $('cbox');
  if (!box) return;
  const ta = box.querySelector('textarea');
  if (ta) box.removeChild(ta);
  const bar = box.querySelector('button');      // 保存/取消那一行
  if (bar && bar.parentElement === box) box.removeChild(bar.parentElement);
}

function editComment() {
  const box = $('cbox');
  const at = state.viewAt;
  if (box.querySelector('textarea')) return;
  if (!state.fromRecord || !state.recName) { flash('只有打开棋谱时才能改解说词'); return; }

  /* ★ 「开局前」这一档：如果这份棋谱有根节点说明，那这里改的就是**棋谱说明**
     （它不属于任何一手，onclick 里会走 patchSGFComment(text, -1, …)）。 */
  const isRoot = at === 0 && !!String(state.rootComment || '').trim();

  const ta = document.createElement('textarea');
  /* ★ 显示给用户的这份也统一成 CRLF 口径，跟磁盘上的文件一致 ——
     以前这里是 `list[at]` 原样（文件里的 CRLF），而保存时 textarea 已经把它
     规范成 LF 了，改一次就把文件里那处 CRLF 变成 LF。 */
  ta.value = nlForSGF(isRoot ? state.rootComment : ((state.sgfComments || [])[at] || ''));
  ta.placeholder = isRoot
    ? '写点这段棋谱的说明…（例如出处、这是第几图、谁整理的；留空 + 保存 = 删掉这段）'
    : '写点这一手的解说…（留空 + 保存 = 删掉这一手的解说词）';
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:6px;margin-top:6px;flex:none';
  const ok = document.createElement('button');
  ok.textContent = '保存'; ok.className = 'primary'; ok.style.height = '24px';
  const no = document.createElement('button');
  no.textContent = '取消'; no.style.height = '24px';
  bar.append(ok, no);
  box.replaceChildren(ta, bar);
  ta.focus();
  /* ★ Esc = 取消（用户习惯，也多一条出路）。
     注意必须 preventDefault + stopPropagation：全局那个 keydown 监听器里
     有一条「弹窗开着就一律不响应」，但解说词框不是弹窗，事件会穿过去 ——
     不拦住的话按 Esc 还会顺手把别的东西关了。 */
  ta.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    exitCommentEdit();
    renderCommentBox();
  });

  no.onclick = () => { exitCommentEdit(); renderCommentBox(); };
  ok.onclick = async () => {
    ok.disabled = true;
    const r = await saveComment(at, ta.value.trim(), isRoot);
    if (r && r.error) {
      /* ★ 保存失败时**不能**把用户输入清掉（他还要改），
         但也不能把他锁死在编辑态里 —— 那正是原来的 bug。
         所以这里给个「放弃修改」的出路：换掉按钮含义、让他能直接走出去。 */
      flash('保存失败：' + r.error + '（改完再点「保存」，或点「放弃修改」离开）');
      no.textContent = '放弃修改';
      ok.disabled = false;
      return;
    }
    exitCommentEdit();
    flash((isRoot ? '棋谱说明' : '解说词') + '已存回棋谱'
      + (isRoot ? '' : '（第 ' + at + ' 手）') + ((r && r.note) ? r.note : ''));
    renderCommentBox();
  };
}

/* 把这一手（或根节点说明）的解说词写回棋谱文件 */
async function saveComment(at, text, isRoot) {
  const rd = await window.api.records.read(state.recName);
  if (!rd || rd.error) return { error: (rd && rd.error) || '读不到这份棋谱' };
  const patched = patchSGFComment(rd.text, isRoot ? -1 : at, text);
  if (patched.error) return { error: patched.error };
  const w = await window.api.records.save(state.recName, patched.text);
  if (w && w.error) return { error: w.error };
  if (isRoot) {
    /* 磁盘上写的是 CRLF 口径（见 nlForSGF），内存里这份也保持一致 */
    state.rootComment = text ? nlForSGF(text) : '';
  } else {
    if (!state.sgfComments) state.sgfComments = [];
    /* 存进内存的这份也用 CRLF 口径，跟磁盘上的保持一致 */
    if (text) state.sgfComments[at] = nlForSGF(text); else delete state.sgfComments[at];
  }
  /* ★ 如实回报两件用户该知道的事（2026-10-06）：
       ① 文件原本是 GBK 还是 UTF-8 —— 我们按原编码写回的，不改用户文件的口径；
       ② GBK 里没有的字（比如 emoji）会被写成 '?'，必须告诉用户，否则他
          以为存进去了、换个软件打开发现少字却不知道是谁弄丢的。 */
  let note = '';
  if (w && w.enc === 'gbk') {
    note = '（按原文件的 GBK 编码存回）';
    if (w.missing && w.missing.length) {
      note += ' · ★ 有 ' + w.missing.length + ' 个字符 GBK 装不下，已写成 ?：' +
        [...new Set(w.missing)].slice(0, 6).join('');
    }
  }
  return { ok: true, note };
}

$('cbox-edit').onclick = editComment;



/* 用 e.code 判断，不用 e.key —— 中文输入法下字母键的 key 会变（本项目踩过同源的坑）。
   焦点在输入控件里时一律不拦截，免得选难度时按空格出意外。 */
window.addEventListener('keydown', e => {
  /* ★★ Ctrl+Shift+D：分析链路自检 —— 必须放在下面那道 `if (e.ctrlKey)` **之前**！
     2026-10-07 踩到：原来把它写在下面的 `switch (e.code)` 里（还特意写在裸 `case 'KeyD'`
     试下**前面**），但忘了 Ctrl 组合在更上面就被拦下了：
         if (e.ctrlKey || e.metaKey) { if (KeyZ) 悔棋; return; }   ← 这里就 return 了
     于是那个 case 是**死代码**，用户在卡住时按 Ctrl+Shift+D 一点反应都没有
     （而他正是最需要这个自检的时候）。教训：**判断快捷键能不能到达，要看整条
     早期 return 链，不能只看 switch 内部的顺序。**
     ⚠️ 这个判断要放在「输入框里不拦截」那道检查**之前** ——
        用户很可能正点着「计算深度」之类的控件，那时焦点就在输入控件上。 */
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
    e.preventDefault();
    const cur = state.viewAt, n = state.moves.length;
    flash('分析自检·局面: ' + n + '手·看第' + cur + '手'
      + '·选点: ' + (state.candAt < 0 ? '还没算过' : ('第' + state.candAt + '手算的, 差' + (cur - state.candAt)))
      + '·搜索量: ' + state.rootVisits
      + '·请求: ' + (anaBusy ? '在跑' : '空闲')
      + (anaQueue.length ? ('·欠账' + anaQueue.length + '手') : '')
      + (anaForceCur ? '·待重算' : '')
      + (state.noGame ? '·未开局' : '')
      + (scoreBusy ? '·数子中' : '')
      + (reviewBusy ? '·复盘/讲解中' : '')
      + '·引擎: ' + (engineReady ? '就绪' : (engStates.analyze === 'loading' ? '加载中' : '未就绪'))
      + (anaTimeouts ? ('·超时' + anaTimeouts + '次') : '')
      + '·链路: 轮' + anaDiag.start + '/成功' + anaDiag.okCount + '/空跑' + anaDiag.failOnce
      + (anaDiag.lastFailWhy ? ('·最近中断=' + anaDiag.lastFailWhy) : ''));
    return;
  }

  const t = e.target;
  if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;

  /* ★ 有弹窗开着（帮助 / 设置 / 复盘 / 棋谱库 / 新对局）→ 全局快捷键一律不响应。
     否则按键会「穿过」弹窗打到背后的棋局上：看着在看帮助，按个空格就把棋停了、
     按 T 推荐点就没了（用户明确说过「弹窗外的背景不该还能点」，键盘同理）。
     注意判断的是 `.open` —— 遮罩本身是常驻 DOM，不加 .open 时是不可见的。 */
  if (document.querySelector('.modal-mask.open')) return;

  if (e.ctrlKey || e.metaKey) {
    if (e.code === 'KeyZ') { e.preventDefault(); $('btn-undo').click(); }
    return;
  }
  /* 开关类快捷键统一带一句提示（这些键容易误触，而「东西突然没了」的第一嫌疑就是它）。
     键位（2026-10-04 用户指定）：T 推荐点 · Z 坐标 · M 手数 · Y 音效 · X 形势 · N 拟人落子 · D 试下。
     ⚠️ 改键位时**记得同步 index.html 里各开关名字后面的括号**，以及 title 提示。 */
  switch (e.code) {
    case 'ArrowLeft':  e.preventDefault(); $('btn-prev').click(); break;
    case 'ArrowRight': e.preventDefault(); $('btn-next').click(); break;
    case 'Home':       e.preventDefault(); $('btn-first').click(); break;
    case 'End':        e.preventDefault(); $('btn-last').click(); break;
    case 'Space':      e.preventDefault(); $('btn-pass').click(); break;
    case 'KeyT': {
      const c = $('chk-show'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '已显示推荐点' : '已隐藏推荐点（再按 T 恢复）');
      break;
    }
    case 'KeyZ': {
      const c = $('chk-coords'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '已显示棋盘坐标' : '已隐藏棋盘坐标（再按 Z 恢复）');
      break;
    }
    case 'KeyM': {
      const c = $('chk-nums'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '已显示手数' : '已隐藏手数（再按 M 恢复）');
      break;
    }
    case 'KeyB': {
      const c = $('chk-pv'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '变化图：开 · 把鼠标停在推荐点上停一下' : '变化图：关');
      break;
    }
    case 'KeyY': {
      const c = $('chk-sound'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '音效：开' : '音效：关（再按 Y 恢复）');
      break;
    }
    case 'KeyX': {
      const c = $('chk-terr'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '已显示形势（' + (state.terrStyle === 'fog' ? '雾' : '方块') + '）' : '已隐藏形势（再按 X 恢复）');
      break;
    }
    case 'KeyN': {
      const c = $('chk-human'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '拟人落子：开 · 按该段位人类的概率挑手' : '拟人落子：关 · 取最优手');
      break;
    }
    case 'KeyD':       e.preventDefault(); $('btn-draft').click(); break;   // 试下（打草稿）
  }
});

/* ---------------- 设置：KataGo 程序与权重 ----------------
   ★ 路径存在软件目录的 settings.json 里（主进程读写）；改完点「保存并重启引擎」，
     两个引擎会用新路径重新预热（约 10~20 秒），期间状态栏显示「引擎重启中…」。 */

const SET_MASK = $('settings');
/* 设置面板里的五项路径。前三个是 KataGo（**必需**：下棋/分析全靠它），
   后两个是 LoGos 讲解模型（**可选**：不配就没讲解功能，别的照常用）。 */
const SET_KEYS = ['katago', 'analyzeWeight', 'playWeight', 'coachServer', 'coachWeight', 'recordsDir'];
const SET_LABEL = { katago: 'KataGo 程序', analyzeWeight: '分析权重', playWeight: '对弈权重' };
let setCfg = null;                  // 面板里正在编辑的三条路径（还没保存）

function setMsg(text, bad) {
  const el = $('set-msg');
  el.textContent = text || '';
  el.classList.toggle('bad', !!bad);
}

/* 每行右侧的「✓ 已找到 / ★ 找不到」—— 路径一变就刷（不用保存也能看） */
async function refreshSettingsMarks() {
  const r = await window.api.settings.check(setCfg);
  for (const k of SET_KEYS) {
    const el = $('mark-' + k);
    const ok = !!(r && r[k]);
    el.classList.toggle('ok', ok);
    el.classList.toggle('bad', !ok);
    /* 棋谱库是**目录**，文案和「文件」那几项不一样：
       留空 = 用默认（程序目录\records，完全正常，不是「找不到」）。 */
    if (k === 'recordsDir') {
      const custom = !!(setCfg && setCfg.recordsDir && setCfg.recordsDir.trim());
      el.textContent = !custom ? '默认位置' : (ok ? '✓ 可用' : '★ 用不了');
      continue;
    }
    el.textContent = ok ? '✓ 已找到' : '★ 找不到';
  }
}

/* ★ 引擎兼容性自检（2026-10-07 新增）。
   把「引擎自报的后端」和「屏幕这块显卡」并排显示；对不上就把那句建议标红。
   为什么不做成**自动**弹窗：正常用户看到弹窗只会慌。放在设置面板里、给个「检查」按钮，
   需要的人自然会点。而且引擎没配好时也只是"信息"，不是错误。
   ⚠️ 探测会真的跑一次 katago.exe（约 0.1 秒），所以只在用户点「检查」时做，
     不在打开设置时自动跑 —— 免得每次开设置都去启动一个进程。 */
function renderEngineCheck(r) {
  const el = $('eng-check');
  if (!el) return;
  el.classList.remove('ok', 'bad');
  if (!r || !r.backend) { el.textContent = '检查失败：拿不到引擎信息'; el.classList.add('bad'); return; }
  const be = r.backend, gpu = r.gpu || {};
  if (!be.ok) {
    /* 引擎文件不在/跑不起来 —— 这时「找不到文件」才是用户要听的那句话 */
    el.textContent = be.why || '读不到引擎信息';
    el.classList.add('bad');
    return;
  }
  const gpuTxt = gpu.name ? (gpu.name + (gpu.brand ? '（' + gpu.brand.toUpperCase() + '）' : '')) : '认不出显卡';
  const parts = [
    '下棋/分析：' + (be.name || be.raw) + (be.version ? '（v' + be.version + '）' : ''),
    '显卡：' + gpuTxt,
  ];
  /* ★ AI 讲解是**另一套**引擎、另一套显卡构建，所以单独报一行
     （2026-10-08 加：原来只查 KataGo —— A 卡用户按提示换完 KataGo 之后，
       LoGos 还是 N 卡那套、照样用不了，而软件一句话都不说。那是最让人困惑的情况。） */
  const la = r.llama || null;
  if (la) {
    parts.push('AI 讲解：' + (la.ok
      ? (la.device + (la.vramMB ? '（可用 ' + la.vramMB + ' MB）' : ''))
      : '用不了'));
  }

  const bad = [];
  if (r.warn) bad.push(r.warn);
  if (la && !la.ok) {
    bad.push('「AI 讲解」引擎用不了（' + (la.why || '认不出显卡') + '）。不影响下棋与分析；'
      + '想用讲解就去项目 Release 下载【通用版】包 —— 里面的讲解引擎什么显卡都能跑。');
  }
  if (bad.length) {
    el.textContent = parts.join('　·　') + '　——　' + bad.join('　');
    el.classList.add('bad');
  } else {
    el.textContent = parts.join('　·　') + '　——　✓ 都能配上';
    el.classList.add('ok');
  }
}

const btnEngCheck = $('btn-eng-check');
if (btnEngCheck) {
  btnEngCheck.onclick = async () => {
    const el = $('eng-check');
    const old = btnEngCheck.textContent;
    btnEngCheck.disabled = true;
    btnEngCheck.textContent = '检查中…';
    if (el) { el.classList.remove('ok', 'bad'); el.textContent = '正在读引擎后端…'; }
    let r = null;
    try { r = await window.api.engineCheck(); } catch (e) { r = null; }
    renderEngineCheck(r);
    btnEngCheck.disabled = false;
    btnEngCheck.textContent = old;
  };
}

function fillSettingsInputs() {
  for (const k of SET_KEYS) $('set-' + k).value = (setCfg && setCfg[k]) || '';
}

/* 把「最近用过的权重」灌进输入框的 datalist（2026-10-04 用户要求：权重多套并存、
   记住上次用的）。选项来自 settings.json 的 recent —— 每次保存都会把当前路径记进去。
   点输入框就能从下拉里挑回某一套，不用再翻一遍文件对话框。 */
function fillRecentWeights(recent) {
  const r = recent || {};
  for (const k of ['analyzeWeight', 'playWeight', 'coachWeight']) {
    const dl = $('recent-' + k);
    if (!dl) continue;
    dl.textContent = '';
    for (const p of (r[k] || [])) {
      const o = document.createElement('option');
      o.value = p;
      dl.appendChild(o);
    }
  }
}

/* ==================== 关于与更新（2026-10-08 用户要求）====================
   三件事：显示当前版本号 / 点一下查是否最新 / 一个按钮打开浏览器去下载页。

   ★★ 本软件**除了这里，任何地方都不出网**（审计过）：
        · KataGo、llama-server 都是本机子进程，不联网；
        · 软件自己跟 LoGos 说话走的是 127.0.0.1 的本地 HTTP（loops back，不出网卡）；
        · 引擎配置里出现的那些 https:// 全是**注释**（KataGo 自带的文档链接），不是请求。
      只有「检查更新」这一个按钮会发一次请求到 GitHub —— 而且**只在你点它的时候发**，
      不自动、不后台、不上报任何东西。 */
const REPO_PAGE = 'https://github.com/Rapace7/RapaceGo/releases/latest';

function appVerText(txt, cls) {
  const el = $('app-version');
  if (!el) return;
  el.classList.remove('ok', 'bad');
  if (cls) el.classList.add(cls);
  el.textContent = txt;
}

/* 打开设置面板时读一次版本号（本地读，不发请求） */
async function loadAppVersion() {
  try {
    const i = await window.api.app.info();
    appVerText('v' + i.version);
  } catch (e) { appVerText('（读不到版本号）'); }
}

const btnCheckUpdate = $('btn-check-update');
if (btnCheckUpdate) {
  btnCheckUpdate.onclick = async () => {
    const old = btnCheckUpdate.textContent;
    btnCheckUpdate.disabled = true;
    btnCheckUpdate.textContent = '检查中…';
    appVerText('正在问 GitHub…');
    let r = null;
    try { r = await window.api.app.checkUpdate(); } catch (e) { r = null; }
    if (!r || r.ok !== true) {
      /* ★ 检查失败**只说实话** —— 绝不显示"已是最新"。（网络被挡 / GitHub 抽风都可能） */
      appVerText('检查失败：' + ((r && r.error) || '连不上 GitHub'), 'bad');
    } else if (r.uncertain) {
      appVerText('当前 v' + r.current + '，最新 ' + r.latest + '（你的版本号格式特殊，自己看一眼）');
    } else if (r.upToDate) {
      appVerText('已是最新（v' + r.current + '）', 'ok');
    } else {
      appVerText('有新版本 v' + r.latest + '（你在用 v' + r.current + '）—— 点右边「去下载页」', 'bad');
    }
    btnCheckUpdate.disabled = false;
    btnCheckUpdate.textContent = old;
  };
}

const btnOpenDownload = $('btn-open-download');
if (btnOpenDownload) {
  btnOpenDownload.onclick = async () => {
    /* 不依赖"检查"是否成功 —— 这个按钮任何时候都能用（网络被挡时用户照样能手动去下） */
    let r = null;
    try { r = await window.api.app.openDownload(); } catch (e) { r = null; }
    if (!r || r.ok !== true) flash('打不开浏览器：' + ((r && r.error) || '系统拒绝了') + ' —— 可以手动访问 ' + REPO_PAGE);
  };
}

async function openSettings() {
  const info = await window.api.settings.get();
  setCfg = Object.assign({}, (info && info.config) || {});
  fillSettingsInputs();
  fillRecentWeights(info && info.recent);
  setMsg('');
  /* 自检结果**不跨次沿用**：上次那份可能是改路径之前读的，留着会误导。
     清成提示语，要看的自己点「检查」——反正那次探测只花 0.1 秒。 */
  const ec = $('eng-check');
  if (ec) { ec.classList.remove('ok', 'bad'); ec.textContent = '点「检查」看结果'; }
  /* 版本号是本地读的（不发请求）；更新状态**不跨次沿用** —— 和自检一个道理：
     上次查出来"有新版本"，用户可能已经下过新版了，留着会误导。 */
  loadAppVersion();
  SET_MASK.classList.add('open');
  await refreshSettingsMarks();
}

$('btn-settings').onclick = openSettings;
$('set-cancel').onclick = () => SET_MASK.classList.remove('open');
SET_MASK.addEventListener('click', e => { if (e.target === SET_MASK) SET_MASK.classList.remove('open'); });

/* 手打 / 粘贴进来的路径也要能检测：改完失焦就刷一次标记 */
for (const k of SET_KEYS) {
  $('set-' + k).onchange = () => {
    setCfg[k] = $('set-' + k).value.trim();
    refreshSettingsMarks();
  };
}

/* 「选择…」→ 系统文件选择框（主进程弹，我们只拿回路径） */
for (const k of SET_KEYS) {
  $('pick-' + k).onclick = async () => {
    const r = await window.api.settings.choose(k);
    if (!r || r.canceled) return;
    setCfg[k] = r.path;
    $('set-' + k).value = r.path;
    let extra = '';
    /* 选了 katago.exe → 主进程已顺手在同目录找过权重，这里自动填上 */
    if (r.suggest) {
      const hit = [];
      for (const kk of ['analyzeWeight', 'playWeight']) {
        if (r.suggest[kk]) {
          setCfg[kk] = r.suggest[kk];
          $('set-' + kk).value = r.suggest[kk];
          hit.push(SET_LABEL[kk]);
        }
      }
      if (hit.length) extra = '已在同目录找到权重并自动填上：' + hit.join('、') + '。';
    }
    setMsg(extra);
    await refreshSettingsMarks();
  };
}

$('set-default').onclick = async () => {
  const info = await window.api.settings.get();
  setCfg = Object.assign({}, (info && info.defaults) || {});
  fillSettingsInputs();
  setMsg('已填回默认路径（还没保存）。');
  await refreshSettingsMarks();
};

/* 棋谱库那一项旁边的「用默认」（只有改到别处时才有意义） */
$('reset-recordsDir').onclick = () => {
  setCfg.recordsDir = '';
  $('set-recordsDir').value = '';
  setMsg('已改回默认（程序目录\\records），点「保存并重启引擎」才生效。');
  refreshSettingsMarks();
};

$('set-shortcut').onclick = async () => {
  const r = await window.api.makeShortcut();
  if (r && r.ok) setMsg('桌面快捷方式已创建：' + r.path);
  else setMsg('创建快捷方式失败：' + ((r && r.error) || '未知'), true);
};

$('set-save').onclick = async () => {
  for (const k of SET_KEYS) setCfg[k] = $('set-' + k).value.trim();
  const btn = $('set-save');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '保存中…';
  let r;
  try { r = await window.api.settings.save(setCfg); }
  catch (e) { r = { error: String(e) }; }
  btn.disabled = false;
  btn.textContent = old;

  if (!r || r.error) { setMsg((r && r.error) || '保存失败', true); return; }

  setCfg = Object.assign({}, r.config);
  fillSettingsInputs();
  fillRecentWeights(r.config && r.config.recent);   // 保存成功 → 下拉里多了刚用的这一套
  await refreshSettingsMarks();
  SET_MASK.classList.remove('open');
  /* 引擎是**异步**重启的（停 → 拉起 → 预热）；好了没有要看 engine:status 事件 */
  engineReloading = true;
  /* ★ 这次改棋谱库位置的话，如实报一下搬了几份过去（老位置的不删）。 */
  const mv = r.moved;
  if (mv && (mv.copied || mv.failed)) {
    flash('设置已保存 · 引擎正在重启…　棋谱：已复制 ' + mv.copied + ' 份到新位置'
      + (mv.skipped ? '，' + mv.skipped + ' 份同名已存在没覆盖' : '')
      + '（老位置的没删）');
  } else {
    flash('设置已保存 · 引擎正在按新路径重启…');
  }
};

/* 重启完成 → 提示一句。由 applyEngineStatus 调用（那两个引擎的都绪状态在那儿更新）。 */
function checkEngineReloaded() {
  if (!engineReloading) return;
  if (engineReady && engineReadyPlay) {
    engineReloading = false;
    flash('引擎已按新配置重启完成');
  } else if (engineNote) {
    engineReloading = false;      // 起不来就别一直挂着「重启中」，状态栏已显示「引擎异常」
  }
}

/* ---------------- 帮助 ----------------
   面板内容全是静态 HTML（写在 index.html 的 #help 里），这里只管开关。
   想改帮助文字 → 直接改 index.html；**改功能或快捷键时记得顺手同步**，
   别让帮助里写的和软件实际做的不一样。 */
const HELP_MASK = $('help');
$('btn-help').onclick = () => {
  HELP_MASK.classList.add('open');
  /* ★ 每次打开都从头看（2026-10-08）——
     上次翻到一半的位置留着，会让人以为帮助"打开就是最后一节"。
     ★ 滚动归零直接做（瞬时、不依赖任何测量）；各节位置等到**下一帧**
       —— 弹窗出现动画走完、布局稳定了 —— 再量并缓存（见 measureHelpSections 的注释）。 */
  const body = document.querySelector('.help-body');
  if (body) body.scrollTop = 0;
  helpHighlight('help-first');
  requestAnimationFrame(() => { helpOffsets = measureHelpSections(); });
};
$('help-close').onclick = () => HELP_MASK.classList.remove('open');
HELP_MASK.addEventListener('click', e => { if (e.target === HELP_MASK) HELP_MASK.classList.remove('open'); });

/* ---------- 帮助顶部的直达目录（2026-10-08 用户要求）----------
   用户原话：「软件内的帮助要有顶部列出的直达按钮，直接拉到对应位置，方便快速查询」。

   ★ 为什么不用浏览器原生的 `#id` 锚点跳转：
     帮助正文的滚动容器是 **`.help-body`**（它自己 `overflow-y:auto`），不是根文档 ——
     `#id` 锚点在这里不生效。所以位置得自己算：
       目标相对滚动容器的偏移 = 目标.rect.top − 容器.rect.top ＋ 容器已滚过的距离
     再自己赋 `scrollTop`。CSS 里配了 `scroll-margin-top: 44px` 给吸顶目录让位，
     所以这里不用再手动减目录高度。

   ★ 顺带做**当前小节高亮**：目录吸在顶上，翻到哪一节一眼就知道自己在哪、
     还剩哪些没看 —— 这才是"方便快速查询"。（用 rAF 节流，滚动不卡。） */
const HELP_SECTIONS = ['help-first', 'help-parts', 'help-feat', 'help-rules', 'help-keys', 'help-data'];

/* 平滑滚动：自己用 rAF 做，**不用 CSS 的 scroll-behavior:smooth**。
   为什么不能用 CSS 那个（2026-10-08 实测踩到）：
     它会让每一次 `scrollTop` 赋值都变成动画，于是"先归零、再量绝对位置"的算法失效 ——
     赋值后立刻量，量到的还是动画中途的值（实测设了 0、读到 72），跳转位置就全错。
   自己写还有个好处："打开帮助时归零"可以瞬时完成，而"点目录跳转"才用动画。 */
function animateScrollTop(el, to, ms) {
  const from = el.scrollTop;
  const dist = to - from;
  if (!dist) return;
  /* 环境不支持 rAF（或无头调试窗口）→ 直接跳，别留个半路的位置 */
  if (typeof requestAnimationFrame !== 'function') { el.scrollTop = to; return; }
  const t0 = performance.now();
  const dur = ms || 260;
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);                 // easeOutCubic：快进慢出
    el.scrollTop = from + dist * e;
    if (p < 1) requestAnimationFrame(step);
    else el.scrollTop = to;                           // 收尾对齐，免得差几像素
  };
  requestAnimationFrame(step);
}

/* 各小节相对"滚动内容顶部"的偏移量。
   ★★ 为什么要缓存（2026-10-08 踩了两次才想通）：
     · 弹窗关闭时是 `display:none` → 里面所有元素的 rect 全是 0；
     · 弹窗刚打开时还在做出现动画 → 量出来会偏（实测"打开后跳第一节"停在 72px 而不是 0）。
     两次都是同一个病：**在布局不稳定的时候量位置**。
     所以改成：**只在弹窗稳定显示后量一次、存起来**（打开时的下一帧量），
     之后所有跳转都用这份缓存 —— 不再依赖任何实时 rect。 */
let helpOffsets = null;

function measureHelpSections() {
  const body = document.querySelector('.help-body');
  if (!body) return null;
  const keep = body.scrollTop;
  body.scrollTop = 0;                                  // 量之前先归零，量完还原
  const br = body.getBoundingClientRect();
  const out = {};
  for (const id of HELP_SECTIONS) {
    const el = document.getElementById(id);
    out[id] = el ? Math.round(el.getBoundingClientRect().top - br.top) : 0;
  }
  body.scrollTop = keep;
  return out;
}

function helpScrollTo(id, smooth) {
  const body = document.querySelector('.help-body');
  if (!body) return;
  if (!helpOffsets) helpOffsets = measureHelpSections();
  if (!helpOffsets) return;
  const top = Math.max(0, (helpOffsets[id] || 0) - 44);   // 44 = 吸顶目录让出的高度
  if (smooth === false) body.scrollTop = top;
  else animateScrollTop(body, top, 260);
  helpHighlight(id);
}

function helpHighlight(id) {
  const nav = $('help-nav');
  if (!nav) return;
  nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.help === id));
}

/* 滚到哪一节就高亮哪个。
   ★ 判据：**找最后一节「相对内容顶部的偏移 ≤ 当前滚动位置 + 一点余量」**。
     第一版我写成"看谁已经越过容器顶部"（rect 相减），在**顶部**时那一节是"第一次使用"
     和"主要功能"同时满足条件、取到后面那个 —— 所以滚到最上面反而高亮"主要功能"。
     用绝对偏移量比就没这个歧义：滚到 0 时只有第一节满足。 */
(() => {
  const body = document.querySelector('.help-body');
  const nav = $('help-nav');
  if (!body || !nav) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const y = body.scrollTop + 60;
    let cur = HELP_SECTIONS[0];
    for (const id of HELP_SECTIONS) {
      const el = document.getElementById(id);
      if (!el) continue;
      /* 同样用"先归零再量"会闪，所以这里用 offsetTop 一类的稳定量：
         el 相对 .help-body 内容顶部的距离 = rect.top − body.rect.top + body.scrollTop */
      const off = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
      if (off <= y) cur = id;
    }
    helpHighlight(cur);
  };
  body.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  });
})();

/* 点目录里的按钮 → 跳过去（阻止默认，免得地址栏跑出 `#help-xxx` 的尾巴） */
(() => {
  const nav = $('help-nav');
  if (!nav) return;
  nav.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      helpScrollTo(a.dataset.help || (a.getAttribute('href') || '').replace('#', ''), true);
    });
  });
})();

/* ---------------- 启动 ---------------- */

window.addEventListener('resize', resize);
bindClockName('b');        // 右侧双方名字：点一下就能改（导出棋谱时写进 PB/PW）
bindClockName('w');
fillLevelSelects();        // ★ 段位下拉要先生成 —— applyNewGame → syncUI 会读它
refreshLevelNote();
fillVisitSelect();         // 搜索量下拉（「计算深度」）
/* ★ 启动时**不直接开局**（用户要求）：把界面摆成「未开局」的中性状态 ——
   棋盘点不动、胜率条五五开且不发分析、对局信息四项全「未定」，
   棋盘中央一个大胶囊按钮引导去新建对局。 */

/* ==================== 讲解（LoGos，2026-10-05 新增） ====================

   两个框、两条功能，共用同一套「问 LoGos」的机制：

   · 分析讲解 —— 点评**当前显示的那一手**
   · 选点讲解 —— 讲「这一手该走哪、为什么」

   ★★ 一条铁律：**点位由 KataGo 定，LoGos 只负责讲道理。**
      实测（同一天的探索记录）：让 LoGos 直接点评已下的一手，它
        ① 对明显差的一手照样编得出「很有战略意义」；
        ② 会跑题（讲起别的区域，不提你问的那手）；
        ③ 甚至把坐标说错（传 A1，它讲成 A13）。
      但反过来——给它一个**本来就合理的点**（KataGo 的候选点就是），
      它讲得又快又好：每点约 4 秒、约 120 字、术语也像样。
      所以：「好坏」永远由 KataGo 的目损说，「为什么」才交给 LoGos。

   两条共同的规矩（用户定）：
     · 单次不超过 200 字，局面简单时几十字
     · 再点一次 = 清掉旧的、重新生成
     · 内容只在对局期间保留；开新局 / 换棋谱就清空
*/

/* ---------- 两个框的常驻标注 ----------
   用户要求写清楚这框是干啥的，**尤其是选点讲解**：
   棋盘上已经有 KataGo 画的推荐点了（虚线圆圈），不说明白会和框里的内容混淆。 */
const COACH_PH_EXPLAIN = [
  '点评当前显示的这一手。',
  '',
  '· 好不好 —— 看 KataGo 的目损（客观数据，不会瞎夸）',
  '· 为什么 —— 听 LoGos 讲',
  '',
  '回看、打谱都能用。点一次讲一次。',
].join('\n');

/* 空状态的说明。
   ★ 措辞要点（2026-10-07 按用户要求改）：**必须点明「点是谁选的」** ——
     原来写成「LoGos 推荐落点讲解」，会被读成"LoGos 自己选的点、和 KataGo 不是一批"，
     那是误解：**点全是 KataGo 算的，LoGos 只负责讲道理**（它连 prompt 里都是被点名讲某一点的）。 */
const COACH_PH_PICK = [
  '点击「生成讲解」：由 LoGos 逐点解释 KataGo 算出的推荐落点。',
  '',
  '选点是 KataGo 的事，LoGos 只讲「为什么这么下」。',
  '棋盘上要不要显示那批点，用「显示」菜单里的「实时推荐落点」（快捷键 T）。',
  '',
  '讲解是**点击那一刻**的快照：之后棋盘会继续随分析更新，两者可能不同，',
  '上方会提示「当前局面已变化」；要讲现在的局面，请重新生成。',
  '',
  '打谱时用不了 —— 那是别人的棋，不替人支招。',
].join('\n');

/* LoGos 的 system prompt（照官方格式写，它认这个） */
const COACH_SYS = '你是一位专业的围棋棋手。在给出的棋局中，"X"表示黑棋，"O"表示白棋。'
  + '棋盘的大小为19x19，每个落子的坐标是一个字母加上一个数字的形式。'
  + '字母为A-T(跳过I)，对应于棋盘上从左到右。数字为1-19，对应于棋盘上从下到上。\n';

/* ★ 停词 —— 掐掉「开始逐手推演变化图」的那一句。
   实测：不截断时它一口气吐 623 token 的长篇推演；截断后只剩 55 token / 1.8 秒，
   留下的正好是「结论 + 几条理由」= 用户要的那种讲解。
   ⚠️ 别加太宽的词（「其他」「另一个」「如果选择」都试过）——它们会出现在正常句子里，
      一命中就把讲解拦腰砍断（实测有一次只剩 60 字、末尾还是个破折号）。 */
const COACH_STOP = ['选项', '此外', '可能的变化', '的变化是', '变化推演', '变化如下',
  '其他选择', '另一个选择', '接下来黑棋', '接下来白棋'];

let coachSeq = 0;              // 请求序号：被新的取代就丢弃（这就是「覆盖」）

/* ---------- 拼输入 ---------- */

/* 着法序列：1.X-Q16  2.O-R4 ……（和官方训练数据同一个格式） */
function coachMoveList(moves) {
  const out = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    out.push((i + 1) + '.' + (m.color === 'b' ? 'X' : 'O') + '-'
      + (m.pass ? 'pass' : toGTP(m.x, m.y)));
  }
  return out.join('  ');
}

/* 棋盘矩阵 [[...]]：1=黑 -1=白 0=空。
   ⚠️ 第 0 行是**最上面**那一行 —— 这个朝向是拿官方训练数据逐字节核对过的
      （官方的 3.X-D4 落在 matrix[15][3]，正是本函数算出来的位置）。
   注意 RapaceGo 的 y=0 也在最上面（toGTP 写的是 N-y），所以这里是正序，不用翻。 */
function coachMatrix(board) {
  const rows = [];
  for (let y = 0; y < N; y++) {
    const row = new Array(N);
    for (let x = 0; x < N; x++) {
      const v = board[idx(x, y)];
      row[x] = v === 1 ? 1 : (v === 2 ? -1 : 0);
    }
    rows.push('[' + row.join(',') + ']');
  }
  return '[' + rows.join(',') + ']';
}

/* 一条「指定点讲解」的完整输入。
   ★ 末尾那句「预填」是整套里最关键的一招：它训练时的模板就是「先长篇推理、
     再给结论」，直接命令它「讲短点」完全无效（实测给它 150 字的限制，
     它照样吐 623 token）。但**替它写好开头**，它就会顺着往下写 ——
     于是直接从结论开始，不再罗列一堆候选点。

   ★★ 预填必须用**条件句**（「如果白棋下在C3，」），不能用断言句（「白棋下在C3」）——
      实测断言句会让它把**还没落子**的候选点当成既成事实来讲
      （「白棋在C3的应对是非常标准的」），读起来像在讲已经发生的事，是逻辑错误。
      条件句输出的自然就是「如果……那么……」，逻辑对，内容也不减。
      （加"这是建议、还没落子"之类的约束词它**根本不理**——7B 的指令遵循就这么弱。） */
function coachPrompt(moves, board, color, point, onset) {
  return COACH_SYS + '\n'
    + '以下是当前的对局记录：\n\n' + coachMoveList(moves)
    + '\n\n\n当前盘面情况为:' + coachMatrix(board)
    + '\n其中1表示黑棋，-1表示白棋，0表示空位。\n'
    + '<reasoning>\n如果' + (color === 'b' ? '黑棋' : '白棋') + '下在' + point + '，'
    /* ★★ 2026-10-08：「分析讲解」用的是**已经下出来的那一手**，要讲的是
       「这一手之后会怎样」，不是「该下在哪」。原来的 prompt 只有前半句，
       模型于是顺着「这手好不好 / 该下哪」去讲，用户实测抱怨：
       「这分析讲解应该是如果下在这里会怎样啊，而不只是应该下在哪里」。
       这里补一句强制要求，**只在传了 onset 时加**（推荐落点讲解不传，保持原样）。 */
    + (onset ? ('\n（这一手已经下出来了' + onset + '。请**先直接说这一手之后会发生什么**：'
      + '它碰到了哪些棋子、切断了什么、自己多了或少了气、对方接下来最可能的应手是什么；'
      + '然后再讲这样下划不划算。不要重复上面的胜率数字，也不要说「应该下在别处」。）') : '');
}

/* 清掉它偶尔带出来的标签和结论框 */
function cleanCoachText(s) {
  return String(s || '')
    .replace(/<\/?reasoning>/gi, '')
    .replace(/<\/?answer>/gi, '')
    .replace(/\\boxed\{[^}]*\}/g, '')
    /* ★ 推演变化图的残渣：像「5.X-R17」「78.O-J13」「X-D4」这种记谱 ——
       这是 LoGos 训练数据里的写法（X=黑 O=白，前面数字是第几手，后面是坐标），
       但它混在讲解里用户根本看不懂（用户原话：「一个字母加-接一个坐标的是啥意思？」），
       而且我们要的是讲解、不是变化图（变化图由 KataGo 的推荐点负责）——一律清掉。 */
    .replace(/\d+\.\s*[XO]-[A-T]\d{1,2}/g, ' ')
    .replace(/[XO]-[A-T]\d{1,2}/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    /* 结尾只剩半个标点（「——」「，」「、」）说明这句被截断了 —— 磨掉，
       别让人看着像话没说完。 */
    .replace(/[，,、：:；;]+$/, '')
    .replace(/[—–-]+$/, '')
    .trim();
}

/* 它讲到后面总想「列候选 / 推演变化」，被停词截断后会剩半句话 ——
   这里做三件事，只留「结论 + 理由」：
     ① 砍掉「开始分析下一步」的尾巴（实测这些词一出现，后面就是推演）
     ② 砍掉「开始罗列第二/第三个方案」的尾巴 —— 用户要的是**这一个点**的讲解，
        候选清单本来就由 KataGo 给、写在标题上了，不需要它再列一遍
     ③ 最后砍到最后一个完整句子，别让人看着像话没说完（实测尾巴长这样：
        「……非常符合棋理。现在轮到白棋第6手，我需要考虑几个可能的选择：」） */
function trimCoachTail(t) {
  let s = String(t || '');
  const m1 = s.search(/(我需要|现在轮到|可能的选择|接下来我|下面我|让我想想|让我思考|让我分析)/);
  if (m1 > 0) s = s.slice(0, m1);
  /* ★ 只把**真的是分点**的词当分点（2026-10-06 审查发现）：
     原来 `第二|第三` 是裸词，而围棋讲解里「第二线」「第三路」「第二个角」都是常用说法 ——
     一出现就把后面整段砍掉，句子只剩半截（而且看起来像模型自己写坏了，很难发现是这里砍的）。
     现在给这两个词加条件：后面**不能**接 线/路/手/个/种/局/盘/阶。
     `其次/再次/另外/另一种` 几乎只能是分点，保持原样。 */
  const m2 = s.search(/(其次|再次|另外|另一种|另一个思路|或者考虑|也可以考虑|第二(?!线|路|手|个|种|局|盘|阶)|第三(?!线|路|手|个|种|局|盘|阶))/);
  if (m2 > 8) s = s.slice(0, m2);
  s = s.trim();
  const last = Math.max(s.lastIndexOf('。'), s.lastIndexOf('！'), s.lastIndexOf('？'));
  if (last > 0 && last < s.length - 1) s = s.slice(0, last + 1);
  return s.trim();
}

/* 预填是条件句「如果白棋下在C3，」，模型接着写「那么黑棋很可能……」——
   渲染时把预填那半句拼回去，读起来才是一句完整的话。

   ★ 2026-10-08：多了一种开头 `head`（给「分析讲解」用）——
     那种场景下问的是**实际下出来的那一手**，所以要写成「这一手 X（...）下出来，」
     而不是「如果下在 X，」。不传 head 时保持老行为（推荐落点讲解走这条）。 */
function fixCoachHead(t, point, color, head) {
  const pre = head || ('如果' + (color === 'b' ? '黑棋' : '白棋') + '下在' + point + '，');
  return pre + String(t || '');
}

/* 一段最终要上屏的讲解：清洗 → 去尾 → 补开头 */
function coachTextReady(raw, point, color, head) {
  return fixCoachHead(trimCoachTail(cleanCoachText(raw)), point, color, head);
}

/* 这段讲解"能不能用"？——不行就重试一次（两次里挑可用的）。
   ★ 判据：**第一句得说完整**（前 60 字里要有句号/问号/叹号），且不能太短。
   实测它有两个失手方式：① 只吐半句就停（「如果黑棋下在R16，」）
   ② 整段都是变化图推演、一句完整的话都没有
      （批量讲解里见过 61 个字全是「…下在X，Y下在Z，…那么」）。 */
function coachUsable(t) {
  const s = String(t || '');
  return s.length >= 40 && /[。！？]/.test(s.slice(0, 60));
}

/* ---------- 打字机：让讲解「按字出来」 ----------
   用户反馈：直接把流式片段贴上去是「隔好多才出一段」——因为网络会把几个 token
   攒成一块再给。所以这里不贴片段，而是记住**累计文本**，自己按固定速度一个字
   一个字往外放；新出现的字带淡入（由淡转实）。
   速度定得比模型快（80 字/秒 vs 模型约 30），所以永远追得上，不会越等越久。 */
function makeTyper(el) {
  let target = '';
  let shown = 0;          // 已经「放」到第几个字
  let painted = 0;        // 已经画进 DOM 的第几个字
  let raf = 0;
  let lastTs = 0;
  let wantFinish = false;
  const CPS = 80;

  function put(s) {
    s = String(s == null ? '' : s);
    /* 新文本不是旧文本的延长 → 内容被改写了（清洗/替换），重来一遍 */
    if (!s.startsWith(target.slice(0, Math.min(target.length, s.length)))) {
      target = s; shown = 0; painted = 0; el.textContent = '';
    } else {
      target = s;
    }
    /* ⚠️ 必须夹住 shown：清洗会把结尾的半个标点磨掉，target 可能比已经放出去的字**还短**——
       不夹的话 paint() 会越界去读 target[painted]，画出空字。 */
    if (shown > target.length) shown = target.length;
    if (painted > target.length) painted = target.length;
  }

  function paint() {
    const n = Math.floor(shown);
    while (painted < n) {
      const sp = document.createElement('span');   // 每个字一个 span —— 带淡入动画
      sp.className = 'just';
      sp.textContent = target[painted];
      el.appendChild(sp);
      painted += 1;
    }
  }

  function solidify() {                            // 定稿：整段变成普通文本（顺手清掉那一堆 span）
    el.textContent = target;
    painted = target.length;
  }

  function tick(ts) {
    raf = 0;
    const dt = lastTs ? Math.min(150, ts - lastTs) : 16;
    lastTs = ts;
    if (shown < target.length) {
      shown = Math.min(target.length, shown + CPS * dt / 1000);
      paint();
      raf = requestAnimationFrame(tick);
    } else if (wantFinish) {
      solidify();
    }
  }

  function ensure() {
    if (!raf && shown < target.length) { lastTs = 0; raf = requestAnimationFrame(tick); }
  }

  return {
    setTarget(t) { put(t); ensure(); },
    finish(finalText) {
      if (typeof finalText === 'string') put(finalText);
      wantFinish = true;
      if (shown >= target.length) solidify();      // 已经放完了 → 直接定稿
      else ensure();                               // 还差几个字 → 让它放完，放完时自动定稿
    },
  };
}

/* 讲解的流式渲染：主进程每收到一小段就推一次（带 id）——
   这里按 id 找到对应的打字机，把**累计文本**喂给它。 */
const coachTypers = new Map();
if (window.api && window.api.coach && window.api.coach.onProgress) {
  window.api.coach.onProgress(d => {
    const t = coachTypers.get(d.id);
    if (t) t.setTarget(cleanCoachText(d.full));
  });
}

/* ★ 坐标校验：实测它偶尔会把坐标写歪（传 A1，它写「白棋下在A13位置」）。
   规则：只看**最前面那十几个字**里的第一个坐标 —— 那里若出现坐标，
   就必须是我们给的那个点，否则整段作废。开头没提坐标就通过。
   ⚠️ 不能全文搜：它顺口说一句「和 C3 呼应」是很正常的，全文搜会误伤 ——
      第一版就是那么写的，实测 4 段里误杀了 3 段（只因为正文里提了别的子）。 */
function coordOk(text, point) {
  const head = String(text || '').slice(0, 18).toUpperCase();
  const m = head.match(/[A-HJ-T]\d{1,2}/);
  if (!m) return true;                       // 开头没提坐标 → 通过
  return m[0] === point.toUpperCase();
}

/* 问一次 LoGos。回来的序号对不上就说明已被新请求取代 → 丢弃（「覆盖」就是这么做出来的）。
   传了 typer 就把它登记到 id 上 —— 流式片段会喂给这个打字机（见上面的 onProgress）。 */
async function coachAsk(prompt, maxTokens, typer) {
  const id = ++coachSeq;
  if (typer) coachTypers.set(id, typer);
  try {
    const r = await window.api.coach.explain({
      id: id,
      prompt: prompt,
      maxTokens: maxTokens || 320,
      temperature: 0.3,
      stop: COACH_STOP,
    });
    if (id !== coachSeq) return null;
    return r;
  } finally {
    coachTypers.delete(id);
  }
}

/* ---------- 小工具 ---------- */
function mkEl(tag, cls, text) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  d.textContent = text == null ? '' : text;
  return d;
}
function resetCoachBtn(which) {
  /* ★ 全盘讲解期间不许点亮 —— 那两个按钮这时是灰的（防止插队抢通道），
     被这里的 finally 点亮就白挡了（2026-10-05 审查发现）。 */
  if (state.coach.batch) return;
  const b = $(which === 'explain' ? 'btn-explain' : 'btn-pick');
  if (!b) return;
  b.disabled = false;
  b.textContent = which === 'explain' ? '讲解这手' : '生成讲解';
}

/* ---------- 按**当前手数**刷新两个框 ----------
   切换手数、讲解完成、开新局 —— 都走这里。
   ★ 为什么必须按手数取内容：用户报过两个 bug ——
     ① 讲完第 2 手点回第 1 手，框里还挂着第 2 手的讲解（和眼前这一手对不上）；
     ② 讲完第 6 手再点回第 2 手，第 2 手的讲解直接没了。
     现在每手各存一份，切到哪手显示哪份，没有就写「这一手还没有讲解」。 */
let coachRenderedAt = -999;
function pickPositionKey(at) {
  return JSON.stringify([N, settings.rules, settings.komi, state.setup, state.moves.slice(0, at)]);
}
function renderPickContext() {
  const rec = state.coach.pickPending || state.coach.pick;
  const el = $('pick-context');
  const stale = !!rec && rec.positionKey !== pickPositionKey(state.viewAt);
  el.hidden = !rec;
  el.classList.toggle('is-stale', stale);
  el.textContent = rec
    ? '第 ' + rec.at + ' 手后 · ' + (rec.side === 'b' ? '黑方' : '白方') + ' · '
      + (state.coach.pickPending ? '正在生成讲解快照' : '讲解快照')
      + (stale ? ' · 当前局面已变化' : '')
    : '';
}
function renderCoachPanels(force) {
  renderPickContext(); // 生成期间也更新上下文，不重绘打字机正文
  const at = state.viewAt;
  if (!force && at === coachRenderedAt
      && state.coach.busy.explain !== at && state.coach.busy.pick !== at) return;
  coachRenderedAt = at;

  /* 正在生成的那一手已经不是当前这一手了 → 掐断（用户切走了，
     别再往已经离开屏幕的元素上画）。
     ⚠️ 只对**分析讲解**做 —— 它跟手数走，切走了就该停；
        选点讲解不跟手数走（就是一份留在那儿的快照），切手数不打断它。 */
  if (state.coach.busy.explain >= 0 && state.coach.busy.explain !== at) {
    coachSeq++; state.coach.busy.explain = -1; resetCoachBtn('explain');
  }

  /* 分析讲解 */
  if (state.coach.busy.explain !== at) {
    const box = $('explain-body');
    if (box) {
      const rec = state.coach.explain[at];
      box.textContent = '';
      if (rec) {
        box.appendChild(mkEl('div', 'pnt', rec.head));
        if (rec.verdict) box.appendChild(mkEl('div', rec.ok ? 'ph vok' : 'ph', rec.verdict));
        if (rec.lead) box.appendChild(mkEl('div', 'ph', rec.lead));
        box.appendChild(mkEl('div', '', rec.body));
      } else {
        box.appendChild(mkEl('div', 'ph', at > 0
          ? '这一手还没有讲解 —— 点上面「讲解这手」。'
          : COACH_PH_EXPLAIN));
      }
    }
  }

  /* 选点讲解 —— **不跟手数走**：始终显示存下来的那一份。
     如果它讲的是别的局面（用户切过手数），上面加一行小字标出对应手数，
     免得和眼前的局面混淆。正在生成时别动 DOM（打字机正往上画）。 */
  if (state.coach.busy.pick < 0) {
    const box = $('pick-body');
    if (box) {
      const rec = state.coach.pick;
      box.textContent = '';
      box.appendChild(mkEl('div', 'src', '点由 KataGo 定 · 讲解由 LoGos 写 · 基于点击那一刻的推荐落点'));
      if (rec && rec.pts && rec.pts.length) {
        rec.pts.forEach(p => {
          box.appendChild(mkEl('div', 'pnt', p.title));
          box.appendChild(mkEl('div', '', p.body));
        });
      } else if (state.fromRecord || !state.moves.length) {
        box.appendChild(mkEl('div', 'ph', COACH_PH_PICK));
      } else {
        box.appendChild(mkEl('div', 'ph', '还没生成讲解 —— 点上面「生成讲解」。'));
      }
    }
  }
}

/* 开新局 / 换棋谱时清空（用户要求：讲解只在对局期间保留）。
   注意它是被 applyNewGame / applyRecord 调的 —— 那两个是函数声明、已提升。 */
function clearCoachPanels() {
  coachSeq++;                                   // 作废还在飞的那条
  state.coach.busy = { explain: -1, pick: -1 };
  state.coach.explain = {};
  state.coach.pick = null;
  state.coach.pickPending = null;
  resetCoachBtn('explain');
  resetCoachBtn('pick');
  /* 「全盘讲解」只在**打开棋谱**时出现（用户要求） */
  if ($('btn-batch')) $('btn-batch').hidden = !state.fromRecord;
  coachRenderedAt = -999;
  renderCoachPanels(true);
}

/* ---------- 选点讲解 ----------
   点位和胜率**全部取自 KataGo 的候选点**（state.candidates，就是棋盘上画的那几个）
   —— 点击时同源；之后棋盘继续实时更新，文字保留点击时的快照。
   LoGos 只负责给每个点补一句「为什么这么下」。 */
async function runPickExplain() {
  if (state.coach.busy.pick >= 0) { flash('正在讲，稍微等一下…'); return; }
  /* ★ 两条讲解共用**一条** LoGos 通道（每次请求会掐掉上一条），
     所以同一时刻只能有一条在跑 —— 否则后点的会静默把先点的打断（审查发现）。 */
  if (state.coach.busy.explain >= 0) { flash('「分析讲解」正在讲 —— 等它讲完再来点推荐点'); return; }
  if (state.coach.batch) { flash('全盘讲解正在跑 —— 等它跑完，或点进度条旁边的「停止」'); return; }
  if (needEngine('coach', '推荐落点讲解')) return;
  if (state.noGame || !state.moves.length) { flash('先落几手，再来问「该走哪」'); return; }
  if (state.fromRecord) { flash('打谱时不讲选点 —— 那是别人的棋，不替人支招'); return; }
  if (!engineReady) { needEngine('analyze', '推荐落点讲解'); return; }
  if (state.candAt !== state.viewAt || !state.candidates.length) {
    flash('KataGo 还在算这个局面 —— 等推荐点出来再点');
    return;
  }

  const at = state.viewAt;                           // ★ 讲的是哪个局面（存下来时要标出来）
  const pts = state.candidates.slice(0, 4);          // 用户要求：不能只给一个
  setHintsVisible(true);                            // 看推荐讲解时同步显示盘上的点
  const board = boardAt(at);
  const moves = state.moves.slice(0, at);
  const side = sideToMove(at);
  const sideTxt = side === 'b' ? '黑' : '白';

  const body = $('pick-body');
  body.textContent = '';
  body.appendChild(mkEl('div', 'src', '点由 KataGo 定 · 讲解由 LoGos 写 · 基于点击那一刻的推荐落点'));
  const btn = $('btn-pick');
  state.coach.busy.pick = at;
  const snapshot = { at, side, positionKey: pickPositionKey(at), gen: gameGen };
  state.coach.pickPending = snapshot;
  renderPickContext();
  btn.disabled = true;
  btn.textContent = '讲解中…';
  const collected = [];                              // 讲完的点（存起来，切手数也还在）
  try {
    for (let i = 0; i < pts.length; i++) {
      const c = pts[i];
      const pt = toGTP(c.x, c.y);

      /* 先把这一点的标题放上去（内容随后填）—— 让人立刻看到「有几个点、都在讲」 */
      const wrap = document.createElement('div');
      const h = document.createElement('span');
      h.className = 'pnt';
      /* 标题里明写「推荐」二字 —— 和棋盘上那几个虚线圆圈是同一批点，
         但不能让人误以为已经落子了（正文里是「如果下在这里…」）。 */
      h.textContent = '推荐 ' + (i + 1) + ' · ' + pt + '（胜率 ' + (c.win * 100).toFixed(1) + '%）';
      const p = document.createElement('div');
      wrap.appendChild(h);
      wrap.appendChild(p);
      body.appendChild(wrap);
      const typer = makeTyper(p);       // 每个点一个打字机（各写各的）

      const prompt = coachPrompt(moves, board, side, pt);
      let r = await coachAsk(prompt, 320, typer);
      if (!r) break;                                   // 被新请求取代了 → 收工
      let txt = coachTextReady(r.text, pt, side);
      /* 坐标对不上（它讲的是别的点）→ 重来一次；再不行就**照原样给** ——
         内容本身一般还是有用的，给个空白反而更糟（实测约四次里出错一次）。 */
      if (!r.error && !coordOk(trimCoachTail(cleanCoachText(r.text)), pt)) {
        const r2 = await coachAsk(prompt, 320, typer);
        if (!r2) break;
        /* ★ 复检必须用**没补前缀**的文本（2026-10-06 审查发现）：
           `coachTextReady` 会在开头补上「如果白棋下在<pt>，」，而 coordOk 抓的是
           前 18 字里第一个「字母+数字」—— 抓到的**永远是我们自己补的那个正确坐标**，
           于是这次复检恒为真（等于没检查）：第二次哪怕讲错了点，也照样被采用。
           第一次的复检用的是 cleanCoachText（没补头）所以是对的 —— 这里跟上它。 */
        const clean2 = trimCoachTail(cleanCoachText(r2.text));
        const t2 = coachTextReady(r2.text, pt, side);
        if (coordOk(clean2, pt)) txt = t2;
      }
      const finalTxt = r.error
        ? ('（讲不出来：' + r.error + '）')
        : (txt || '（这段没讲出东西，再点一次试试）');
      typer.finish(finalTxt);
      collected.push({ title: h.textContent, body: finalTxt });
    }
  } finally {
    /* ★ 只清「自己那一手」的标记：可能用户已经切到别的手、并在那里起了新的一段，
       无条件清会把新那段的标记抹掉（审查发现）。 */
    if (state.coach.busy.pick === at) state.coach.busy.pick = -1;
    if (state.coach.pickPending === snapshot) state.coach.pickPending = null;
    resetCoachBtn('pick');
  }
  /* 几个点都讲完了才存（中途被切走/掐断就不存，免得留下半份）。
     ★ 存成**一份快照**、不按手数存 —— 用户要求：切手数时「显示刚才讲解的就行」。 */
  if (snapshot.gen === gameGen && collected.length === pts.length) state.coach.pick = { ...snapshot, pts: collected };
  renderCoachPanels(true);
}

/* ---------- 分析讲解 ----------
   点评「当前显示的那一手」，拆成两半（见文件头的铁律）：
     · 好不好 → KataGo 的目损 / 胜率涨跌（客观，不会瞎夸）
     · 为什么 → LoGos 讲「这一手**之前**的局面，AI 当时想下哪」 */
function handVerdict(at, m) {
  /* 口径就用「这一手让**下棋方**的胜率变化了多少」——
     和手数列表里那个「涨跌」完全一致，用户看着不会打架。
     （复盘的目损虽然更准，但那是另一套数，混着用反而让人对不上。） */
  const h = state.history[at], prev = state.history[at - 1];
  if (typeof h === 'number' && typeof prev === 'number') {
    const d = (h - prev) * 100 * (m.color === 'b' ? 1 : -1);
    if (Math.abs(d) < 0.05) return { txt: '几乎不亏不赚', loss: 0 };
    return d > 0
      ? { txt: '赚了 ' + d.toFixed(1) + '% 胜率', loss: 0 }
      : { txt: '亏了 ' + Math.abs(d).toFixed(1) + '% 胜率', loss: -d };
  }
  return null;
}

async function runAnalysisExplain() {
  if (needEngine('coach', '分析讲解')) return;
  if (state.coach.batch) { flash('全盘讲解正在跑 —— 等它跑完，或点进度条旁边的「停止」'); return; }
  /* 两条讲解共用一条 LoGos 通道 → 同一时刻只允许一条（见 runPickExplain 的注释）。 */
  if (state.coach.busy.pick >= 0) { flash('「推荐落点讲解」正在讲 —— 等它讲完再来'); return; }
  if (state.coach.busy.explain >= 0) { flash('上一段讲解还在生成，稍等…'); return; }
  const at = state.viewAt;
  if (at <= 0) { flash('先用底栏的回看跳到某一手，再来讲'); return; }
  const m = state.moves[at - 1];
  const sideTxt = m.color === 'b' ? '黑' : '白';
  const pt = m.pass ? '停一手' : toGTP(m.x, m.y);

  const body = $('explain-body');
  body.textContent = '';
  const head = document.createElement('div');
  head.className = 'pnt';
  head.textContent = '第 ' + at + ' 手 · ' + sideTxt + ' ' + pt + (state.viewAt === state.moves.length ? '' : '（回看中）');
  const verdict = document.createElement('div');
  verdict.className = 'ph';
  verdict.textContent = '看看这手怎么样…';
  const why = document.createElement('div');
  body.appendChild(head);
  body.appendChild(verdict);
  body.appendChild(why);

  const btn = $('btn-explain');
  btn.disabled = true;
  btn.textContent = '讲解中…';
  state.coach.busy.explain = at;
  let saved = null;                        // 完整生成成功才存（中途被打断就不存）
  try {
    /* ① 客观评价 —— 只有 KataGo 说了算 */
    const v = handVerdict(at, m);
    const verdictTxt = v ? v.txt : '（KataGo 还没算到这一手 —— 先让它把这一带算一遍）';
    verdict.textContent = verdictTxt;
    if (v && v.loss <= 0.05) verdict.className = 'vok';

    /* ② 道理 —— 交给 LoGos 讲「这一手之前的局面，AI 想下哪」 */
    if (!engineReady) {
      why.textContent = '（想听「为什么」，得先把 KataGo 加载起来 —— 它要先算一下当时的局面）';
      return;
    }
    const before = state.moves.slice(0, at - 1);
    const res = await window.api.analyze({
      initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
      moves: before.map(mv => [mv.color === 'b' ? 'B' : 'W', mv.pass ? 'pass' : toGTP(mv.x, mv.y)]),
      rules: (RULES[settings.rules] || RULES.chinese).kata,
      komi: settings.komi,
      size: N,
      maxVisits: Math.max(120, Math.round((settings.visits || ANALYZE_VISITS) / 2)),
    });
    /* ⚠️ 候选点在 res.moves（主进程从引擎的 moveInfos 转出来的），
       **不在** res.root 里 —— res.root 只是 rootInfo（winrate/scoreLead/visits）。 */
    const list = ((res && res.moves) || [])
      .filter(x => x && x.move && (x.visits || 0) >= 2)
      .sort((a, b) => b.winrate - a.winrate);
    const best = list[0];

    if (!best) {
      why.textContent = '（KataGo 没算出候选点，可能是这个局面已经结束了）';
      return;
    }
    const same = (best.move || '').toUpperCase() === pt.toUpperCase();
    const lead = document.createElement('div');
    lead.className = 'ph';
    /* 「当时」两个字不能省 —— 这个胜率是**这一手之前**那个局面的，
       跟上面胜率条（当前局面）不是一个数，不写清楚会让人对不上。
       ★ 2026-10-08 改：下错了的时候**要把"你实际下了哪"也写出来** ——
         原来只写「AI 当时更倾向 D8」，用户会以为下面那段讲的是 D8（而它确实讲错了，见下方注释）。
         现在先交代 AI 想下哪、再交代实际下在哪，下面那段讲的**永远是实际这一手**。 */
    const leadTxt = same
      ? ('AI 当时想下的也是这里（' + best.move + '，' + sideTxt + '棋当时胜率 '
        + (best.winrate * 100).toFixed(1) + '%）。下面讲这一手：')
      : ('AI 当时想下的是 ' + best.move + '（' + sideTxt + '棋当时胜率 '
        + (best.winrate * 100).toFixed(1) + '%）；实际下的是 ' + pt + '。下面讲实际这一手：');
    lead.textContent = leadTxt;
    body.insertBefore(lead, why);

    const typer = makeTyper(why);
    /* ★★ 讲的是**实际下的那一手（pt）**，不是 AI 推荐的那一手 —— 2026-10-08 修 bug。
       原来这里无论哪种情况都传 `best.move`（AI 想下的点），于是「分析讲解」实际输出的是
       「如果下在 AI 推荐点会怎样」，而用户问的是「我这一手怎么样」。
       用户实测撞到：自己第 83 手亏 0.1%，讲解却整段在讲 AI 想下的 D8 —— 风马牛不相及。
       现在两种情况都讲**实际这一手**：
         · 下对了（same）→ 讲解就是这一手（与 AI 首选重合，等于讲首选）
         · 下错了        → 讲这一手的后果，AI 倾向的那个点在前面作一句对照
       prompt 也改了（coachPrompt 的 onset 参数）：**必须先交代这一手的直接后果**，
       而不是只讲"该下哪"。开头也从「如果下在 X，」改成「这一手 X 下出来，」。 */
    const onset = same
      ? ('，和 AI 的首选是同一个点')
      : ('，不过 AI 当时更倾向 ' + best.move + '（' + sideTxt + '棋当时胜率 '
        + (best.winrate * 100).toFixed(1) + '%）');
    /* 讲解正文的开头 —— 用「这一手 X 下出来，」而不是「如果下在 X，」，
       因为这里讲的是**既成事实**（用户问"我这手怎么样"），不是假设。 */
    const explainHead = '这一手 ' + pt + '（' + sideTxt + '棋第 ' + at + ' 手）下出来，';
    const ask = () => coachAsk(coachPrompt(before, boardAt(at - 1), m.color, pt, onset), 320, typer);
    let r = await ask();
    if (!r) return;
    /* ★ 被取消时 main.js 会把**已收到的半截文本**带 `aborted: true` 回来
       （unload 引擎、或这条请求被后一条取代时会走到）。这时：不重试、不入库 ——
       半截文本有可能「够长 + 前 60 字有句号」而被当成完整讲解存进
       `.coach.json`，之后永不重讲（2026-10-06 审查发现：aborted 这个标记一直没人看）。 */
    if (r.aborted) { typer.finish('（已取消）'); return; }
    let txt = coachTextReady(r.text, pt, m.color, explainHead);
    /* 太短 / 第一句没说完 → 重来一次；两次里挑能用的（都好就取长的）。 */
    if (!r.error && !coachUsable(txt)) {
      const r2 = await ask();
      if (r2 && !r2.error) {
        const t2 = coachTextReady(r2.text, pt, m.color, explainHead);
        if (coachUsable(t2) || t2.length > txt.length) { txt = t2; r = r2; }
      }
    }
    const finalTxt = r.error ? ('（讲不出来：' + r.error + '）')
      : (txt || '（这段没讲出东西，再点一次试试）');
    typer.finish(finalTxt);
    if (!r.error && txt) {
      saved = {
        head: head.textContent, verdict: verdictTxt, ok: !!(v && v.loss <= 0.05),
        lead: leadTxt, body: finalTxt,
      };
    }
  } finally {
    /* 同上：只清自己那一手（用户可能已切手数并在那儿起了新的一段）。 */
    if (state.coach.busy.explain === at) state.coach.busy.explain = -1;
    resetCoachBtn('explain');
  }
  /* ★ 存到「第 at 手」名下 —— 切到别手再切回来还能看到（用户报的问题②）。
     分析讲解**按手数存**（它点评的就是第 at 手本身），和选点讲解的存法不一样。 */
  if (saved) { state.coach.explain[at] = saved; renderCoachPanels(true); }
}

/* ==================== 全盘讲解（2026-10-05 用户要求）====================
   打开棋谱后，一次把整盘逐手讲完，结果**存进这份棋谱旁边**
   （<棋谱名>.coach.json，见 main.js 的 coachPath）——
   下次打开这份棋谱直接就能看，不用重跑。

   分两段（进度条上会看出在哪一段）：
     ① KataGo 把整盘逐手算一遍 —— 一次请求拿全（复用「复盘」那条通路），
        得到每手的「AI 当时首选」+ 胜率。
        ★ 为什么非要它：LoGos 讲的是「AI 当时想下哪、为什么」，
          那个点必须由 KataGo 定 —— 让 LoGos 自己选点，实测会把角上一路
          （T19 / A1）说成好棋，那是硬错。
     ② LoGos 逐手讲 —— 每手一次请求，约 2~4 秒。

   ★ 已经讲过的手**跳过**：所以点「停止」之后再来一次，是接着往下讲，不从头。
   ★ 不用打字机：那是给「盯着它一个字一个字写」用的；这里要跑几分钟，
     用户早切到别的手去看别的了。 */
let batchStop = false;

/* 进度条：on=false 收起；否则按 done/total 画，txt 不传就显「3 / 20」 */
function setBatchBar(on, done, total, txt) {
  const bar = $('batch-bar');
  if (!bar) return;
  bar.hidden = !on;
  if (!on) return;
  $('batch-fill').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  $('batch-txt').textContent = txt || (done + ' / ' + total);
}

/* 把内存里的逐手讲解落盘（<棋谱名>.coach.json）。
   list 的下标 = 手数（0 位空着），这样读回来能直接按手数对上。 */
function saveCoachFile() {
  if (!state.recName) return Promise.resolve(null);
  const list = [];
  for (let i = 0; i <= state.moves.length; i++) list.push(state.coach.explain[i] || null);
  const json = JSON.stringify({ v: 1, n: state.moves.length, list: list });
  try {
    return Promise.resolve(window.api.records.saveCoach(state.recName, json)).catch(() => null);
  } catch (e) { return Promise.resolve(null); }
}

/* 打开棋谱时把存下来的讲解读回来（用户要求：结果跟棋谱一起保存，下次打开还在） */
async function loadCoachForRecord(name) {
  if (!name) return;
  const gen = gameGen;
  let r = null;
  try { r = await window.api.records.readCoach(name); } catch (e) { return; }
  if (!r || !r.text || gen !== gameGen) return;      // 读盘期间换了棋谱 → 丢掉
  let data = null;
  try { data = JSON.parse(r.text); } catch (e) { return; }
  const list = (data && data.list) || [];
  const box = {};
  for (let at = 1; at < list.length && at <= state.moves.length; at++) {
    const it = list[at];
    if (it && it.body) box[at] = it;
  }
  const howMany = Object.keys(box).length;
  if (!howMany) return;                              // 存过但是空的 → 当没有
  state.coach.explain = box;
  coachRenderedAt = -999;
  renderCoachPanels(true);
  flash('这份棋谱带着逐手讲解（' + howMany + ' 手）—— 点手数列表就能看');
}

async function runBatchCoach() {
  if (state.coach.batch) { flash('全盘讲解正在跑 —— 想停就点进度条右边的「停止」'); return; }
  /* ★ 反过来也要挡（2026-10-06 审查发现）：单条讲解（分析讲解 / 选点讲解）正在跑时，
     直接点「全盘讲解」会把在跑的那条**静默掐掉** —— 两条共用 coachSeq 通道，
     原来只有「批量挡单条」这一半（批量期间按钮被 disabled），反向漏了。 */
  if (state.coach.busy.explain >= 0 || state.coach.busy.pick >= 0) {
    flash('正在讲别的（分析讲解 / 推荐落点讲解）—— 等它讲完再点全盘讲解');
    return;
  }
  if (!state.fromRecord || !state.recName) { flash('先打开一份棋谱，再来做全盘讲解'); return; }
  if (needEngine('coach', '全盘讲解')) return;
  if (needEngine('analyze', '全盘讲解')) return;
  const n = state.moves.length;
  if (!n) { flash('这份棋谱里没有手顺，讲不了'); return; }

  const gen = gameGen;
  state.coach.batch = { done: 0, total: n };
  batchStop = false;
  $('btn-batch').disabled = true;
  $('btn-explain').disabled = true;      // 批量期间不许插队（会和批量抢 coachSeq）
  $('btn-pick').disabled = true;
  setBatchBar(true, 0, n, '正在让 KataGo 把整盘算一遍…');
  /* 这一步占着引擎：把自动分析压住，否则两边抢同一个进程、谁也算不完。
     （同时靠 state.coach.batch 让「复盘进度」弹窗别冒出来 —— 见文件后面那条订阅。） */
  reviewBusy = true;
  try {
    /* ---------- ① KataGo：整盘逐手算一遍 ---------- */
    const req = {
      initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
      moves: state.moves.map(m => [m.color === 'b' ? 'B' : 'W', m.pass ? 'pass' : toGTP(m.x, m.y)]),
      rules: (RULES[settings.rules] || RULES.chinese).kata,
      komi: settings.komi,
      size: N,
      maxVisits: reviewVisits(),
      analyzeTurns: Array.from({ length: n + 1 }, (_, i) => i),
    };
    let res = null;
    try { res = await window.api.review(req); } catch (e) { res = { error: String(e) }; }
    reviewBusy = false;
    if (gen !== gameGen) return;         // 期间换了棋谱 → 整体作废（finally 会收拾界面）
    if (!res || res.error || !res.turns || res.turns.length < 2) {
      flash('整盘分析失败：' + ((res && res.error) || '引擎没给出结果'));
      return;
    }
    /* ★ 整盘分析**超时**时 main.js 会带 `incomplete: true` 交回「已经算到的那些回合」
       （见 analyze 的超时兜底）。这种情况只能讲算到的部分，而且要如实说明 ——
       原来只看 `turns.length >= 2` 就照跑到底，末尾还报「讲了 N 手」，
       实际有几手因为没数据被跳过（2026-10-06 审查发现）。 */
    if (res.incomplete) {
      flash('KataGo 整盘没算完（超时）—— 这次只讲算到的部分，回头再点一次会接着讲');
    }
    const turns = res.turns;
    /* 顺手把胜率走势填满（引擎给的是「轮到谁走」视角，要换算成黑方视角）——
       这样手数列表的「涨跌」和走势图也一起活了，讲解里说的胜率能跟它们对上。 */
    const isWhiteTurn = x => String(((x && x.root) || {}).currentPlayer || '').toUpperCase() === 'W';
    state.history = turns.map(x => {
      const wr = x && x.root && x.root.winrate;
      return (typeof wr === 'number') ? (isWhiteTurn(x) ? 1 - wr : wr) : undefined;
    });
    state.leads = turns.map(x => {
      const sl = x && x.root && x.root.scoreLead;
      return (typeof sl === 'number') ? (isWhiteTurn(x) ? -sl : sl) : undefined;
    });
    /* ★ 同上：整盘讲解也是同一档搜索量一次算完的，精度标记统一填上 */
    state.histVisits = turns.map(() => reviewVisits());
    renderMoveList();
    renderCurve();

    /* ---------- ② LoGos：逐手讲（讲过的跳过，所以能接着上次继续） ---------- */
    const todo = [];
    /* ★ 上限取 min(手数, 已算到的回合数) —— 超时的情况只讲有数据的那些手，
       免得后面每一手都走到「没算出候选点」、空转一遍还被算进完成数（见上面的 incomplete 判断）。 */
    for (let at = 1; at <= Math.min(n, turns.length); at++) if (!state.coach.explain[at]) todo.push(at);
    if (!todo.length) { flash('这份棋谱已经全部讲过（' + n + ' 手）'); return; }

    let k = 0;
    for (let i = 0; i < todo.length; i++) {
      if (batchStop || gen !== gameGen) break;
      const at = todo[i];
      const m = state.moves[at - 1];
      const pt = m.pass ? '停一手' : toGTP(m.x, m.y);
      const sideTxt = m.color === 'b' ? '黑' : '白';
      const headTxt = '第 ' + at + ' 手 · ' + sideTxt + ' ' + pt;

      const info = turns[at - 1] || {};
      const list = (info.moves || []).filter(x => x && x.move)
        .sort((a, b) => b.winrate - a.winrate);
      const best = list[0];
      const v = handVerdict(at, m);
      const verdictTxt = v ? v.txt : '（KataGo 没算出这一手的数据）';
      let leadTxt = '', body = '';
      if (!best) {
        leadTxt = '（这一手之前的局面没算出候选点）';
      } else {
        /* 「当时」两个字不能省 —— 这是**这一手之前**那个局面的胜率。
           ★ 2026-10-08 与「分析讲解」同步修：这里原来也把 `best.move`（AI 想下的点）
             传给了 LoGos，于是整盘讲解讲的都是"AI 该下哪"，而不是**实际下的这一手**会怎样。 */
        const same = String(best.move).toUpperCase() === pt.toUpperCase();
        leadTxt = same
          ? ('AI 当时想下的也是这里（' + best.move + '，' + sideTxt + '棋当时胜率 '
            + (best.winrate * 100).toFixed(1) + '%）。下面讲这一手：')
          : ('AI 当时想下的是 ' + best.move + '（' + sideTxt + '棋当时胜率 '
            + (best.winrate * 100).toFixed(1) + '%）；实际下的是 ' + pt + '。下面讲实际这一手：');
        const before = state.moves.slice(0, at - 1);
        const onset = same
          ? '，和 AI 的首选是同一个点'
          : ('，不过 AI 当时更倾向 ' + best.move + '（' + sideTxt + '棋当时胜率 '
            + (best.winrate * 100).toFixed(1) + '%）');
        const explainHead = '这一手 ' + pt + '（' + sideTxt + '棋第 ' + at + ' 手）下出来，';
        const ask = () => coachAsk(coachPrompt(before, boardAt(at - 1), m.color, pt, onset), 320);
        let r = await ask();
        if (!r) break;                          // 被别的请求取代 → 收工
        /* ★ 用户点了「停止」（或换棋谱）→ main.js 把半截文本带 `aborted: true` 回来。
           这时**这一手不要**：既不该重试（停了还在讲、还要再等几秒），
           也不该入库 —— 半截文本可能「够长 + 有句号」而被当完整讲解存进 .coach.json，
           之后永不重讲。收工前把 batchStop 置上，下面那句提示也会说「已停」。
           （2026-10-06 审查发现：aborted 这个标记一直没人看。） */
        if (r.aborted) { batchStop = true; break; }
        let txt = coachTextReady(r.text, pt, m.color, explainHead);
        /* 太短 / 第一句没说完 → 重来一次；两次里挑能用的（都好就取长的）。 */
        if (!r.error && !coachUsable(txt)) {
          const r2 = await ask();
          if (r2 && !r2.error) {
            const t2 = coachTextReady(r2.text, pt, m.color, explainHead);
            if (coachUsable(t2) || t2.length > txt.length) { txt = t2; r = r2; }
          }
        }
        body = r.error ? ('（讲不出来：' + r.error + '）') : txt;
      }
      if (body) {
        state.coach.explain[at] = {
          head: headTxt, verdict: verdictTxt, ok: !!(v && v.loss <= 0.05),
          lead: leadTxt, body: body,
        };
      }
      k++;
      setBatchBar(true, k, todo.length, '讲第 ' + at + ' 手 · ' + k + '/' + todo.length);
      /* 讲的正好是眼下这一手 → 顺手把它显示出来（不然用户得等整盘跑完才看得到） */
      if (at === state.viewAt) { coachRenderedAt = -999; renderCoachPanels(true); }
      if (k % 8 === 0) saveCoachFile();     // 每 8 手落一次盘：中途关软件不至于全丢
    }
    /* ★ 只有还停在原来那份棋谱上才写盘 —— 否则会把「刚才切过去的那份棋谱」的
       讲解覆盖成空（那些讲解属于**原来那份**，键存在 state.coach.explain 里）。 */
    if (gen !== gameGen) {
      flash('换棋谱了 —— 全盘讲解已停（这次讲完的 ' + k + ' 手没存）');
    } else {
      await saveCoachFile();
      flash(batchStop
        ? ('已停下 —— 讲完了 ' + k + ' 手，下次再点「全盘讲解」接着往下讲')
        : ('全盘讲解完成：这次讲了 ' + k + ' 手（整盘共 ' + n + ' 手）'));
    }
  } finally {
    reviewBusy = false;
    state.coach.batch = null;
    $('btn-batch').disabled = false;
    $('btn-explain').disabled = false;
    $('btn-pick').disabled = false;
    setBatchBar(false);
    coachRenderedAt = -999;
    renderCoachPanels(true);
  }
}

/* KataGo 在算整盘时，把进度画到我们自己的进度条上（阶段①）。
   ★ 上面那条全局订阅会调 showReviewProgress（弹复盘窗）—— 批量分析不该弹它，
     所以那边加了 `!state.coach.batch` 的条件。 */
window.api.onReviewProgress(d => {
  if (state.coach.batch && d) {
    setBatchBar(true, d.done, d.total, 'KataGo 算整盘 ' + d.done + '/' + d.total);
  }
});

/* ---------- 绑定 ---------- */
$('btn-explain').onclick = () => runAnalysisExplain();
$('btn-pick').onclick = () => runPickExplain();
/* 全盘讲解：只在**打开棋谱**时出现（clearCoachPanels 管显隐） */
$('btn-batch').onclick = () => runBatchCoach();
$('batch-stop').onclick = () => {
  batchStop = true;
  window.api.coach.cancel();          // 掐掉正在写的那一手
  setBatchBar(true, 0, 1, '正在停…');
};
/* ★ 启动初始化放在**最后**（讲解模块的 const 都已求值）：
   applyNewGame 内部会调 clearCoachPanels()，它要用 COACH_PH_* 那两个常量 ——
   放在它们前面会踩 const 的暂时性死区（TDZ）。 */
applyNewGame(true);
