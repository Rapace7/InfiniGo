# dev —— 开发与测试脚本（下载软件的人**不需要**这些）

这个目录是给**改代码的人**用的。软件本身只需要仓库根目录的那些文件
（`main.js`、`preload.js`、`renderer/`、`engine.cfg`、`package.json`）。

> 为什么单独放一个目录（2026-10-07）：这 50 多个脚本原来散在仓库根目录，
> GitHub 的仓库页会先列一长串文件、README 渲染在下面 —— 访客得滚半天才看到产品介绍。
> 搬进来之后根目录只剩 16 个文件。

## 文件分类

| 前缀 | 是什么 | 例子 |
|---|---|---|
| `_cdp_*.mjs` | **端到端测试**（驱动真界面，靠 CDP 调试端口） | `_cdp_regress.mjs`（综合回归，最常跑）、`_cdp_ko.mjs`（打劫/倒扑）、`_cdp_jump.mjs`（涨跌数字） |
| `_rtest.py` | **跑 CDP 测试的启动器**：拉起 Electron（带调试口）→ 跑脚本 → 截图 → 关掉 | — |
| `_lint_*.mjs` | **静态检查**（不需要跑界面） | `_lint_ids`（DOM id 对不上）、`_lint_ipc`（IPC 契约）、`_lint_hidden`（`[hidden]` 被 display 压过） |
| `_smoke.mjs` | 冒烟：把主要路径点一遍，看有没有运行时错误 | — |
| `_precheck.mjs` | 预检：CDP 脚本里的模板串会不会求值报错 | — |
| `_deploy.sh` / `_sync_deploy.ps1` | 发布：提交 + 打 tag + 发 Release / 同步到免解压版 | — |
| `_build_lazy.ps1` / `_update_lazy.ps1` | 重建懒人包 / 把新版程序拷进懒人包 | — |
| `_check_encodings.ps1` | 检查 `.bat` 的 BOM / CRLF / `%~dp0`（踩过好几次） | — |

## 怎么跑

所有脚本**都按自己所在位置推导路径**，所以从哪儿运行都行。

```bash
# 静态检查（秒级，改完代码先跑这个）
node dev/_lint_ids.mjs
node dev/_lint_ipc.mjs
node dev/_lint_hidden.mjs

# 端到端（会自己拉起软件、跑完关掉）
python dev/_rtest.py dev/_cdp_regress.mjs _trash/_shot.png
```

`_rtest.py` 的参数顺序是 `<_测试脚本> <截图名> [第二段脚本] [第二张截图名]` ——
⚠️ **第 2 个位置参数是截图名**，所以测试脚本要的参数得走**环境变量**传
（`_cdp_shot2.mjs`、`_cdp_stuck.mjs` 就是这么做的）。

## 环境要求

- **Node.js**（脚本用 `import`，要 ESM 支持）
- **Python 3**（只给 `_rtest.py` 用；它只用标准库，不需要 pip 装东西）
- `node_modules`（`npm install`）—— `_rtest.py` 要用里面的 `electron` 跑界面

## 两条纪律

1. **`.ps1` / `.bat` 必须 UTF-8 带 BOM + CRLF** —— Windows PowerShell 5.1 读无 BOM 的
   UTF-8 会当 GBK，中文注释一变乱码整段语法就崩。用编辑器改完 `.ps1` 记得补 BOM
   （`_check_encodings.ps1` 会查）。
2. **测试的判据比被测代码更容易写错**。本项目有多次"测试报 ★，其实是判据错了"的记录
   （拿 GBK 字节比 UTF-8、用不存在的字段当等待条件、把观察者效应当成被测行为）。
   写判据时先确认：**字段真的存在吗？口径对吗？**
