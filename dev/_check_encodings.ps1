. "$PSScriptRoot\_paths.ps1"
# ============================================================
#  检查"给 Windows 用的文本文件"编码与换行（2026-10-06 深夜，踩了太多次）
#  用法：  powershell -File _check_encodings.ps1   （退出码 0 = 全过）
#
#  为什么要有这个脚本 —— 今晚在这上面栽了四次，每次症状都不一样：
#    · .bat 无 BOM 且含中文 → cmd 把中文当命令名，报一堆"不是内部或外部命令"
#    · .bat 用了 LF         → cmd 把 echo 拆成 "ho"
#    · .ps1 无 BOM 且含中文 → PowerShell 5.1 按 GBK 解码 UTF-8 源码，中文全乱 → 语法崩
#    · start.bat 里 %~dp0 被拆行 → cmd 报 "'~dp0" 不是内部或外部命令'
#  规矩按扩展名各不相同，所以这里分开校验，别靠记性。
# ============================================================
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:fail = 0

function Test-OneFile($path) {
  $name = Split-Path $path -Leaf
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $ext = [System.IO.Path]::GetExtension($path).ToLower()
  $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  $cr = ($bytes | Where-Object { $_ -eq 13 } | Measure-Object).Count
  $lf = ($bytes | Where-Object { $_ -eq 10 } | Measure-Object).Count
  $nonAscii = ($bytes | Where-Object { $_ -gt 127 } | Measure-Object).Count
  $problems = @()

  if ($ext -eq '.bat') {
    if ($cr -eq 0 -and $lf -gt 0) { $problems += "换行不是 CRLF（cmd 会把命令拆坏）" }
    if ($nonAscii -gt 0 -and -not $hasBom) { $problems += "含中文但无 UTF-8 BOM（cmd 会把中文当命令）" }
    $text = [System.Text.Encoding]::ASCII.GetString($bytes)
    if ($text -match "(?m)^\s*%\s*$") { $problems += '有孤立的 "%" 行（%~dp0 被拆行了）' }
    foreach ($m in [regex]::Matches($text, '~dp0')) {
      $before = if ($m.Index -gt 0) { $text[$m.Index - 1] } else { 'X' }
      if ($before -ne '%') { $problems += '出现裸 ~dp0（缺 %）' }
    }
  }
  elseif ($ext -eq '.ps1') {
    if ($nonAscii -gt 0 -and -not $hasBom) { $problems += "含中文但无 UTF-8 BOM（PS 5.1 按 GBK 解码 → 语法崩）" }
  }
  elseif ($ext -eq '.json') {
    if ($hasBom) { $problems += "JSON 不该带 BOM" }
  }

  $tag = if ($problems.Count -gt 0) { "X" } else { "v" }
  $bomTxt = if ($hasBom) { '有' } else { '无' }
  $crlfTxt = if ($cr -gt 0) { '是' } else { '否' }
  Write-Host ("{0} {1,-24} BOM={2,-3} CRLF={3,-3} 非ASCII={4,-6} {5}" -f $tag, $name, $bomTxt, $crlfTxt, $nonAscii, ($problems -join '；'))
  if ($problems.Count -gt 0) { $script:fail = $script:fail + 1 }
}

Write-Host "=== 根目录的 .bat / .ps1 ===" -ForegroundColor Cyan
Get-ChildItem $root -File | Where-Object { $_.Extension -eq '.bat' -or $_.Extension -eq '.ps1' } | ForEach-Object {
  Test-OneFile $_.FullName
}
Write-Host ""
Write-Host "=== 正式版目录里的 .bat（用户会双击的）===" -ForegroundColor Cyan
$deploy = $WDeploy
if (Test-Path $deploy) {
  Get-ChildItem $deploy -File -Filter *.bat | ForEach-Object { Test-OneFile $_.FullName }
} else {
  Write-Host "  （没有那个目录，跳过）"
}
Write-Host ""
if ($script:fail -eq 0) {
  Write-Host "全过。" -ForegroundColor Green
  exit 0
} else {
  Write-Host ("有 {0} 个文件不合规 —— 上面标 X 的就是。" -f $script:fail) -ForegroundColor Red
  exit 1
}