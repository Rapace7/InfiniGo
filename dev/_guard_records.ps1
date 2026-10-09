# ============================================================
#  端到端测试的**安全护栏** —— 跑任何 CDP 测试之前用它，跑完还原
#
#  为什么必须要有（2026-10-07 踩的，代价是动了用户的棋谱）：
#    `_rtest.py` 启动的是**开发目录**的 Electron，但开发目录的 `records\`
#    是空的，所以有些测试会去读/写「免解压版」的棋谱目录
#    （`D:\GoStudy\玄清围弈\records`）—— 那是**用户自己的棋谱库**。
#    结果：用户那份 `20261007-155056-34手.sgf`（他用来报打劫 bug 的）
#    在测试期间从目录里消失，最后是从 `_backup_玄清围弈_*` 和回收站里捞回来的。
#
#  规矩：**测试永远不碰用户的活目录**。这个脚本的做法是最土但最可靠的一种——
#    先把用户 records 整个挪到一边，测试跑完再挪回来。
#    中途就算测试把 records 清空了，也不影响他的原始数据。
#
#  用法：
#     powershell -File _guard_records.ps1 -Save     # 跑测试前：把用户 records 收起来
#     powershell -File _guard_records.ps1 -Restore  # 跑完：原样放回
#     powershell -File _guard_records.ps1 -Status   # 看当前状态
# ============================================================
param(
  [switch]$Save,
  [switch]$Restore,
  [switch]$Status
)

# ★ 路径自适应（2026-10-09）：不再写死盘符，从脚本位置往上找工作区根
. "$PSScriptRoot\_paths.ps1"
$ErrorActionPreference = 'Stop'

$LIVE  = Join-Path $WDeploy 'records'          # 用户的棋谱库（活目录，不能碰）
$STASH = Join-Path $WRoot '_user_records_stash'       # 测试期间暂存处
$MARK  = Join-Path $STASH '_stashed.flag'

function Show-Status {
  $live = if (Test-Path $LIVE) { (Get-ChildItem $LIVE -Force -File).Count } else { '(目录不存在)' }
  $stash = if (Test-Path $STASH) { (Get-ChildItem $STASH -Force -File).Count } else { '(无暂存)' }
  Write-Host "活目录 $LIVE : $live 个文件"
  Write-Host "暂存处 $STASH : $stash 个文件"
  Write-Host ("状态: " + $(if (Test-Path $MARK) { '★ 测试进行中（用户数据在暂存处）' } else { '正常（没有正在跑的测试）' }))
}

if ($Status -or (-not $Save -and -not $Restore)) { Show-Status; return }

if ($Save) {
  if (Test-Path $MARK) { Write-Host '★ 已经收起来过了（暂存处还在）—— 先 Restore 再 Save' -ForegroundColor Yellow; Show-Status; return }
  if (Test-Path $STASH) { Remove-Item $STASH -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $STASH | Out-Null
  if (Test-Path $LIVE) {
    Get-ChildItem $LIVE -Force -File | Where-Object { $_.Name -ne '_stashed.flag' } | ForEach-Object { Move-Item $_.FullName $STASH -Force }
    Write-Host ("已收起 " + (Get-ChildItem $STASH -Force -File).Count + " 个文件（测试期间用户数据是安全的）")
  } else {
    Write-Host '活目录不存在，没什么可收的'
  }
  # 给测试留一个**空的** records（测试可能往里写，写完一起清掉就行）
  New-Item -ItemType Directory -Force -Path $LIVE | Out-Null
  # ⚠️ 标记文件放**暂存处**，不能放活目录 ——
  #    第一版放活目录，Restore 时把它一起搬进用户 records 了（自己造垃圾，实测踩到）。
  Set-Content -Path $MARK -Value (Get-Date -Format 'o') -Encoding ASCII
  return
}

if ($Restore) {
  if (-not (Test-Path $MARK)) { Write-Host '没有"测试进行中"的标记 —— 不用还原' -ForegroundColor Yellow; Show-Status; return }
  # ★ 测试期间写进活目录的东西**全部清掉**，再把用户的放回去
  if (Test-Path $LIVE) {
    $junk = Get-ChildItem $LIVE -Force -File | Where-Object { $_.Name -ne '_stashed.flag' }
    if ($junk) {
      Write-Host ("清掉测试期间产生的 " + $junk.Count + " 个文件：" + (($junk | Select-Object -ExpandProperty Name) -join ', ')) -ForegroundColor DarkGray
      $junk | Remove-Item -Recurse -Force
    }
  } else {
    New-Item -ItemType Directory -Force -Path $LIVE | Out-Null
  }
  if (Test-Path $STASH) {
    Get-ChildItem $STASH -Force -File | Where-Object { $_.Name -ne '_stashed.flag' } | ForEach-Object { Move-Item $_.FullName $LIVE -Force }
  }
  Remove-Item $MARK -Force -ErrorAction SilentlyContinue
  Remove-Item $STASH -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host ("已还原 " + (Get-ChildItem $LIVE -Force -File).Count + " 个文件到用户的棋谱库")
  Get-ChildItem $LIVE -Force | ForEach-Object { Write-Host ("   " + $_.Name) }
}