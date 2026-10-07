#!/usr/bin/env bash
# ============================================================
#  玄清围弈 · 一键发布
#  改完代码后跑这一条，全套都同步到 GitHub：
#     静态检查 → 打包 → 提交 → 推送 → 更新 Release 资产
#
#  用法：
#     bash _deploy.sh "这次改了什么（一句话）"
#
#  ★ 为什么用文件传 commit message：MSYS 的 heredoc 传中文给 git
#    会把个别字变成乱码（踩过一次：「硬件」→「硬��」）。
#
#  ★★ package.json 是**纯 JSON，一行注释都不能加**（2026-10-06 踩过）：
#    npm 与 electron-builder 都用严格的 JSON.parse 解析它，
#    /* */ 和 // 都会报 `Expected property name or '}' in JSON at position 819`，
#    表现是「打包第一步就失败」，而 commit 照样成功（容易误以为发布完了）。
#    → 要给配置写说明，放到本文件或开发记录里，别放进 package.json。
#
#  ★ 产物形态：只出 `RapaceGo.zip`（2026-10-06 起）。
#    曾经还有个 portable 单文件 `RapaceGo.exe`，**已砍掉**，原因（实测，非推测）：
#      · portable 每次启动把 96MB 解压成 376MB 扔进 %TEMP% 随机目录 → **120 秒**；
#        zip 版解压完启动只要 **0.3 秒**（慢 400 倍）。
#      · 它和「便携」相反：exe 在 C 盘临时目录 → 引擎找不到、棋谱也存到那儿，
#        整个文件夹拷不走。zip 版才是「一个文件夹，拷走就能用、删掉即彻底卸载」。
#    要恢复：package.json 里加回
#        "target": [ { "target": "portable", ... }, { "target": "zip", ... } ]
#    并在本脚本第 5 步的 for 列表里加回 dist/RapaceGo.exe。
# ============================================================
set -e

MSG="${1:-}"
# ★ 防呆：提交标题取的是 $1 的**第一行**，而发布说明是整段。
#   如果直接把整段说明传给 $1（像 2026-10-06 那样用 heredoc 传），
#   提交标题会变成说明的第一行 —— 实测提交成了「## 这一版改了什么（v0.1.8）」。
#   这里显式拦一下：$1 看起来像整段说明（多行 / 以 # 开头）就提醒，
#   应该写成「第一行是标题，其余是说明」的形式。
if [ -n "$MSG" ] && printf '%s\n' "$MSG" | head -1 | grep -qE '^#{1,2} '; then
  echo "  ★ 提交标题会取 \$1 的第一行，而 \$1 看起来是一整段说明。"
  echo "    正确写法：\$1 第一行写标题（如 'v0.1.9：修…'），空行之后写详细说明。"
  echo "    继续发布，但提交标题可能不是你想要的。"
fi
if [ -z "$MSG" ]; then
  echo "用法：bash _deploy.sh \"这次改了什么\""
  exit 1
fi

cd "$(dirname "$0")"
N="C:/Users/rapac/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
GH="/c/Program Files/GitHub CLI/gh.exe"
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

# ============================================================
# ★ 2026-10-06 深夜补：本脚本原来假设 PATH 里已经有 npm / git ——
#   在 DSH（本机新用的开发环境）里**不成立**，三处全断：
#     · npm 没装（node 是 .workbuddy 下的绿色版）→ `npm run dist` 直接失败
#     · git 不在 PATH（在 .workbuddy 的 PortableGit 里）
#     · bash 也不在（同前）
#   于是「打包那步失败、而 commit 照样成功」的坑会再来一次 ——
#   所以这里显式把三样都定位好，不依赖外部 PATH。
# ============================================================
PORTABLE_GIT="C:/Users/rapac/.workbuddy/binaries/PortableGit/versions/1.2.0"
if [ -x "$PORTABLE_GIT/cmd/git.exe" ]; then
  export PATH="$PORTABLE_GIT/cmd:$PATH"
  echo "  已把 PortableGit 加进 PATH（$(git --version 2>/dev/null || echo 取不到版本)）"
else
  echo "  ★ 找不到 PortableGit 的 git.exe —— 后面的提交/推送会失败：$PORTABLE_GIT"
fi
# npm 不存在时直接调 electron-builder 的 CLI（等价于 `npm run dist` = `electron-builder --win`）
EB_CLI="node_modules/electron-builder/out/cli/cli.js"
if command -v npm >/dev/null 2>&1; then
  BUILD_CMD="npm run dist"
else
  BUILD_CMD="\"$N\" $EB_CLI --win"
  echo "  没有 npm → 直接用 electron-builder CLI 打包（等价于 npm run dist）"
