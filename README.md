# OpenClaw Bot Chat

Broker-first 实时链路仓库，包含：

- `backend/`: Go 服务，只做认证、业务数据、bootstrap、历史查询、MQTT 消费持久化
- `frontend/`: Next.js 聊天前端，直接通过 MQTT over WebSocket 连接 broker
- `plugins/openclaw-bot-chat/`: testagent/plugin，直接通过 MQTT TCP 连接 broker

## Realtime 架构

唯一实时主链路：

- `frontend -> MQTT over WebSocket -> broker`
- `plugin/testagent -> MQTT TCP -> broker`

`backend` 不再承担实时转发，不提供 `/api/v1/ws`，也不再提供 HTTP realtime send/heartbeat。

`backend` 职责固定为：

- 认证与业务数据管理
- `GET /api/v1/realtime/bootstrap`（用户）
- `GET /api/v1/bot-runtime/bootstrap`（bot）
- 历史查询与断线补偿查询
- MQTT topic 消费并落库

## Broker 说明

默认 compose 使用 **EMQX**，但实现不写死 EMQX。只要 MQTT broker 支持以下能力即可替换：

- MQTT TCP + MQTT over WebSocket
- 连接认证（username/password 或等价机制）
- topic 发布/订阅 ACL

当前仓库保留一个明确 TODO：

- `TODO(broker-acl)`: 接入你们自有 broker 的动态认证和动态 ACL 下发流程。现阶段 compose 示例先保证 broker-first 链路可跑通。

业务消息 payload 不带 `auth` 字段。生产环境应由 broker 负责认证与 ACL；当前 compose 的 EMQX 示例已开启用户名密码认证，ACL 动态化仍是后续 TODO。

## Docker Compose

默认启动：

- PostgreSQL
- Redis
- EMQX
- Backend
- Frontend

```bash
docker compose up --build -d
docker compose ps
```

可选启动 testagent（需要先提供 bot key 等环境变量）：

```bash
docker compose --profile testagent up --build -d
```

常用端口映射：

- Frontend: `3000`
- Backend: `8080`
- MQTT TCP: `1883`
- MQTT WS: `8083` (`/mqtt`)
- EMQX Dashboard: `18083`

## 关键环境变量

- `NEXT_PUBLIC_API_URL`: 前端访问 backend 的地址
- `MQTT_USERNAME` / `MQTT_PASSWORD`: backend bootstrap 输出给客户端的 broker 凭据字段
- `MQTT_TCP_PUBLIC_URL`: backend bootstrap 返回给 plugin/testagent 的 broker TCP 地址
- `MQTT_WS_PUBLIC_URL`: backend bootstrap 返回给 frontend 的 broker WS 地址
- `JWT_SECRET` / `DATABASE_PASSWORD`: 生产务必替换

## 文档

- API: `docs/API.md`
- Backend 运行与配置: `backend/README.md`
- Plugin/testagent 使用: `plugins/openclaw-bot-chat/README.md`
