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
# ============================================================
set -e

MSG="${1:-}"
if [ -z "$MSG" ]; then
  echo "用法：bash _deploy.sh \"这次改了什么\""
  exit 1
fi

cd "$(dirname "$0")"
N="C:/Users/rapac/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
GH="/c/Program Files/GitHub CLI/gh.exe"
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

echo "=== 1/5 语法与静态检查 ==="
for f in main.js preload.js renderer/app.js; do "$N" --check "$f"; done
echo "  JS 语法 OK"
"$N" _lint_ids.mjs    | sed -n '5,7p'
"$N" _lint_hidden.mjs | grep -A2 "隐患" || true
"$N" _lint_ipc.mjs    | sed -n '5,8p'

echo
echo "=== 2/5 打包 ==="
rm -rf dist/win-unpacked dist/*.exe dist/*.zip
npm run dist 2>&1 | grep -E "building|packaging|error|Error" | tail -4

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
echo "=== 5/5 更新 Release 资产（--clobber 覆盖同名的）==="
VER=$(grep -o '"version": *"[^"]*"' package.json | head -1 | cut -d'"' -f4)
TAG="v${VER}"
if "$GH" release view "$TAG" --repo Rapace7/RapaceGo > /dev/null 2>&1; then
  # ★ 只上传 zip：2026-10-06 起不再出 portable 单文件版（实测慢 400 倍且不便携）
  for f in dist/RapaceGo.zip; do
    [ -f "$f" ] || continue
    echo "  上传 $f"
    "$GH" release upload "$TAG" "$f" --repo Rapace7/RapaceGo --clobber 2>&1 | tail -1
  done
  echo "  Release $TAG 已更新"
else
  echo "  Release $TAG 还不存在 —— 首次发布请手动跑 gh release create"
fi

echo
echo "============================================================"
echo " 完成。仓库：https://github.com/Rapace7/RapaceGo"
echo "============================================================"
