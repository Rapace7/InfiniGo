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
if [ -z "$MSG" ]; then
  echo "用法：bash _deploy.sh \"这次改了什么\""
  exit 1
fi

cd "$(dirname "$0")"
N="C:/Users/rapac/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
GH="/c/Program Files/GitHub CLI/gh.exe"
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

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
npm run dist 2>&1 | grep -E "building|packaging|error|Error" | tail -4

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
  echo "  ✓ 已同步到 $DEPLOY_DIR（$(du -sh "$DEPLOY_DIR" 2>/dev/null | cut -f1)）"
  echo "    保留：settings.json（引擎路径）、records/（你的棋谱）"
  # ★ 立刻删掉中间产物：它和正式版内容完全相同，留着白占 376MB，
  #   而且用户可能误点那个 exe（下次打包它会消失 → 快捷方式突然失效）。
  rm -rf dist/win-unpacked
  echo "    已删除中间产物 dist\\win-unpacked（省 376MB，避免误点）"
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
# ★ 发布说明用一个**版本无关**的固定文件（下载 / 更新 / 引擎自备 / 硬件 / 说明）——
#   这样每次发布不用重写一遍，也不会漏掉「怎么更新」这类必需信息。
#   版本号本身由 --title 体现。
NOTES="发布说明.md"
if "$GH" release view "$TAG" --repo Rapace7/RapaceGo > /dev/null 2>&1; then
  echo "  Release $TAG 已存在 → 覆盖资产 + 刷新说明"
  # ★ 只上传 zip：2026-10-06 起不再出 portable 单文件版（实测慢 400 倍且不便携）
  for f in dist/RapaceGo.zip; do
    [ -f "$f" ] || continue
    echo "  上传 $f"
    "$GH" release upload "$TAG" "$f" --repo Rapace7/RapaceGo --clobber 2>&1 | tail -1
  done
  if [ -f "$NOTES" ]; then
    "$GH" release edit "$TAG" --repo Rapace7/RapaceGo --notes-file "$NOTES" > /dev/null 2>&1 \
      && echo "  说明已刷新（$NOTES）"
  fi
  echo "  Release $TAG 已更新"
else
  # 新版本：自动建一个新的 Release（旧版本的留在列表里当历史，别覆盖 —— 
  # 用户靠「最上面那条」判断有没有更新，也要能看到自己那条）
  echo "  Release $TAG 不存在 → 新建"
  if [ -f "$NOTES" ]; then
    "$GH" release create "$TAG" dist/RapaceGo.zip \
      --repo Rapace7/RapaceGo \
      --title "$TAG" \
      --notes-file "$NOTES" 2>&1 | tail -2
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
