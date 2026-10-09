# OGS 联网对弈 · 方案（v2）

> 起因：GitHub issue #7（`keindex`，2026-10-08）提「能不能实现线上对弈功能」。
> 本文件是**动手前的规划**，不是承诺。首相已定：**先规划，过段时间施工**。
> 实测原始记录见 `OGS调研笔记.md`（含每条命令与结果）；本文只写结论与决策。
> 更新于 2026-10-08（v2：根据实测大幅修订 —— v1 有三处判断被实测推翻，见「一、先纠正三处」）。

---

## 一、先纠正三处（v1 写错/写偏的地方）

| v1 的说法 | 实测结论 |
|---|---|
| 「**人必须在线**，这是实时对弈」 | **错。** OGS 官方支持长期对局（`speed: "correspondence"`），**最长 28 天 + 每手 7 天**，服务器记时，**关掉软件照走** |
| 「下棋必须用 WebSocket（`goban` 库）」 | **不一定。** `POST games/{id}/move/` **是 REST 接口** —— 长期对局可以**纯 REST + 轮询**，不需要长连接 |
| 「拿棋谱要登录」 | **错。** `games/{id}/`、`games/{id}/state/`、`games/{id}/sgf/` **匿名就能读**（实测 HTTP 200） |

**这三处纠正把方案整体变简单了**：第一版可以是个"REST 客户端"，不碰长连接、不引入 `goban`。

**另有一个顺带的好处**：REST 请求**从主进程发**（Electron 的 `net.fetch`，做「检查更新」时已经用过）。
主进程是 Node 环境，**不适用浏览器的同源策略** → **完全不用操心 CORS**。
（实测 OGS 响应带 `Vary: origin`，说明它按来源变化；子代理另测到 `access-control-allow-origin: *`。
无论哪种，主进程发请求都不受影响。）

---

## 二、结论

**可行，路子是正的** —— OGS 官方为第三方客户端准备了完整接口，不是逆向外挂。

**三条必须先立的规矩**：

1. **对局中绝不能插本地引擎** —— 作弊会封号。而且实测发现 **OGS 自己有 `disable_analysis` 字段和 AI 检测**，
   所以这条不是"我们自觉"，是**与平台机制对齐**（见「七、合规红线」）。
2. **它给这个软件开了一条联网通道** —— 打破现有「除检查更新外不出网」纪律，要明确新增例外并写进帮助。
3. **第一版只做长期对局** —— 复杂度低、体验贴合、且**"必须在线"那条约束不存在**。

**最重要的一句**：接入 OGS 的意义**不在"能联网下棋"**（浏览器本来就能下），
而在 **"下完直接在这个软件里用 KataGo 复盘、用 LoGos 讲棋"** —— 这条闭环才是我们独有的。
所以**闭环是核心目标，不是收尾工作**（阶段排序把它提前了，见「八」）。

---

## 三、OGS 能力全景（实测）

### 3.1 接口规模

| 项 | 实测结果 |
|---|---|
| REST 路径 | **182 条**，分布在 **26 个命名域 + 1 个未打标的根路径**（共 27 组） |
| 操作总数（含各 HTTP 方法） | **307 条**（GET 145 / POST 72 / PUT 41 / PATCH 12 / DELETE 37） |
| OpenAPI 规范 | `https://online-go.com/api-docs/schema/`，**287,219 字节** / 11363 行 YAML |
| 官方开发者文档 | <https://docs.online-go.com/>（Realtime + REST + OAuth2） |
| OGS 线上版本（实测 `ui/config`） | `5.1-6768-gbe545105d` |

### 3.2 27 个功能域（26 个命名 + 1 个根路径；哪些对我们有用）

| 域 | 操作数 | 是什么 | 对我们 |
|---|---|---|---|
| **games** | 21 | 对局本体：状态、落子、停一手、暂停/继续、棋谱、AI 复盘 | ★★★ 核心 |
| **challenges** | 11 | 建立/接受挑战（自定义对局）、rengo 组队 | ★★★ 开局入口 |
| **me** | 51 | 登录用户的一切：我的对局、好友、邀请、休假、设置 | ★★★ 必需 |
| **players** | 23 | 玩家搜索/资料/直接挑战某人 | ★★☆ 找朋友 |
| **reviews** | 9 | 人工复盘（带标注的棋盘，可私有+ACL） | ★★☆ 将来可接 |
| **ai_reviews** | 1 | OGS 自己的 AI 复盘 | ★☆☆ 我们本地更强 |
| **kibitz** | 11 | 观战/讲解室（多人在同一盘上聊） | ★☆☆ 不做 |
| **puzzles** | 23 | 死活题 | ✗ 我们不做题 |
| **tournaments** | 18 | 锦标赛 | ✗ 不做 |
| **title_tournaments** | 2 | 头衔战 | ✗ 不做 |
| **tournament_schedules** | 6 | 赛程表 | ✗ 不做 |
| **ladders** | 6 | 天梯 | ✗ 不做 |
| **groups** | 17 | 棋友会/群组 | ★☆☆ 私房对局可借道 |
| **library** | 6 | 个人棋谱库（可建收藏集+ACL） | ✗ 我们有本地棋谱库 |
| **game_records** | 4 | 手工录入的对局（非 OGS 上下的） | ✗ 不做 |
| **demos** | 3 | 教学/分析用演示盘 | ★☆☆ 不做 |
| **online_league** | 7 | 线上联赛 | ✗ 不做 |
| **announcements** | 6 | 站内公告 | ✗ 不做 |
| **whats_new** | 21 | 更新日志 | ✗ 不做 |
| **stats** | 1 | 站点统计 | ✗ 不做 |
| **prizes** | 6 | 赞助者奖品预算 | ✗ 不做 |
| **polls** | 1 | 投票 | ✗ 不做 |
| **ui** | 8 | 界面相关（含给机器人账号生成 API key） | ✗ 不做 |
| **gotv** | 1 | 直播/观赛 | ✗ 不做 |
| **data** | 1 | 顶层资源目录 | — |

