# ============================================================
#  开发脚本共用的「路径自适应」助手
#
#  ★ 为什么要有它（2026-10-09 用户要求）：
#    原来各脚本里写死了 `D:\GoStudy\...`。用户把整个工作区搬个位置
#    （D:\GoStudy → D:\Git by Rapace\GoStudy）之后，**所有脚本立刻全废**。
#
#  ★★ 第二次加固（2026-10-09 晚，用户要改文件夹名）：
#    第一版虽然不写盘符了，但**还依赖文件夹的名字** ——
#    找"同时有 `RapaceGo\` 和 `KataGo\` 的那一层"。
#    而用户要把免解压版改名成 `RapaceGo`、源码仓库改名成 `RG工程文件夹` ——
#    名字一改，第一版又废。
#
#    所以现在改成**按"特征"认，不按名字认**：
#      · 源码仓库 = 工作区里**某个含 `.git` + `main.js` + `package.json` 的目录**
#        （不再要求它叫 RapaceGo —— clone 下来的人叫什么都行）
#      · 免解压版 = 工作区里**某个直接含 `RapaceGo.exe` 的目录**
#        （打包版的特征就是 exe 在里面）
#      · 工作区根 = 从脚本位置往上找第一次同时出现 `KataGo` 和 `LoGos` 的那一层
#
#    这样：换盘、改文件夹名、搬层数、别人 clone 到自己的路径下 —— 全都不用改脚本。
#
#  用法（在别的脚本里）：
#      . "$PSScriptRoot\_paths.ps1"
#      $WRoot / $WRepo / $WDeploy / $WKataGo / $WLoGos
# ============================================================

function Test-IsRepoDir([string]$dir) {
    <# 一个目录是不是「本项目的源码仓库」——按特征判断，不看名字 #>
    if (-not $dir) { return $false }
    return (Test-Path (Join-Path $dir '.git')) -and
           (Test-Path (Join-Path $dir 'main.js')) -and
           (Test-Path (Join-Path $dir 'package.json'))
}

function Test-IsDeployDir([string]$dir) {
    <# 一个目录是不是「免解压版 / 打包产物」——特征就是 exe 在里面 #>
    if (-not $dir) { return $false }
    return (Test-Path (Join-Path $dir 'RapaceGo.exe'))
}

function Get-WorkspaceRoot {
    <#
      从当前脚本所在目录往上找，返回"同时有 KataGo 和 LoGos 的那一层"。
      ★ 这是这个工作区的**结构约定**（引擎和仓库平级），不是名字约定。
      找不到返回 $null（调用方自己报错，不猜）。
    #>
    [CmdletBinding()]
    param([string]$StartDir)

    if (-not $StartDir) {
        $StartDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
    }
    $d = (Resolve-Path -LiteralPath $StartDir -ErrorAction SilentlyContinue).Path
    for ($i = 0; $i -lt 15 -and $d; $i++) {
        if ((Test-Path (Join-Path $d 'KataGo')) -and (Test-Path (Join-Path $d 'LoGos'))) {
            return $d
        }
        $parent = Split-Path -Parent $d
        if (-not $parent -or $parent -eq $d) { break }
        $d = $parent
    }
    return $null
}

$script:WRoot = Get-WorkspaceRoot

if ($script:WRoot) {
    # 按特征在工作区里找仓库和免解压版（跳过 node_modules / _trash / 备份 / 打包残留）
    $skip = 'node_modules|_trash|_backup|dist$|locales$|resources$|userdata$|engine-logs$|^KataGo$|^LoGos$'
    $script:WRepo   = $null
    $script:WDeploy = $null
    foreach ($d in (Get-ChildItem $script:WRoot -Directory -Force -ErrorAction SilentlyContinue)) {
        if ($d.Name -match $skip) { continue }
        if (-not $script:WRepo   -and (Test-IsRepoDir   $d.FullName)) { $script:WRepo   = $d.FullName }
        if (-not $script:WDeploy -and (Test-IsDeployDir $d.FullName)) { $script:WDeploy = $d.FullName }
    }
    # 兜底：仓库就在本脚本的上一级（脚本永远住在 <repo>\dev\）
    if (-not $script:WRepo) {
        $maybe = Split-Path -Parent $PSScriptRoot
        if (Test-IsRepoDir $maybe) { $script:WRepo = $maybe }
    }
    $script:WKataGo = Join-Path $script:WRoot 'KataGo'
    $script:WLoGos  = Join-Path $script:WRoot 'LoGos'
}
