# OGS 调研 · 实测原始记录

> 本文件是**调研过程的原始记录**（实测命令与结果），供写正式方案时引用。
> 正式方案见 `OGS对弈方案.md`。写于 2026-10-08。
> ★ 标注【实测】的都是当场跑出来的；【文档】的是官方文档原文。

---

## 一、OGS 对外接口的存在性与可访问性

| 项 | 结果 | 类型 |
|---|---|---|
| `https://online-go.com/api/v1/` | HTTP 200，返回各资源路径的目录 | 实测 |
| `https://online-go.com/api/v1/players/1` | HTTP 200，拿到玩家资料（含 ranking、country 等） | 实测 |
| `https://online-go.com/api/v1/me` | **HTTP 401**（需要登录） | 实测 |
| `https://online-go.com/api/v1/challenges` | **HTTP 401**（需要登录） | 实测 |
| `https://online-go.com/api/v1/games?page_size=3` | **HTTP 404**（这个路径不存在） | 实测 |
| `https://online-go.com/api/v1/players/1/games?page_size=30` | **HTTP 200**，拿到 30 盘对局 | 实测 |
| 官方开发者文档 `https://docs.online-go.com/` | 存在，HTTP 200 | 实测 |
| REST 接口文档 `https://online-go.com/api-docs/` | 存在（Swagger UI，JS 渲染） | 实测 |
| OpenAPI 规范 `https://online-go.com/api-docs/schema/` | **HTTP 200，280 KB，11363 行 YAML** | 实测 |

### ★ 规范质量的一个重要坑（必须记住）

`games/{id}/state/` 与 `me/games/` 在规范里**只写了 description，没写响应结构**：

```
/api/v1/games/{id}/state/:
  get:
    operationId: games_state_retrieve
    description: Get the current board state of a game.
    responses:
      '200':
        description: No response body      ← 规范没描述字段！
```

**结论：这份 REST 规范是自动生成的、字段有缺。** 响应结构必须**实测**才知道，
不能照规范写代码。`players/{id}/games` 反而给了完整字段（见下）。

---

## 二、OGS 的 API 规模

**【实测】** 182 条路径，**307 条操作**（GET 145 / POST 72 / PUT 41 / PATCH 12 / DELETE 37），
分布于 **26 个命名域 + 1 个未打标的根路径**（共 27 组）：

```
ai_reviews  announcements  challenges  data  demos  game_records  games  gotv
groups  kibitz  ladders  library  me  online_league  players  polls  prizes
puzzles  reviews  stats  title_tournaments  tournament_records
tournament_schedules  tournaments  ui  whats_new
（+ 未打标的根路径 /api/v1/，列顶层资源）
```

> ⚠️ 我第一次数成 253 条 —— 正则漏了 `patch` 等方法。**以 307 为准。**
> 教训：统计 schema 这种自动生成的规范时，别漏 HTTP 方法种类。

**schema 未给 description 的域**：`data` / `gotv` / `stats` / `online_league` / `tournament_records` / `ai_reviews`
—— 这些域的用途是**按路径推断**的，标【未验证】。

**另一条暗线**（子代理发现，未写进任何文档）：存在 `termination-api`，匿名可读，例如
`GET /termination-api/game/1` **直接给解析好的时限对象**。
schema 自己也承认它存在（"redirects to termination API"）。
**但它没有稳定性承诺 → 不当正式依赖。**

---

## 三、★ 对局数据模型（【实测】从 `players/1/games` 拿到的真实字段）

一盘棋的字段（前 30 个，完整）：

```
related, players, id, name, creator, mode, source,
black, white, width, height, rules, ranked,
handicap_rank_difference, handicap, komi,
time_control, black_player_rank, black_player_rating,
white_player_rank, white_player_rating,
time_per_move, time_control_parameters,
disable_analysis, tournament, tournament_round, ladder,
pause_on_weekends, outcome, black_lost, ...
```

**几个关键字段**：

