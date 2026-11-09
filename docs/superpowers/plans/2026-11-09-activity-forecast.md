# Activity forecast（方案 B）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把官网 Activity 页的 forecast（本期逐日消费 + 剩余期外推）加进 opencode-usage 插件的 `/usage` 报告与 TUI 侧边栏。

**Architecture:** `usage.ts` 新增 `ActivityGo` 类型与 `forecastView()`（复刻 Console 前端官方算法），`fetchUsage` 增拉 `/console/api/activity/go`；`renderReport`/`sidebarLines` 各渲染报告节与服务端侧边栏行；`tui.tsx` 在 JSX 中消费 `forecastView` 渲染同类一行。

**Tech Stack:** TypeScript（node 24 原生执行，无需转译/无新增依赖）、`node:test` + `assert` 测试、Solid JSX（TUI）。

**Spec:** `docs/superpowers/specs/2026-11-09-activity-forecast-design.md`

## Global Constraints

- 插件目录（`C:\Users\KHADAS\.config\opencode\plugins\opencode-usage\`）**不是 git 仓库**：无 commit 步骤，每任务以绿色测试收尾。
- 测试命令：`node --test` （在插件目录下运行），测试文件置 `test\usage.test.mjs`，直接 `import("../usage.ts")`，通过替换 `globalThis.fetch` stub 网络，断网可跑。
- 不新增任何依赖；`index.ts` 不改；60s 刷新机制不动。
- Forecast 算法与官方一致：`c = used≥limit ? 100 : round(used×10000/limit)/100`；`forecast = elapsed≥1d ? (已耗尽 ? 100 : c×(整期/已过)) : undefined`；`runsOut = forecast>100 && !耗尽 ? start+已过×100/c : undefined`。
- 月上限不硬编码，跟随 `meters.month.limitMicroCents`。
- percent 显示：报告内结论行用 `~{Math.round}%`；内部值保留 2 位小数。

## Review Focus

1. **期界穿越**：`now` 落在本期开始前（clamp 到 start）或结束后（clamp 到 reset）→ forecast 必须为 undefined 或正确值，不得抛错/算出负值。（Task 2 step 1)
2. **本期外历史日**：activity daily 里若混入早于期界开始的日期 → 必须被过滤，不参与总量/图示。（Task 2 step 1)
3. **零消费/零总量期**：本期刚开始（daily 全 0）→ 不除零（除数为 0 时 daily 塌缩为单点 {今日,c}），forecast 正常给出 0%。（Task 2 step 1)
4. **UTC 日界**：日期匹配/（今）标注一律用 UTC 日（API 的 date 为 UTC），不能用本地时区，否则 GLM 用户会出现“今天”错位。（Task 3 step 1)
5. **数据缺失降级**：activity 拉取失败或 meters.month 缺失 → 报告无本节、侧边栏无本行、现有三行不变、errors 仅追记一条。（Task 1/4 step 1)

---

### Task 1: `fetchUsage` 增拉 activity 端点

**Files:**
- Modify: `usage.ts:55-61`（UsageSnapshot 增 `activity?: ActivityGo`）
- Modify: `usage.ts:73-103`（fetchUsage 增加 read）
- Test: `test/usage.test.mjs`（新建）

**Interfaces:**
- Consumes: 现有 `fetchUsage(token)`、`UsageSnapshot.errors` 追记模式。
- Produces: `export interface ActivityGo { startsAt?: string; daily?: Array<{date?: string; totalCostMicroCents?: string; totalRequests?: string; totalTokens?: string}>; models?: Array<{provider?: string; model?: string; totalRequests?: string}> }`；`UsageSnapshot.activity?: ActivityGo`；fetch 失败时仅 `errors` 追记 `activity: ...` 且其余字段不受影响。

- [ ] **Step 1: Write the failing test**（样例固定 stub fetch，返回预置 3 端点 JSON；第二例 activity 返回 403）

```js
// test/usage.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { fetchUsage } from "../usage.ts"