fi

echo "=== 1/5 语法与静态检查 ==="
for f in main.js preload.js renderer/app.js; do "$N" --check "$f"; done
echo "  JS 语法 OK"
# ★ package.json 必须是**纯 JSON**（一行注释都不行）。踩过：加了注释之后打包第一步就失败，
#   但 commit 和 push 照样成功 → 看起来"发布完了"，其实包根本没打出来。
if ! "$N" -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" 2>/dev/null; then
  echo "  ★★ package.json 不是合法 JSON（多半是加了注释）—— 打包会失败，先修。"
  "$N" -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" || true
  exit 1
fi
echo "  package.json 合法"
# ★★ .bat 的编码与换行**必须**检查（2026-10-06 连踩两次，都发包出去了）：
#   ① 换行必须是 CRLF —— 实测 LF 的 .bat 会让 cmd 把 echo 拆成「ho」、把中文当命令名，
#      报一堆「不是内部或外部命令」（一键安装脚本直接跑不起来）。
#   ② 编码必须是 **UTF-8 带 BOM** —— 实测同一个文件：
#        无 BOM + chcp 65001 → 4 条 "is not recognized"（中文注释被当命令）
#        带 BOM + chcp 65001 → 0 条 ✓
#   为什么要写成检查而不是「记住」：这两种错在开发时完全看不出来，
#   只有用户跑到那一步才暴露 —— 而用户看到的是「软件坏了」。
#   ★ BOM 只在**文件里有非 ASCII 字符**（比如中文）时才要求 ——
#     纯英文的 .bat（如 start.bat）不需要，加了也对但不必要。
#     第一版检查没区分这点，把 start.bat 误报成错，特此修正。
for b in *.bat; do
  [ -f "$b" ] || continue
  # 数 0x0d（CR）字节 —— 别用 grep '\r' 之类：不同调用方式下反斜杠会被吃掉/加倍，
  # 结果可能变成「匹配字母 r」而**假通过**（我自己先踩了这个，白测一轮）。
  cr=$(od -An -tx1 "$b" | tr ' ' '\n' | grep -c '^0d' || true)
  if [ "${cr:-0}" -eq 0 ]; then
    echo "  ★★ $b 不是 CRLF 换行 —— cmd 会解析坏（实测 echo 被拆开）。先修再发。"
    exit 1
  fi
  # 数一下 0x80 以上的字节（od 出的十六进制里以 8~f 开头的）
  nonascii=$(od -An -tx1 "$b" | tr ' ' '\n' | grep -c '^[89abcdef]' || true)
  if [ "${nonascii:-0}" -gt 0 ]; then
    if [ "$(head -c3 "$b" | od -An -tx1 | tr -d ' \n')" != "efbbbf" ]; then
      echo "  ★★ $b 含中文但没有 UTF-8 BOM —— cmd 会把中文当命令（实测 4 条报错）。先修再发。"
      exit 1
    fi
  fi
done
echo "  .bat 换行与 BOM OK"
# ★ 打包前必须确认没有 RapaceGo 在运行：它会占着 dist\RapaceGo.exe，
#   7-Zip 读不了 → portable 构建失败（zip 却正常，容易误判成"偶发"）。
if tasklist //FI "IMAGENAME eq RapaceGo.exe" 2>/dev/null | grep -q RapaceGo.exe; then
  echo "  ★ 警告：RapaceGo.exe 正在运行，会占住 dist 导致构建失败。请先关掉它。"
fi
"$N" _lint_ids.mjs    | sed -n '5,7p'
"$N" _lint_hidden.mjs | grep -A2 "隐患" || true
"$N" _lint_ipc.mjs    | sed -n '5,8p'

