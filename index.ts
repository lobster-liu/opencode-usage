import { Plugin } from "@opencode/plugin"
import { describe, fetchUsage, renderReport } from "./usage.ts"

const INTEGRATION_ID = "opencode"

export default Plugin.define({
  id: "opencode-usage",
  async setup(ctx) {
    async function snapshot() {
      const connection = await ctx.integration.connection.active(INTEGRATION_ID)
      if (!connection) throw new Error("未连接 OpenCode Console，请先执行 /connect")
      const credential = await ctx.integration.connection.resolve(connection)
      const token = credential && credential.type === "oauth" ? credential.access : undefined
      if (!token) throw new Error("没有可用的 OpenCode Console 凭据")
      return await fetchUsage(token)
    }

    await ctx.command.transform((editor) => {
      editor.add({
        name: "usage",
        description: "查看 OpenCode Go 用量、Console 余额与本月消费",
        execute: async ({ sessionID }) => {
          try {
            const result = await snapshot()
            await ctx.session.synthetic({ sessionID, text: renderReport(result) })
          } catch (error) {
            await ctx.session.synthetic({ sessionID, text: `用量查询失败：${describe(error)}` })
          }
        },
      })
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
