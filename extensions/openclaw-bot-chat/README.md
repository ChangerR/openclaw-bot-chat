# openclaw-bot-chat extension

按 OpenClaw 官方插件规范实现的 **Channel Plugin** 骨架，入口与加载方式对齐 `extensions/discord` 的关键结构：

- `index.ts`：`defineBundledChannelEntry(...)`
- `channel-plugin-api.ts`：窄导出 channel plugin 对象
- `runtime-api.ts`：窄导出 runtime setter
- `openclaw.plugin.json` 与 `package.json#openclaw`

## 功能

- 对接 BotChat backend bootstrap + MQTT 通信
- 入站消息解析后回调到 OpenClaw（`emitMessage`）
- 出站消息发布到 broker topic
- 权限审批扩展（本地 handler / HTTP）
- 本地 checkpoint 持久化（`stateDir/botchat-<botId>-state.json`）
- 启动后按 checkpoint 进行历史补偿（`historyCatchupLimit`，默认 100）
- MQTT 重连成功后自动再执行一次历史补偿
- 权限审批拒绝时可自动回写 `permissionDeniedReply`

## 入口与加载

- `index.ts`
  - 默认导出 `defineBundledChannelEntry(...)`
  - 声明 plugin specifier 与 runtime specifier
- `channel-plugin-api.ts`
  - 导出 `botChatPlugin`
- `runtime-api.ts`
  - 导出 `setBotChatRuntime`
- `src/channel.ts`
  - channel plugin 对象与 initialize/shutdown/消息处理入口
- `src/runtime.ts`
  - runtime interface 与默认 runtime（bootstrap、mqtt、inbound/outbound、approval）

示例配置见 `config.example.json`。

## Agent 拆分计划

见：`docs/EXTENSION_AGENT_BREAKDOWN.md`
