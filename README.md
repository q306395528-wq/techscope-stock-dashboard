# TechScope V4

个人美股科技股历史价格分析仪表盘。前端、API 和定时任务运行在 Cloudflare Workers；历史价格按年份保存到 R2；Tiingo 只补充缺失区间和最新交易日。

## V4 功能

- R2 历史数据永久保存，重复查询直接读取 R2
- 自选股在 R2 中同步，可添加和移除
- 只有自选股参与每日定时增量更新
- 1月、3月、6月、1年、3年、5年、10年和全部历史
- 折线、K线、MA50、MA200、成交量和对数坐标
- 区间收益、CAGR、最大回撤、当前回撤、波动率和52周高点距离
- QQQ、SPY、SOXX 等基准对比，默认不会自动消耗额外 API 请求
- PWA，可安装到手机或电脑桌面
- 可选 `APP_ACCESS_TOKEN`，保护公开网址背后的股票 API
- GitHub Actions 自动检查和部署

## 首次部署

```bash
npm install
npx wrangler login
npx wrangler r2 bucket create techscope-stock-data
npx wrangler secret put TIINGO_API_TOKEN
npm run deploy
```

R2 已经存在时，创建命令报“已存在”可以忽略。

## 给公开网址增加访问口令

```bash
npx wrangler secret put APP_ACCESS_TOKEN
npm run deploy
```

输入一个只有自己知道的口令。网页首次访问 API 时会要求输入，并仅保存到当前浏览器的 `localStorage`。不设置此 Secret 时，行为与 V3 一致。

## GitHub 自动部署

仓库 Settings → Secrets and variables → Actions，添加：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

之后每次推送到 `main` 都会运行语法检查、测试并部署。

Cloudflare API Token 至少需要 Workers Scripts Edit、R2 Edit 和 Account Settings Read 权限。

## 本地开发

创建 `.dev.vars`：

```text
TIINGO_API_TOKEN=你的Tiingo密钥
# APP_ACCESS_TOKEN=可选访问口令
```

运行：

```bash
npm install
npm run dev
```

## 数据结构

```text
prices/TSLA/manifest.json
prices/TSLA/2024.json
prices/TSLA/2025.json
prices/TSLA/2026.json
meta/TSLA.json
config/watchlist.json
config/cron-status.json
```

## 定时更新

`wrangler.jsonc` 默认使用：

```text
30 1 * * 2-6
```

即 UTC 周二至周六 01:30。它会更新自选股中已经初始化过历史数据的股票，默认最多20只。