function stubFetch(responses) {
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    const hit = responses.find((r) => url.includes(r.matched))
    if (!hit) return new Response("not found", { status: 404 })
    return new Response(hit.body, { status: hit.status ?? 200, headers: { "content-type": "application/json" } })
  }
  return calls
}

const GO = JSON.stringify({
  access: { meters: { fiveHour: { limitMicroCents: "1200000000", usedMicroCents: "50000000" }, month: { resetsAt: "2026-12-04T13:02:31.000Z", limitMicroCents: "6000000000", usedMicroCents: "3000000000" } } },
  product: "go", useBalance: false,
})
const ACT = JSON.stringify({
  startsAt: "2026-11-04T13:02:31.000Z",
  daily: [{ date: "2026-11-08", totalCostMicroCents: "94043113", totalRequests: "435" }],
  models: [{ provider: "opencode-go", model: "deepseek-v4.1-flash", totalRequests: "1442" }],
})

test("fetchUsage 附带 activity 数据", async () => {
  stubFetch([{ matched: "/console/api/activity/go", body: ACT }, { matched: "/console/api/go/status", body: GO }, { matched: "/console/api/billing/status", body: "{}" }, { matched: "/console/api/members", body: "{}" }])
  const snap = await fetchUsage("t")
  assert.ok(snap.activity)
  assert.equal(snap.activity.startsAt, "2026-11-04T13:02:31.000Z")
  assert.equal(snap.activity.daily?.[0].totalCostMicroCents, "94043113")
})

test("activity 失败仅记错误且不影响其它数据", async () => {
  stubFetch([{ matched: "/console/api/activity/go", status: 403, body: "{}" }, { matched: "/console/api/go/status", body: GO }, { matched: "/console/api/billing/status", body: "{}" }, { matched: "/console/api/members", body: "{}" }])
  const snap = await fetchUsage("t")
  assert.equal(snap.activity, undefined)
  assert.ok(snap.go)
  assert.ok(snap.errors.some((e) => e.startsWith("activity")))
})
```

- [ ] **Step 2: Run test to verify it fails** — `node --test` → 两条 test 里 "附带 activity 数据" FAIL（snap.activity undefined）。
- [ ] **Step 3: Implement** — `usage.ts`：加 `ActivityGo` interface 与 `UsageSnapshot.activity` 字段；`fetchUsage` 的 `Promise.all` 里并行加 `read<ActivityGo>("/console/api/activity/go")` 成功挂 `snapshot.activity`、catch 追记 `activity: ${describe(error)}`。
- [ ] **Step 4: Run test to verify it passes** — `node --test` 全绿。
- [ ] **Step 5: 既有测试不受影响**（无 commit，见 Global Constraints）— 跑全量 `node --test` 即收尾。

### Task 2: `forecastView()` 复刻官方算法

**Files:**
- Modify: `usage.ts`（文件末尾新增函数与类型）
- Test: `test/usage.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `UsageSnapshot.activity` 与 `meters.month`。
- Produces:

```ts
export interface ForecastDay { date: string; usd: number; percent: number }
export interface ForecastView {
  windowDays: number
  elapsedDays: number
  daily: ForecastDay[]            // 仅本期、按日期升序
  totalUsd: number
  percentUsed: number             // c，2 位小数，≤100
  forecastPercent?: number        // elapsed<1d 时 undefined
  runsOutAt?: string              // ISO；forecast>100 且未耗尽才有
  exhausted: boolean
}
export function forecastView(snapshot: UsageSnapshot | undefined, now?: number): ForecastView | undefined
// 无 activity 或无 month meter 时返回 undefined；now 不传用 Date.now()
```

