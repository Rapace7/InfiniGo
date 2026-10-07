# ============================================================
#  把「玄清围弈」（已同步的最新版）里的**程序文件**复制到桌面懒人包
#
#  用法： powershell -NoProfile -ExecutionPolicy Bypass -File _update_lazy.ps1
#
#  ★ 为什么只复制程序、不重建整个懒人包：
#     懒人包 8.2GB，其中 7.9GB 是 KataGo 权重 + LoGos 模型 —— 那些**从来不随版本变**。
#     版本迭代改的只是程序本体（约 0.4GB）。重建要动 8GB，纯浪费。
#
#  ★★ 绝不能带过去的东西（懒人包是发给别人的）：
#     settings.json  ← 本机绝对路径（D:\GoStudy\KataGo\...），别人拿到必然找不到
#     records\       ← 用户自己的棋谱，隐私
#     userdata\      ← Chromium 缓存，体积大且无用
#     start.bat      ← 本机专用的启动脚本（绕 ELECTRON_RUN_AS_NODE），与用户无关
#     engine-logs\   ← **运行期**的引擎日志（★ 2026-10-07 补：原来漏了它，
#                       结果把我的调试日志当"程序文件"复制进了懒人包，
#                       用户在自己的懒人包里发现了那个 log）。
#                       它是程序启动时自己生成的运行时目录，不属于程序本体。
# ============================================================
$ErrorActionPreference = 'Stop'

$SRC  = 'D:\GoStudy\玄清围弈'
$DEST = 'C:\Users\rapac\Desktop\RapaceGo懒人包'
$EXCLUDE = @('settings.json', 'records', 'userdata', 'start.bat', 'engine-logs')

if (-not (Test-Path $SRC))  { throw "源目录不存在：$SRC" }
if (-not (Test-Path $DEST)) { throw "懒人包目录不存在：$DEST" }

Write-Host '=== 1/4 复制程序文件 ==='
$copied = 0
Get-ChildItem -LiteralPath $SRC -Force | ForEach-Object {
    if ($EXCLUDE -contains $_.Name) {
        Write-Host ("  跳过 " + $_.Name + "（不该进懒人包）") -ForegroundColor DarkGray
        return
    }
    Copy-Item -LiteralPath $_.FullName -Destination $DEST -Recurse -Force
    $copied++
}
Write-Host ("  复制了 $copied 项")

Write-Host '=== 2/4 核对懒人包里绝不能出现的东西 ==='
# ⚠️ 2026-10-07：这些**不是**"源目录被污染"才会出现 —— 只要用懒人包里的 exe 启动过一次，
#   它就会在包内自己生成 records\ 和 userdata\（还可能有个 engine-logs\）。
#   所以这里不能只"报告"，要**直接清掉**（它们本来就不该出现在发给别人的包里）。
$bad = @()
foreach ($n in $EXCLUDE) {
    $p = Join-Path $DEST $n
    if (Test-Path $p) { Remove-Item $p -Recurse -Force; $bad += $n }
}
if ($bad.Count) {
    Write-Host ("  已清掉测试残留：" + ($bad -join ', ') + "（多半是启动过包里的 exe 生成的）") -ForegroundColor Yellow
} else {
    Write-Host '  ✓ settings.json / records / userdata / start.bat / engine-logs 都不在（正确）'
}
# ★ 再兜一道：包内**任何**位置都不该有日志文件（除了引擎自己目录里那个 srv 日志）。
#   我那个调试日志（*-分析链路.log）已经在新版里撤销了，但旧包/旧副本可能还留着。
$stragglers = @(Get-ChildItem -LiteralPath $DEST -Recurse -File -Filter '*分析链路*' -ErrorAction SilentlyContinue)
if ($stragglers.Count) {
    $stragglers | Remove-Item -Force
    Write-Host ("  ★ 清掉了 " + $stragglers.Count + " 个残留的调试日志（*分析链路.log）") -ForegroundColor Yellow
} else {
    Write-Host '  ✓ 没有残留的调试日志'
}

Write-Host '=== 3/4 核对版本号与关键文件 ==='
$pkg = Join-Path $DEST 'resources\app\package.json'
if (Test-Path $pkg) {
    $j = Get-Content -Raw -Encoding UTF8 $pkg | ConvertFrom-Json
    Write-Host ("  懒人包内版本号 : " + $j.version)
} else {
    Write-Host '  ★ 找不到 resources\app\package.json' -ForegroundColor Red
}
$exe = Join-Path $DEST 'RapaceGo.exe'
if (Test-Path $exe) {
    Write-Host ("  RapaceGo.exe   : " + [math]::Round((Get-Item $exe).Length / 1MB, 2) + " MB，改于 " + (Get-Item $exe).LastWriteTime)
}
# 引擎与模型必须在（懒人包的价值就在这儿）
foreach ($d in @('KataGo', 'LoGos')) {
    $p = Join-Path $DEST $d
    if (Test-Path $p) {
        $sz = (Get-ChildItem -LiteralPath $p -Recurse -File | Measure-Object Length -Sum).Sum
        Write-Host ("  $d : " + [math]::Round($sz / 1GB, 2) + " GB")
    } else {
        Write-Host ("  ★ 缺目录 $d —— 懒人包不完整！") -ForegroundColor Red
    }
}

Write-Host '=== 4/4 总体积 ==='
$total = (Get-ChildItem -LiteralPath $DEST -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
Write-Host ("  " + [math]::Round($total / 1GB, 2) + " GB")

Write-Host ''
Write-Host '完成。' -ForegroundColor Green
Write-Host '★ 提醒：懒人包是**整个文件夹**上传网盘，不是压缩包（用户定的）。'
