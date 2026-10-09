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
  [string]$DeployDir = "",
  [string]$Unpacked  = "",
  [switch]$DryRun,
  [switch]$NoBackup,
  [switch]$KeepUnpacked,
  [int]$KeepBackups = 2
)

# ★ 路径自适应（2026-10-09）：不再写死盘符，从脚本位置往上找工作区根
. "$PSScriptRoot\_paths.ps1"
$ErrorActionPreference = 'Stop'

# 参数默认值从 _paths.ps1 推出来（按特征认目录，不写死名字）
if (-not $DeployDir) { $DeployDir = $WDeploy }
if (-not $Unpacked)  { $Unpacked  = Join-Path $WRepo 'dist\win-unpacked' }
if (-not $DeployDir) { throw '找不到免解压版目录（工作区里没有含 RapaceGo.exe 的文件夹）' }
if (-not $WRepo)     { throw '找不到源码仓库（工作区里没有含 .git + main.js 的文件夹）' }
# ★★ 2026-10-06 深夜踩过的坑，别再犯：
#   `[char]13 + [char]10` 在 PowerShell 里是**数组相加**（得到两个元素的数组），
#   不是字符串拼接。后果有两层，都很隐蔽：
#     · 它当时在 `-join $L` 里当分隔符 → 报错或拼出怪东西
#     · `$P = [char]37` 也是数组，于是 `$P + '~dp0'` 把 `%` 和 `~dp0` **拆成了两行** ——
#       生成的 start.bat 里 `%~dp0` 变成换行的 `%` 和 `~dp0`，cmd 直接报
#       「'~dp0"' 不是内部或外部命令」→ 那个 bat **根本跑不起来**（用户因此以为它没用）。
#   正确写法：显式转成 [string] 再拼。
$L = [string]([char]13) + [string]([char]10)
$P = [string]([char]37)          # 就是 `%`，批处理里写 `%~dp0` 要用它

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
$bak = Join-Path $WRoot "_backup_玄清围弈_$stamp"
if ($NoBackup) {
  Write-Host "  已指定 -NoBackup：跳过备份（出问题就只能重打包）"
} elseif ($DryRun) {
  Write-Host "  [DryRun] 会备份到 $bak"
} else {
  New-Item -ItemType Directory -Path $bak -Force | Out-Null
  robocopy $DeployDir $bak /E /NFL /NDL /NJH /NJS /NP | Out-Null
  $n = (Get-ChildItem $bak -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
  Write-Host "  备份到 $bak（$n 个文件）"
  # ★ 2026-10-06 深夜：备份必须限量。
  #   每一份是 368MB 的完整程序目录 —— 一晚同步 4 次就 1.5GB，
  #   用户直接问「你给我在 GoStudy 里新增的两个 backup 文件夹是啥玩意」。
  #   现在只留最近 $KeepBackups 份，旧的删掉（进回收站，仍可捞）。
  $olds = Get-ChildItem $WRoot -Directory -Filter "_backup_玄清围弈_*" |
          Sort-Object CreationTime -Descending | Select-Object -Skip $KeepBackups
  if ($olds) {
    Add-Type -AssemblyName Microsoft.VisualBasic
    foreach ($d in $olds) {
      try {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($d.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin')
        Write-Host "  清掉旧备份（进回收站）：$($d.Name)"
      } catch { Write-Host "  旧备份删不掉，跳过：$($d.Name)" }
    }
  }
}

# ---------- 2) 清掉旧程序文件（保留用户数据 + 引擎） ----------
#  ★★ 2026-10-09 改了保留清单 —— 前提变了，别再照旧清：
#    以前免解压版**不自带引擎**（settings.json 里存绝对路径指向工作区的 KataGo/LoGos），
#    所以那时把引擎目录当"旧内容"清掉是对的。
#    现在引擎**已经搬进免解压版内部**（自包含，搬到哪都能跑），
#    再清就等于把引擎删了 —— 实测踩到：同步完 KataGo\ LoGos\ 全没了、软件起不来。
#    ⚠️ 这两个目录是几 GB 的引擎，删了要重新搬（浪费且吓人），必须保。
Step "2/5" "清掉旧程序文件（保留 settings.json、records 与引擎）"
$keep = @('settings.json', 'records', 'KataGo', 'LoGos')
$doomed = Get-ChildItem $DeployDir -Force | Where-Object { $keep -notcontains $_.Name }
Write-Host "  将删除 $($doomed.Count) 项；保留：settings.json、records\、KataGo\、LoGos\"
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
  'cd /d "__DP0__"',
  'start "" "__DP0__RapaceGo.exe"'
)
# ★★ 2026-10-06 深夜第二个坑（第一个是 $L/$P 当数组）：
#   原来写的是  'cd /d "' + $P + '~dp0"',  这种"数组元素里做字符串拼接"的写法，
#   PowerShell 会把 `,` 解析成 `+` 的右操作数 →
#   **@(...) 里塌成 1 个元素**（实测：两个元素变成一个），拼出来的东西整段错位。
#   所以这里先用**纯 ASCII 占位符**，全部拼完之后再用 .Replace() 换掉 ——
#   方法调用没有歧义。要的是 `%~dp0`（`%` 的 ASCII 是 37）。
$text = (($lines -join $L) + $L).Replace('__DP0__', [string]([char]37) + '~dp0')
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

# ---------- 6) 清掉中间产物 dist\win-unpacked ----------
#  ★ 2026-10-06 深夜用户纠正：**「免解压版」只有 `玄清围弈` 一个**。
#    `dist\win-unpacked` 是 electron-builder 的**中间产物**，我一度把它留着
#    并当成"免解压版"，等于凭空多出一个 376MB、内容和正式版完全相同的副本，
#    用户看到就问「你怎么在 dist 里又弄了一个免安装版」。
#    现在同步完就删（要留着对比的用户自己加 -KeepUnpacked）。
if ($KeepUnpacked) {
  Write-Host "  已指定 -KeepUnpacked：保留中间产物 dist\win-unpacked"
} elseif (Test-Path $Unpacked) {
  try {
    Remove-Item $Unpacked -Recurse -Force
    Write-Host "  已删除中间产物 dist\win-unpacked（免解压版只留 $DeployDir 一个）"
  } catch {
    Write-Host "  ★ 中间产物删不掉（可能有程序占着）：$($_.Exception.Message)"
  }
}
Write-Host ""
Write-Host "完成。双击 $DeployDir\start.bat 即可试用新版本。" -ForegroundColor Green
