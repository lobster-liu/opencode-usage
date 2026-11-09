import { createResource } from "solid-js"
import { Command, MenuItem, Panel, Plugin, usePlugin, type PanelTab } from "@opencode/plugin/gui"
import { Usage } from "../rpc"

function UsageView() {
  const ctx = usePlugin()
  const [report] = createResource(() => ctx.client.rpc(Usage).report())

  return (
    <pre
      style={{
        "white-space": "pre-wrap",
        "font-family": "ui-monospace, SFMono-Regular, Consolas, monospace",
        "font-size": "12px",
        "line-height": "1.6",
        padding: "12px",
        margin: "0",
      }}
    >
      {report()?.text ?? (report.error ? `用量读取失败：${String(report.error)}` : "正在读取用量…")}
    </pre>
  )
}

const tab: PanelTab = {
  id: "usage",
  get title() {
    return "OpenCode 用量"
  },
  closable: "compact",
  fallback: true,
}

export default Plugin.define({
  i18n: {
    en: {
      "command.usage": "OpenCode 用量",
      "panel.title": "OpenCode 用量",
    },
  },
  setup(ctx) {
    const open = () => {
      const session = ctx.sessions.current()
      if (session) ctx.layout.open(`${ctx.id}:usage`, session)
    }

    ctx.add(Command, () => ({
      id: "usage",
      title: ctx.t("command.usage"),
      slash: { name: "usage" },
      run: () => open(),
    }))

    ctx.add(MenuItem, () => ({
      menu: "session.panel" as const,
      id: "usage",
      title: ctx.t("panel.title"),
      run: () => open(),
    }))

    ctx.add(Panel, {
      id: "usage",
      region: "side",
      width: "narrow",
      list: (input) => (input.open.includes("usage") ? [tab] : []),
      render: () => <UsageView />,
    })
  },
})
