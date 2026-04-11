# openclaw-bot-chat

OpenClaw 侧的 BotChat 接入插件。它用 `X-Bot-Key` 连接 BotChat WebSocket，把 BotChat 消息路由到 OpenClaw agent，再把回复回写到 BotChat。

## 特性

- TypeScript 严格模式
- `ws` WebSocket 客户端
- 单 bot / 多 bot 双配置模式
- 多通道上下文解析和按 channel 隔离状态
- 入站消息权限审批与 allowlist
- `config.json` 或环境变量配置
- `dialog_id -> openclaw session_id` 映射
- `message_id` 去重
- checkpoint 持久化，重连后自动补拉历史消息
- WebSocket 心跳 + HTTP heartbeat
- 优雅停机

## 目录

```text
plugins/openclaw-bot-chat/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── client/
│   │   ├── websocket.ts
│   │   └── http.ts
│   ├── runtime/
│   │   ├── bot.ts
│   │   ├── session.ts
│   │   └── checkpoint.ts
│   ├── router/
│   │   └── message.ts
│   └── types/
│       ├── channel.ts
│       ├── index.ts
│       └── permissions.ts
└── README.md
```

## 配置

优先级：环境变量 > `config.json`

### 必填

- `BOT_CHAT_BASE_URL`: BotChat 服务地址，例如 `https://botchat.example.com`
- `ACCESS_KEY`: 旧单 bot 模式的 access key
- `bots`: 新多 bot 模式的配置对象

### 可选

- `BOT_ID`: bot id；当 bootstrap 不返回 bot 信息时必填
- `BOT_CHAT_DEFAULT_BOT`: 覆盖 `defaultBot`
- `BOT_CHAT_DEFAULT_CHANNEL_POLICY`: `open` 或 `allowlist`
- `BOT_CHAT_CONFIG`: 配置文件路径，默认 `./config.json`
- `BOT_CHAT_HEARTBEAT_INTERVAL_MS`: 默认 `15000`
- `BOT_CHAT_HTTP_TIMEOUT_MS`: 默认 `15000`
- `BOT_CHAT_RECONNECT_BASE_MS`: 默认 `1000`
- `BOT_CHAT_RECONNECT_MAX_MS`: 默认 `30000`
- `OPENCLAW_STATE_DIR`: 本地状态目录，默认 `./data`
- `OPENCLAW_AGENT_HANDLER`: 本地 JS 模块路径，需导出 `respond(request)`
- `OPENCLAW_AGENT_URL`: OpenClaw agent HTTP endpoint，接收 `OpenClawRequest`
- `OPENCLAW_AGENT_TIMEOUT_MS`: 默认 `60000`

### 多 bot config.json 示例

```json
{
  "botChatBaseUrl": "https://botchat.example.com",
  "defaultBot": "bot1",
  "defaultChannelPolicy": "open",
  "heartbeatIntervalMs": 15000,
  "httpTimeoutMs": 15000,
  "reconnectBaseDelayMs": 1000,
  "reconnectMaxDelayMs": 30000,
  "stateDir": "./data",
  "openClawAgentHandler": "./agent-handler.js",
  "bots": {
    "bot1": {
      "id": "bot_001",
      "accessKey": "ocbk_xxx_bot1",
      "enabled": true,
      "channels": [
        "channel_1",
        "channel_2"
      ],
      "users": [
        "user_001",
        "user_002"
      ],
      "groupPolicy": "open",
      "actions": {
        "sendMessage": true,
        "sendImage": true,
        "typing": true,
        "reactions": false,
        "threads": false
      }
    },
    "bot2": {
      "id": "bot_002",
      "accessKey": "ocbk_xxx_bot2",
      "enabled": false
    }
  }
}
```

### 旧单 bot 配置仍然可用

```json
{
  "botChatBaseUrl": "https://botchat.example.com",
  "accessKey": "ocbk_xxx",
  "botId": "bot_123",
  "stateDir": "./data",
  "actions": {
    "sendMessage": true,
    "sendImage": true,
    "typing": true,
    "reactions": false,
    "threads": false
  }
}
```

### AllowList 说明

- `channels` / `users` 可以直接写字符串数组，默认按 `matchMode: "any"` 处理。
- 如果要强制按名称匹配，可以改成对象：

```json
{
  "channels": {
    "items": [
      "engineering",
      "ops-war-room"
    ],
    "matchMode": "name"
  }
}
```

### 权限模型

