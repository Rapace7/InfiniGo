# ============================================================
#  构建「RapaceGo懒人包」—— 给别人用网盘下载、解压即可用
#
#  用法（在本脚本所在的 dev\ 目录下跑）：
#      powershell -NoProfile -ExecutionPolicy Bypass -File _build_lazy.ps1
#      powershell -NoProfile -ExecutionPolicy Bypass -File _build_lazy.ps1 -Zip
#
#  产出：C:\Users\<你>\Desktop\RapaceGo懒人包\
#          ├─ RapaceGo.exe        程序本体（双击它）
#          ├─ KataGo\             引擎 + 两个权重（别人不用自己配）
#          ├─ LoGos\              讲解运行时 + 4.4GB 模型
#          └─ 使用说明.txt
#
#  ★★ 懒人包的三条铁律（都是踩出来的）：
#    1. **绝不带 settings.json** —— 里面是本机绝对路径，别人解压后引擎必然找不到。
#    2. **程序本体必须散在懒人包根目录、和 KataGo\ LoGos\ 平级** ——
#       打包态的默认路径就是按 exe 同级找引擎的（见 main.js 的 BASE_DIR）。
#       ⚠️ 2026-10-06 踩过：把程序套进 RapaceGo\ 子目录 → 引擎永远起不来。
#    3. **不能带 records/ 和 userdata/** —— 前者是你的棋谱（隐私），
#       后者是缓存（体积大且无用）。
# ============================================================
param(
  # 默认 = 本脚本所在 dev\ 的**上一级**（开发目录）。别写死盘符 —— 换机器/改目录名就废。
  [string]$Src      = "",
  [string]$KataGoSrc= "D:\GoStudy\KataGo",
  [string]$LoGosSrc = "D:\GoStudy\LoGos",
  [string]$OutDir   = "",          # 默认桌面
  [switch]$Zip
)
if (-not $Src) { $Src = Split-Path -Parent $PSScriptRoot }
$ErrorActionPreference = "Stop"
$log = @()
function Say($t) { Write-Host $t; $script:log += $t }

if (-not $OutDir) { $OutDir = Join-Path ([Environment]::GetFolderPath('Desktop')) 'RapaceGo懒人包' }
# ★★ 2026-10-06 深夜：程序本体**直接放懒人包根目录**，不要再套一层 RapaceGo\。
#   原因（实测出来的，不是猜的）：main.js 里
#       up = IS_PACKAGED ? BASE_DIR : __dirname\..
#   而 BASE_DIR 打包后 = **exe 所在目录**，所以打包态下引擎的约定是
#   **和 RapaceGo.exe 平级**（不是上一级）。
#   我第一版套了一层 RapaceGo\，软件算出的路径就成了
#       ...\懒人包\RapaceGo\KataGo\engine\katago.exe（多一层 RapaceGo）
#   而文件实际在 ...\懒人包\KataGo\... → settings.check 五项全 false、引擎起不来。
$stage = $OutDir

Say "=== 0/5 前置检查 ==="
foreach ($p in @("$Src\main.js", "$Src\renderer\app.js", "$KataGoSrc\engine\katago.exe",
                 "$KataGoSrc\weights\b11c768nbt.bin.gz", "$KataGoSrc\weights\b18c384nbt-humanv0.bin.gz",
                 "$LoGosSrc\llama-server.exe", "$LoGosSrc\cublasLt64_12.dll")) {
  if (-not (Test-Path $p)) { throw "缺少必需文件：$p" }
}
Say "  必需文件都在"

Say ""
Say "=== 1/5 清掉旧的构建产物 ==="
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force; Say "  已删除旧目录 $OutDir" }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Say ""
Say "=== 2/5 复制程序本体（RapaceGo v0.1.10）==="
# 与 electron-builder 的 output(win-unpacked) 等价：只带程序必需的东西
$keep = @(
  'RapaceGo.exe', '下载讲解模型.bat', 'settings.json',   # settings.json 下一步会删
  'LICENSE.electron.txt', 'LICENSES.chromium.html'
)
foreach ($k in $keep) {
  $from = Join-Path "D:\GoStudy\玄清围弈" $k
  if (Test-Path $from) { Copy-Item $from (Join-Path $stage $k) -Recurse -Force }
}
# 顶层运行库（只取文件）
Get-ChildItem "D:\GoStudy\玄清围弈" -File | Where-Object {
  $_.Extension -in '.dll', '.pak', '.bin', '.dat', '.json'
} | ForEach-Object { Copy-Item $_.FullName (Join-Path $stage $_.Name) -Force }
# 需要的子目录（排除用户数据：records / engine-logs / userdata）
Get-ChildItem "D:\GoStudy\玄清围弈" -Directory | Where-Object {
  $_.Name -notin 'records', 'engine-logs', 'userdata'
} | ForEach-Object { Copy-Item $_.FullName (Join-Path $stage $_.Name) -Recurse -Force }

# ★ 程序本体只从「玄清围弈」取一份 —— 那是**唯一**的免解压版（由 _sync_deploy.ps1
#   从 electron-builder 的产物同步过来），所以它里面的 resources\app\ 已经是最新代码。
#   ⚠️ 2026-10-07 去掉了原来的「再用 $Src 的 main.js/renderer 覆盖一遍」：
#      那会让「源码版」和「打包版」混在一起（程序骨架来自打包产物、代码来自工作区），
#      一旦工作区有未提交的改动，懒人包就变成既不是这版也不是那版的东西。
#      现在规则简单：**懒人包 = 玄清围弈 + 引擎 + 模型**，只认一个来源。
if (-not (Test-Path (Join-Path $stage 'resources\app\main.js'))) {
  throw "懒人包里没有 resources\app\main.js —— 「玄清围弈」目录不完整，先跑 _sync_deploy.ps1"
}


