# opencode-usage

在 OpenCode 里直接看 **OpenCode Go 用量** 和 **Console 余额 / 消费**，不用再开网站。

安装位置：`~/.config/opencode/plugins/opencode-usage/`

```
~/.config/opencode/plugins/opencode-usage/
├── index.ts              # 服务端插件：RPC + opencode_usage 工具
├── tui.tsx               # TUI 插件：侧边栏常驻显示
├── usage.ts              # 共用的取数与格式化逻辑
├── rpc.ts                # 服务端→GUI 的取数契约
├── src/gui.tsx           # 桌面端 GUI 面板源码
└── gui-experimental.cjs  # 构建产物（vite build 生成）
```

OpenCode 会自动发现这个目录。桌面端的面板需要在 `opencode.json` 的 `plugins` 里列出该目录（已配置）；TUI 侧边栏不需要。

## 用起来是什么样

**终端 TUI 侧边栏**（每 60 秒自动刷新）：

```
Go 5h 0%  周 3%  月 51%
$0/$12 · $0.85/$30 · $30/$60
↻ 4d8h · 13d21h
▅▃▂▅▆▇█ 月底约 78% ↗
Console $9.40 · 本月 $0.25
```

用量 ≥ 70% 变黄，≥ 90% 变红。倒数第二行的 **forecast** 是本期的消费走势（sparkline）与线性外推：
`月底约 N% ↗` 表示按当前节奏本期结束时的预计用量（外推 ≥30% 时该行变黄）；若按此节奏会提前触顶则显示 `11/28 触顶`，额度已用尽则显示 `已触顶`（均为红色）。本期不足 1 天时该行不显示。

**桌面端**：在聊天框输入 `/usage`（或在侧边栏的 **+** 菜单 / 命令面板里选「OpenCode 用量」），会在会话侧边打开一个面板，显示完整报表：

```
**OpenCode 用量** · 2026/10/21 23:22:59

**Go** · 本期至 2026/11/4

5h：$0 / $12.00 · 0% · 未开始
周：$0.85 / $30.00 · 3% · 4d8h 后
月：$30.33 / $60.00 · 51% · 13d21h 后

**本期日消费**（11/4 以来 · 月上限 $60）

11/4 $0.08 · 11/5 $0.54 · 11/6 $0.49 · 11/7 $0.68
11/8 $0.94 · 11/9（今） $0.55

→ 本期结束（12/4）预计用量 ~78%，暂无触顶风险

**Console**
- 余额：$9.40（pay-as-you-go / prepaid）
- 本月已消费：$0.25
```

> 桌面端通过 GUI 插件面板展示，**不会向对话插入消息、不会触发模型回复**。数据经插件 RPC 在服务端获取（Console API 的 CORS 只允许 opencode.ai，桌面窗口不能直连）。

「本期日消费」与结论行与官网 Console 的 Activity 页算法一致（逐日按消费占比归一，结论按已过时间线性外推）；若按当前节奏会在本期结束前触顶，结论行会变成 `→ ⚠ 按此节奏预计 11/28 触顶`，额度已用尽则为 `→ ⚠ 本期额度已用尽`。

**命令行面板**：TUI 里按 `ctrl+p` 搜「刷新 OpenCode 用量」立即刷新。

**给 Agent 用**：工具 `opencode_usage` 已注册，直接问「我的 Go 还剩多少」即可。

## 数据来源

全部用 OpenCode 已登录的 Console 凭据（`opencode` integration 的 OAuth token），**不需要额外配置 key**：

| 接口 | 用途 |
| --- | --- |
| `GET /console/api/go/status` | Go 套餐、5 小时 / 周 / 月 三档的已用与上限、重置时间 |
| `GET /console/api/activity/go` | 本期逐日消费（官网 Activity 页同源数据），用于 forecast |
| `GET /console/api/billing/status` | Console 预付余额 |
| `GET /console/api/members` | 本月已消费 |

凭据来源：

- 服务端插件：`ctx.integration.connection.active("opencode")` → `ctx.integration.connection.resolve(...)`
- TUI 插件：`context.client.credential.list()`

## 排错

| 现象 | 处理 |
| --- | --- |
| 侧边栏显示「用量读取失败（/connect）」 | 先 `/connect` 登录 OpenCode Console |
| TUI 侧边栏不显示 | 确认用的是终端 TUI（`opencode`），终端宽度足够时侧边栏才显示 |
| 桌面端 `/usage` 没反应 | 确认 `opencode.json` 的 `plugins` 里列出了插件目录；改完 GUI 源码后跑 `npx vite build`，或重启桌面端 |
| `/usage` 不在斜杠菜单里 | 跑 `opencode plugin list`，应能看到 `opencode-usage` |
| 数字不更新 | 看 `~/.local/share/opencode/log/opencode.log`，插件改动会自动热重载 |

## 注意

- 桌面端的 `/usage` 打开的是**侧边面板**，不会往对话里发消息、不会让模型回复。
- Go 的 meter（接口返回的 5h / 周 / 月上限）是**全模型共享池**（当前月池 $60）；官网价目表里「仅用某模型」的上限（如 DeepSeek V4.1 Flash $100）表示独占全池时的折算额度，插件展示的是共享池百分比。
- `5h` 窗口没有使用时 `resetsAt` 为空，报表里显示「未开始」。
- 「本月已消费」是 Console credits 的实际扣减，不含 Go 订阅覆盖的调用。
