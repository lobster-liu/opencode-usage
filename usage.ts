/**
 * Shared OpenCode Console usage helpers.
 *
 * Every endpoint below is authenticated with the OpenCode Console credential
 * that OpenCode already stores for the "opencode" integration, so no extra
 * configuration or API key is needed:
 *
 *   GET /console/api/go/status       Go subscription + 5h / week / month meters
 *   GET /console/api/billing/status  prepaid balance (Console credits)
 *   GET /console/api/members         per-member spend for the current month
 */

export const CONSOLE_ORIGIN = "https://opencode.ai"

export interface GoMeter {
  startsAt?: string
  resetsAt?: string
  limitMicroCents?: string
  usedMicroCents?: string
}

export interface GoStatus {
  product?: string
  useBalance?: boolean
  cancelAtPeriodEnd?: boolean
  resumability?: string
  access?: {
    startsAt?: string
    endsAt?: string
    meters?: {
      fiveHour?: GoMeter
      week?: GoMeter
      month?: GoMeter
    }
  }
}

export interface BillingStatus {
  billingMode?: string
  mode?: string
  balanceMicroCents?: string
  creditLimitMicroCents?: string | null
  availableMicroCents?: string
}

export interface MembersResponse {
  items?: Array<{
    userId?: string
    email?: string
    role?: string
    spentMicroCents?: string
  }>
}

/** GET /console/api/activity/go — the Console Activity page's Go spending chart data. */
export interface ActivityGo {
  startsAt?: string
  daily?: Array<{
    date?: string
    totalCostMicroCents?: string
    totalTokens?: string
    totalRequests?: string
  }>
  models?: Array<{ provider?: string; model?: string; totalRequests?: string }>
}

export interface UsageSnapshot {
  fetchedAt: number
  go?: GoStatus
  billing?: BillingStatus
  spentMicroCents?: string
  activity?: ActivityGo
  errors: string[]
}

export interface CredentialEntry {
  id?: string
  integrationID?: string
  active?: boolean
  label?: string
  value?: { type?: string; access?: string; [key: string]: unknown }
}

/**
 * TUI 的 v2 SDK 会把凭据列表包成 `{ data: [...] }`（旧版直接返回数组）。
 * 统一取出 `integrationID === "opencode"` 的条目，优先 active 的那条。
 */
export function activeCredentialEntry(result: unknown): CredentialEntry | undefined {
  const raw = result as { data?: unknown } | undefined
  const entries: CredentialEntry[] = Array.isArray(result)
    ? (result as CredentialEntry[])
    : Array.isArray(raw?.data)
      ? (raw!.data as CredentialEntry[])
      : []
  const candidates = entries.filter((item) => item?.integrationID === "opencode")
  return candidates.find((item) => item?.active) ?? candidates[0]
}

export interface MeterView {
  key: "fiveHour" | "week" | "month"
  label: string
  meter: GoMeter
  percent: number
  used: string
  limit: string
  reset: string
}

