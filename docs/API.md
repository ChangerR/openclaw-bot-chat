# OpenClaw Bot Chat API

本文档以当前代码实现为准，覆盖后端 HTTP API、WebSocket、bot runtime HTTP 接口，以及会话 topic 规则。

当前代码参考入口：

- `backend/cmd/server/main.go`
- `backend/internal/handler/*.go`
- `backend/internal/model/response/*.go`
- `backend/internal/service/message_service.go`

## Base URL

- HTTP: `/api/v1`
- Health check: `/health`
- WebSocket: `/api/v1/ws`

## 通用响应格式

除 `/health` 和 WebSocket 握手外，HTTP 接口默认使用以下结构：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

分页接口额外返回：

```json
{
  "code": 0,
  "message": "success",
  "data": [],
  "page": 1,
  "per_page": 20,
  "total": 3,
  "has_more": false
}
```

错误响应：

```json
{
  "code": 400,
  "message": "invalid request"
}
```

## 认证方式

用户接口使用：

```http
Authorization: Bearer <access-token>
```

bot runtime 和 bot WebSocket 使用：

```http
X-Bot-Key: <bot-access-key>
```

WebSocket 用户认证支持三种入口，按顺序尝试：

1. 查询参数 `?token=<access-token>`
2. `Authorization: Bearer <access-token>`
3. `Sec-WebSocket-Protocol: authorization, Bearer <access-token>`

## 会话与 Topic 规则

当前 canonical topic 规则如下：

- 用户/机器人私聊: `chat/dm/{leftType}/{leftId}/{rightType}/{rightId}`
- 群聊: `chat/group/{groupId}`

私聊 topic 会做 canonical 排序，不按发送方向拼 topic。

排序优先级：

- `user`
- `bot`
- `channel`
- `system`

同类型时按 ID 字典序排序。

示例：

- 用户 `u1` 与 bot `b1`: `chat/dm/user/u1/bot/b1`
- bot `b1` 与 bot `b2`: `chat/dm/bot/b1/bot/b2`
- 群 `g1`: `chat/group/g1`

部分 HTTP 接口也接受已 URL 编码的 conversation id，例如：

- `GET /api/v1/messages/chat%2Fgroup%2Fg1`
- `GET /api/v1/bot-runtime/dialogs/chat%2Fdm%2Fuser%2Fu1%2Fbot%2Fb1/messages`

## Health

### `GET /health`

无认证。

响应：

```json
{
  "status": "ok"
}
```

## Auth

### `POST /api/v1/auth/register`

请求体：

```json
{
  "username": "tester",
  "email": "tester@example.com",
  "password": "test123456"
}
```

响应 `data`：

```json
{
  "tokens": {
    "access_token": "<jwt>",
    "refresh_token": "<jwt>",
    "expires_in": 7200,
    "token_type": "Bearer"
  },
  "user": {
    "id": "uuid",
    "username": "tester",
    "email": "tester@example.com",
    "nickname": "tester",
    "avatar_url": null,
    "created_at": "2026-04-11T00:00:00Z",
    "createdAt": "2026-04-11T00:00:00Z"
  }
}
```

### `POST /api/v1/auth/login`

请求体二选一：

```json
{
  "username": "tester",
  "password": "test123456"
}
```

```json
{
  "email": "tester@example.com",
  "password": "test123456"
}
```

响应与注册接口相同。

### `POST /api/v1/auth/refresh`

请求体：

```json
{
  "refresh_token": "<refresh-token>"
}
```

