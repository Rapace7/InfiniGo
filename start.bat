@echo off
rem ============================================================
rem  InfiniGo (Chinese name: XuanQing WeiYi) - double-click to launch
rem  Dev-mode launcher: runs Electron from node_modules.
rem  %~dp0 = the folder this .bat lives in, so it works no matter
rem  where you put the project (no hard-coded paths).
rem ============================================================
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