| 字段 | 含义 |
|---|---|
| `time_control` | 计时**制式**：`fischer` / `byoyomi` / `none`（不是快慢） |
| `time_control_parameters` | 完整时限参数（JSON 字符串，见下） |
| `time_per_move` | 平均每手可用秒数（长期对局会是几十万秒） |
| `disable_analysis` | **服务端禁止分析**（防作弊开关） |
| `pause_on_weekends` | 周末暂停（长期对局用） |
| `handicap` / `komi` / `rules` | 让子 / 贴目 / 规则 |
| `ranked` | 是否计分 |
| `outcome` / `black_lost` / `white_lost` | 结果 |
| `width` / `height` | 棋盘大小 |

---

## 四、★★ 时限体系全貌（【实测】把 4 档速别都抓到了）

`time_control_parameters` 的真实取值（每种制式/速别各一份）：

| speed | system | 参数 | 换算 |
|---|---|---|---|
| `blitz`（超快棋） | fischer | `initial 30s, inc 3s, max 300s` | 30 秒 + 每手 3 秒 |
| `rapid`（快棋） | fischer | `initial 300s, inc 5s, max 3600s` | 5 分 + 每手 5 秒 |
| `live`（慢棋） | byoyomi | `main 1200s, period 30s × 5` | 20 分 + 5×30 秒读秒 |
| **`correspondence`（长期）** | fischer | **`initial 2419200s, inc 604800s, max 2419200s`** | **28 天 + 每手 7 天，上限 28 天** |
| `correspondence`（长期） | fischer | `initial 604800s, inc 86400s, max 604800s` | 7 天 + 每手 1 天 |
| `correspondence`（长期） | byoyomi | `main 604800s, period 86400s × 5` | 7 天 + 5×1 天 |

**结论：OGS 官方支持"下很多天"的棋，最长可到 28 天 + 每手 7 天。**
`speed: "correspondence"` 就是官方给这类对局的标记。

---

## 五、对弈相关的关键接口（【实测】路径存在，响应待登录后验证）

| 接口 | 方法 | 作用 |
|---|---|---|
| `games/{id}/state/` | GET | 当前局面 / 时钟 / 轮到谁 ← **长期对局的核心** |
| `games/{id}/move/` | **POST** | **落子（REST 就能下！）** |
| `games/{id}/pass/` | POST | 停一手 |
| `games/{id}/sgf/` | GET | 拿棋谱 SGF ← **接本地复盘的入口** |
| `games/{id}/next/{userid}` | GET | 跳到"我下一盘该走的棋" ← **长期对局的命门** |
| `games/{id}/pause/` · `/resume/` | POST | 暂停 / 继续 |
| `games/{id}/ai_reviews/` · `ai_reviews/{id}/` | GET | OGS 自己的 AI 复盘 |
| `games/between_players_since/` | GET | 查两个玩家之间的对局 |
| `me/games/` | GET | 我参与的所有对局 |
| `me/games/sgf/{id}/` | GET | 我的棋谱 SGF |
| `me/challenges/invites/` | GET | 别人邀请我的对局 |
| `me/friends/` · `me/friends/invitations/` | GET | 好友（指定朋友对战用） |
| `me/vacation/` | — | 休假模式（长期对局挂起） |
| `players/{id}/challenge/` | POST | **直接挑战某个玩家** |
| `challenges/{id}/accept/` · `/join/` · `/start/` | POST | 接受 / 加入 / 开局 |
| `challenges/{uu-{uuid}/` | GET | 用 uuid 取挑战（分享链接给朋友） |
| `kibitz/rooms/` 等 6 条 | — | 观战 / 讲解室 |

### ★★ 最重要的架构发现

**`POST /api/v1/games/{id}/move/` 存在**（规范原文：*Submit a move in an active game*），
且 `games/{id}/state/` 可读状态。

**含义：长期对局有可能完全不用 WebSocket，纯 REST + 轮询就能实现。**
这会大幅降低第一版的复杂度和风险（不用处理长连接、心跳、断线重连）。