echo
echo "=== 2/5 打包 ==="
rm -rf dist/win-unpacked dist/*.exe dist/*.zip
eval "$BUILD_CMD" 2>&1 | grep -E "building|packaging|error|Error" | tail -4

# ---- 2b/5 同步到「正式版」目录 ----------------------------------------
# ★ 为什么要这一步（2026-10-06 用户定的分工）：
#   · D:\GoStudy\RapaceGo\      = **开发目录**（源代码 + node_modules，我改代码用）
#   · D:\GoStudy\玄清围弈\       = **正式版**（用户双击用；exe 在根目录，引擎在同级）
#   两者必须分开：开发目录里没有可双击的 exe（要走 npm 起）。
#   用户明确要求：**每次打包直接覆盖旧版，不用保留**（旧版本身有问题）。
#
# ★ 问过「为什么不直接让打包器输出到玄清围弈」—— 查了 electron-builder 源码：
#   appOutDir 是 `path.join(outDir, "win-unpacked")` **拼出来的硬编码目录名**，
#   改不了。所以只能「打包 → 复制过去 → 删掉中间产物」。
#   但复制 376MB 实测只要 **0.3 秒**，中间那步根本不花时间；
#   真正要避免的是**复制完把源留在那儿白占 376MB**（之前就是这个问题）。
DEPLOY_DIR="D:/GoStudy/玄清围弈"
if [ -d dist/win-unpacked ]; then
  echo
  echo "=== 2b/5 同步到正式版目录 ==="
  # 先清掉上一次同步的**程序文件与资源**（保留 settings.json —— 里面是你配好的
  # 引擎路径，删了要重新设置；保留 records\ —— 你的棋谱）
  if [ -d "$DEPLOY_DIR" ]; then
    find "$DEPLOY_DIR" -maxdepth 1 -mindepth 1 \
      ! -name settings.json ! -name records \
      -exec rm -rf {} + 2>/dev/null
  else
    mkdir -p "$DEPLOY_DIR"
  fi
  cp -r dist/win-unpacked/. "$DEPLOY_DIR/"
  # ★ 正式版要额外带一个 start.bat —— electron-builder 不会生成它。
  #   作用只有一个：先 `set ELECTRON_RUN_AS_NODE=` 再启动。
  #   这个变量一旦是 1，Electron 会把自己当成普通 Node 跑，报
  #     "Cannot read properties of undefined (reading 'isPackaged')" 后立刻退出
  #   —— 症状是「双击没反应」，很难自己想到是这个变量。
  #   为什么必须在这里重建：上面那步 rm -rf 会把正式版目录清空（只留 settings/records），
  #   手放的 start.bat 下次发布就没了 —— 踩过一次。
  #   编码规矩（见文件里 .bat 检查那段）：**纯英文注释 + 无 BOM + CRLF**。
  #   ★ 不能加 BOM：加了之后 cmd 会把第一行读成 '﻿@echo' →
  #     报「'﻿@echo' 不是内部或外部命令」（实测）。中文注释也不行——
  #     start.bat 不 chcp，注释里的中文在 cmd 里是乱码。
  {
    printf '@echo off\r\n'
    printf 'rem ============================================================\r\n'
    printf 'rem  XuanQing WeiYi - double-click to launch\r\n'
    printf 'rem  Uses RapaceGo.exe in this same folder.\r\n'
    printf 'rem\r\n'
    printf 'rem  WHY CLEAR ELECTRON_RUN_AS_NODE FIRST:\r\n'
    printf 'rem    When it is 1, Electron runs itself as plain Node and exits\r\n'
    printf 'rem    with "Cannot read properties of undefined (reading isPackaged)".\r\n'
    printf 'rem    Symptom: double-click does nothing.\r\n'
    printf 'rem    Some AI toolchains / terminals set it, so just clear it.\r\n'
    printf 'rem ============================================================\r\n'
    printf 'set ELECTRON_RUN_AS_NODE=\r\n'
    printf 'cd /d "%%~dp0"\r\n'
    printf 'start "" "%%~dp0RapaceGo.exe"\r\n'
  } > "$DEPLOY_DIR/start.bat"
  echo "  ✓ 已生成 start.bat（先清 ELECTRON_RUN_AS_NODE 再启动）"
  echo "  ✓ 已同步到 $DEPLOY_DIR（$(du -sh "$DEPLOY_DIR" 2>/dev/null | cut -f1)）"
  echo "    保留：settings.json（引擎路径）、records/（你的棋谱）"
  # ★ 立刻删掉中间产物：它和正式版内容完全相同，留着白占 376MB，
  #   而且用户可能误点那个 exe（下次打包它会消失 → 快捷方式突然失效）。
  #   ★ 2026-10-06 深夜例外：在 DSH 环境下**保留**它 —— 用户要能随时
  #     「看用户下载解压后的版本长什么样」，不想每次都去开正式版目录。
  #     要恢复"省 376MB"的老行为：设 KEEP_UNPACKED=0 再跑本脚本。
  if [ "${KEEP_UNPACKED:-1}" = "0" ]; then
    rm -rf dist/win-unpacked
    echo "    已删除中间产物 dist\\win-unpacked（省 376MB，避免误点）"
  else
    echo "    已保留 dist\\win-unpacked（用户要能随时对比"解压后是什么样"；"
    echo "      想省 376MB 就设 KEEP_UNPACKED=0）"
  fi
  # 快捷方式要重建才指向新位置（指向旧的 exe 路径不会自动更新）
  rm -f "$USERPROFILE/Desktop/玄清围弈.lnk" 2>/dev/null || true
else
  echo "  ★ 没有 dist\win-unpacked，跳过同步"
fi

echo
echo "=== 3/5 提交 ==="
git add -A
if git diff --cached --quiet; then
  echo "  没有改动，跳过提交"
else
  # ★ message 走文件（heredoc 传中文会乱码）
  printf '%s\n\n%s\n' "$MSG" "$(git diff --cached --stat | tail -20)" > .git/_msg.txt
  git commit -q -F .git/_msg.txt
  echo "  已提交：$(git log --oneline -1)"
fi

echo
echo "=== 4/5 推送 ==="
TOKEN=$("$GH" auth token)
git push "https://x-access-token:${TOKEN}@github.com/Rapace7/RapaceGo.git" main:main 2>&1 | tail -2

echo
echo "=== 5/5 发布 Release ==="
# ★ 版本号只在 package.json 一处维护；tag 与它同名（v0.1.1 这样）。
#   版本号规则（2026-10-06 与用户定的）：
#     第三位 = 修 bug / 小改动，**每次发布 +1**（可以频繁）
#     第二位 = 攒够一个「用户能感觉到的新功能」才 +1
#     第一位 = 只有 1.0.0（稳定到能推荐给任何人）
VER=$(grep -o '"version": *"[^"]*"' package.json | head -1 | cut -d'"' -f4)
TAG="v${VER}"
# ---------- Release 说明 = 「版本专属」+「通用」两份拼起来 ----------
# ★ 2026-10-06 修一个静默丢失的缺陷：
#   原来**只用** 发布说明.md（版本无关的通用内容），而每次发布我详细写的
#   「这一版改了什么」被**静默丢弃** —— 用户在 Release 页面永远看不到
#   为什么该升级（v0.1.1 到 v0.1.7 全是这样）。
#   现在：命令行第一个参数（本次发布说明）写在**最前面**（用户最先看到的），
#   通用下载/更新/硬件说明接在后面。
# ★ 为什么用临时文件而不是 --notes：--notes 传多行会被 shell 拆坏；
#   而反引号在双引号里会被当命令执行（实测把 `zz` 那行吞了，还只打一行 stderr）。
NOTES_COMMON="发布说明.md"
NOTES_TMP="$(mktemp)"
trap 'rm -f "$NOTES_TMP"' EXIT
if [ -n "${1:-}" ]; then
  printf '%s\n\n' "$1" > "$NOTES_TMP"
fi
if [ -f "$NOTES_COMMON" ]; then
  cat "$NOTES_COMMON" >> "$NOTES_TMP"
fi
if [ ! -s "$NOTES_TMP" ]; then
  echo "  ★ 没有说明可发（既没给本次说明，也没有 $NOTES_COMMON）—— 用 --generate-notes 兜底"
  NOTES_TMP=""
fi
echo "  说明行数：$(wc -l < "$NOTES_TMP" 2>/dev/null || echo 0)"

if "$GH" release view "$TAG" --repo Rapace7/RapaceGo > /dev/null 2>&1; then
  echo "  Release $TAG 已存在 → 覆盖资产 + 刷新说明"
  # ★ 只上传 zip：2026-10-06 起不再出 portable 单文件版（实测慢 400 倍且不便携）
  for f in dist/RapaceGo.zip; do
    [ -f "$f" ] || continue
    echo "  上传 $f"
    "$GH" release upload "$TAG" "$f" --repo Rapace7/RapaceGo --clobber 2>&1 | tail -1
  done
  if [ -n "$NOTES_TMP" ]; then
    "$GH" release edit "$TAG" --repo Rapace7/RapaceGo --notes-file "$NOTES_TMP" > /dev/null 2>&1 \
      && echo "  说明已刷新（含本次改动）"
  fi
  echo "  Release $TAG 已更新"
else
  # 新版本：自动建一个新的 Release（旧版本的留在列表里当历史，别覆盖 ——
  # 用户靠「最上面那条」判断有没有更新，也要能看到自己那条）
  echo "  Release $TAG 不存在 → 新建"
  if [ -n "$NOTES_TMP" ]; then
    "$GH" release create "$TAG" dist/RapaceGo.zip \
      --repo Rapace7/RapaceGo \
      --title "$TAG" \
      --notes-file "$NOTES_TMP" 2>&1 | tail -2
  else
    "$GH" release create "$TAG" dist/RapaceGo.zip \
      --repo Rapace7/RapaceGo --title "$TAG" --generate-notes 2>&1 | tail -2
  fi
  echo "  已创建 Release $TAG"
fi

echo
echo "============================================================"
echo " 完成。仓库：https://github.com/Rapace7/RapaceGo"
echo "============================================================"
