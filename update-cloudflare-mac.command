#!/bin/bash
set -e
cd "$(dirname "$0")"

echo ""
echo "========================================"
echo " TechScope V4 - 更新现有 Cloudflare 版本"
echo "========================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请先安装 Node.js LTS。"
  read -r -p "按回车退出"
  exit 1
fi

npm install
npm run check

if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "需要重新登录 Cloudflare，浏览器即将打开。"
  npx wrangler login
fi

npx wrangler deploy

echo ""
echo "V4 更新完成，请重新打开或强制刷新："
echo "https://techscope-stock-dashboard.q306395528.workers.dev/"
read -r -p "按回车退出"
