# openclaw-bot-chat extension

按 OpenClaw 官方插件规范实现的 **Channel Plugin** 骨架，入口与加载方式对齐 `extensions/discord` 的关键结构：

- `index.ts`：`defineBundledChannelEntry(...)`
- `channel-plugin-api.ts`：窄导出 channel plugin 对象
- `runtime-api.ts`：窄导出 runtime setter
- `openclaw.plugin.json` 与 `package.json#openclaw`

## 功能

- 对接 BotChat backend bootstrap + MQTT 通信
- 入站消息解析后回调到 OpenClaw（`emitMessage`）
- 出站消息发布到 BotChat 后端可持久化的 `chat/...` conversation topic
- 权限审批扩展（本地 handler / HTTP）
- 本地 checkpoint 持久化（`stateDir/botchat-<botId>-state.json`）
- 启动后通过 bot-runtime history endpoint 按 checkpoint 进行历史补偿（`historyCatchupLimit`，默认 100）
- MQTT 重连成功后自动再执行一次历史补偿
- 权限审批拒绝时可自动回写 `permissionDeniedReply`

## BotChat 后端对齐

运行时使用 BotChat 后端当前的 bot-runtime contract：

- `GET /api/v1/bot-runtime/bootstrap`
  - Header: `X-Bot-Key: <bot key>`
  - 返回 broker TCP URL、订阅 topics、可发布 topics、bot identity 等安全启动信息。
- `GET /api/v1/bot-runtime/messages/<conversation_id>?limit=<n>&after_seq=<seq>`
  - Header: `X-Bot-Key: <bot key>`
  - 用于 extension 重启或 MQTT 重连后的历史补偿。
- MQTT publish topic 必须是后端可持久化的 conversation topic，例如：
  - DM: `chat/dm/user/<userId>/bot/<botId>`
  - Group: `chat/group/<groupId>`

## Target 映射

OpenClaw outbound target 会被映射到 BotChat conversation topic：

| OpenClaw target | BotChat publish topic | 说明 |
| --- | --- | --- |
| `dm:<userId>` / `user:<userId>` | `chat/dm/user/<userId>/bot/<botId>` | BotChat 用户与当前 bot 的 DM。 |
| `group:<groupId>` | `chat/group/<groupId>` | BotChat 群聊。 |
| `channel:<conversationId>` | `<conversationId>` | 原样使用已有 BotChat conversation topic。 |
| raw target | `channel:<raw>` | 默认当作 channel/conversation topic。 |

`threadId` / `replyToId` 目前仅作为 metadata 透传，尚未声明完整 thread routing capability，因此 `capabilities.threads` 保持 `false`。

## 配置 handoff

1. 在 BotChat 前端创建 bot。
2. 在 bot 详情/密钥管理中创建 bot key，并立即保存返回的 one-time `key`。
3. 将 bot ID、bot key、后端 URL、MQTT TCP URL 写入 OpenClaw 配置。

OpenClaw channel config 示例：

```json
{
  "channels": {
    "bot-chat": {
      "backendUrl": "http://127.0.0.1:8080",
      "botKey": "ocbk_replace_with_one_time_bot_key",
      "botId": "replace_with_bot_uuid",
      "mqttTcpUrl": "mqtt://127.0.0.1:1883",
      "defaultTo": "group:replace_with_group_uuid",
      "allowFrom": ["*"],
      "stateDir": "./data",
      "historyCatchupLimit": 100
    }
  }
}
```

也可以把 `botKey` 改为 OpenClaw secret ref：

```json
{
  "source": "env",
  "provider": "default",
  "id": "BOT_CHAT_BOT_KEY"
}
```

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