**★ 结论：27 个域里我们真正需要的是 5 个** —— `games` / `challenges` / `me` / `players` /（可选）`reviews`。

### 3.3 匿名可读（实测，重要）

| 接口 | 结果 |
|---|---|
| `GET games/{id}/` | HTTP 200 |
| `GET games/{id}/state/` | **HTTP 200** |
| `GET games/{id}/sgf/` | **HTTP 200**，`application/x-go-sgf`，拿到标准 SGF |
| `GET players/{id}/games` | HTTP 200（完整对局字段） |
| `GET api/v1/` | HTTP 200（资源目录） |
| `GET me/` · `GET challenges/` | **HTTP 401**（要登录） |

**含义：**
- **「看别人的棋 + 本地复盘」不依赖登录** —— 即使 OAuth2 出问题，这块照样能做
- `sgf/` 直接给标准 SGF，**喂进我们现有复盘/讲解流程零改造**

### 3.4 `state/` 的真实结构（规范没写，实测拿到）

```json
{
  "board": [[0,0,0,...], ...],      // 19×19
  "move_number": 2,
  "last_move": { "x": 8, "y": 7 }
}
```

- `board[y][x]`：**0=空，1=黑，2=白**
- 原点：**左上角**
- **★★ 我们内部也是二维数组、左上原点、`(x,y)`** → **接入时几乎不需要坐标转换**

### 3.5 时限体系（实测 + 源码，六种制式）

**计时制式只有 6 种**（源码 `TimeControl/TimeControl.ts` 的枚举）：
`fischer` / `simple` / `byoyomi` / `canadian` / `absolute` / `none`

**速度 4 档**，判定规则（源码 `TimeControl/util.ts` 的 `classifyGameSpeed`）：
**平均每手 = 0 或 > 3600 秒 → `correspondence`**；< 10 秒 → `blitz`；其余 → `live`。

**长期对局（correspondence）的可设范围**（单位秒）：

| 制式 | 可选范围 |
|---|---|
| Fischer | initial 1~28 天，increment **4 小时~7 天**，max 1~28 天 |
| **Simple** | **per_move 12 小时~28 天** ← **"每手几天"的正式入口** |
| Byo-yomi | main ∈ {0, 1天…28天}，period 1~28 天 |
| Canadian | main ∈ {0, 1天…28天}，period 1~28 天 |
| Absolute | total 7~28 天 |

**默认值**：Fischer 3天+1天/手（上限7天）· Byo-yomi 7天+5×1天 · Canadian 7天+7天/10子 · **Simple 2天/手** · Absolute 28天。
**前五种的 `pause_on_weekends` 默认开**，`none` 为关。

**周末暂停的具体时间**（文档所述）：**仅长期对局可用**；
**从周五 20:00 GMT 开始，到周日 20:00 GMT 结束**；若对局在暂停期内开局，暂停要到下一个周末才生效。

**★ 实现要点**：`time_control_parameters` 是**一个 JSON 字符串**，必须解析它 ——
只读顶层 `time_control` 字符串不够（那只是制式名）。顶层另有独立的 `pause_on_weekends` 布尔。

**休假**：`GET/PUT/DELETE /me/vacation/` —— 休假会**暂停你所有长期对局**；
站点偏好 `auto_vacation` 默认开（"超时前自动开休假"）。

### 3.6 OGS 实测到的真实对局对象（44 个字段）

```
id, all_players, name, players{black,white}, related, creator, mode, source,
black, white,                       ← 双方玩家 id
width, height, rules, ranked, komi, handicap, handicap_rank_difference,
time_control, time_per_move, time_control_parameters,   ← 时限三件套
black_player_rank, black_player_rating, white_player_rank, white_player_rating,
disable_analysis,                   ← 服务端是否禁止分析
tournament, tournament_round, ladder, pause_on_weekends,
outcome, black_lost, white_lost, annulled, annulment_reason,
started, ended, historical_ratings, gamedata, auth, rengo, flags,
bot_detection_results, simul_black, simul_white
```

**做「待我走」列表要用**：

| 需求 | 字段 |
|---|---|
| 我在哪一方 | `/me` 的 id 与 `black` / `white` 比 |
| 是不是长期对局 | `time_control_parameters.speed == "correspondence"` |
| 结束没有 | `ended` 有值 / `outcome` 非空 |
| 轮到谁 | `GET games/{id}/state/` 的 `move_number` —— **黑先，偶数手轮到黑** |

**★ 限制**：`me/games` **只能排序和分页**（参数只有 `ordering`/`page`/`page_size`），
**不能按"轮到我了"过滤** → 「待我走」列表必须客户端自己拼，而且**每盘要查一次 state**
（这就要遵守限流规矩，见「九」）。

### 3.7 ★ 观战/看别人的棋：匿名可读，而且含进行中的对局

