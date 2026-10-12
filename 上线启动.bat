@echo off
chcp 65001 >nul
title Campus Vault - 公网
cd /d "%~dp0"

rem esbuild / node need a writable temp dir
set TMP=%~dp0.tmp
set TEMP=%~dp0.tmp
if not exist "%~dp0.tmp" mkdir "%~dp0.tmp"

echo ============================================
echo   Campus Vault - 上线（公网 + https）
echo ============================================
echo.
echo   这一步会做三件事：
echo     1. 起生产形态的服务（后端直接提供网页，不是开发服务器）
echo     2. 开 Cloudflare 隧道，给你一个 https 网址
echo     3. 把网址打印出来，手机/外面都能打开
echo.
echo   前提：上线.env 已配好，且管理员密码已改过。
echo         没改过的话服务会拒绝启动，并按提示告诉你怎么改。
echo.
echo   关闭本窗口 = 网站下线
echo ============================================
echo.

rem 编辑配置的快捷入口：没有配置文件时先帮用户复制一份并打开
if not exist "%~dp0上线.env" (
  echo   [!] 没有找到 上线.env，正在从模板复制一份...
  copy /y "%~dp0上线.env.example" "%~dp0上线.env" >nul
  echo.
  echo   即将用记事本打开它，请至少修改这一行：
  echo       ADMIN_PASSWORD=你自己的密码
  echo   改完保存并关闭记事本，然后重新双击本文件。
  echo.
  pause
  notepad "%~dp0上线.env"
  exit /b 0
)

rem launcher manages both processes (see tools/serve-public.mjs)
node tools\serve-public.mjs
set RC=%errorlevel%

echo.
echo ============================================
echo   服务已停止（退出码 %RC%）。
if not "%RC%"=="0" echo   如果是被安全守卫拦下的，往上翻，中文提示里写了要改什么。
echo ============================================
echo.
echo   按任意键关闭窗口。
pause >nul
