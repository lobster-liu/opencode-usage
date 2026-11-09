import { Plugin } from "@opencode/plugin"
import { Usage } from "./rpc.ts"
import { describe, fetchUsage, renderReport } from "./usage.ts"

const INTEGRATION_ID = "opencode"

export default Plugin.define({
  id: "usage-forecast",
  async setup(ctx) {
    async function snapshot() {
      const connection = await ctx.integration.connection.active(INTEGRATION_ID)
      if (!connection) throw new Error("未连接 OpenCode Console，请先执行 /connect")
      const credential = await ctx.integration.connection.resolve(connection)
      const token = credential && credential.type === "oauth" ? credential.access : undefined
      if (!token) throw new Error("没有可用的 OpenCode Console 凭据")
      return await fetchUsage(token)
    }

    // GUI 面板通过 RPC 取数，避免桌面端直接请求 Console API（CORS 只允许 opencode.ai）
    await ctx.rpc.register(Usage, {
      report: async () => ({ text: renderReport(await snapshot()) }),
    })

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "opencode",
        description: "OpenCode Console 账号用量与余额",
      })
      editor.add({
        name: "usage",
        description:
          "查询当前账号的 OpenCode Go 用量（5 小时/周/月 窗口的已用与上限）、Console 余额和本月消费。",
        input: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        execute: async () => {
          try {
            const result = await snapshot()
            return { content: renderReport(result) }
          } catch (error) {
            return { content: `用量查询失败：${describe(error)}` }
          }
        },
      })
    })
  },
})
