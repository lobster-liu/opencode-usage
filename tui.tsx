import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createSignal, Show } from "solid-js"
import {
  activeCredentialEntry,
  fetchUsage,
  forecastLine,
  formatUsd,
  formatUsdCompact,
  goProductLabel,
  meterViews,
  type UsageSnapshot,
} from "./usage.ts"

const REFRESH_INTERVAL = 60_000

export default Plugin.define({
  id: "opencode-usage.tui",
  setup(context) {
    const [snapshot, setSnapshot] = createSignal<UsageSnapshot | undefined>(undefined)
    const [refreshing, setRefreshing] = createSignal(false)

    async function refresh() {
      setRefreshing(true)
      try {
        const entries = await context.client.credential.list()
        const entry = activeCredentialEntry(entries)
        const value = entry?.value
        if (!value || value.type !== "oauth" || !value.access) {
          setSnapshot({ fetchedAt: Date.now(), errors: ["未连接 OpenCode Console（/connect）"] })
          return
        }
        setSnapshot(await fetchUsage(value.access))
      } catch (error) {
        setSnapshot({
          fetchedAt: Date.now(),
          errors: [error instanceof Error ? error.message : String(error)],
        })
      } finally {
        setRefreshing(false)
      }
    }

    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL)

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "opencode-usage.refresh",
          title: "刷新 OpenCode 用量",
          group: "OpenCode",
          palette: true,
          run: async () => {
            await refresh()
            context.ui.toast.show({ message: "用量已刷新", variant: "info", duration: 1500 })
          },
        },
      ],
    }))

    const unregister = context.ui.slot({
      append: "sidebar.footer",
      render: () => <UsagePanel snapshot={snapshot()} />,
    })

    return () => {
      clearInterval(timer)
      unregister()
    }
  },
})

function UsagePanel(props: { snapshot?: UsageSnapshot }) {
  const context = usePlugin()
  const theme = context.theme

  const meters = () => meterViews(props.snapshot)
  const resets = () => meters().filter((meter) => meter.reset)
  const peak = () => meters().reduce((max, meter) => Math.max(max, meter.percent), 0)
  const plan = () => goProductLabel(props.snapshot?.go?.product)
  const balance = () =>
    formatUsd(props.snapshot?.billing?.availableMicroCents ?? props.snapshot?.billing?.balanceMicroCents)
  const spent = () => formatUsd(props.snapshot?.spentMicroCents)
  const forecast = () => forecastLine(props.snapshot, Date.now())

  const forecastColor = () => {
    const label = forecast()
    if (label.includes("触顶")) return theme.text.feedback.error.base
    const match = label.match(/约\s*(\d+)%/)
    if (match && Number(match[1]) >= 30) return theme.text.feedback.warning.base
    return theme.text.muted
  }

  const usageColor = () => {
    const value = peak()
    if (value >= 90) return theme.text.feedback.error.base
    if (value >= 70) return theme.text.feedback.warning.base
    return theme.text.base
  }

  const failed = () => !!props.snapshot && props.snapshot.errors.length > 0 && !props.snapshot.go && !props.snapshot.billing

  return (
    <box flexDirection="column" gap={0}>
      <Show when={!props.snapshot}>
        <text fg={theme.text.muted}>用量加载中…</text>
      </Show>
      <Show when={failed()}>
        <text fg={theme.text.feedback.error.base}>用量读取失败（/connect）</text>
      </Show>
      <Show when={meters().length > 0}>
        <text fg={usageColor()}>
          {plan()} {meters().map((meter) => `${meter.label} ${meter.percent}%`).join(" ")}
        </text>
        <text fg={theme.text.muted}>
          {meters()
            .map((meter) => `${formatUsdCompact(meter.meter.usedMicroCents)}/${formatUsdCompact(meter.meter.limitMicroCents)}`)
            .join(" · ")}
        </text>
        <Show when={resets().length > 0}>
          <text fg={theme.text.faint}>↻ {resets().map((meter) => meter.reset).join(" · ")}</text>
        </Show>
        <Show when={forecast()}>
          <text fg={forecastColor()}>{forecast()}</text>
        </Show>
      </Show>
      <Show when={balance() !== "-"}>
        <text fg={theme.text.base}>
          Console {balance()}
          <Show when={spent() !== "-"}> · 本月 {spent()}</Show>
        </text>
      </Show>
    </box>
  )
}