- [ ] **Step 1: Write the failing test**（期界：window 11/04T13:02Z→12/04T13:02Z 共 30d；用 blob 用例：期起 `2026-11-01T00:00:00Z` 期终 `2026-12-01T00:00:00Z`，limit $60，daily 5 天 $0.08/$0.55/$0.49/$0.68/$0.94，meters.month.used 对应 $3.08）

```js
const meta = {
  meter: { resetsAt: "2026-12-01T00:00:00.000Z", limitMicroCents: "6000000000", usedMicroCents: "308000000" },
  activity: {
    startsAt: "2026-11-01T00:00:00.000Z",
    daily: [
      { date: "2026-11-01", totalCostMicroCents: "8000000" },
      { date: "2026-11-02", totalCostMicroCents: "55000000" },
      { date: "2026-11-03", totalCostMicroCents: "49000000" },
      { date: "2026-11-04", totalCostMicroCents: "68000000" },
      { date: "2026-11-05", totalCostMicroCents: "94000000" },
    ],
  },
}
function snapOf(nowISO, months) { return { fetchedAt: Date.parse(nowISO), errors: [], go: { access: { meters: { month: months ?? meta.meter } } }, activity: meta.activity } }
const NOW = Date.parse("2026-11-05T12:00:00Z") // elapsed 4.5d，window 30d

test("forecastView 正常外推", () => {
  const f = forecastView(snapOf("", NOW), NOW)
  assert.equal(f.windowDays > 29 && f.windowDays <= 31, true)
  assert.ok(Math.abs(f.percentUsed - (Number(meta.meter.usedMicroCents) / Number(meta.meter.limitMicroCents)) * 100) < 0.02)
  // 共 5 天 $3.08；11/05 占 $0.94 → 柱 percent = c*0.94/3.08
  assert.ok(Math.abs(f.daily.at(-1).percent - f.percentUsed * (0.94 / 3.08)) < 0.01)
  // forecast = c × 30/4.5 ≈ 5.13×6.67 ≈ 34.2
  assert.ok(Math.abs(f.forecastPercent - f.percentUsed * 30 / 4.5) < 0.05)
  assert.equal(f.runsOutAt, undefined)
})

test("forecastView 触顶给出 runsOutAt", () => {
  // 半天烧掉 $45（75%），30d 期 → forecast=75×(30d/0.5d)=4500>100
  // runsOut = start+0.5d×100/75 = 11/01T16:00Z
  const used = { resetsAt: "2026-12-01T00:00:00.000Z", limitMicroCents: "6000000000", usedMicroCents: "4500000000" }
  const act = {
    startsAt: "2026-11-01T00:00:00.000Z",
    daily: [
      { date: "2026-11-01", totalCostMicroCents: "4500000000" },
      { date: "2026-11-02", totalCostMicroCents: "0" },
    ],
  }
  const f = forecastView({ fetchedAt: NOW, errors: [], go: { access: { meters: { month: used } } }, activity: act }, Date.parse("2026-11-01T12:00:00Z"))
  assert.ok(f.forecastPercent > 100)
  assert.equal(new Date(f.runsOutAt).toISOString().startsWith("2026-11-01T16:00"), true)
})

> **Amendment (2026-11-09, 审查后):** 上文 Task 2 fixture 有三处算术/语义错误，实现按官方语义为准（详见台账 rulings）：① `daily` 归一除数是 daily 系列总量 **$2.74**，不是 meter 用量 $3.08（`totalUsd` 断言应为 2.74）；② 触顶用例 `elapsed` 必须 ≥1 天，否则命中 `<1d` 规则先返回 undefined（改用 1.5 天、runsOut 11/03T00:00Z）；③ 零消费用例 `percentUsed` 来自 meter、与 daily 无关，`daily` 应为空且不伪造 $0 行。另：`now > resetsAt` 返回 undefined（非 clamp）；期首日按 `date ≥ startsAt 的 UTC 日` 过滤（不能用完整时间戳，否则省首日）。后续执行者请勿把代码改回本节旧断言。

test("elapsed<1d 时 forecast 未定义", () => {
  const f = forecastView(snapOf("", meta.meter), Date.parse("2026-11-01T06:00:00Z"))
  assert.equal(f.forecastPercent, undefined)
  assert.equal(f.runsOutAt, undefined)
})

test("now 出界被 clamp、activity 缺失返回 undefined", () => {
  assert.equal(forecastView(snapOf("", meta.meter), Date.parse("2026-12-15T00:00:00Z"))?.forecastPercent, undefined)
  assert.equal(forecastView({ fetchedAt: NOW, errors: [], go: { access: { meters: { month: meta.meter } } } }, NOW), undefined)
})

test("daily 含期前历史日被过滤", () => {
  const act = { startsAt: "2026-11-01T00:00:00.000Z", daily: [{ date: "2026-10-20", totalCostMicroCents: "9900000000" }, ...meta.activity.daily] }
  const f = forecastView({ fetchedAt: NOW, errors: [], go: { access: { meters: { month: meta.meter } } }, activity: act }, NOW)
  assert.equal(f.daily.every((d) => d.date >= "2026-11-01"), true)
  assert.equal(f.totalUsd, 3.08)
})

test("零消费期不除零", () => {
  const act = { startsAt: "2026-11-01T00:00:00.000Z", daily: [{ date: "2026-11-05", totalCostMicroCents: "0" }] }
  const f = forecastView({ fetchedAt: NOW, errors: [], go: { access: { meters: { month: meta.meter } } }, activity: act }, NOW)
  assert.equal(f.percentUsed, 0)
  assert.ok(f.daily.length >= 1)
})
```

