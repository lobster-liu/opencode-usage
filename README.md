# opencode-usage

在 OpenCode 里直接看 **OpenCode Go 用量** 和 **Console 余额 / 消费**，不用再开网站。

安装位置：`~/.config/opencode/plugins/opencode-usage/`

```
~/.config/opencode/plugins/opencode-usage/
├── index.ts   # 服务端插件：/usage 命令 + opencode_usage 工具
├── tui.tsx    # TUI 插件：侧边栏常驻显示
└── usage.ts   # 共用的取数与格式化逻辑
```

OpenCode 会自动发现这个目录，无需改 `opencode.json` 或 `cli.json`。

## 用起来是什么样

**终端 TUI 侧边栏**（每 60 秒自动刷新）：

```
Go 5h 0%  周 3%  月 51%
$0/$12 · $0.85/$30 · $30/$60
↻ 4d8h · 13d21h
Console $9.40 · 本月 $0.25
```

用量 ≥ 70% 变黄，≥ 90% 变红。

**桌面端 / 网页版**：在聊天框输入 `/usage`，会直接在对话里输出一份完整报表：

```
**OpenCode 用量** · 2026/10/21 23:22:59

**Go** · 本期至 2026/11/4

| 窗口 | 已用 | 上限 | 用量 | 重置 |
| --- | --- | --- | --- | --- |
| 5h | $0 | $12.00 | 0% | 未开始 |
| 周 | $0.85 | $30.00 | 3% | 4d8h 后 |
| 月 | $30.33 | $60.00 | 51% | 13d21h 后 |

**Console**
- 余额：$9.40（pay-as-you-go / prepaid）
- 本月已消费：$0.25
```

**命令行面板**：TUI 里按 `ctrl+p` 搜「刷新 OpenCode 用量」立即刷新。

**给 Agent 用**：工具 `opencode_usage` 已注册，直接问「我的 Go 还剩多少」即可。

## 数据来源

全部用 OpenCode 已登录的 Console 凭据（`opencode` integration 的 OAuth token），**不需要额外配置 key**：

| 接口 | 用途 |
| --- | --- |
| `GET /console/api/go/status` | Go 套餐、5 小时 / 周 / 月 三档的已用与上限、重置时间 |
| `GET /console/api/billing/status` | Console 预付余额 |
| `GET /console/api/members` | 本月已消费 |

凭据来源：

- 服务端插件：`ctx.integration.connection.active("opencode")` → `ctx.integration.connection.resolve(...)`
- TUI 插件：`context.client.credential.list()`

## 排错

| 现象 | 处理 |
| --- | --- |
| 侧边栏显示「用量读取失败（/connect）」 | 先 `/connect` 登录 OpenCode Console |
| 侧边栏不显示 | 确认用的是终端 TUI（`opencode`）；桌面端是 Web UI，没有插件插槽，只能用 `/usage` |
| `/usage` 不在斜杠菜单里 | 跑 `opencode plugin list`，应能看到 `opencode-usage` |
| 数字不更新 | 看 `~/.local/share/opencode/log/opencode.log`，插件改动会自动热重载 |

## 注意

- Go 的三个窗口上限是**按模型**算的，接口返回的是账号级上限（最高档），所以百分比会比单个模型宽松。
- `5h` 窗口没有使用时 `resetsAt` 为空，报表里显示「未开始」。
- 「本月已消费」是 Console credits 的实际扣减，不含 Go 订阅覆盖的调用。