| 接口 | 匿名 | 说明 |
|---|---|---|
| `GET games/{id}` | ✅ 实测 200 | **含完整 `gamedata.moves`** —— 实测连**进行中**的对局也读得到（moves=149, phase=play） |
| `GET games/{id}/state/` | ✅ | 当前局面 |
| `GET games/{id}/sgf/` | ✅ | 标准 SGF |
| `GET games/{id}/png` · `/apng/` | ✅ | 静图 / 落子动图 |
| `GET ui/config/` | ✅ | 客户端启动配置，**匿名也会下发一个 `user_jwt`**（这是实时连接的入场券） |

**含义：非私密的 OGS 对局，匿名就能围观并本地复盘 —— 这条链完全不依赖登录。**

### 3.8 私有 / 指定朋友对局（实测 + 源码）

```
POST games/{id}/acl/                "Manage access control list for private games" ← 私房许可名单
GET  challenges/uu-{uuid}/          用 uuid 查挑战（**匿名可读**）← 邀请链接就靠它
POST challenges/{id}/accept/        接受挑战并开局
GET  me/challenges/invites/         别人邀请我的
POST players/{id}/challenge/        直接挑战某个玩家
GET  me/friends/                    好友列表
```

**四种玩法**：① 直接挑战某玩家 ② **`invite_only` + `uuid` 邀请链接（收链接的人匿名也能打开）** ③ 私密对局 `game.private=true` + ACL ④ 好友。
> ⚠️ 注意：**计分对局（ranked）不能设为私密**。

### 3.9 联网基础设施（OAuth2，实测抓取）

| 项 | 值 |
|---|---|
| 授权 / 取 token / 撤销 / 内省 / 用户信息 | `oauth2/authorize` · `token` · `revoke_token` · `introspect` · `userinfo` |
| scope | `read` / `write` / `groups` |
| 应用注册 | <https://online-go.com/oauth2/applications/>，**每人最多 5 个** |
| 客户端类型 | **`Public` + PKCE**（官方文档明确写"桌面应用用这个"，**不存 secret**） |
| **token 寿命** | **access 30 天 / refresh 30 天** —— **对桌面客户端很有利**（不用天天登录） |
| 允许的回调协议 | `https://`（推荐）、**`http://`（标注"仅本地开发"）**、`expo://`、`gobo://` |
| **第三方客户端要不要审核** | **查不到任何审核流程** —— 应用自助注册；只有**机器人账号**需要联系管理员标记 |

---

## 四、登录（OAuth2）—— 有权威实践可照抄

OAuth2 标准流程是「浏览器跳过去授权 → OGS 把 `code` 回传到你的网址」。**我们没有网址**，这是这条路上唯一的硬障碍。

### 4.1 ★★ 社区已有成体系的实践（2025-11-20，OGS 开发者亲自协助）