- 权限在入站消息阶段检查，拒绝后不会调用 OpenClaw agent。
- 当前内置动作：
  - `sendMessage`
  - `sendImage`
  - `typing`
  - `reactions`
  - `threads`
- 拒绝会输出明确错误码，例如：
  - `PERMISSION_BOT_DISABLED`
  - `PERMISSION_ACTION_DISABLED`
  - `PERMISSION_USER_NOT_ALLOWED`
  - `PERMISSION_CHANNEL_NOT_ALLOWED`
  - `PERMISSION_GROUP_DISABLED`
  - `PERMISSION_GROUP_NOT_ALLOWED`

## Agent 接入

插件不会把 OpenClaw agent 调用方式写死，支持两种模式：

1. `OPENCLAW_AGENT_HANDLER`
   本地模块，导出 `respond(request)`。

```js
exports.respond = async function respond(request) {
  return {
    content: `echo: ${request.content}`,
    metadata: {
      content_type: "text"
    }
  };
};
```

2. `OPENCLAW_AGENT_URL`
   插件会对该地址 `POST` 一个 `OpenClawRequest`，期待返回 `OpenClawResponse`。

### 快速测试机器人

仓库里已经带了一个最小可用的 OpenAI-compatible handler 和启动脚本：

- `./examples/openai-compatible-handler.cjs`
- `../../scripts/test-agent.sh`
- `../../scripts/test-agent.env.example`

最小启动方式：

```bash
cd /home/admin/projects/openclaw-bot-chat
cp ./scripts/test-agent.env.example ./scripts/test-agent.env

vi ./scripts/test-agent.env
./scripts/test-agent.sh start
```

脚本会自动：

- 读取 `./scripts/test-agent.env`
- 生成插件运行配置 `plugins/openclaw-bot-chat/.test-agent.config.json`
- 执行 `npm run build`
- 启动测试 agent

可选环境变量：

- `OPENAI_COMPAT_SYSTEM_PROMPT`
- `OPENAI_COMPAT_TIMEOUT_MS`
- `OPENAI_COMPAT_TEMPERATURE`
- `OPENAI_COMPAT_MAX_TOKENS`
- `OPENAI_COMPAT_EXTRA_HEADERS`：JSON 对象字符串，用于某些兼容服务的额外请求头

内置调试指令：

- `/ping`
- `/meta`

辅助命令：

```bash
./scripts/test-agent.sh check
./scripts/test-agent.sh print-config
```

## BotChat 协议

### HTTP

- `GET /api/v1/bot-runtime/bootstrap`
- `POST /api/v1/bot-runtime/messages`
- `POST /api/v1/bot-runtime/heartbeat`
- `GET /api/v1/bot-runtime/dialogs/{dialog_id}/messages`

说明：

- 如果 `bootstrap` 或 `heartbeat` 返回 `404`，插件会降级运行
- 发送消息优先走 `POST /api/v1/bot-runtime/messages`
- 如果发送接口不可用且返回 `404/405/5xx`，会 fallback 到 WebSocket `publish`

### WebSocket

- 连接：`GET /api/v1/ws` + `X-Bot-Key`
- 多 bot 模式下，每个 bot 使用自己的 `X-Bot-Key` 建立独立连接
- 支持 hello 帧
- 支持 `subscribe` / `unsubscribe` / `publish`
- 支持应用层 `ping` / `pong`
- 自动指数退避重连

默认订阅：

- `chat/user/+/to/bot/{botId}`
- `chat/bot/+/to/bot/{botId}`
- bootstrap 返回的 subscriptions / dialogs / transport policy topics

## 运行

```bash
cd /home/admin/projects/openclaw-bot-chat/plugins/openclaw-bot-chat
npm install
npm run build
npm start
```

只做类型检查：

```bash
npx tsc --noEmit
```

## 持久化状态

默认写入 `./data/<botKey>/`：

- `sessions.json`: `dialog_id -> openclaw session_id`
- `checkpoints.json`: 每个 dialog 的最新 checkpoint

运行时还会把 dialog/session/checkpoint 按 channel scope 做内存隔离，避免不同 bot 或频道互相污染。

## 消息流

1. BotChat 通过 WebSocket 推送消息
2. 插件按 `message_id` 去重
3. `dialog_id` 映射到 OpenClaw `session_id`
4. 调用 OpenClaw agent
5. 通过 BotChat HTTP API 回写回复
6. 更新 checkpoint
7. 重连后按 checkpoint 拉取未处理消息补偿