响应 `data`：

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "expires_in": 7200,
  "token_type": "Bearer"
}
```

### `POST /api/v1/auth/logout`

需要用户 JWT。

响应 `data`：

```json
{
  "message": "logged out"
}
```

### `GET /api/v1/auth/me`

需要用户 JWT。

响应 `data`：

```json
{
  "id": "uuid",
  "username": "tester",
  "email": "tester@example.com",
  "nickname": "tester",
  "avatar_url": null,
  "created_at": "2026-04-11T00:00:00Z",
  "createdAt": "2026-04-11T00:00:00Z"
}
```

### `PUT /api/v1/auth/me`

需要用户 JWT。

请求体：

```json
{
  "nickname": "New Nick",
  "avatar_url": "https://example.com/avatar.png"
}
```

说明：

- 也接受 `avatar`
- 传空字符串会清空对应字段

### `POST /api/v1/auth/change-password`

需要用户 JWT。

请求体同时兼容 camelCase 和 snake_case：

```json
{
  "old_password": "old-password",
  "new_password": "new-password-123"
}
```

```json
{
  "oldPassword": "old-password",
  "newPassword": "new-password-123"
}
```

## Bots

### `GET /api/v1/bots?page=1&page_size=20`

需要用户 JWT。分页返回当前用户拥有的 bots。

响应 `data` 为 bot 数组，主要字段：

```json
{
  "id": "uuid",
  "owner_id": "uuid",
  "userId": "uuid",
  "name": "Assistant Bot",
  "description": "bot description",
  "avatar_url": "https://example.com/bot.png",
  "bot_type": "assistant",
  "status": "online",
  "status_code": 1,
  "is_public": false,
  "config": {},
  "mqtt_topic": null,
  "created_at": "2026-04-11T00:00:00Z",
  "updated_at": "2026-04-11T00:00:00Z"
}
```

### `POST /api/v1/bots`

需要用户 JWT。

请求体：

```json
{
  "name": "Assistant Bot",
  "description": "bot description",
  "avatar_url": "https://example.com/bot.png",
  "bot_type": "assistant",
  "is_public": false,
  "config": {}
}
```

### `GET /api/v1/bots/:id`

需要用户 JWT，仅 bot owner 可访问。

### `PUT /api/v1/bots/:id`

需要用户 JWT，仅 bot owner 可访问。

请求体支持部分更新：

```json
{
  "name": "Renamed Bot",
  "description": "updated",
  "avatar_url": "https://example.com/bot.png",
  "bot_type": "assistant",
  "status": 1,
  "is_public": true,
  "config": {
    "temperature": 0.7
  }
}
```

### `DELETE /api/v1/bots/:id`

需要用户 JWT，仅 bot owner 可访问。

响应 `data`：

```json
{
  "message": "bot deleted"
}
```

## Bot Keys

### `GET /api/v1/bots/:id/keys`

需要用户 JWT，仅 bot owner 可访问。

返回数组字段示例：

```json
{
  "id": "uuid",
  "bot_id": "uuid",
  "botId": "uuid",
  "key_prefix": "ocbk_xxxxxxxx",
  "name": "prod",
  "last_used_at": "2026-04-11T00:00:00Z",
  "last_used_ip": "127.0.0.1",
  "expires_at": "2026-04-11T00:00:00Z",
  "is_active": true,
  "status": "active",
  "created_at": "2026-04-11T00:00:00Z"
}
```

### `POST /api/v1/bots/:id/keys`

需要用户 JWT，仅 bot owner 可访问。

请求体：

```json
{
  "name": "prod",
  "expires_at": 1770000000
}
```

说明：

- `expires_at` 为 Unix 秒时间戳
- 明文 `key` 只会在创建时返回一次

创建响应 `data`：

```json
{
  "id": "uuid",
  "key": "ocbk_xxx",
  "key_prefix": "ocbk_xxx",
  "name": "prod",
  "expires_at": 1770000000,
  "created_at": 1760000000
}
```

### `DELETE /api/v1/bots/:id/keys/:key_id`

需要用户 JWT，仅 bot owner 可访问。

响应 `data`：

```json
{
  "message": "key revoked"
}
```

## Conversations

### `GET /api/v1/conversations?limit=50`

需要用户 JWT。

返回当前用户可见的会话列表。

响应 `data` 数组示例：

```json
{
  "id": "chat/dm/user/u1/bot/b1",
  "type": "bot",
  "name": "Bot b1",
  "targetId": "b1",
  "sourceId": "chat/dm/user/u1/bot/b1",
  "lastMessage": {
    "content": "hello",
    "timestamp": 1760000000
  },
  "unreadCount": 0,
  "conversation_id": "chat/dm/user/u1/bot/b1",
  "last_message": {
    "id": "uuid",
    "conversation_id": "chat/dm/user/u1/bot/b1",
    "content": {
      "type": "text",
      "body": "hello"
    }
  },
  "unread_count": 0
}
```

## Messages

### `GET /api/v1/messages?conversation_id=<topic>&limit=50&before_seq=0`

需要用户 JWT。

查询参数：

- `conversation_id`: 必填
- `limit`: 默认 `50`，最大 `200`
- `before_seq`: 可选，取指定 seq 之前的历史
- `before`: `before_seq` 的兼容别名

### `GET /api/v1/messages/*conversation_id?limit=50&before_seq=0`

需要用户 JWT。

功能同上，但把 conversation id 放到路径里。含 `/` 的 conversation id 需要 URL 编码。

### `POST /api/v1/messages`

需要用户 JWT。

支持两种常用请求方式。

方式一，显式指定 `to` 和 `content`：

```json
{
  "to": {
    "type": "bot",
    "id": "bot-uuid"
  },
  "content": {
    "type": "text",
    "body": "hello"
  }
}
```

方式二，显式指定 conversation id：

```json
{
  "conversation_id": "chat/group/group-uuid",
  "content_type": "text",
  "body": "@assistant hello"
}
```

兼容字段：

- `conversation_id` 或 `conversationId`
- `content_type` 或 `contentType`
- `meta` 或 `metadata`
- `from_*` / `to_*` 的 snake_case 和 camelCase

图片消息示例：

```json
{
  "to": {
    "type": "group",
    "id": "group-uuid"
  },
  "content": {
    "type": "image",
    "body": "Screenshot.png",
    "meta": {
      "asset": {
        "id": "asset-uuid"
      }
    }
  }
}
```

消息响应 `data` 示例：

```json
{
  "id": "message-uuid",
  "db_id": 12,
  "conversation_id": "chat/dm/user/u1/bot/b1",
  "message_id": "message-uuid",
  "from": {
    "type": "user",
    "id": "u1",
    "name": "tester"
  },
  "to": {
    "type": "bot",
    "id": "b1"
  },
  "content": {
    "type": "text",
    "body": "hello",
    "meta": {}
  },
  "timestamp": 1760000000,
  "seq": 12,
  "sender_type": "user",
  "sender_id": "u1",
  "bot_id": "b1",
  "msg_type": "text",
  "metadata": {},
  "mqtt_topic": "chat/dm/user/u1/bot/b1",
  "created_at": "2026-04-11T00:00:00Z"
}
```

图片消息返回中，`content` 会尽量补齐：

- `url`
- `name`
- `size`
- `meta.asset`

## Assets

当前仅开放图片上传相关接口，且依赖对象存储已配置。

### `POST /api/v1/assets/image/upload-prepare`

需要用户 JWT。

请求体：

```json
{
  "file_name": "example.png",
  "content_type": "image/png",
  "size": 12345,
  "conversation_id": "chat/group/group-uuid"
}
```

说明：

- 当前实现会校验图片类型和大小
- `conversation_id` 目前可传，但当前服务逻辑未使用它做额外约束

响应 `data`：

```json
{
  "asset": {
    "id": "asset-uuid",
    "kind": "image",
    "status": "pending",
    "storage_provider": "oss",
    "bucket": "bucket-name",
    "object_key": "uploads/2026/04/user-uuid/file.png",
    "mime_type": "image/png",
    "size": 12345,
    "file_name": "example.png"
  },
  "upload": {
    "method": "PUT",
    "url": "https://storage.example.com/...",
    "headers": {
      "Content-Type": "image/png"
    },
    "expires_at": "2026-04-11T00:00:00Z"
  }
}
```

### `POST /api/v1/assets/image/complete`

需要用户 JWT。

请求体：

```json
{
  "asset_id": "asset-uuid",
  "object_key": "uploads/2026/04/user-uuid/file.png"
}
```

响应 `data` 为最终资产对象：

```json
{
  "id": "asset-uuid",
  "kind": "image",
  "status": "ready",
  "storage_provider": "oss",
  "bucket": "bucket-name",
  "object_key": "uploads/2026/04/user-uuid/file.png",
  "mime_type": "image/png",
  "size": 12345,
  "file_name": "example.png",
  "download_url": "https://storage.example.com/...",
  "download_url_expires_at": "2026-04-11T00:10:00Z"
}
```

## Groups

### `GET /api/v1/groups?page=1&page_size=20`

需要用户 JWT。

分页返回当前用户所在群组。

### `POST /api/v1/groups`

需要用户 JWT。

请求体：

```json
{
  "name": "Project Group",
  "description": "group description",
  "avatar_url": "https://example.com/group.png",
  "max_members": 500
}
```

### `GET /api/v1/groups/:id`

需要用户 JWT。

### `PUT /api/v1/groups/:id`

需要用户 JWT，仅群 owner 可更新。

请求体支持部分更新：

```json
{
  "name": "Renamed Group",
  "description": "updated",
  "avatar_url": "https://example.com/group.png",
  "is_active": true,
  "max_members": 1000
}
```

### `DELETE /api/v1/groups/:id`

需要用户 JWT，仅群 owner 可删除。

### `GET /api/v1/groups/:id/members`

需要用户 JWT。

响应 `data`：

```json
{
  "users": [
    {
      "id": "uuid",
      "group_id": "uuid",
      "user_id": "uuid",
      "role": "owner",
      "nickname": "tester",
      "is_active": true,
      "joined_at": "2026-04-11T00:00:00Z"
    }
  ],
  "bots": [
    {
      "id": "uuid",
      "group_id": "uuid",
      "bot_id": "uuid",
      "role": "member",
      "nickname": "assistant",
      "is_active": true,
      "added_at": "2026-04-11T00:00:00Z"
    }
  ]
}
```

### `POST /api/v1/groups/:id/members`

需要用户 JWT。

请求体二选一：

```json
{
  "user_id": "user-uuid",
  "role": "member",
  "nickname": "tester"
}
```

```json
{
  "bot_id": "bot-uuid",
  "role": "member",
  "nickname": "assistant"
}
```

规则：

- 只有群 owner 或 admin 可以管理成员
- 添加 bot 时，请求用户必须是该 bot 的 owner

### `DELETE /api/v1/groups/:id/members/:uid`

需要用户 JWT。

当前路径参数名是 `uid`，实现上按“用户成员 ID”处理，不用于删除 bot 成员。

## Bot Runtime HTTP

这组接口给 `plugins/openclaw-bot-chat/` 使用，统一走 `X-Bot-Key` 认证。

### `GET /api/v1/bot-runtime/bootstrap`

响应 `data`：

```json
{
  "bot": {
    "id": "bot-uuid",
    "name": "Assistant Bot",
    "description": "bot description",
    "status": "online",
    "config": {}
  },
  "groups": [
    {
      "id": "group-uuid",
      "name": "Project Group",
      "topic": "chat/group/group-uuid"
    }
  ],
  "dialogs": [
    {
      "dialog_id": "chat/dm/user/u1/bot/b1",
      "topic": "chat/dm/user/u1/bot/b1"
    }
  ],
  "subscriptions": [
    {
      "topic": "chat/group/group-uuid",
      "qos": 1
    }
  ],
  "checkpoints": [],
  "transport_policy": {
    "heartbeat_interval_ms": 15000,
    "base_reconnect_delay_ms": 1000,
    "max_reconnect_delay_ms": 30000,
    "topics": []
  }
}
```

### `POST /api/v1/bot-runtime/messages`

请求体：

```json
{
  "dialog_id": "chat/dm/user/u1/bot/b1",
  "message_id": "message-uuid",
  "content_type": "text",
  "body": "hello from bot",
  "meta": {},
  "reply_to_message_id": "previous-message-uuid"
}
```

兼容字段：

- `dialog_id` 或 `topic`
- `meta` 或 `metadata`

### `POST /api/v1/bot-runtime/heartbeat`

当前只做鉴权和存活确认，响应：

```json
{
  "ok": true
}
```

### `GET /api/v1/bot-runtime/dialogs/:dialog_id/messages?after_seq=0&limit=50`

查询参数：

- `after_seq`: 可选，拉增量
- `limit`: 默认 `50`，最大 `200`

响应 `data`：

```json
{
  "messages": [
    {
      "id": "message-uuid",
      "conversation_id": "chat/dm/user/u1/bot/b1",
      "content": {
        "type": "text",
        "body": "hello"
      },
      "seq": 12
    }
  ]
}
```

## WebSocket

### 连接

用户：

```text
GET /api/v1/ws?token=<access-token>
```

或：

```http
GET /api/v1/ws
Authorization: Bearer <access-token>
```

bot：

```http
GET /api/v1/ws
X-Bot-Key: <bot-access-key>
```

### 常见帧

订阅：

```json
{
  "type": "subscribe",
  "topic": "chat/group/group-uuid"
}
```

取消订阅：

```json
{
  "type": "unsubscribe",
  "topic": "chat/group/group-uuid"
}
```

发布：

```json
{
  "type": "publish",
  "topic": "chat/dm/user/u1/bot/b1",
  "payload": {
    "from": {
      "type": "user",
      "id": "u1"
    },
    "to": {
      "type": "bot",
      "id": "b1"
    },
    "content": {
      "type": "text",
      "body": "hello"
    }
  }
}
```

服务端推送消息：

```json
{
  "type": "message",
  "topic": "chat/dm/user/u1/bot/b1",
  "payload": {
    "id": "message-uuid",
    "from": {
      "type": "user",
      "id": "u1"
    },
    "to": {
      "type": "bot",
      "id": "b1"
    },
    "content": {
      "type": "text",
      "body": "hello",
      "meta": {}
    },
    "timestamp": 1760000000,
    "seq": 12
  }
}
```

心跳：

```json
{
  "type": "ping",
  "id": "client-generated-id"
}
```

服务端可能返回：

```json
{
  "type": "pong",
  "id": "client-generated-id"
}
```

或：

```json
{
  "type": "ack",
  "id": "client-generated-id"
}
```

## 兼容性备注

- 当前接口同时返回一部分 snake_case 和 camelCase 字段，前端兼容层依赖这些别名
- 资产消息的 `content.url`、`content.name`、`content.size` 来自 `metadata.asset`
- `PrepareImageUploadRequest.conversation_id` 当前保留，但服务端尚未基于它做 ACL 或对象归属校验
- 群成员删除接口当前只处理用户成员，bot 成员移除尚未暴露独立 HTTP 接口