**待实测确认**：move 接口的请求体格式（规范没写）、state 接口的响应结构、
以及"轮询能不能及时知道对方走了"（长期对局对实时性要求本来就低）。

---

## 六、防作弊与合规（【实测】发现）

| 发现 | 说明 |
|---|---|
| 对局字段 `disable_analysis`（布尔） | **服务端可以禁止分析** —— 说明平台自己就在防 AI 辅助 |
| `games/library_ai_detection/{library_owner}/` | OGS **有 AI 检测功能** |
| `PaginatedGameAIDetectionListList` 模型 | 检测结果是分页列表 |
| 机器人通道 | 官方指定 `gtp2ogs` 项目；我们连的是**人的账号**（OAuth2），不碰这个 |

**结论：对局中禁用本地引擎不是"我们自觉"，而是与平台机制对齐 —— 必须写成硬性红线。**

---

## 七、OAuth2（【实测抓取官方文档】）

| 项 | 值 |
|---|---|
| 授权 | `https://online-go.com/oauth2/authorize/` |
| 取 token | `https://online-go.com/oauth2/token/` |
| 撤销 | `https://online-go.com/oauth2/revoke_token/` |
| 内省 | `https://online-go.com/oauth2/introspect/` |
| 用户信息 | `https://online-go.com/oauth2/userinfo/` |
| scope | `read` / `write` / `groups` |
| 应用注册 | `https://online-go.com/oauth2/applications/`，**每人最多 5 个** |
| 客户端类型 | `Confidential`（有后端）/ **`Public`（桌面应用 → PKCE，不存 secret）** |
| 允许的回调协议 | `https://`（推荐）、`http://`（**标注"仅本地开发"**）、`expo://`、`gobo://` |

**★ 未解决的最大障碍**：桌面程序没有公网回调地址。
`http://127.0.0.1:端口/callback` 能不能注册成正式回调（还是只能算"本地开发"），
以及列表里的 `gobo://` 能不能注册自己的 scheme —— **两者都待实测**（需要有 OGS 应用之后才能试）。

---

## 八、实时协议（【文档】）

```
客户端 → 服务器:  [命令, 数据, id?]
服务器 → 客户端:  [事件名, 数据]   或   [id, 数据?, 错误?]
```
`id` 可选；带了就会收到恰好一条对应回复；回复里 data 与 error 只会有一个。

官方客户端库 npm `goban`（Apache-2.0，v8.3.226，仅 1 个依赖 `eventemitter3`）：
- `build/goban.js` 0.97 MB（min 0.36 MB），整包 11 MB（含 source map / examples / CSS）
- 提供 `GobanSocket`（EventEmitter：connect / disconnect / reconnect / unrecoverable_error / latency）
- **浏览器向的库**（ESM + 面向 DOM）→ 主进程 Node 侧用不了，得放渲染进程

---

## 八之二、★★ 三个接口匿名可读 + `state/` 的真实结构（【实测】重大利好）

### 匿名就能读（不需要登录！）

| 接口 | 结果 |
|---|---|
| `GET games/{id}/` | HTTP 200，3445 字节 JSON |
| `GET games/{id}/state/` | **HTTP 200**，813 字节 JSON |
| `GET games/{id}/sgf/` | **HTTP 200**，`Content-Type: application/x-go-sgf`，拿到真 SGF 文本 |

**含义：**
- **看别人的棋 + 本地复盘这条链完全不依赖登录** —— 即使 OAuth2 出问题，"围观 + 复盘"照样能做
- 拿 SGF 那条尤其值钱：`games/{id}/sgf/` 直接给出标准 SGF，**喂给我们的复盘/讲解流程零改造**

### 实测拿到的 SGF 片段（字段可辨认）

```
(;GM[1]FF[4]DT[2014-08-09]PC[OGS: https://online-go.com/game/787823]
  PB[anoek]PW[Random Bot]BR[11k]WR[?]RE[Void]
  SZ[19]KM[6.5]RU[Japanese]TM[0]OT[0 none]
  ;B[ml];W[ih]...)
```

