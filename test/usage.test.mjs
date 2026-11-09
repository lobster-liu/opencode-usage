import { test } from "node:test"
import assert from "node:assert/strict"
import {
  activeCredentialEntry,
  fetchUsage,
  forecastLabel,
  forecastLine,
  forecastView,
  renderReport,
  sidebarLines,
  sparkline,
} from "../usage.ts"

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
  access: {
    meters: {
      fiveHour: { limitMicroCents: "1200000000", usedMicroCents: "50000000" },
      month: { resetsAt: "2026-12-04T13:02:31.000Z", limitMicroCents: "6000000000", usedMicroCents: "3000000000" },
    },
  },
  product: "go",
  useBalance: false,
})
const ACT = JSON.stringify({
  startsAt: "2026-11-04T13:02:31.000Z",
  daily: [{ date: "2026-11-08", totalCostMicroCents: "94043113", totalRequests: "435" }],
  models: [{ provider: "opencode-go", model: "deepseek-v4.1-flash", totalRequests: "1442" }],
})

function baseResponses(act = ACT) {
  return [
    { matched: "/console/api/activity/go", body: act },
    { matched: "/console/api/go/status", body: GO },
    { matched: "/console/api/billing/status", body: "{}" },
    { matched: "/console/api/members", body: '{"items":[]}' },
  ]
}

test("fetchUsage 附带 activity 数据", async () => {
  stubFetch(baseResponses())
  const snap = await fetchUsage("t")
  assert.ok(snap.activity)
  assert.equal(snap.activity.startsAt, "2026-11-04T13:02:31.000Z")
  assert.equal(snap.activity.daily?.[0].totalCostMicroCents, "94043113")
})

test("activity 失败仅记错误且不影响其它数据", async () => {
  stubFetch(baseResponses("{}").map((r) => (r.matched === "/console/api/activity/go" ? { ...r, status: 403 } : r)))
  const snap = await fetchUsage("t")
  assert.equal(snap.activity, undefined)
  assert.ok(snap.go)
  assert.ok(snap.errors.some((e) => e.startsWith("activity")))
})

// ---- Task 2: forecastView ----

