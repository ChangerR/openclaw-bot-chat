# openclaw-bot-chat plugin

OpenClaw 侧 bot runtime 插件，采用 broker-first 模式：

- 通过 backend 的 `bot-runtime/bootstrap` 获取 broker 连接信息、topic 与历史补偿参数
- 通过 MQTT TCP 直接订阅/发布业务消息
- 通过 backend 历史接口进行断线补偿

不再使用 backend WebSocket，不再使用 HTTP realtime send/heartbeat。

## 运行模式

1. 使用 `X-Bot-Key` 调 backend bootstrap
2. 连接 broker TCP
3. 订阅 bootstrap 下发的 topic
4. 收到消息后调用 OpenClaw agent
5. 将回复直接 publish 到 broker
6. 重连后按 `after_seq` 补拉历史

## 快速启动（测试）

在仓库根目录：

```bash
cp ./scripts/test-agent.env.example ./scripts/test-agent.env
./scripts/test-agent.sh start
```

关键环境变量：

- `BOT_CHAT_BACKEND_URL`
- `BOT_CHAT_BOT_KEY`
- `BOT_CHAT_BOT_ID`（部分场景可选）
- `BOT_CHAT_MQTT_TCP_URL`（可选 override）
- `OPENAI_COMPAT_BASE_URL`
- `OPENAI_COMPAT_API_KEY`
- `OPENAI_COMPAT_MODEL`
- `OPENAI_COMPAT_HISTORY_TURNS`：每个会话保留的历史轮数，默认 `8`
- `OPENAI_COMPAT_MCP_CONFIG`：指向 MCP JSON 配置文件
- `OPENAI_COMPAT_MCP_SERVERS_JSON`：直接以内联 JSON 提供 `mcpServers`
- `OPENAI_COMPAT_MCP_MAX_TOOL_ROUNDS`：单次请求最多工具轮数，默认 `6`
- `OPENCLAW_PERMISSION_APPROVAL_ENABLED`：是否启用权限审批（默认 `false`）
- `OPENCLAW_PERMISSION_APPROVAL_HANDLER`：本地审批 handler 路径（优先）
- `OPENCLAW_PERMISSION_APPROVAL_URL`：审批 HTTP 接口地址
- `OPENCLAW_PERMISSION_APPROVAL_TIMEOUT_MS`：审批超时毫秒（默认 `8000`）
- `OPENCLAW_PERMISSION_DENIED_REPLY`：审批拒绝时回复文案（可选）

辅助命令：

```bash
./scripts/test-agent.sh check
./scripts/test-agent.sh print-config
```

调试指令：

- `/meta`：查看当前请求 metadata
- `/reset`：清空当前 session 的内存上下文

MCP 说明：

- 默认 `openai-compatible-handler.cjs` 已支持可选 MCP
- 它会启动配置里的 stdio MCP server，把工具映射成 OpenAI-compatible `tools`
- 模型返回 tool calls 后，handler 会自动调用 MCP 工具并继续对话轮询

权限审批说明：

- 先执行插件内静态权限校验（`channels/users/groupPolicy/actions`）
- 静态校验拒绝时，可配置审批扩展（二选一）：
  - `OPENCLAW_PERMISSION_APPROVAL_HANDLER`
  - `OPENCLAW_PERMISSION_APPROVAL_URL`
- 审批通过：继续执行消息处理并调用 agent
- 审批拒绝：跳过 agent，并可自动回复拒绝说明

## Broker 可替换性

插件不依赖 EMQX 私有协议，只要求 broker 支持：

- MQTT TCP
- 连接认证
- topic publish/subscribe ACL

业务消息 payload 不带 `auth`。