export async function fetchUsage(token: string): Promise<UsageSnapshot> {
  const snapshot: UsageSnapshot = { fetchedAt: Date.now(), errors: [] }
  const bearer = { Authorization: `Bearer ${token}`, Accept: "application/json" }

  const read = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${CONSOLE_ORIGIN}${path}`, { headers: bearer })
    if (!res.ok) throw new Error(`${path} responded ${res.status}`)
    return (await res.json()) as T
  }

  await Promise.all([
    read<GoStatus>("/console/api/go/status")
      .then((go) => {
        snapshot.go = go
      })
      .catch((error) => snapshot.errors.push(`go: ${describe(error)}`)),
    read<ActivityGo>("/console/api/activity/go")
      .then((activity) => {
        snapshot.activity = activity
      })
      .catch((error) => snapshot.errors.push(`activity: ${describe(error)}`)),
    read<BillingStatus>("/console/api/billing/status")
      .then((billing) => {
        snapshot.billing = billing
      })
      .catch((error) => snapshot.errors.push(`billing: ${describe(error)}`)),
    read<MembersResponse>("/console/api/members")
      .then((members) => {
        const spent = members.items?.map((item) => item.spentMicroCents).find((value) => value !== undefined)
        if (spent !== undefined) snapshot.spentMicroCents = spent
      })
      .catch((error) => snapshot.errors.push(`members: ${describe(error)}`)),
  ])

  return snapshot
}

export function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function formatUsd(microCents: string | number | null | undefined): string {
  if (microCents === undefined || microCents === null || microCents === "") return "-"
  const value = Number(microCents)
  if (!Number.isFinite(value)) return "-"
  const usd = value / 100_000_000
  if (Math.abs(usd) < 0.01) return "$" + usd.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")
  if (Math.abs(usd) < 100) return "$" + usd.toFixed(2)
  return "$" + usd.toFixed(0)
}

/** Shorter money format for the narrow TUI sidebar: "$0.85", "$30", "$12". */
export function formatUsdCompact(microCents: string | number | null | undefined): string {
  if (microCents === undefined || microCents === null || microCents === "") return "-"
  const value = Number(microCents)
  if (!Number.isFinite(value)) return "-"
  const usd = value / 100_000_000
  if (Math.abs(usd) < 1) return "$" + usd.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
  if (Math.abs(usd) < 10) return "$" + usd.toFixed(1).replace(/\.0$/, "")
  return "$" + usd.toFixed(0)
}

export function percentOf(used: string | undefined, limit: string | undefined): number {
  const usedValue = Number(used ?? Number.NaN)
  const limitValue = Number(limit ?? Number.NaN)
  if (!Number.isFinite(usedValue) || !Number.isFinite(limitValue) || limitValue <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((usedValue / limitValue) * 100)))
}

export function formatCountdown(target: string | undefined | null, now: number = Date.now()): string {
  if (!target) return ""
  const time = new Date(target).getTime()
  if (!Number.isFinite(time)) return ""
  const delta = time - now
  if (delta <= 0) return "now"
  const minutes = Math.floor(delta / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days >= 1) return `${days}d${hours}h`
  if (hours >= 1) return `${hours}h${String(minutes % 60).padStart(2, "0")}m`
  return `${Math.max(1, minutes)}m`
}

export function goProductLabel(product: string | undefined): string {
  if (product === "go-plus") return "Go Plus"
  if (product === "go") return "Go"
  return "Go"
}

export function meterViews(snapshot: UsageSnapshot | undefined, now: number = Date.now()): MeterView[] {
  const meters = snapshot?.go?.access?.meters
  if (!meters) return []
  const entries: Array<[MeterView["key"], string, GoMeter | undefined]> = [
    ["fiveHour", "5h", meters.fiveHour],
    ["week", "周", meters.week],
    ["month", "月", meters.month],
  ]
  return entries
    .filter(([, , meter]) => meter !== undefined)
    .map(([key, label, meter]) => {
      const value = meter as GoMeter
      return {
        key,
        label,
        meter: value,
        percent: percentOf(value.usedMicroCents, value.limitMicroCents),
        used: formatUsd(value.usedMicroCents),
        limit: formatUsd(value.limitMicroCents),
        reset: formatCountdown(value.resetsAt, now),
      }
    })
}

export interface ForecastDay {
  date: string
  usd: number
  percent: number
}

export interface ForecastView {
  windowDays: number
  elapsedDays: number
  daily: ForecastDay[]
  totalUsd: number
  percentUsed: number
  forecastPercent?: number
  runsOutAt?: string
  exhausted: boolean
  /** 展示语义：ok（<30% 或无外推）/ warn（≥30%）/ overrun（按节奏会提前触顶）/ exhausted（已用尽）。 */
  status: "ok" | "warn" | "overrun" | "exhausted"
}

function microCentsToUsd(value: string | number | undefined): number {
  return Number(value ?? 0) / 100_000_000
}

/**
 * Official Console forecast algorithm (the frontend `Ome` helper in the
 * Console bundle): percent-used `c` scaled linearly over the remaining
 * window, daily bars proportional to each day's share of the period total,
 * and an on-pace overrun date when the forecast crosses 100%.
 *
 *   c = percent used (2 decimals; 100 when exhausted)
 *   daily value = c × day cost ÷ period total
 *   forecast = c × (full window ÷ elapsed), only when elapsed ≥ 1 day
 */
export function forecastView(snapshot: UsageSnapshot | undefined, now: number = Date.now()): ForecastView | undefined {
  const meter = snapshot?.go?.access?.meters?.month
  const startsAt = snapshot?.activity?.startsAt ?? snapshot?.go?.access?.startsAt
  const resetsAt = meter?.resetsAt
  if (!meter?.limitMicroCents || !startsAt || !resetsAt) return undefined

  const start = new Date(startsAt).getTime()
  const end = new Date(resetsAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined

  const used = Number(meter.usedMicroCents ?? 0)
  const limit = Number(meter.limitMicroCents)
  const exhausted = used >= limit
  const percentUsed = exhausted || limit <= 0 ? 100 : Math.round((used / limit) * 10000) / 100

  const startDate = new Date(start).toISOString().slice(0, 10)
  const sourceDays = (snapshot.activity?.daily ?? [])
    .filter((day) => !!day.date && day.date >= startDate)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  const usdDays = sourceDays.map((day) => ({ date: day.date as string, usd: microCentsToUsd(day.totalCostMicroCents) }))
  const totalUsd = usdDays.reduce((sum, day) => sum + day.usd, 0)

  const clampedNow = Math.min(Math.max(now, start), end)
  if (now > end) return undefined // 本期已重置，旧活动数据不再有意义
  const elapsedMs = clampedNow - start
  const daily: ForecastDay[] =
    totalUsd > 0
      ? usdDays.map((day) => ({ date: day.date, usd: day.usd, percent: (percentUsed * day.usd) / totalUsd }))
      : []

  const forecastPercent = elapsedMs >= 86_400_000 ? (exhausted ? 100 : (percentUsed * (end - start)) / elapsedMs) : undefined
  const runsOutAt =
    forecastPercent !== undefined && forecastPercent > 100 && !exhausted
      ? new Date(start + (elapsedMs * 100) / percentUsed).toISOString()
      : undefined
  const status: ForecastView["status"] = exhausted
    ? "exhausted"
    : forecastPercent === undefined
      ? "ok"
      : forecastPercent > 100
        ? "overrun"
        : forecastPercent >= 30
          ? "warn"
          : "ok"

  return {
    windowDays: (end - start) / 86_400_000,
    elapsedDays: elapsedMs / 86_400_000,
    daily,
    totalUsd,
    percentUsed,
    forecastPercent,
    runsOutAt,
    exhausted,
    status,
  }
}

export const SPARK_BLOCKS = "▁▂▃▄▅▆▇█"

/** 小型走势图：样本 ≤ width 时逐日一字符，超过则等宽分组取组内最大值。 */
export function sparkline(days: number[], width: number = 8): string {
  if (!days.length) return ""
  let buckets = days
  if (days.length > width) {
    buckets = Array.from({ length: width }, (_, i) => {
      const start = Math.floor((i * days.length) / width)
      const end = Math.max(start + 1, Math.floor(((i + 1) * days.length) / width))
      return Math.max(...days.slice(start, end))
    })
  }
  const peak = Math.max(...buckets)
  return buckets
    .map((value) => {
      if (peak <= 0) return SPARK_BLOCKS[0]
      return SPARK_BLOCKS[Math.min(SPARK_BLOCKS.length - 1, Math.floor((value / peak) * (SPARK_BLOCKS.length - 1) + 0.0001))]
    })
    .join("")
}

/** `月底约 34% ↗` / `11/28 触顶` / `已触顶`；forecast 无效（未定义）时为空。 */
export function forecastLabel(forecast: ForecastView | undefined): string {
  if (!forecast || forecast.forecastPercent === undefined) return ""
  if (forecast.status === "exhausted") return "已触顶"
  if (forecast.status === "overrun") {
    return forecast.runsOutAt ? `${shortDate(new Date(forecast.runsOutAt).toISOString().slice(0, 10))} 触顶` : ""
  }
  return `月底约 ${Math.round(forecast.forecastPercent)}% ↗`
}

/** 侧边栏一行：`▁▂▄▅▆▇ 月底约 34% ↗`；本期刚开始（<1 天）无 forecast 时不返回。 */
export function forecastLine(snapshot: UsageSnapshot | undefined, now: number = Date.now()): string {
  const forecast = forecastView(snapshot, now)
  const label = forecastLabel(forecast)
  if (!label) return ""
  const bars = sparkline(forecast.daily.map((day) => day.percent))
  return bars ? `${bars} ${label}` : label
}

/** Compact single line used by the TUI sidebar. */
export function sidebarLines(snapshot: UsageSnapshot | undefined, now: number = Date.now()): string[] {
  if (!snapshot) return ["用量加载中…"]
  if (snapshot.errors.length && !snapshot.go && !snapshot.billing) return ["用量读取失败"]

  const lines: string[] = []
  const meters = meterViews(snapshot, now)
  if (meters.length) {
    const plan = goProductLabel(snapshot.go?.product)
    lines.push(`${plan} ${meters.map((meter) => `${meter.label} ${meter.percent}%`).join(" ")}`)
    lines.push(meters.map((meter) => `${meter.used}/${meter.limit}`).join(" · "))
    const resets = meters.filter((meter) => meter.reset)
    if (resets.length) lines.push(`↻ ${resets.map((meter) => meter.reset).join(" · ")}`)
  }
  const forecastRow = forecastLine(snapshot, now)
  if (forecastRow) lines.push(forecastRow)
  const balance = formatUsd(snapshot.billing?.availableMicroCents ?? snapshot.billing?.balanceMicroCents)
  if (balance !== "-") {
    const spent = formatUsd(snapshot.spentMicroCents)
    lines.push(`Console ${balance}${spent !== "-" ? ` · 本月 ${spent}` : ""}`)
  }
  if (!lines.length) return ["暂无用量数据"]
  return lines
}

/** 图表分块：把数组切成 n 个一行。 */
function chunk<T>(items: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n))
  return out
}

/** `M/D` 形式的 UTC 日期标签。 */
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-")
  return `${Number(month)}/${Number(day)}`
}

/** Full markdown report used by the `/usage` command and the agent tool. */
export function renderReport(snapshot: UsageSnapshot, now: number = Date.now()): string {
  const stamp = new Date(snapshot.fetchedAt ?? now).toLocaleString()
  const lines: string[] = [`**OpenCode 用量** · ${stamp}`, ""]

  const meters = meterViews(snapshot, now)
  if (meters.length) {
    const plan = goProductLabel(snapshot.go?.product)
    const endsAt = snapshot.go?.access?.endsAt
    lines.push(
      `**${plan}**${endsAt ? ` · 本期至 ${new Date(endsAt).toLocaleDateString()}` : ""}${
        snapshot.go?.cancelAtPeriodEnd ? " · 已取消自动续费" : ""
      }`,
    )
    lines.push("")
    lines.push("| 窗口 | 已用 | 上限 | 用量 | 重置 |")
    lines.push("| --- | --- | --- | --- | --- |")
    for (const meter of meters) {
      lines.push(
        `| ${meter.label} | ${meter.used} | ${meter.limit} | ${meter.percent}% | ${
          meter.reset ? `${meter.reset} 后` : "未开始"
        } |`,
      )
    }
    if (snapshot.go?.useBalance === false) {
      lines.push("")
      lines.push("_超额后不会回落到余额计费（Extra usage 未开启）。_")
    }
    lines.push("")
  }

  const forecast = forecastView(snapshot, now)
  if (forecast && forecast.daily.length) {
    const limit = Number(snapshot.go?.access?.meters?.month?.limitMicroCents)
    const periodStart = shortDate(new Date(snapshot.activity?.startsAt ?? snapshot.go?.access?.startsAt ?? "").toISOString().slice(0, 10))
    lines.push(`**本期日消费**（${periodStart} 以来 · 月上限 ${formatUsdCompact(limit)}）`)
    lines.push("")
    const today = new Date(now).toISOString().slice(0, 10)
    for (const group of chunk(forecast.daily, 6)) {
      lines.push(`| ${group.map((d) => shortDate(d.date) + (d.date === today ? "（今）" : "")).join(" | ")} |`)
      lines.push(`| ${group.map(() => "---").join(" | ")} |`)
      lines.push(`| ${group.map((d) => formatUsdCompact(d.usd * 100_000_000)).join(" | ")} |`)
      lines.push("")
    }
    const endDate = shortDate(new Date(snapshot.go?.access?.meters?.month?.resetsAt ?? "").toISOString().slice(0, 10))
    if (forecast.status === "exhausted") {
      lines.push("→ ⚠ 本期额度已用尽")
    } else if (forecast.status === "overrun" && forecast.runsOutAt) {
      lines.push(`→ ⚠ 按此节奏预计 ${shortDate(new Date(forecast.runsOutAt).toISOString().slice(0, 10))} 触顶`)
    } else if (forecast.forecastPercent !== undefined) {
      lines.push(`→ 本期结束（${endDate}）预计用量 ~${Math.round(forecast.forecastPercent)}%，暂无触顶风险`)
    }
    lines.push("")
  }

  const billing = snapshot.billing
  if (billing) {
    lines.push("**Console**")
    const balance = formatUsd(billing.availableMicroCents ?? billing.balanceMicroCents)
    const spent = formatUsd(snapshot.spentMicroCents)
    lines.push(`- 余额：${balance}（${billing.mode ?? "unknown"} / ${billing.billingMode ?? "unknown"}）`)
    if (spent !== "-") lines.push(`- 本月已消费：${spent}`)
    lines.push("")
  }

  if (snapshot.errors.length) {
    lines.push(`_部分数据读取失败：${snapshot.errors.join("; ")}_`)
  }
  if (!lines.some((line) => line.startsWith("**"))) lines.push("_没有可用的用量数据_")

  return lines.join("\n").trim()
}