const META = {
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
const NOW = Date.parse("2026-11-05T12:00:00Z") // elapsed 4.5d of 30d

function snapOf(months = META.meter, activity = META.activity) {
  return { fetchedAt: NOW, errors: [], go: { access: { meters: { month: months } } }, activity }
}

test("forecastView 正常外推", () => {
  const f = forecastView(snapOf(), NOW)
  assert.ok(f.windowDays > 29 && f.windowDays <= 31)
  assert.ok(Math.abs(f.percentUsed - (Number(META.meter.usedMicroCents) / Number(META.meter.limitMicroCents)) * 100) < 0.02)
  // 共 5 天 daily 合计 $2.74；11/05 占 $0.94 → 日柱 percent = c × 0.94/2.74（官方按 daily 系列总量归一）
  assert.ok(Math.abs(f.daily.at(-1).percent - f.percentUsed * (0.94 / 2.74)) < 0.01)
  assert.ok(Math.abs(f.forecastPercent - (f.percentUsed * 30) / 4.5) < 0.05)
  assert.equal(f.runsOutAt, undefined)
  assert.equal(f.exhausted, false)
})

test("forecastView 触顶给出 runsOutAt", () => {
  // 1.5 天烧掉 $45（75%），30d 期 → forecast=75×(30/1.5)=1500>100
  // runsOut = start+1.5d×100/75 = 11/03T00:00Z
  const used = { resetsAt: "2026-12-01T00:00:00.000Z", limitMicroCents: "6000000000", usedMicroCents: "4500000000" }
  const act = {
    startsAt: "2026-11-01T00:00:00.000Z",
    daily: [
      { date: "2026-11-01", totalCostMicroCents: "4500000000" },
      { date: "2026-11-02", totalCostMicroCents: "0" },
    ],
  }
  const f = forecastView(snapOf(used, act), Date.parse("2026-11-02T12:00:00Z"))
  assert.ok(f.forecastPercent > 100)
  assert.equal(new Date(f.runsOutAt).toISOString().startsWith("2026-11-03T00:00"), true)
})

test("elapsed<1d 时 forecast 未定义", () => {
  const f = forecastView(snapOf(), Date.parse("2026-11-01T06:00:00Z"))
  assert.equal(f.forecastPercent, undefined)
  assert.equal(f.runsOutAt, undefined)
})

test("now 出界被 clamp、activity 缺失返回 undefined", () => {
  assert.equal(forecastView(snapOf(), Date.parse("2026-12-15T00:00:00Z"))?.forecastPercent, undefined)
  assert.equal(forecastView({ fetchedAt: NOW, errors: [], go: { access: { meters: { month: META.meter } } } }, NOW), undefined)
})

test("daily 含期前历史日被过滤", () => {
  const act = {
    startsAt: "2026-11-01T00:00:00.000Z",
    daily: [{ date: "2026-10-20", totalCostMicroCents: "9900000000" }, ...META.activity.daily],
  }
  const f = forecastView(snapOf(META.meter, act), NOW)
  assert.equal(f.daily.every((d) => d.date >= "2026-11-01"), true)
  assert.ok(Math.abs(f.totalUsd - 2.74) < 0.001)
})

test("零消费期不除零", () => {
  const meter = { resetsAt: "2026-12-01T00:00:00.000Z", limitMicroCents: "6000000000", usedMicroCents: "0" }
  const act = { startsAt: "2026-11-01T00:00:00.000Z", daily: [{ date: "2026-11-05", totalCostMicroCents: "0" }] }
  const f = forecastView(snapOf(meter, act), NOW)
  assert.equal(f.percentUsed, 0)
  assert.deepEqual(f.daily, [])
  assert.equal(f.forecastPercent, 0)
  assert.equal(f.status, "ok")
})

// ---- Task 3: renderReport 本期日消费节 ----

test("renderReport 含本期日消费表与 forecast 结论", () => {
  const out = renderReport(snapOf(), NOW)
  assert.match(out, /\*\*本期日消费\*\*（11\/1 以来 · 月上限 \$60）/)
  assert.match(out, /\| 11\/5（今） \|/)
  assert.match(out, /\| \$0\.94 \|/)
  assert.match(out, /→ 本期结束（12\/1）预计用量 ~34%，暂无触顶风险/)
})

test("renderReport 触顶变体", () => {
  const used = { resetsAt: "2026-12-01T00:00:00.000Z", limitMicroCents: "6000000000", usedMicroCents: "4500000000" }
  const act = {
    startsAt: "2026-11-01T00:00:00.000Z",
    daily: [
      { date: "2026-11-01", totalCostMicroCents: "4500000000" },
      { date: "2026-11-02", totalCostMicroCents: "0" },
    ],
  }
  const out = renderReport(snapOf(used, act), Date.parse("2026-11-02T12:00:00Z"))
  assert.match(out, /→ ⚠ 按此节奏预计 11\/3 触顶/)
  assert.doesNotMatch(out, /暂无触顶风险/)
})

test("无 activity 时报告不出现本期日消费节", () => {
  const out = renderReport({ fetchedAt: NOW, errors: [], go: { access: { meters: { month: META.meter } } } }, NOW)
  assert.doesNotMatch(out, /本期日消费/)
  assert.match(out, /OpenCode 用量/)
})

// ---- Task 4: sidebar forecast row ----

const F34 = forecastView(snapOf(), NOW)

test("sparkline 分组与空样", () => {
  assert.equal(sparkline([]), "")
  assert.equal(sparkline([0, 0, 0, 0, 1, 0, 0, 0, 2]).length, 8)
})

test("forecastLabel 三态", () => {
  assert.equal(forecastLabel({ ...F34, forecastPercent: undefined }), "")
  assert.equal(forecastLabel(F34), "月底约 34% ↗")
  assert.equal(forecastLabel({ ...F34, status: "exhausted" }), "已触顶")
  assert.equal(
    forecastLabel({ ...F34, status: "overrun", forecastPercent: 150.4, runsOutAt: "2026-11-28T00:00:00Z" }),
    "11/28 触顶",
  )
})

test("sidebarLines 在 Console 行前插 forecast 行", () => {
  const snapshot = { ...snapOf(), billing: { balanceMicroCents: "940000000" } }
  const lines = sidebarLines(snapshot, NOW)
  const i = lines.findIndex((l) => l.includes("月底约"))
  assert.ok(i > 0)
  assert.match(lines[i + 1], /^Console/)
  assert.equal(lines[i].length >= 9 && lines[i].length <= 20, true)
})

test("无 forecast 的 snapshot 无 forecast 行", () => {
  const lines = sidebarLines({ ...snapOf(), activity: undefined }, NOW)
  assert.equal(lines.some((l) => l.includes("月底约")), false)
})

// ---- Review 修复：GFM 表格完整性 / 期首日 / 触顶 / 空日序列 ----

test("日消费表是合法 GFM：每分块有分隔行、分块间空行", () => {
  const act = {
    startsAt: "2026-11-01T00:00:00.000Z",
    daily: Array.from({ length: 8 }, (_, i) => ({
      date: `2026-11-0${i + 1}`,
      totalCostMicroCents: "10000000",
    })),
  }
  const out = renderReport(snapOf(META.meter, act), Date.parse("2026-11-08T12:00:00Z"))
  const section = out.slice(out.indexOf("**本期日消费**"))
  const table = section.split("\n").filter((line) => line.startsWith("|"))
  // 两个分块 × (日期表头 + 分隔行 + 金额行) = 6 行
  assert.equal(table.length, 6)
  assert.match(table[1], /^\|( --- \|)+$/)
  assert.match(table[4], /^\|( --- \|)+$/)
  assert.match(out, /\| \$0\.1 \| \$0\.1 \| \$0\.1 \| \$0\.1 \| \$0\.1 \| \$0\.1 \|\n\n\| 11\/7 \|/)
})

test("期首日按日期过滤（startsAt 非零点也要包含当天）", () => {
  const act = {
    startsAt: "2026-11-04T13:02:31.000Z",
    daily: [
      { date: "2026-11-04", totalCostMicroCents: "200000000" },
      { date: "2026-11-05", totalCostMicroCents: "100000000" },
    ],
  }
  const f = forecastView(snapOf(META.meter, act), Date.parse("2026-11-05T12:00:00Z"))
  assert.equal(f.daily.length, 2)
  assert.equal(f.daily[0].date, "2026-11-04")
  assert.ok(Math.abs(f.totalUsd - 3) < 1e-9)
})

test("已触顶：status/label/报告均为明确的触顶状态", () => {
  const used = { resetsAt: "2026-12-01T00:00:00.000Z", limitMicroCents: "6000000000", usedMicroCents: "6000000000" }
  const act = { startsAt: "2026-11-01T00:00:00.000Z", daily: [{ date: "2026-11-01", totalCostMicroCents: "6000000000" }] }
  const now = Date.parse("2026-11-05T12:00:00Z")
  const f = forecastView(snapOf(used, act), now)
  assert.equal(f.exhausted, true)
  assert.equal(f.status, "exhausted")
  assert.equal(forecastLabel(f), "已触顶")
  const out = renderReport(snapOf(used, act), now)
  assert.match(out, /→ ⚠ 本期额度已用尽/)
  assert.doesNotMatch(out, /暂无触顶风险/)
})

test("activity 成功但日序列为空：不出本节、不伪造 $0、sparkline 为空", () => {
  const act = { startsAt: "2026-11-01T00:00:00.000Z", daily: [] }
  const snapshot = snapOf(META.meter, act)
  const out = renderReport(snapshot, NOW)
  assert.doesNotMatch(out, /本期日消费/)
  const f = forecastView(snapshot, NOW)
  assert.deepEqual(f.daily, [])
  assert.equal(forecastLine(snapshot, NOW), "月底约 34% ↗")
})

test("forecast status 三档：warn / overrun / exhausted", () => {
  assert.equal(forecastView(snapOf(), NOW).status, "warn")
  const used = { resetsAt: "2026-12-01T00:00:00.000Z", limitMicroCents: "6000000000", usedMicroCents: "4500000000" }
  const act = {
    startsAt: "2026-11-01T00:00:00.000Z",
    daily: [
      { date: "2026-11-01", totalCostMicroCents: "4500000000" },
      { date: "2026-11-02", totalCostMicroCents: "0" },
    ],
  }
  assert.equal(forecastView(snapOf(used, act), Date.parse("2026-11-02T12:00:00Z")).status, "overrun")
})

// ---- Task 5: TUI 凭据解析（v2 SDK 返回 { data } 包装） ----

const CREDS = [
  { integrationID: "opencode", active: false, value: { type: "oauth", access: "st_old" } },
  { integrationID: "opencode", active: true, value: { type: "oauth", access: "st_new" } },
]

test("activeCredentialEntry 兼容数组与 { data } 包装，优先 active", () => {
  assert.equal(activeCredentialEntry(CREDS).value.access, "st_new")
  assert.equal(activeCredentialEntry({ data: CREDS }).value.access, "st_new")
  assert.equal(activeCredentialEntry([...CREDS].reverse()).value.access, "st_new")
  assert.equal(activeCredentialEntry(undefined), undefined)
  assert.equal(activeCredentialEntry({ data: [] }), undefined)
  assert.equal(activeCredentialEntry([{ integrationID: "other", active: true }]), undefined)
})
