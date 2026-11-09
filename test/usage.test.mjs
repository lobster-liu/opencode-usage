import { test } from "node:test"
import assert from "node:assert/strict"
import { fetchUsage, forecastView } from "../usage.ts"

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
  assert.ok(f.daily.length >= 1)
  assert.equal(f.forecastPercent, 0)
})
