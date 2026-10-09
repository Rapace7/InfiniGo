# ============================================================
#  开发脚本共用的「路径自适应」助手
#
#  ★ 为什么要有它（2026-10-09 用户要求）：
#    原来各脚本里写死了 `D:\GoStudy\...`。用户把整个工作区搬个位置
#    （这次是从 `D:\GoStudy` 搬到 `D:\Git by Rapace\GoStudy`）之后，
#    **所有脚本立刻全废**，得一个个手改。
#
#  ★ 做法：从**脚本自己所在的位置**往上找，而不是记死盘符和层数。
#    找的是"同时有 RapaceGo\ 和 KataGo\ 的那一层"（即 GoStudy 根）。
#    好处：
#      · 换盘、改文件夹名、搬进更深的目录 —— 都不用改脚本
#      · 别人 clone 到自己的路径下也能直接跑
#    注意：不能用 `Split-Path` 固定上溯几层 —— 那等于把"层数"写死，
#    正是这次踩的坑。所以这里用**逐级向上搜索**。
#
#  用法（在别的脚本里）：
#      . "$PSScriptRoot\_paths.ps1"
#      $root = Get-WorkspaceRoot          # → D:\Git by Rapace\GoStudy
#      $deploy = Join-Path $root '玄清围弈'
# ============================================================

function Get-WorkspaceRoot {
    <#
      从当前脚本所在目录往上找，返回"同时包含 RapaceGo 和 KataGo 的那一层"。
      找不到就返回 $null（调用方自己决定怎么报错，别猜一个错的）。
    #>
    [CmdletBinding()]
    param([string]$StartDir)

    if (-not $StartDir) {
        # $PSScriptRoot：本文件所在目录（dev\）。点源引入时它是有值的。
        $StartDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
    }
    $d = (Resolve-Path -LiteralPath $StartDir -ErrorAction SilentlyContinue).Path
    for ($i = 0; $i -lt 12 -and $d; $i++) {
        if ((Test-Path (Join-Path $d 'RapaceGo')) -and (Test-Path (Join-Path $d 'KataGo'))) {
            return $d
        }
        $parent = Split-Path -Parent $d
        if (-not $parent -or $parent -eq $d) { break }
        $d = $parent
    }
    return $null
}

# 常用派生路径（找不到 root 时都是 $null，调用方自行判断）
$script:WRoot = Get-WorkspaceRoot
if ($script:WRoot) {
    $script:WRepo   = Join-Path $script:WRoot 'RapaceGo'      # 源码仓库
    $script:WDeploy = Join-Path $script:WRoot '玄清围弈'        # 自用免解压版
    $script:WKataGo = Join-Path $script:WRoot 'KataGo'
    $script:WLoGos  = Join-Path $script:WRoot 'LoGos'
}