# ★★ 铁律 1：删掉 settings.json（绝对路径会害了别人）
$sj = Join-Path $stage 'settings.json'
if (Test-Path $sj) { Remove-Item $sj -Force; Say "  已删除 settings.json（里面是本机绝对路径，绝对不能带）" }
# 铁律 3：不带 records / engine-logs
foreach ($junk in 'records', 'engine-logs', 'userdata') {
  $j = Join-Path $stage $junk
  if (Test-Path $j) { Remove-Item $j -Recurse -Force; Say "  已删除 $junk（不该进懒人包）" }
}
Say ("  程序本体：" + [math]::Round((Get-ChildItem $stage -Recurse -File | Measure-Object -Property Length -Sum).Sum/1MB) + " MB")

Say ""
Say "=== 3/5 复制 KataGo（引擎 + 两个权重）==="
$kdir = Join-Path $OutDir 'KataGo'
robocopy $KataGoSrc $kdir /E /NFL /NDL /NJH /NJS /NP /XD analysis_logs | Out-Null
Say ("  KataGo：" + [math]::Round((Get-ChildItem $kdir -Recurse -File | Measure-Object -Property Length -Sum).Sum/1MB) + " MB")

Say ""
Say "=== 4/5 复制 LoGos（讲解运行时）==="
$ldir = Join-Path $OutDir 'LoGos'
robocopy $LoGosSrc $ldir /E /NFL /NDL /NJH /NJS /NP | Out-Null
Say ("  LoGos：" + [math]::Round((Get-ChildItem $ldir -Recurse -File | Measure-Object -Property Length -Sum).Sum/1MB) + " MB")

Say ""
Say "=== 5/5 生成使用说明 ==="
$L = [string]([char]13) + [string]([char]10)
<#
 ★ 2026-10-06 深夜用户定的：**不要启动 bat** —— 懒人包不做"懒到那种程度"，
   直接让他教对方"双击 RapaceGo.exe"就行。
   那个 bat 本来是为了对付 ELECTRON_RUN_AS_NODE=1（AI 工具链会设，双击 exe 会秒退），
   但对普通用户来说多一个文件反而费解。所以懒人包里不放它。
#>
$readme = @(
  'RapaceGo 懒人包',
  '================',
  '',
  '【怎么用】',
  '  双击本文件夹里的 RapaceGo.exe —— 就这样，不用配任何东西。',
  '  （引擎和权重已经摆在旁边了：KataGo\ 和 LoGos\ 与 exe 同级。）',
  '',
  '【里面有什么】',
  '  RapaceGo.exe  程序本体，双击它',
  '  KataGo\       围棋引擎 + 两个权重（算胜率 / 当对手）',
  '  LoGos\        讲解模型运行时（讲棋用的）',
  '  records\      你的棋谱（第一次运行后自动出现）',
  '',
  '【注意】',
  '  · 建议解压到**英文或中文路径都行**，但**别解压成嵌套两层**',
  '    （比如 D:\游戏\RapaceGo懒人包\RapaceGo懒人包\）——',
  '    程序按「上一级找引擎」的约定找 KataGo，嵌套了会找不到。',
  '    真嵌套了也不要紧：软件发现配置的路径不存在会自动回退到默认位置。',
  '  · 讲解功能第一次用需要几秒加载（它在你的显卡上跑一个 7B 模型，约 4.9GB 显存）。',
  '  · 显存不够（<6GB）可以只用不讲解的部分：下棋、胜率、推荐点、复盘都不需要它。',
  '',
  '【卸载】整个文件夹删掉就行 —— 不写注册表、不留 C 盘。',
  ''
)
[System.IO.File]::WriteAllText((Join-Path $OutDir '使用说明.txt'), [string]::Join($L, $readme), (New-Object System.Text.UTF8Encoding($true)))
Say "  已生成「使用说明.txt」"

Say ""
$total = [math]::Round((Get-ChildItem $OutDir -Recurse -File | Measure-Object -Property Length -Sum).Sum/1MB)
Say "=== 完成：$OutDir（合计 $total MB）==="
Get-ChildItem $OutDir -Force | ForEach-Object {
  $sz = if ($_.PSIsContainer) { [math]::Round((Get-ChildItem $_.FullName -Recurse -File | Measure-Object -Property Length -Sum).Sum/1MB) } else { [math]::Round($_.Length/1KB) }
  $unit = if ($_.PSIsContainer) { 'MB' } else { 'KB' }
  Say ("  {0,8} {1}  {2}" -f $sz, $unit, $_.Name)
}

if ($Zip) {
  Say ""
  Say "=== 打包 zip（Windows 自带 zip，别人双击就能解压）==="
  $zipPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'RapaceGo懒人包.zip'
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  # ★ 用 UTF8 显式编码条目名（我们的文件名以中文为主，默认编码会让别人解压出乱码）
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $OutDir, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false,
    [System.Text.Encoding]::UTF8)
  Say ("  已生成 $zipPath（" + [math]::Round((Get-Item $zipPath).Length/1MB) + " MB）")
}
