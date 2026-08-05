@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ========================================
echo  TechScope V4 - 更新现有 Cloudflare 版本
echo ========================================
echo.

where node.exe >nul 2>&1
if errorlevel 1 goto NO_NODE

call npm install
if errorlevel 1 goto FAILED

echo.
echo [1/3] 检查代码与本地数据逻辑
call npm run check
if errorlevel 1 goto FAILED

echo.
echo [2/3] 检查 Cloudflare 登录
call npx wrangler whoami >nul 2>&1
if errorlevel 1 (
  echo 需要重新登录 Cloudflare，浏览器即将打开。
  call npx wrangler login
  if errorlevel 1 goto FAILED
)

echo.
echo [3/3] 更新现有 Worker，保留 R2 与所有 Secret
call npx wrangler deploy
if errorlevel 1 goto FAILED

echo.
echo ========================================
echo  V4 更新完成
echo ========================================
echo 请重新打开或强制刷新：
echo https://techscope-stock-dashboard.q306395528.workers.dev/
echo.
pause
exit /b 0

:NO_NODE
echo 未检测到 Node.js，请先安装 Node.js LTS。
pause
exit /b 1

:FAILED
echo.
echo 更新没有完成，请截图上方报错信息。
pause
exit /b 1
