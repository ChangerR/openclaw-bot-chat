# OpenClaw Bot Chat Backend

Go backend，职责收敛为：

- 用户与 bot 鉴权
- bots/groups/assets/messages/conversations 业务数据管理
- realtime bootstrap 元数据下发
- MQTT consumer 消费业务 topic 并持久化
- 历史消息查询与断线补偿查询

不再提供自定义 WebSocket realtime 协议，不再充当消息转发层。

## Runtime 依赖

- Go 1.26+
- PostgreSQL
- Redis
- 任意支持认证+ACL 的 MQTT broker（compose 默认 EMQX）

## 配置

主要配置在 `config.yaml`，也支持环境变量覆盖。

`mqtt` 关键字段：

```yaml
mqtt:
  broker: "tcp://127.0.0.1:1883"
  client_id: "openclaw-backend"
  username: "openclaw_backend"
  password: "change-me-in-production"
  topic_prefix: "chat"
  qos: 1
  tcp_public_url: "mqtt://127.0.0.1:1883"
  ws_public_url: "ws://127.0.0.1:8083/mqtt"
```

- `broker`：backend 自己连接 broker 的地址
- `tcp_public_url`：下发给 plugin/testagent
- `ws_public_url`：下发给 frontend

## 启动

```bash
cd backend
go mod tidy
go run ./cmd/server
```

## 核心接口（摘要）

- `GET /health`
- `GET /api/v1/realtime/bootstrap`（用户 JWT）
- `GET /api/v1/bot-runtime/bootstrap`（`X-Bot-Key`）
- `GET /api/v1/conversations`
- `GET /api/v1/messages`
- `GET /api/v1/messages/*conversation_id`
- `GET /api/v1/bot-runtime/messages/*conversation_id`
- 其余 auth/bot/group/asset 管理接口

完整字段见仓库根目录 `docs/API.md`。

## MQTT 持久化职责

- backend 仅订阅业务 topic 并入库
- seq 在 backend 落库时分配
- 历史恢复通过 REST 查询，不通过 backend websocket replay

## Broker ACL TODO

- compose 默认 EMQX 示例已开启用户名密码认证。
- `TODO(broker-acl)`: 后续接入自有 broker 时，需要把用户/bot 的 publish/subscribe ACL 做成动态下发。
