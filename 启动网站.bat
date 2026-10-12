@echo off
chcp 65001 >nul
title Campus Vault

rem 用**本文件所在目录**，不写死盘符 —— 换电脑、换目录都不用改
cd /d "%~dp0"

rem esbuild / node 需要一个可写的临时目录
set TMP=%~dp0.tmp
set TEMP=%~dp0.tmp
if not exist "%~dp0.tmp" mkdir "%~dp0.tmp"

echo ============================================
echo   Campus Vault - 我的课程知识库
echo ============================================
echo.
echo   正在启动后端与前端，请稍候...
echo.
echo   关闭本窗口即同时停止前后端
echo ============================================
echo.

rem launcher manages both processes (see tools/dev.mjs)
node tools\dev.mjs
set RC=%errorlevel%

rem exit code 3 = site already running, browser was opened
if "%RC%"=="3" (
  echo.
  echo ============================================
  echo   网站本来就在运行，已为你打开浏览器。
  echo.
  echo   本窗口可以直接关掉，不影响已在运行的服务。
  echo   要重启的话，先关掉原来那个服务器窗口。
  echo ============================================
  echo.
  timeout /t 6 >nul
  exit /b 0
)

echo.
echo 服务器已停止。按任意键关闭窗口。
pause >nul
