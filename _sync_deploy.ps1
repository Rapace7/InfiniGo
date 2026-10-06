# ============================================================
#  同步到「正式版」目录 —— 打包之后跑这一条
#
#  用法（注意：Windows PowerShell 5.1 读 UTF-8 脚本需要 BOM，
#        本文件**必须**带 BOM，改动后检查前 3 字节是 ef bb bf）：
#      powershell -File _sync_deploy.ps1            # 用 dist\win-unpacked 覆盖
#      powershell -File _sync_deploy.ps1 -DryRun    # 只看要删什么，不动手
#
#  为什么单独一个脚本（而不是只写在 _deploy.sh 里）：
#    _deploy.sh 是 bash 脚本，而本机（DSH 环境）的 bash/git/npm 都不在 PATH 上，
#    用它调试一步要绕三层。这个 .ps1 只管「同步正式版目录」这一件事，
#    在 PowerShell 里能直接跑、能 DryRun、能逐步核对。
#
#  ★★ 绝不能误删的东西（用户自用的配置与棋谱）：
#      settings.json   ← 您配好的引擎路径（katago.exe / 权重 / LoGos）
#      records\        ← 您的棋谱、复盘报告(.review.json)、讲解(.coach.json)
#    这两个是**唯一保留**的；其余（含 userdata 缓存）一律替换成新包内容。
# ============================================================
param(
  [string]$DeployDir = "D:\GoStudy\玄清围弈",
  [string]$Unpacked  = "D:\GoStudy\RapaceGo\dist\win-unpacked",
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$L = [char]13 + [char]10
$P = [char]37

function Step($n, $t) { Write-Host ""; Write-Host "=== $n $t ===" -ForegroundColor Cyan }

# ---------- 0) 前置检查 ----------
Step "0/5" "前置检查"
if (-not (Test-Path "$Unpacked\RapaceGo.exe")) {
  throw "找不到 $Unpacked\RapaceGo.exe —— 先打包（electron-builder --win）再同步。"
}
$running = Get-Process -Name "RapaceGo" -ErrorAction SilentlyContinue
if ($running) {
  throw "RapaceGo.exe 正在运行（PID $($running.Id -join ',')）。请先关掉软件再同步，否则文件被占用会覆盖失败。"
}
Write-Host "  新包：$Unpacked"
Write-Host "  目标：$DeployDir"
if (-not (Test-Path $DeployDir)) { throw "目标目录不存在：$DeployDir" }

# ---------- 1) 备份现有正式版（可回退） ----------
Step "1/5" "备份现有正式版（可回退）"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "D:\GoStudy\_backup_玄清围弈_$stamp"
if ($DryRun) {
  Write-Host "  [DryRun] 会备份到 $bak"
} else {
  New-Item -ItemType Directory -Path $bak -Force | Out-Null
  robocopy $DeployDir $bak /E /NFL /NDL /NJH /NJS /NP | Out-Null
  $n = (Get-ChildItem $bak -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
  Write-Host "  备份到 $bak（$n 个文件）"
}

# ---------- 2) 清掉旧程序文件（保留用户数据） ----------
Step "2/5" "清掉旧程序文件（保留 settings.json 与 records）"
$keep = @('settings.json', 'records')
$doomed = Get-ChildItem $DeployDir -Force | Where-Object { $keep -notcontains $_.Name }
Write-Host "  将删除 $($doomed.Count) 项；保留：settings.json、records\"
$doomed | ForEach-Object { Write-Host "    - $($_.Name)" }
if (-not $DryRun) {
  $doomed | ForEach-Object { Remove-Item $_.FullName -Recurse -Force }
  Write-Host "  已清理"
}

# ---------- 3) 复制新包 ----------
Step "3/5" "复制新包内容"
if ($DryRun) {
  Write-Host "  [DryRun] 会从 $Unpacked 全量复制"
} else {
  robocopy $Unpacked $DeployDir /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy 复制失败（exit $LASTEXITCODE）" }
  Write-Host "  已复制"
}

# ---------- 4) 重建 start.bat ----------
#  规矩来自 _deploy.sh（三条都踩过）：
#    · 必须 CRLF —— LF 的 .bat 会让 cmd 把 echo 拆成「ho」、中文当命令名
#    · 纯英文注释 + **不加 BOM** —— 加了 BOM 后 cmd 把第一行读成 '@echo'
#      报「不是内部或外部命令」（实测）
#    · 必须 set ELECTRON_RUN_AS_NODE= —— 这个变量是 1 时 Electron 把自己
#      当普通 Node 跑，报 isPackaged 后立刻退出，症状是「双击没反应」
Step "4/5" "重建 start.bat（CRLF / 无 BOM / 纯英文）"
$lines = @(
  '@echo off',
  'rem ============================================================',
  'rem  XuanQing WeiYi - double-click to launch',
  'rem  Uses RapaceGo.exe in this same folder.',
  'rem',
  'rem  WHY CLEAR ELECTRON_RUN_AS_NODE FIRST:',
  'rem    When it is 1, Electron runs itself as plain Node and exits',
  'rem    with "Cannot read properties of undefined (reading isPackaged)".',
  'rem    Symptom: double-click does nothing.',
  'rem    Some AI toolchains / terminals set it, so just clear it.',
  'rem ============================================================',
  'set ELECTRON_RUN_AS_NODE=',
  'cd /d "' + $P + '~dp0"',
  'start "" "' + $P + '~dp0RapaceGo.exe"'
)
$text = ($lines -join $L) + $L
$bytes = [System.Text.Encoding]::ASCII.GetBytes($text)
if ($DryRun) {
  Write-Host "  [DryRun] 会写入 start.bat（$($bytes.Length) 字节）"
} else {
  [System.IO.File]::WriteAllBytes("$DeployDir\start.bat", $bytes)
  $cr = ($bytes | Where-Object { $_ -eq 13 } | Measure-Object).Count
  Write-Host "  start.bat（$($bytes.Length) 字节，CRLF $cr 个，无 BOM）"
}

# ---------- 5) 核对结果 ----------
Step "5/5" "核对"
if ($DryRun) { Write-Host "  [DryRun] 到此为止，什么都没改。"; return }
$pkg = Get-Content "$Unpacked\resources\app\package.json" -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host "  包内版本号      : $($pkg.version)"
Write-Host "  目标 exe 时间戳 : $((Get-Item "$DeployDir\RapaceGo.exe").LastWriteTime)"
$same = (Get-Item "$DeployDir\RapaceGo.exe").Length -eq (Get-Item "$Unpacked\RapaceGo.exe").Length
Write-Host "  与包内 exe 一致 : $same"
$sj = Get-Content "$DeployDir\settings.json" -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host "  settings.json   : katago=$($sj.katago)"
Write-Host "                    coach =$($sj.coachServer)"
$rc = (Get-ChildItem "$DeployDir\records" -File -ErrorAction SilentlyContinue | Measure-Object).Count
Write-Host "  records 文件数  : $rc"
Write-Host ""
Write-Host "完成。双击 $DeployDir\start.bat 即可试用新版本。" -ForegroundColor Green