（第二例 runsOut 断言按官方公式 start=11/01T00:00Z，elapsed=12h=0.5d，c=75 → runsOut=start+0.5d×100/75=11/01T16:00Z；断言写 `d.toISOString().startsWith("2026-11-01T16:00")`。）

- [ ] **Step 2: Run test to verify it fails** — `node --test` → 新增 6 例 FAIL（forecastView is not exported）。
- [ ] **Step 3: Implement `forecastView`** § 算法按 Global Constraints 第 5 条，窗口取 `activity.startsAt`（缺则 `access.startsAt`，仍无 → undefined）与 `meters.month.resetsAt`；daily 过滤 `date ≥ startsAt 的 UTC 日`；`percentUsed` 与外推照抄 Global Constraints；total = daily 之和（µc→USD /1e8）；daily 全 0 时 total=0 → daily 塌缩 `[{今日, 0}]`。
- [ ] **Step 4: Run test to verify it passes** — 全绿。
- [ ] **Step 5: 全量回归** — `node --test`。

### Task 3: `renderReport` 增「本期日消费」节

**Files:**
- Modify: `usage.ts:206-252`（renderReport 中 meters 表之后、Console 之前插入新节）
- Test: `test/usage.test.mjs`

**Interfaces:**
- Consumes: Task 2 `forecastView`。
- Produces: 报告固定输出（字符串断言锚点为本任务之测试，也是 Task 5 端到端检查的基准）：
  - 节标题：``**本期日消费**（11/05 以来 · 月上限 $60）``（期起取 `activity.startsAt` 的 UTC 日 `M/D`；上限 `formatUsd(limitMicroCents)`）
  - 表：每块 6 列，**整体放进 ``` 代码块**（客户端不渲染 GFM 表格时仍能等宽对齐显示）；块内表头 `| 11/04 | 11/05 | … |`（UTC 日 `M/D（今）`），紧跟分隔行 `| --- | … |`，下一行 `| $0.08 | $0.55 | … |`（`formatUsdCompact`）；分块之间空行隔开；daily 为空（无消费日）时不输出本节。Go meter 表同样放进代码块。
  - 结论行（forecastPercent ≤ 100 且非触顶）：`→ 本期结束（12/04）预计用量 ~34%，暂无触顶风险`（余额重置日 → resetsAt 的 `M/D`）
  - 结论行（>100）：`→ ⚠ 按此节奏预计 {M/D} 触顶`（runsOutAt 的 `M/D`）
  - 结论行（exhausted）：`→ ⚠ 本期额度已用尽`

- [ ] **Step 1: Write the failing test**

```js
import { forecastView, renderReport } from "../usage.ts"

