# 设计稿：Activity forecast 图加入 opencode-usage 插件（方案 B）

日期：2026-11-09 · 状态：已批准（用户选 B）

## 意图

把官网 Console「Activity」页顶部图表的 forecast 能力搬进插件，让 `/usage` 命令可调阅完整图，TUI 侧边栏常驻一行 forecast 结论，免去去网站看趋势。

## 背景（实测确认）

- 官网 Go 版 forecast 数据源：`GET /console/api/activity/go`（OAuth 凭据实测 200）→ `{startsAt, daily:[{date,totalCostMicroCents,totalTokens,totalRequests}], models:[...]}`
- 月上限/已用来自现有 `GET /console/api/go/status` 的 `access.meters.month`
- 官方前端算法（Console bundle `app-pages-XQgBKoKH.js` 中 `Ome` 函数，逐行核对）：
  - `c` = 已用百分数（2 位小数；已用 ≥ 上限则 100）
  - 每日柱值 = `c × 当日消费 ÷ 本期总消费`（总量为 0 时取当日 0）
  - `forecast = c × (整期毫秒 ÷ 已过毫秒)`（仅当已过 ≥ 1 天；已耗尽时直接 100）
  - `runsOut` = forecast > 100 且未耗尽时：`start + 已过 × 100 / c`
- 当前期限 $60（`limitMicroCents: 6000000000`，2026-11-09 实测重查确认，product=go 非 Go Plus），代码跟随 API 返回上限，不硬编码。

## 目标

- `/usage` 报告末尾新增「本期日消费」节：markdown 表（日期 + 金额，6 列分块，今日标（今））+ forecast 结论行
- TUI 侧边栏在 resets 行之后、Console 行之前加一行：`▁▂▁▂▃▁ 月底约 18% ↗` 或 `→ 11/28 触顶`（超 100% 时）
- forecast 数据取不到（活动接口失败、本期刚开始 <1 天、无月 meter）时该幅内容整体省略，不影响现有输出

## 非目标

- 不做模型排行、不做上月对比、不动 60s 刷新逻辑、不加新依赖、不改 `index.ts`
- 侧边栏不画完整日柱状图（宽度不够，方案 C 已否）

## 方式

- 共享逻辑全部落在 `usage.ts`：`ActivityGo` 类型、`fetchUsage` 增拉 activity 端点（失败仅记 error）、`forecastView(snapshot, now)`（复刻官方算法）、sparkline/结论行格式化
- `tui.tsx` 仅消费 `forecastView` 的产物渲染一行
- 测试：`node --test test/usage.test.mjs`，直接 import `./usage.ts`（node 24 原生跑 TS），fetch 用 stub 替换，不联网