### `games/{id}/state/` 的真实结构（规范没写，这是实测）

```json
{
  "board": [[0,0,0,...], ...],       // 19×19 二维数组
  "move_number": 2,
  "last_move": { "x": 8, "y": 7 }
}
```

| 值 | 含义 |
|---|---|
| `board[y][x]` | **0 = 空，1 = 黑，2 = 白** |
| 原点 | **左上角**（`board[0][0]` 是左上） |
| `last_move` | 用 `{x, y}` 表示，**同一个坐标系** |

**★★ 对我们极其有利**：我们内部棋盘也是二维数组、也是左上为原点、也是 `(x, y)`。
**接入时几乎不需要坐标转换** —— 只需把 1/2 映射成我们的黑/白。

---

## 八之三、对局对象的完整字段（【实测】`games/{id}/` 返回 44 个字段）

```
id, all_players, name, players{black,white}, related, creator, mode, source,
black, white,                       ← 双方玩家 id
width, height, rules, ranked, komi,
handicap, handicap_rank_difference,
time_control, time_per_move, time_control_parameters,
black_player_rank, black_player_rating, white_player_rank, white_player_rating,
disable_analysis,                   ← 服务端是否禁止分析
tournament, tournament_round, ladder, pause_on_weekends,
outcome, black_lost, white_lost, annulled, annulment_reason,
started, ended, historical_ratings, gamedata, auth, rengo, flags,
bot_detection_results, simul_black, simul_white
```

### 做「待我走」列表要用哪些字段

| 需求 | 用哪个字段 |
|---|---|
| 我在哪一方 | 拿 `/me` 的 id，与 `black` / `white` 比较 |
| 是不是长期对局 | `time_control_parameters.speed == "correspondence"` |
| 结束了没 | `ended` 有值 / `outcome` 非空 |
| 结果 | `outcome`（如 `Cancellation`）、`black_lost`、`white_lost`、`annulled` |
| **轮到谁** | `GET games/{id}/state/` 的 `move_number` —— **黑先，所以偶数手时轮到黑** |
| 是否禁止分析 | `disable_analysis` |

### ★ 重要限制：`me/games` **不能按"轮到我了"过滤**

实测它的查询参数只有三个：`ordering` / `page` / `page_size`。

**所以「待我走」列表必须客户端自己筛**：
```
拉 me/games（分页）→ 过滤出未结束的 → 对每一盘查 state 取 move_number
   → 偶数=轮到黑、奇数=轮到白 → 和"我是哪一方"比对
```

**注意**：这会带来多次请求（每盘一次 state）。**要按限流规矩做**（见调研笔记「限流的真实教训」）：
翻页别快、缓存已取到的状态、只在面板打开时拉。

---

## 九、未验证清单（必须实测，别当"大概没问题"）

| 项 | 为什么现在验不了 |
|---|---|
| 本地回环回调能否注册 | 需要先有 OGS 应用（要用户的账号） |
| `gobo://` 能否注册自定义 scheme | 同上 |
| `games/{id}/move/` 的请求体格式 | 规范没写，要登录后试 |
| `games/{id}/state/` 的响应结构 | 规范没写，要登录后试 |
| 轮询能否满足长期对局的及时性 | 要真的下一盘 |
| WebSocket 的命令/事件全集 | 要登录后的会话 |
| 实际对局时序（打劫/让子/停一手/数子） | 要真的下一盘 |
| OGS 对第三方客户端的速率限制 | 文档未提 |
| 第三方客户端是否需审核 | 文档未提 |

---

## 十、临时文件清理记录

调研过程中在 `D:\GoStudy\` 下产生过临时文件，用完即删：
`_ogs_schema.yml`、`_ogs_schema.json`、`_goban_probe\`、`_ogs_probe\`、`_ogs_probe2\`、`_ogs_probe3\`
（写本文件时 `_ogs_probe3` 尚在，收尾时一并清掉）
