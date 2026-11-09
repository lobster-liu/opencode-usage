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