test("renderReport 含本期日消费表与 forecast 结论", () => {
  const out = renderReport(snapOf("", NOW), NOW)
  assert.match(out, /\*\*本期日消费\*\*（11\/01 以来 · 月上限 \$60）/)
  assert.match(out, /\| 11\/05.*\$0\.94/)
  assert.match(out, /→ 本期结束（12\/01）预计用量 ~34%，暂无触顶风险/)
})

test("renderReport 触顶变体", () => {
  // 复用 Task 2 的 45% 半天例 → 含 `→ ⚠ 按此节奏预计 11/01 触顶` 且不含「暂无触顶风险」
})

test("无 activity 时报告不出现本期日消费节", () => {
  // 用 go-only snapshot → /本期日消费/ 不匹配，其余节不变
})
```

- [ ] **Step 2: Run test to verify it fails** — `node --test` → 新增 3 例 FAIL。
- [ ] **Step 3: Implement renderReport 插节** — 仅当 `f = forecastView(...)` 存在时插节；分块 6 列用私有 helper `chunk(arr, n)`；`（今）`判断：`d.date === new Date(now).toISOString().slice(0,10)`（UTC 日）。
- [ ] **Step 4: Run test to verify it passes** — 全绿。
- [ ] **Step 5: 全量回归** — `node --test`。

### Task 4: 侧边栏 forecast 行（`sidebarLines` + sparkline helper）

**Files:**
- Modify: `usage.ts`（文件末尾新增；`sidebarLines` 在 Console 行前插一行）
- Test: `test/usage.test.mjs`

**Interfaces:**
- Consumes: Task 2 `forecastView`。
- Produces:

```ts
export const SPARK_BLOCKS = "▁▂▃▄▅▆▇█"
export function sparkline(days: number[], width?: number): string  // 默认 8 格；样本≤width 时逐日，>width 时按等宽分组取 max
export function forecastLabel(f: ForecastView | undefined, now?: number): string
// forecastPercent===undefined → ""；exhausted → `已触顶`；overrun → `MM/DD 触顶`；否则 → `月底约 ${Math.round}% ↗`
export function forecastLine(snapshot: UsageSnapshot | undefined, now?: number): string
// 无 forecast → ""；有 → sparkline + " " + label（如 `▁▂▄▅▆▇▂▂ 月底约 34% ↗`）
```

- [ ] **Step 1: Write the failing test**（日期复用 Task 2 fixtures）

```js
import { forecastLabel, forecastLine, sidebarLines, sparkline } from "../usage.ts"

test("sparkline 分组与空样", () => {
  assert.equal(sparkline([], 8), "")
  assert.equal(sparkline([0, 0, 0, 0, 1, 0, 0, 0, 2], 8).length, 8)
})

test("forecastLabel 三态", () => {
  assert.equal(forecastLabel({ ...f34, forecastPercent: undefined }), "")
  assert.equal(forecastLabel(f34), "月底约 34% ↗")
  assert.equal(forecastLabel({ ...f34, forecastPercent: 150.4, runsOutAt: "2026-11-28T00:00:00Z" }), "11/28 触顶")
})

test("sidebarLines 在 Console 行前插 forecast 行", () => {
  const lines = sidebarLines(snapOf("", NOW), NOW)
  const i = lines.findIndex((l) => l.includes("月底约"))
  assert.ok(i > 0)
  assert.ok(lines[i + 1]?.startsWith("Console"), "forecast 行之后才是 Console")
})

