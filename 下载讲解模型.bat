@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 玄清围弈 · 讲解模型一键安装

REM ============================================================
REM  玄清围弈 —— 讲解模型（LoGos）一键安装
REM  双击本文件即可。它会自动做三件事：
REM    1. 下载推理运行时（llama-server，CPU + CUDA）
REM    2. 下载讲解模型（约 4.4GB，分 3 个文件下）
REM    3. 合并模型 + 解压运行时，放进本目录的 LoGos\ 文件夹
REM
REM  ★ 需要联网。整个过程约需下载 5GB，请预留时间。
REM  ★ 如果只想下棋、不要讲解功能 —— 不用跑这个文件。
REM ============================================================

set HERE=%~dp0
set DIR=%HERE%LoGos
set VER=v0.1.0
set BASE=https://github.com/Rapace7/InfiniGo/releases/download/%VER%
set PROXY=https://gh-proxy.com/

echo.
echo  ============================================================
echo    玄清围弈 · 讲解模型一键安装
echo  ============================================================
echo.
echo  接下来会自动下载约 5GB 的文件（模型 4.4GB + 运行时 0.5GB）。
echo  国内网络如果很慢，可以试试先连上一个网络加速器。
echo.
echo  按任意键开始，或直接关掉这个窗口取消。
echo  ----------------------------------------
pause >nul
echo.

if not exist "%DIR%" mkdir "%DIR%"

REM ---------- ① 推理运行时 ----------
set RT=%DIR%\llama-server.exe
if exist "%RT%" (
  echo  [1/3] 运行时已就位，跳过。
) else (
  echo  [1/3] 下载推理运行时 ^(llama.cpp，约 150MB^)...^&
  set RTZIP=%DIR%\runtime.zip
  call :fetch "https://www.modelscope.cn/models/waterchfly/llama-cpp-binaries/resolve/master/llama-b11046-bin-win-cuda-12.4-x64.zip" "%RTZIP%"
  if errorlevel 1 goto :fail_rt
  echo        解压中...^&
  powershell -NoProfile -Command "Expand-Archive -Path '%RTZIP%' -DestinationPath '%DIR%' -Force" >nul 2>&1
  del /q "%RTZIP%" >nul 2>&1
  REM 解压出来是 llama-b11046-bin-win-cuda-12.4-x64\ 子目录，把里面的 exe 和 dll 提到 LoGos\
  for /d %%D in ("%DIR%\llama-b*-win-*") do (
    copy /y "%%D\llama-server.exe" "%DIR%\" >nul 2>&1
    copy /y "%%D\*.dll" "%DIR%\" >nul 2>&1
    rmdir /s /q "%%D" >nul 2>&1
  )
  if not exist "%RT%" goto :fail_rt
  echo        运行时就绪。^&
)

REM ---------- ② 模型（3 个分卷）----------
echo.
echo  [2/3] 下载讲解模型 LoGos-7B ^(共约 4.4GB，分 3 个文件^)...^&
set M1=%DIR%\LoGos-7B-Q4_K_M.gguf.part01
set M2=%DIR%\LoGos-7B-Q4_K_M.gguf.part02
set M3=%DIR%\LoGos-7B-Q4_K_M.gguf.part03
call :fetch "%BASE%/LoGos-7B-Q4_K_M.gguf.part01" "%M1%"
if errorlevel 1 goto :fail_m1
call :fetch "%BASE%/LoGos-7B-Q4_K_M.gguf.part02" "%M2%"
if errorlevel 1 goto :fail_m2
call :fetch "%BASE%/LoGos-7B-Q4_K_M.gguf.part03" "%M3%"
if errorlevel 1 goto :fail_m3

REM ---------- ③ 合并 ----------
echo.
echo  [3/3] 合并分卷（约 1-2 分钟）...^&
set MG=%DIR%\LoGos-7B-Q4_K_M.gguf
copy /b /y "%M1%"+"%M2%"+"%M3%" "%MG%" >nul
if errorlevel 1 goto :fail_merge
del /q "%M1%" "%M2%" "%M3%" >nul 2>&1

REM ---------- 检查体积（4.4GB 左右才算对）----------
set SZ=0
for %%A in ("%MG%") do set SZ=%%~zA
if !SZ! LSS 4000000000 (
  echo.
  echo  ★ 合并出来的文件只有 !SZ! 字节，看起来不完整。
  echo    请删掉 %DIR% 整个文件夹后重新运行本文件。
  goto :fail_end
)

echo.
echo  ============================================================
echo    搞定了！
echo  ============================================================
echo.
echo  讲解模型已经放在：%DIR%
echo.
echo  接下来：
echo    1. 回到玄清围弈，点顶栏那个「LoGos」灯 → 菜单里选「加载」
echo    2. 第一次加载约十几秒（要把模型读进显存）
echo    3. 加载成功后，「分析讲解」「选点讲解」「全盘讲解」就能用了
echo.
echo  ★ 讲解功能每次占约 5GB 显存。不需要的时候可以在
echo    顶栏灯的菜单里「卸载」，立刻就释放。
echo.
echo  ★ 第一次用讲解前，建议先读一下 README 里的「硬件要求」。
echo.
pause
exit /b 0

REM ============================================================
REM  下载函数：先试直连，失败就换加速通道
REM ============================================================
:fetch
  set URL=%~1
  set OUT=%~2
  if exist "%OUT%" (
    for %%A in ("%OUT%") do if %%~zA GTR 1000000 ( echo        已有，跳过。 & exit /b 0 )
  )
  curl -L --retry 3 --retry-delay 3 --connect-timeout 20 -C - -o "%OUT%" "%URL%"
  if not errorlevel 1 exit /b 0
  echo        直连失败，换加速通道重试...^&
  REM 加速通道的用法是在原 URL 前面加一段前缀，所以直接拼 "%PROXY%%URL%"
  curl -L --retry 2 --connect-timeout 20 -C - -o "%OUT%" "%PROXY%%URL%"
  if not errorlevel 1 exit /b 0
  exit /b 1

:fail_rt
  echo.
  echo  ★ 运行时下载失败。多半是网络问题 —— 换个网络/加速器再试一次。
  goto :fail_end
:fail_m1
  echo.
  echo  ★ 第 1 个模型分卷下载失败。
  goto :fail_end
:fail_m2
  echo.
  echo  ★ 第 2 个模型分卷下载失败（网断或者被限速了，重新运行会接着下）。
  goto :fail_end
:fail_m3
  echo.
  echo  ★ 第 3 个模型分卷下载失败（网断或者被限速了，重新运行会接着下）。
  goto :fail_end
:fail_merge
  echo.
  echo  ★ 合并分卷时出错。请检查磁盘还有没有 5GB 以上空间。
  goto :fail_end
:fail_end
  echo.
  echo  ----------------------------------------
  echo   没装成功。上面那行写了原因。
  echo   解决之后**重新双击本文件**即可，会接着上次的地方继续。
  echo  ----------------------------------------
  echo.
  pause
  exit /b 1
