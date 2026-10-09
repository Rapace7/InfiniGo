# macOS 版本方案

> 定稿：2026-10-09
> 状态：**代码已改造完，待 Actions 出包验证**

## 零、首相拍板的四条（2026-10-09）

1. 开发者**没有 Mac 机器**
2. **不出预编译 Mac 包** —— 让 Mac 用户自己打包
3. **引擎由 Mac 用户自行下载配置**
4. **GitHub 上要给出提示和指引**

---

## 一、起因

| Issue | 谁 | 说了什么 |
|---|---|---|
| **#2** | Jason-Sun 提，**zhenli789** 补充 | zhenli789 原话：*「katago 引擎有原生 mac metal 版本。网上找了一圈，目前这个是**唯一一个可以通过本地模型进行自然语言棋局讲解的 AI 围棋软件**，如果能有 mac 版本就最好了」* |

**值得做的理由**：用户点出的那句是真差异化 —— **本地模型 + 自然语言讲解**，Mac 上没有第二家。

---

## 二、可行性：三个条件全部成立（都实测/查证过）

### 2.1 KataGo 在 Mac 上有现成的、带 Metal 的构建

**关键事实：KataGo 官方 Release 里一个 macOS 构建都没有**
（核过 v1.18.1 / v1.18.2 的资产清单，macOS 相关资产 **0 个**）。
**Homebrew 是 Mac 上唯一的省事途径**：

| 项目 | 实测结果 |
|---|---|
| `brew install katago` | formula 版本 **1.18.2**（与 Windows 版同代） |
| keg-only | 否 → 直接进 PATH |
| 二进制位置 | `/opt/homebrew/bin/katago`（Apple Silicon）<br>`/usr/local/bin/katago`（Intel） |
| **编译后端** | **`-DUSE_BACKEND=METAL`**（读 formula 源码确认） |
| 兜底 | 同 formula 还有 `-DUSE_BACKEND=EIGEN`（纯 CPU）分支 |
| 预编译瓶 | `arm64_sequoia` / `arm64_tahoe` / `arm64_golden_gate` → Apple Silicon 免编译<br>⚠️ **没有 x86_64 macOS 瓶** → Intel Mac 要源码编译（很久） |

### 2.2 LoGos 的运行时（llama.cpp）有官方 Mac 包

| 资产 | 大小 |
|---|---|
| `llama-bXXXXX-bin-macos-arm64.tar.gz` | **11.5 MB** |
| `llama-bXXXXX-bin-macos-x64.tar.gz` | 11.1 MB |

解包内容（下载看过）：
```
llama-server                      ← 真程序（49,984 字节）
libllama-server-impl.dylib        ← 实现（9.2 MB）
libggml-metal.0.26.0.dylib        ← ★ Metal 后端（5.3 MB）
libggml-cpu / blas / rpc / base …
```

**★ LoGos 的 `.gguf` 模型跨平台同一份** —— Mac 用户下 Windows 那份即可（约 4.4 GB），
**不需要重新分发模型**。

### 2.3 Electron 本身跨平台

Electron 44 + electron-builder 26.15.3 原生支持 `--mac`，**代码是同一份**。

---

## 三、代码改造（已完成，逐处可查）

### 3.1 集中化的平台常量（main.js 顶部）

```js
const WIN = process.platform === 'win32';
const EXE = WIN ? '.exe' : '';
const KATAGO_BIN = 'katago' + EXE;
const LLAMA_BIN  = 'llama-server' + EXE;
```

**为什么集中**：原来 9 处各自写死 `'katago.exe'` / `'llama-server.exe'`，
散在 123 / 144 / 228 / 231 / 413 / 1754 / 1829 / 2005 / 2006 行 —— **漏一处就是「引擎找不到」**。

### 3.2 改动清单（全部已落地）

| 处 | 内容 |
|---|---|
| 7 处 | 拼引擎路径 / 自动换引擎 → 用 `KATAGO_BIN` / `LLAMA_BIN` |
| 2 处 | 报错文案（"找不到 katago.exe"）→ 按平台显示 |
| 2 处 | 文件选择对话框标题（"选择 katago.exe"）→ 按平台显示 |
| 新增 | **`setupAppMenu()`** —— macOS 应用菜单（Mac 上没它按不出 ⌘Q、复制粘贴失效） |
| 新增 | `package.json` 的 **`build.mac`** + `dist:mac` 脚本 |
| 新增 | `.github/workflows/build-macos.yml` |
| 文档 | README 中英双语 Mac 章节（原 6 处"不支持"改掉） |

### 3.3 已经做好、不用改的

