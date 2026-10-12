@echo off
chcp 65001 >nul
title 创建桌面快捷方式

rem 在桌面创建一个「Campus Vault」快捷方式，指向**本文件夹**里的 启动网站.bat。
rem
rem 为什么用脚本而不是直接提交一个 .lnk 文件：
rem   .lnk 是二进制，里面记着创建它的那台机器的绝对路径、卷序列号、用户名 ——
rem   换台电脑就失效，而且会把别人的机器信息带进仓库。
rem   这个脚本用 %~dp0 取当前目录，谁 clone 下来都能生成自己的快捷方式。

set "HERE=%~dp0"
set "TARGET=%HERE%启动网站.bat"

if not exist "%TARGET%" (
  echo [x] 找不到 启动网站.bat
  echo     这个脚本要放在项目根目录里运行。
  pause
  exit /b 1
)

echo.
echo   项目目录：%HERE%
echo   启动文件：%TARGET%
echo   正在创建桌面快捷方式「Campus Vault」...
echo.

powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$lnk = $ws.CreateShortcut([IO.Path]::Combine($ws.SpecialFolders('Desktop'), 'Campus Vault.lnk'));" ^
  "$lnk.TargetPath = '%TARGET%';" ^
  "$lnk.WorkingDirectory = '%HERE%';" ^
  "$lnk.IconLocation = (Get-Command node -ErrorAction SilentlyContinue).Source + ',0';" ^
  "$lnk.Description = 'Campus Vault - 我的课程知识库';" ^
  "$lnk.Save();" ^
  "Write-Host ('  [√] 已创建：' + $lnk.FullName)"

echo.
echo   完成。桌面上会出现「Campus Vault」，双击即可启动网站。
echo.
pause >nul
