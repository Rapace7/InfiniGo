. "$PSScriptRoot\_paths.ps1"
$ErrorActionPreference = 'SilentlyContinue'

$checks = @(
    @{ name = '免解压版'; dir = $WDeploy },
    @{ name = '懒人包';   dir = 'C:\Users\rapac\Desktop\RapaceGo懒人包' }
)

# 这一版修掉的三处错话（改完后不该再出现）
$shouldGone = @(
    '引擎和权重都是有版权的第三方组件，本软件<b>不附带</b>',
    '设置面板里能改'
)
# 应该出现的新文案
$shouldHave = @(
    '懒人包（网盘那个完整包）里已经配好了'
)

foreach ($c in $checks) {
    Write-Host ('════ ' + $c.name + ' ════')
    $base = Join-Path $c.dir 'resources\app'
    $files = @{
        'README.md'          = Join-Path $base 'README.md'
        'renderer\index.html' = Join-Path $base 'renderer\index.html'
        'package.json'       = Join-Path $base 'package.json'
    }
    foreach ($k in $files.Keys) {
        $p = $files[$k]
        Write-Host ('  ' + $k.PadRight(22) + $(if (Test-Path $p) { 'OK ' + (Get-Item $p).LastWriteTime.ToString('MM-dd HH:mm') } else { '★ 缺' }))
    }
    $html = Join-Path $base 'renderer\index.html'
    if (Test-Path $html) {
        $t = Get-Content $html -Raw -Encoding UTF8
        foreach ($s in $shouldGone) {
            Write-Host ('    旧错话已清除 [' + $s.Substring(0, [Math]::Min(20, $s.Length)) + '…]: ' + (-not $t.Contains($s)))
        }
        foreach ($s in $shouldHave) {
            Write-Host ('    新文案已生效 [' + $s.Substring(0, [Math]::Min(16, $s.Length)) + '…]: ' + $t.Contains($s))
        }
    }
    $ver = Join-Path $base 'package.json'
    if (Test-Path $ver) {
        Write-Host ('    版本: ' + (Get-Content $ver -Raw | ConvertFrom-Json).version)
    }
    Write-Host ''
}