test("无 forecast 的 snapshot 无 forecast 行", () => {
  assert.equal(sidebarLines(snapOf("", NOW).go ? { ...snapOf("", NOW), activity: undefined } : snapOf("", NOW), NOW).some((l) => l.includes("月底约")), false)
})
```

（f34 为 Task 2 正常外推例的 `forecastView` 产物。）

- [ ] **Step 2: Run test to verify it fails**。
- [ ] **Step 3: Implement three functions + sidebarLines 插行** — `sidebarLines` 现有实现里 `const balance = formatUsd(...)` 前插入 `const forecast = forecastLine(snapshot, now); if (forecast) lines.push(forecast)`。
- [ ] **Step 4: Run test to verify it passes**。
- [ ] **Step 5: 全量回归** — `node --test`。

### Task 5: TUI 接线 + 端到端验证

**Files:**
- Modify: `tui.tsx:3-10`（import 增 `forecastLine`）、`tui.tsx:112-121`（resets `<Show>` 后插一个 forecast `<text>`）、`tui.tsx:74-91`（`UsagePanel` 增 `forecast` 访问器）
- Modify: `README.md`（功能节补两行：/usage 输出样例 + 侧边栏行样例；数据源列加 `/console/api/activity/go`）
- Test: pty 视觉验证 + `/usage` service 端到端

**Interfaces:**
- Consumes: Task 4 `forecastLine`（服务端 `sidebarLines` 不再被 tui 用，仅留 API 对齐）。
- Produces: 侧边栏第 4 行 `<text>{forecastline}</text>`，fg 由 `forecastView(...).status` 决定：`exhausted`/`overrun` → `theme.text.feedback.error.base`；`warn`（外推 ≥30%）→ `theme.text.feedback.warning.base`；否则 `theme.text.muted`（按显示文本正则判色已被审查否决）。

- [ ] **Step 1: tui.tsx 三处接线** — import 增 `forecastLine`；`UsagePanel` 内 `const forecast = () => forecastLine(props.snapshot)`；resets `<Show>` 与 Console `<Show>` 之间加：

```jsx
<Show when={forecast()}>
  <text fg={forecastColor()}>{forecast()}</text>
</Show>
```

`forecastColor()` 语义：含「触顶」→ `theme.text.feedback.error.base`；含 `约 N% ↗` 中 N≥30 → `theme.text.feedback.warning.base`；否则 `theme.text.muted`。

- [ ] **Step 2: pty 视觉验证** — 复用 `C:\Users\KHadas\AppData\Local\Temp\opencode\pty-screen.cjs`（若已被清理则按 checkpoint 记法重建：node-pty 起 `opencode` TUI，`ctrl+x b` 开侧边栏，截图校验：
  - `OpenCode 用量` 面板出现 forecast 行如 `▁▂▄▅▆▇ 月底约 X% ↗` 位于 resets 行与 Console 行之间；
  - 颜色 class 按 >30% 规则未见 exception 日志；
  - forecast 数据取不到时不出现空行占位。
- [ ] **Step 3: `/usage` 端到端** — `opencode-cli.exe api post "/api/session/<sesID>/command" --body '{"name":"usage","text":""}'`（body 键 `name`+`text`）→ 输出含 `**本期日消费**` 节与 `→ … 预计用量` 行。
- [ ] **Step 4: 全量回归 + README** — `node --test` 绿；README 节补完。

## Self-Review 记录（自查通过项）

- Spec coverage： Goals A（/usage 表+结论行）→ Task 3；B（侧边栏一行）→ Task 4/5；非目标未掺入。降级路径 → Review Focus 5 与 Task 3/4 test。
- 类型一致：`ForecastView`/`ForecastDay`/`forecastLine` 签名在 Task 2/3/4/5 一致。
- 步骤均为单一动作；无 TBD。
- 无 git repo → 无 commit 步骤（Global Constraints 已声明）。