| 位置 | 现状 |
|---|---|
| `detectGpuBrandSync` | 已 `if (process.platform !== 'win32') return ''` |
| 桌面快捷方式 | 已 `if (process.platform !== 'win32') return { error: '只在 Windows 上支持' }` |
| 窗口关闭行为 | 已有 `if (process.platform !== 'darwin') app.quit()` |
| 快捷键 | renderer **已同时判断** `ctrlKey` 与 `metaKey` → ⌘ 可用 |
| 引擎自检 | `BACKEND_HINTS` 里**已有 `metal` 条目**（`brand: 'apple'`）→ 能认出 Mac |

---

## 四、分发：靠 GitHub Actions 的 macOS 机器

**Windows 上做不出 mac 包** —— electron-builder 明确拒绝（实测报错
「Build for macOS is supported only on macOS」）。我们又没有 Mac，
所以用 **GitHub Actions 的免费 macOS runner**。

工作流 `.github/workflows/build-macos.yml` 的要点：

| 设置 | 为什么 |
|---|---|
| `runs-on: macos-latest` | 借 Mac 机器 |
| `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` | **关键**：不去找签名证书，直接出未签名包（否则 builder 会尝试签名然后失败） |
| `hardenedRuntime: false` + `gatekeeperAssess: false` | 未签名包必须关掉，否则校验失败 |
| `arch: [arm64, x64]` | 两种 Mac 都覆盖 |
| 产物 | `RapaceGo-mac-arm64.zip` / `RapaceGo-mac-x64.zip` |
| 触发 | 推 `v*` tag 自动挂 Release；也可手动 `workflow_dispatch` |

**产出是未签名包**，用户第一次打开会被 Gatekeeper 拦 —— README 里已写明怎么绕过。

---

## 五、Mac 用户要做的四步（README 已写入，中英双语）

```bash
# ① 装引擎
brew install katago                    # Metal 后端，Apple Silicon 原生
katago version                         # 应输出 "Using Metal backend"
# ② 下 llama.cpp 的 mac 包（~11 MB）+ LoGos 模型（~4.4 GB）
# ③ 打包
git clone https://github.com/Rapace7/RapaceGo.git && cd RapaceGo
npm install && npm run dist:mac
# ④ 过 Gatekeeper（未签名的正常现象）
xattr -cr /Applications/RapaceGo.app
```

然后在「设置」里指三个路径：
`/opt/homebrew/bin/katago` · 解压出来的 `llama-server` · `LoGos-7B-Q4_K_M.gguf`

---

## 六、能验的 / 不能验的（诚实清单）

### 已在本机（Windows）验过

| 项 | 结果 |
|---|---|
| Windows 版没被改坏 | 单测 **12 / 1 / 7 / 1 全过**；3 个 lint **全 0** |
| `main.js` 语法 | ✓ |
| `package.json` 合法、`build.win` 完好 | ✓ |
| mac 配置能被 electron-builder 读懂 | ✓（报的是"只能在 macOS 上构建"，**不是配置错**） |

### **没验过**（必须靠 Mac 用户反馈）

| 项 | 风险 |
|---|---|
| Actions 能否一次跑通出包 | 中 —— Mac 打包本地试不了 |
| KataGo Metal 与软件配合 | 低 —— `katago version` 能跑就说明引擎侧没问题 |
| LoGos 在 Mac 上加载 4.4 GB 模型 | 中 —— 统一内存的 Mac 理论上可以，**没实测** |
| ⌘ 快捷键全部生效 | 中 |
| 中文界面 / 字体 | 低 |

---

## 七、已知限制（必须写进指引，不能藏）

1. **只承诺 Apple Silicon** —— Homebrew 没 x86_64 macOS 瓶，Intel 用户要源码编译。
2. **未签名** —— 用户要手动过 Gatekeeper；要消除得买 Apple 开发者账号（$99/年）。
3. **开发者无法复现用户问题** —— 没有 Mac。只能靠对方贴终端输出。

---

## 八、为什么不走 GitHub Actions + 正式签名公证

需求还不够大。等 Mac 用户数上来（比如 10 人以上要）再考虑买开发者账号 ——
那时候只需在现有 workflow 里加证书 secret，其余不用改。

---

## 九、相关文件

| 文件 | 内容 |
|---|---|
| `main.js` | 平台常量 / `setupAppMenu()` / 9 处改造 |
| `package.json` | `build.mac` / `dist:mac` |
| `.github/workflows/build-macos.yml` | macOS 打包工作流 |
| `README.md` / `README.en.md` | Mac 章节（🍎 macOS 用户请看这里） |
| `dev/_rtest.py` | 回归测试入口（支持 `RAPACEGO_EXE` 指定打包版 exe） |
