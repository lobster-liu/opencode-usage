import { Rpc } from "@opencode/plugin/rpc"

/**
 * 服务端 → GUI 的取数契约。GUI 面板通过 `ctx.client.rpc(Usage).report()`
 * 拿到已经渲染好的纯文本报告（桌面端不需要自己处理凭据与 CORS）。
 */
export const Usage = Rpc.define({
  id: "opencode-usage",
  methods: {
    report: {
      input: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      errors: {},
    },
  },
  events: {},
})