出处：OGS 论坛帖 [Oauth2 How To](https://forums.online-go.com/t/58804)（作者 `Clossius1`，帖中写明「Thanks to @anoek for helping me figure this out」，
`anoek` 是 OGS 的开发者）。另有 [OAuth2 flow — using authorization grant code?](https://forums.online-go.com/t/58106)（2025-09~11）补充细节。

**实测确认的事实**：

| 事实 | 出处 | 对我们的意义 |
|---|---|---|
| **授权码流程可跑通**，PKCE（`code_verifier` + `code_challenge`=SHA256）支持 | 两帖 | **我们的登录方案成立** ✅ |
| 「OGS **doesn't enforce** this, but you **should use PKCE** from a mobile or client-only app」 | 帖 58106 帖2 | 官方态度：推荐用 PKCE |
| **不允许自定义 URI scheme**（原文：*it doesn't allow custom URI schemes*） | 帖 58106 帖4 | **`gobo://` 用不了** → 只剩本地回环或 https |
| **URL 与 `redirect_uri` 必须逐字符精确匹配**，**且 `redirect_uri` 必须和注册时填的完全一致（含结尾 `/`）** | 帖 58804 帖1 | ★ 实现时最容易踩的坑 |
| **`oauth2/token/` 末尾的 `/` 不能省** | 帖 58804 帖1 | 同上 |
| **有 refresh token，access token 会过期，要自己刷新** | 帖 58106 帖2（对方自己写了 `getRefreshToken`） | 方案里必须包含刷新逻辑 |
| **client_secret 只在创建应用时显示一次**，之后只给加密版 | 帖 58106 帖2 | 注册应用时要**立刻保存** |
| OGS 对 cache-control 头有 CORS 规则 | 帖 58106 帖2 | 实现注意 |

**帖 58804 给出的实现骨架（我们的第 1 阶段可以直接照这个路子）**：

```
① 在 https://online-go.com/oauth2/applications/ 注册应用，记下 client_id
② 本地生成：verifier = 随机 32 字节 base64url；challenge = base64url(SHA256(verifier))；state = 随机
   把 verifier 和 state 存本地
③ 开浏览器到 https://online-go.com/oauth2/authorize/?client_id=...&response_type=code
   &redirect_uri=<精确匹配的地址>&state=...&code_challenge=...&code_challenge_method=S256
④ 用户在 OGS 登录并授权 → 回调到 redirect_uri，带上 ?code=...&state=...
⑤ 校验 state 一致 → POST https://online-go.com/oauth2/token/
   （grant_type=authorization_code & code & client_id & code_verifier）
⑥ 拿到 access_token + refresh_token + 有效期
```

### 4.2 三种回调方式的可行性（实测+社区信息后重排）

| 办法 | 可行性 | 说明 |
|---|---|---|
| **本地回环 `http://127.0.0.1:端口/callback`** | **最可能可行** | 自定义 scheme 已被排除（见上），`https://` 我们又没服务器 → **这是主方案**。官方文档把 `http://` 标注"仅本地开发"，但**社区实践里注册的是 https 地址**；回环能否注册**必须第 1 阶段实测** |
| 自定义协议 `gobo://` | **实测排除** | 论坛明确「不允许自定义 URI scheme」 |
| **手动粘贴 code** | **一定能行** | 开浏览器授权 → 用户从地址栏复制 `code=` 后面那串粘贴回来。土，但**零依赖、必然可用**，作为兜底 |
| 注册一个 `https://` 回调 | 理论可行 | 但要自己有域名和公网服务 —— **不符合我们"不养服务器"的原则**，不做 |

**★ 第 1 阶段的任务因此非常明确**：注册 OGS 应用 → 试 `http://127.0.0.1:端口/callback` 能不能被接受 →
不行就退回"手动粘贴 code"。**1~2 天出结论。**

---

## 五、我们要做什么 / 明确不做什么

### 5.1 要做（按优先级）

| 功能 | 说明 |
|---|---|
| **登录 OGS** | OAuth2，**不在软件里输密码**，可退出登录 |
| **看我的对局列表** | 进行中 / 待我走 / 已结束 |
| **长期对局下棋** | 落子、停一手、认输、暂停/继续；显示双方时钟 |
| **指定朋友对局** | 直接挑战某人 / 邀请链接 / 私房 |
| **★ 下完自动落盘本地并复盘** | 棋谱进 `records\` → 直接点「AI 复盘」「全盘讲解」 |
| **围观 + 复盘别人的棋** | 靠匿名接口，**不需要登录**（做起来最省事，价值也直接） |

### 5.2 明确不做

| 不做 | 理由 |
|---|---|
| 实时对局（快棋/读秒那种） | 要长连接 + 断线重连 + 时钟同步，复杂度高；**放最后，等前面稳了再说** |
| 观战室 / 聊天 / kibitz | 不是我们的场景 |
| 死活题 / 锦标赛 / 天梯 / 群组 / 联赛 | OGS 网页版做得好，我们重复做没意义 |
| OGS 的 AI 复盘 | 我们本地 KataGo 更强、可调搜索量 |
| 把 OGS 棋谱同步成"我们的棋谱库" | 只在本地存一份，不双向同步（避免状态分叉） |
| 机器人 / gtp2ogs | 我们连的是**人的账号**；机器人另有官方通道，**不许混用** |

---

## 六、用户体验设计

### 6.1 入口

顶栏加一个「**OGS**」按钮 → 打开面板。**没登录时面板里只有登录按钮。**

### 6.2 登录

```
点「登录 OGS」→ 开系统浏览器 → 用户在 OGS 页面点「授权」
   → 自动跳回软件（或粘贴授权码）→ 显示「已登录：用户名（段位）」
```

界面上要写明：**走 OAuth2 授权，软件永远碰不到你的 OGS 密码。**

### 6.3 对局列表与下棋

```
面板三栏：进行中（待我走排最前） / 已结束 / 挑战与邀请
点一盘 → 棋盘就是主界面（复用现有棋盘）
  右侧：对手名、段位、双方时钟、结果
  按钮：落子 → 停一手 → 认输 →（棋规允许时）求和 / 悔棋请求
```

### 6.4 ★ 对局中的界面红线

进入对局时：

- **强制关闭** KataGo 分析、推荐点、候选点、形势、所有讲解、AI 复盘
- **界面上明确显示**「**对局中已停用分析（OGS 平台规则）**」 —— 否则用户以为坏了
- 退出对局 / 对局结束 → **恢复用户原来的分析设置**
- 显示对方是否开了 `disable_analysis`

### 6.5 ★ 闭环（核心价值）

```
对局结束 → 棋谱自动存进本地 records\
   → 「AI 复盘」用本地 KataGo 逐手分析
   → 「全盘讲解」让 LoGos 逐手讲
```

**没有这一步，接入 OGS 就只是"又一个客户端"。**

---

## 七、合规红线（不是可选项）

### 7.1 ★ OGS 服务条款原文（已亲自核验，取自 OGS 官方源码仓库）

出处：`online-go/online-go.com` 仓库的 `src/views/docs/legal.tsx`（就是线上 `/docs/terms-of-service` 那页的内容）。

> **No Cheating or Computer Help**
> You can **NEVER** use Go programs (Leela, Zen, etc.) or neural networks to analyze current ongoing games
> unless specifically permitted (e.g., a computer tournament). The only type of computer assistance allowed is
> games databases for opening lines and joseki databases for corner patterns **in correspondence Go**.
> **You cannot receive ANY outside assistance on live or blitz Go games.**

**逐句解读（对我们的含义）**：

| 原文 | 含义 |
|---|---|
| 「NEVER use Go programs or neural networks to analyze **current ongoing games**」 | **对局进行中，一律不许用引擎** —— 无论快慢 |
| 「only type allowed is **databases for opening lines and joseki** … **in correspondence Go**」 | 长期对局允许"开局库/定式库"这类**资料查询**；**live/blitz 连这个都不许** |
| 「You cannot receive **ANY** outside assistance on **live or blitz**」 | 快棋是**零容忍** |

**★ 由此定的红线（第一版只做长期对局，但规则要一次立对）**：

| 功能 | 长期对局进行中 | live / blitz 进行中 | 对局结束后 / 看别人的棋 |
|---|---|---|---|
| KataGo 分析（胜率/推荐点/候选点/形势） | **关闭** | **关闭** | ✅ 可用 |
| 讲解 / AI 复盘 | 关闭 | 关闭 | ✅ 可用 |
| **定式/布局库查询** | 条款允许，但**第一版不做这功能**（省得踩灰区） | 关闭 | — |

**一句话**：**对局中一律不用我们的引擎；棋下完了随便分析。** 这条最保守，也最安全。

### 7.2 平台机制（进一步印证）

- 对局字段 **`disable_analysis`**（实测）：勾选后**双方在对局结束前不能进分析模式**，且长期对局的**条件手功能一并禁用**
- **AI 检测**（实测）：`games/library_ai_detection/...`；对局带 `bot_detection_results`（对外为 null）
- **处罚落点**：`AnnulmentReason.ai_cheating_remediation`（"Game was annulled as part of AI cheating remediation"）
- **官方态度**：明确**不公开检测手法**；每局至少过一遍工具；**先警告后停号**；
  「definitely AI assisted」的对局判无效，**并额外 annul 足够多对局以修正段位损失**；不解释"为什么是这一局"

### 7.3 我们的自我约束（写进代码与界面）

| 规矩 | 做法 |
|---|---|
| 对局中禁用一切本地引擎 | 进入对局强制关闭 + 界面明示「**对局中已停用分析（OGS 平台规则）**」 |
| 退出对局后恢复 | 恢复用户原来的分析设置，别让他以为软件坏了 |
| 只连人的账号 | 走 OAuth2；**不接 `gtp2ogs`**（那是官方给机器人的通道） |
| 不做自动化代打 | 不做"定时自动走棋""自动接受对局" —— 那会被当成机器人 |
| 不批量抓取 | 见「九、限流的真实教训」 |
| 让用户知道后果 | 首次使用明确提示：**对局中用 AI 会封号，那是你自己的账号** |

---

## 八、施工阶段（重排：长期对局优先、闭环提前）

| 阶段 | 做什么 | ★ 成功标准（可验证） | 主要风险 | 工作量 |
|---|---|---|---|---|
| **1. 登录通道** | 见下方「阶段 1 明细」 | **能登录并读到自己的 OGS 用户名** | **唯一"可能走不通"的环节** | 小（1~2 天） |
| **2. 只读接入** | REST 拉我的对局列表、拉某盘的状态与棋谱 | 面板里能看到我的对局，点开能看到棋盘 | `me/games` 响应结构（规范没写，要实测） | 小~中 |
| **3. 围观 + 复盘** | 匿名接口拿别人的棋谱 → 落进本地 → 接上复盘/讲解 | **能在软件里看一盘 OGS 的棋并做 AI 复盘**（不需要登录！） | 低 | 小 |
| **4. ★ 长期对局下棋** | REST 落子/停一手/认输 + 时钟显示 + 轮询 | **能和真人在 OGS 上走完一盘长期对局** | `move/` 请求体格式（规范没写）；轮询频率与限流 | **中~大** |
| **5. ★ 闭环** | 对局结束自动落盘 `records\` → 复盘/讲解 | 下完直接点「AI 复盘」 | 低 | 小 |
| **6. 指定朋友对局** | 直接挑战 / uuid 邀请 / 私房 ACL | **能和朋友约一盘私房** | 挑战参数细节 | 中 |
| **7. 实时对局** | WebSocket（可能要 `goban`）+ 断线重连 | 能下快棋 | **最高**（长连接、时钟、乱序） | 大 |
| **8. 打磨** | 异常提示、断线提示、挑战管理 | 用着舒服 | 低 | 中 |

### 阶段 1 明细（照着做即可，步骤来自社区实践）

> 出处：OGS 论坛 [Oauth2 How To](https://forums.online-go.com/t/58804)（2025-11-20，OGS 开发者协助写成）

| # | 步骤 | 备注 |
|---|---|---|
| 1 | **首相注册 OGS 应用**：<https://online-go.com/oauth2/applications/> | 需要**你的账号**。授权类型选 **authorization code**；`client_secret` **只显示一次，立刻保存** |
| 2 | 填 `redirect_uri` | **先试 `http://127.0.0.1:8614/callback`**（回环）。★ 必须与后续请求里的**逐字符一致，含结尾 `/`** |
| 3 | 本地生成 PKCE 参数 | `verifier` = 32 随机字节 base64url；`challenge` = base64url(SHA256(verifier))；`state` = 随机串。**存起来待校验** |
| 4 | 开系统浏览器到授权页 | `https://online-go.com/oauth2/authorize/?client_id=…&response_type=code&redirect_uri=…&scope=read+write&state=…&code_challenge=…&code_challenge_method=S256` |
| 5 | 起本地回环服务收 `code` | 校验回来的 `state` 与存的一致（防 CSRF）；页面回一句"可以关掉这个窗口了" |
| 6 | 换 token | `POST https://online-go.com/oauth2/token/`（**结尾 `/` 不能省**），`grant_type=authorization_code` + `code` + `client_id` + `code_verifier` |
| 7 | 存 token 并验证 | 存 access/refresh token + 有效期；调 `/oauth2/userinfo/` 或 `/api/v1/me` 确认能读到用户名 |
| 8 | **兜底方案** | 若第 2 步回环地址不被接受 → 改成"**手动粘贴 code**"（开浏览器授权，用户从地址栏复制 `code=` 那串回来）。**必然可用** |

**阶段 1 结束时要能回答**：回环回调能不能用？token 刷新能不能跑通？读到的用户名对不对？


**排序理由**：
- **阶段 1 必须最先**（唯一可能全盘否掉的环节）
- **阶段 3 提这么前**：它**不依赖登录**（匿名接口），能最快让用户体验到价值，且给阶段 4 铺好渲染通路
- **阶段 5 紧跟阶段 4**：闭环是核心价值，不与 7 里的实时对局绑定
- **阶段 7 最后**：最难，且前面所有棋局同步逻辑**能被它复用**，先做等于给它打地基

---

## 九、风险清单（不粉饰）

| 风险 | 影响 | 应对 |
|---|---|---|
| **回调地址不被接受** | 阶段 1 卡死 | 自定义 scheme 已被排除；主试本地回环；兜底"手动粘贴 code" |
| **REST 规范字段不全** | 照规范写代码会踩空 | 已知 `state/`、`me/games` 规范没写响应结构；`ui/overview/` 规范标匿名但实际 **403** → **一切以实测为准**（本文件与调研笔记里的字段都是实测来的） |
| **★ 限流与封禁（有真实教训）** | 被限流甚至屏蔽 | 见下方「限流的真实教训」 |
| **★ 「轮到你走」没有系统级推送** | 用户不知道轮到自己了 | OGS 只有**页面内 Web Notification**（要页面开着）+ **邮件**；**没有 Web Push / Service Worker**。→ 桌面客户端要**自己做托盘提醒/系统通知**（必须自己实现的缺口，见「十」） |
| **OGS 协议变更** | 常年维护负担 | 只用 REST（比 WebSocket 稳定得多）；不引入 `goban`（少一个会变的依赖） |
| **对局状态分叉** | 我们显示的和 OGS 不一致 | **一律以服务器为准**；分歧时重拉 `state/` 覆盖本地 |
| **作弊风险（用户侧）** | 用户开别的 AI 被封号 | 对局中强制关本地引擎 + 首次使用明确告知后果（见「七」） |
| **联网纪律** | 打破"只有检查更新出网" | 新增明确例外；写进帮助/README/`dev/_lint_net.mjs` 白名单；**不后台轮询，用户不点就不连** |
| **依赖外部平台** | OGS 挂了/改政策 | 功能设计成"**可选、独立**"—— 不登录时软件一切照旧 |
| **token 过期** | 用户用着突然失效 | 必须实现 refresh token（见「四、登录」）；刷新失败要给清楚的重新登录引导 |

### ★ 限流的真实教训（有出处，必须当回事）

出处：OGS 论坛 [Whitelisting for /api/v1/games](https://forums.online-go.com/t/19332)（2018-12 ~ 2019-01）

| 发生过什么 | 原文大意 |
|---|---|
| **`/api/v1/games` 被整个关掉** | 「OGS 服务器差点因为某人的 API 请求**崩掉**，之后这个接口就没了」（实测该路径确实 404） |
| **"礼貌退避"也会被封** | 「我尽量礼貌（收到 429 就退避），但客户端最后还是**被 blocked**了 —— 推测大量下载棋谱不受开发者欢迎」 |
| 成功案例的节奏 | 「用 **15 或 30 秒**的请求间隔，下载了约 1.8 万盘」 |

**所以我们定三条死规矩**：

1. **绝不批量抓取** —— 只读**自己账号**的对局（`me/games`），不遍历别人的、不批量下棋谱
2. **必须处理 429** —— 收到就退避（指数退避），并在界面上如实提示"OGS 让我们慢一点"
3. **不做后台轮询** —— 只在用户打开 OGS 面板时拉取；间隔别密（长期对局本来就不要求实时）

> ⚠️ 这条要写进代码注释与帮助文档，免得以后有人（包括我）"顺手加个批量同步"把用户账号搞进黑名单。

---

## 十、需要首相拍板的决策点

| # | 事项 | 我的建议 |
|---|---|---|
| 1 | **做不做** | **做**，但先只做阶段 1（1~2 天见分晓） |
| 2 | **OGS 应用谁来注册** | **你来**（要你的 OGS 账号）。`client_id` 会写进代码；桌面应用走 PKCE，**不需要 secret**。我无法代注册 |
| 3 | **联网纪律怎么改** | 改成「除检查更新和 OGS 对弈外不出网」，并写明"不点不连" |
| 4 | **对局禁用分析** | 按红线做（合规底线） |
| 5 | **第一版范围** | 阶段 1~3（登录 + 只读 + 围观复盘）先出可用版；下棋放阶段 4 |
| 6 | **要不要引入 `goban`** | **不引入完整包**（Node 里根本加载不了，已实测）。长期对局走 REST 用不上它；**做实时对局时引入 `goban-engine`**（已实测能在纯 Node 连上 OGS） |
| 7 | **界面放哪** | 顶栏加「OGS」按钮，独立面板；不动现有界面结构 |
| 8 | **OGS 账号的合规提示怎么写** | 首次登录时明确告知"对局中用 AI 会封号、那是你的账号"，并写明软件会强制关闭分析 |

---

## 十一、必须自己实现的部分（OGS 不提供）

子代理把官方协议摸完后确认的缺口清单 —— **这些没有现成接口，都得我们写**：

| 要自己实现的 | 说明 |
|---|---|
| **棋盘渲染与规则逻辑** | OGS 不提供 UI 逻辑（官方那份在 npm `goban` 里）。我们**本来就有棋盘和规则引擎**，直接复用 ✅ |
| **「轮到我走」的聚合视图** | OGS 没有这个接口。要自己拼 `me/games` + 每盘的 `state/` |
| **托盘提醒 / 系统通知** | **OGS 没有系统级推送**（只有页面内通知 + 邮件）。长期对局最需要"轮到我"的提醒 → **自己做**（桌面客户端还能做到网页做不到的事） |
| **时钟显示与本地推进** | 服务器给时钟状态，但界面上的倒计时得自己走（长期对局对精度要求低，**比实时对局简单得多**） |
| **幂等 / 防重复落子** | 网络重试时别把同一手下去两次 |
| **429 退避** | 阈值不公开，保守处理（见「九」） |

**反过来，下面这些 OGS 直接给，不用自己造**：
登录（OAuth2+PKCE）· 对局状态 · 落子/停一手 · 棋谱 SGF · 邀请链接 · 私房 ACL · 好友 · 休假 · 通知接口

---

## 十二、未验证清单（施工前必须自己试出来）

| 项 | 为什么现在验不了 |
|---|---|
| 本地回环回调能否注册成正式回调 | 需要先有 OGS 应用（要你的账号） |
| ~~`gobo://` 自定义 scheme~~ | **已被社区实践排除**（论坛原话：*it doesn't allow custom URI schemes*） |
| `POST games/{id}/move/` 的**请求体格式** | 规范没写，要登录后实测 |
| `GET me/games/` 的响应结构 | 规范没写，要登录后实测 |
| `/oauth2/userinfo/` 带**有效** token 的行为 | 实测无 token 与伪造 token 都是 **404**（但文档明列该端点）；有效 token 未验 |
| OAuth 各 grant type 是否真启用 | schema 列了 implicit/password 等，实际是否开放未知 |
| 轮询能否满足长期对局的及时性 | 要真的下一盘 |
| OGS 的**速率限制具体阈值** | 无文档；实测 40 次未触发；2019 有封号先例 |
| ~~第三方客户端是否需审核~~ | **查不到任何审核流程**（应用自助注册；只有机器人账号要联系管理员） |
| **落子由哪个实时事件投递** | `ServerToClient` 里只有 `game/<id>/gamedata|clock|phase`，**没有独立 move 事件** —— 做实时对局时才需要搞清 |
| 实际对局时序（打劫 / 让子 / 停一手 / 数子） | 要真的下一盘 |
| 长期对局的**通知机制** | 已查明：只有页面内通知 + 邮件，**无系统推送** → 我们要自己做 |
| `min_ranking`/`max_ranking` 的取值语义 | 源码注释与文档互相矛盾（段位索引 vs Glicko 分） |
| 未文档化的 `termination-api` | 好用（直接给解析好的时限对象）但**无稳定性承诺** → **不当正式依赖** |

**这些不是"大概没问题"，是"必须试出来"。阶段 1~3 就是为了把它们变成确定答案。**

---

## 十三、现成的客户端与库（已核验）

出处：子代理逐个查了 GitHub/npm 的现状；标【实测】的是我自己跑过的。

### 13.1 ★★ 关键结论：别用完整的 `goban` 包，用 `goban-engine`

| 包 | 在我们环境里能用吗 | 证据 |
|---|---|---|
| **`goban`**（完整包，含棋盘 UI） | **不行** | 【实测】`build/goban.js:26` 是 `})(self, () => {` —— **UMD 把 `self` 写死**，纯 Node 里 `require` 直接 **`ReferenceError: self is not defined`**。补 DOM 也补不出来（接着报 `document` / `window.addEventListener` / `attachShadow`，需要真 jsdom）。官方有人 2024-07 报过（[goban#171](https://github.com/online-go/goban/issues/171)），**至今未修**。而且**没有 `exports` 字段**、不是 ESM |
| **`goban-engine`**（官方给的 Node 版） | **能用** ✅ | 【实测】纯 Node 22.22.2、零 DOM shim：**加载成功、70 个导出**（含 `GobanSocket`/`GobanEngine`/`protocol`/`BoardState`）；`new GobanSocket('wss://online-go.com/socket')` → **真的连上了 OGS** |
| **`ws`** | **不需要** ✅ | 【实测】我们的 Node **22.22.2 已内建全局 `WebSocket`**（`typeof WebSocket === 'function'`）→ **省一个依赖**（gtp2ogs 用它是因为要兼容老 Node） |

**结论：第一版（REST）什么都不用引入；做实时对局时引入 `goban-engine` 即可。**

### 13.2 别人是怎么做的（对我们的启示）

| 项目 | 语言 | 怎么连 | 值得我们学什么 |
|---|---|---|---|
| [Gobo](https://github.com/lasko/gobo) | Kotlin | **自研 WebSocket** + OAuth2+PKCE（redirect `gobo://oauth`） | **最贴近我们**：OAuth2 全链路，并把"不明显的地方"写进了 README |
| [Surround](https://github.com/honganhkhoa/Surround) | Swift | 自研 WS + **用户名密码**登录；已上架 App Store | 桌面级成熟度：`user/jwt` 中途换发、时钟 skew、重连状态机 |
| [gtp2ogs](https://github.com/online-go/gtp2ogs) | TS | `goban-engine` + `ws`，bot key | **Node 端官方样板**：重连/时钟/暂停的工程处理 |
| [Sabaki](https://github.com/SabakiHQ/Sabaki) | JS/**Electron** | **完全不支持 OGS** | Electron 做围棋桌面的先例；但只做本地 SGF + 挂 GTP 引擎，**零在线能力** |
| Sente / ogsdroid | Kotlin | socket.io 老协议 | **反面教材**：绑在旧协议上，迁移后要大改 |

**★ 一个重要观察：没有一个第三方客户端用完整的 `goban` 包** —— 大家都自研协议层或只用 `goban-engine`。
`goban` 的实际消费者只有 OGS 官网自己（而它跑在浏览器里，有真 DOM）。

### 13.3 ★★★ 登录后还要再换一次凭证（最容易踩的坑）

**`access_token` 不是 socket 的凭证！** 完整链路：

```
OAuth2 (PKCE) → access_token
                  ↓  Authorization: Bearer <access_token>
              GET https://online-go.com/api/v1/ui/config
                  ↓
              user_jwt          ← 这个才是 socket 的入场券
                  ↓  WebSocket 的 "authenticate" 消息里发 jwt 字段
              game/connect → 开下
```

**两个必须注意的点**：

1. **`authenticate` 里的 `jwt` 要填 `user_jwt`，不是 `access_token`** —— 填错就连不上
2. **服务器会中途换发新 JWT**（ServerToClient 有 `user/jwt` 事件）→ **必须处理轮换**，否则长连接会被踢

> 我们做「检查更新」时已经用过 `net.fetch`，`ui/config` 这一步是现成能力。

### 13.4 ★ 别人踩过的坑（有出处，施工时逐条对照）

| 坑 | 教训 |
|---|---|
| **重连后必须重新 `authenticate` + 重新 `game/connect`**，用服务器重推的 `gamedata` 重建棋盘 | 不重建就 **desync**（实测报错：`move_number is invalid. 113 !== 114`）。**绝不沿用本地 move_number** |
| **`goban` 的重连太激进**（`[50,50]→[100,300]→[250,750]`，到顶后永远 250-750ms 无限重试） | Gobo 自己加到 `[1000,2000]→[2000,5000]` **并加随机抖动**。我们照 Gobo 做 |
| **崩溃风暴防护**：连上不到 1 秒就断 → 直接退出 | gtp2ogs 的 `MIN_CONNECT_TIME = 1000` 就是这个用途 |
| **让子棋的棋子不在 move 列表里** | 「靠重放 move 重建棋盘」会**漏掉让子棋子**。<br>★ **我们的 REST 路线没这个问题**：`games/{id}/state/` 直接给整个 `board` 数组，让子棋子天然在里面 ✅ |
| **打劫没有专门消息** | 本地判 ko 只为**响应速度**，服务器才是权威。Gobo 原话：只做"自杀/简单劫"的轻量校验 |
| **终局石头移除是独立一套消息**（`game/removed_stones/set|accept|reject`） | 做实时对局时别漏这个阶段（Sente 的 MVP 就漏了） |
| **发棋可能静默失败** | 发完 move **要核对服务器回推的状态**，别假设成功 |
| **拿 `gamedata` 字段差异当"局面变了"的信号会出事** | gtp2ogs 因此引发过崩溃风暴（104 次重启、每秒千行日志）；`auto_score` 字段时有时无 |
| **协议有过破坏性变更** | 2017 年 `/ui/config` 删掉 `ggs_host` → 现成客户端全线找不到服务器；Socket.IO → 原生 WebSocket 是大换血。**要有"跟着改"的心理准备** |

### 13.5 限流的具体数字（之前只知"存在"，现在有出处）

| 出处 | 数字 |
|---|---|
| OGS 开发者 `anoek` 论坛原话（2021-08） | **SGF 导出端点限流 1/s** |
| 用户实测 | `/api/v1/game/` **约 2/s 就吃 429** |
| `anoek` 的建议 | 改用 `termination-api`，"**start at 20/s** and see how that goes" |
| 论坛帖（IP 被封真实案例） | 起因是**猛刷 SGF 端点**；结论"只是战术性封禁、不是政策"，当事人建议**避开 `sgf` 端点**（`moves` 已在 game data 里） |

**★ 对我们的含义**：对弈本身 REST 调用**极少**（登录 / `ui/config` / 挑战），主流量走 WebSocket → **限流风险低**。
把 IP 打爆的是**批量下载对局/SGF** —— 我们本来就不做（见「九」）。
**另外**：第 3 阶段（围观+复盘）要拉 SGF 时**别连着拉很多**；能复用 `state/` 或 `games/{id}` 的 `gamedata`，就别再单独请求 `sgf/`。

---

## 十四、相关文件

| 文件 | 内容 |
|---|---|
| `OGS对弈方案.md` | **本文件** —— 方案正文（规划定稿，v2） |
| `OGS调研笔记.md` | **实测原始记录**：每条命令与返回结果、接口字段、发现的坑 |
| `_OGS架构草稿.md` | 6 条架构决定的推理过程 —— **内容已并入本文件，可删** |
| `现状与待办.md` | 项目当前状态与待办（动工时把本方案挂进去） |

### 核验记录（谁验的）

| 结论 | 谁验的 |
|---|---|
| OGS 接口可读性、`state/`/`sgf/` 匿名可读、对局字段、时限参数、挑战/私密机制 | 我 + 子代理 1，各自实测 |
| OGS 27 个功能域、ToS 原文、防作弊机制、机器人政策 | 子代理 1（我复核了 ToS 原文，取自官方源码仓库） |
| `goban` 不能用 / `goban-engine` 能用 / Node 内建 WebSocket | 子代理 2 提出，**我全部实测复核** |
| 别人的坑（重连/时钟/让子/打劫/限流数字） | 子代理 2，**每条附出处** |
