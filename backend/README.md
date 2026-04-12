# OpenClaw Bot Chat Backend

A Go backend service for multi-robot chat, supporting MQTT messaging, WebSocket real-time communication, and JWT authentication.

## Tech Stack

- **Go 1.21+**, Gin, GORM, PostgreSQL 15, Redis
- **MQTT**: `github.com/eclipse/paho.mqtt.golang`
- **WebSocket**: `github.com/gorilla/websocket`
- **Auth**: JWT (golang-jwt/jwt/v5)
- **Config**: Viper (YAML)
- **Logging**: zerolog

## Quick Start

### 1. Clone & Install Dependencies

```bash
cd backend
go mod tidy
```

### 2. Configure

Edit `config.yaml` with your PostgreSQL, Redis, and MQTT settings:

```yaml
database:
  host: "localhost"
  port: 5432
  user: "postgres"
  password: "your-password"
  dbname: "openclaw_bot_chat"

redis:
  host: "localhost"
  port: 6379

mqtt:
  broker: "tcp://localhost:1883"

jwt:
  secret: "change-me-in-production"
```

### 3. Run Database Migration

```bash
psql -U postgres -c "CREATE DATABASE openclaw_bot_chat;"
psql -U postgres -d openclaw_bot_chat -f migrations/init.sql
```

### 4. Run the Server

```bash
go run ./cmd/server
# Server starts on http://0.0.0.0:8080
```

## API Routes

详细接口文档见仓库根目录：

- `docs/API.md`

这里保留路由总览。

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/auth/register | Register new user |
| POST | /api/v1/auth/login | Login, returns JWT |
| POST | /api/v1/auth/refresh | Refresh tokens |
| POST | /api/v1/auth/logout | Logout |
| GET | /api/v1/auth/me | Current user info |
| PUT | /api/v1/auth/me | Update current user profile |
| POST | /api/v1/auth/change-password | Change current user password |

### Bots
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/bots | List user's bots |
| POST | /api/v1/bots | Create bot |
| GET | /api/v1/bots/:id | Get bot details |
| PUT | /api/v1/bots/:id | Update bot |
| DELETE | /api/v1/bots/:id | Delete bot |
| GET | /api/v1/bots/:id/keys | List bot keys |
| POST | /api/v1/bots/:id/keys | Create new key |
| DELETE | /api/v1/bots/:id/keys/:key_id | Revoke key |

### Messages
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/messages?conversation_id=xxx&limit=50 | Get messages |
| GET | /api/v1/messages/:conversation_id | Get messages via REST-style path |
| POST | /api/v1/messages | Send message via HTTP fallback |
| GET | /api/v1/conversations | List conversations |

### Groups
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/groups | List groups |
| POST | /api/v1/groups | Create group |
| GET | /api/v1/groups/:id | Get group |
| PUT | /api/v1/groups/:id | Update group |
| DELETE | /api/v1/groups/:id | Delete group |
| POST | /api/v1/groups/:id/members | Add member |
| DELETE | /api/v1/groups/:id/members/:uid | Remove member |
| GET | /api/v1/groups/:id/members | List members |

### Realtime
| Endpoint | Description |
|----------|-------------|
| GET /api/v1/ws?token=<jwt> | User WebSocket session (JWT) |
| GET /api/v1/ws + `X-Bot-Key` | Bot WebSocket session (validated bot key) |

### Bot Runtime
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/bot-runtime/bootstrap | Return bot bootstrap info for plugin runtime |
| POST | /api/v1/bot-runtime/messages | Send bot reply through HTTP with `X-Bot-Key` |
| POST | /api/v1/bot-runtime/heartbeat | Optional runtime heartbeat |
| GET | /api/v1/bot-runtime/dialogs/:dialog_id/messages | Fetch dialog messages for replay / recovery |

## MQTT Topics

MQTT routing only trusts the topic path itself. `bots.mqtt_topic` and `groups.mqtt_topic` are legacy fields and are not the route source.

| Topic | Description |
|-------|-------------|
| `chat/dm/{leftType}/{leftId}/{rightType}/{rightId}` | Canonical direct route for `user` / `bot` peers |
| `chat/group/{groupId}` | Group route |

## WebSocket Protocol

Connect as user: `GET /api/v1/ws?token=<jwt>`

Connect as bot: `GET /api/v1/ws` with header `X-Bot-Key: <bot-key>`

**Subscribe:**
```json
{"type": "subscribe", "topic": "chat/dm/bot/xxx/bot/yyy"}
```

**Publish:**
```json
{"type": "publish", "topic": "chat/dm/bot/xxx/bot/yyy", "payload": {"from": {"type": "bot", "id": "xxx"}, "to": {"type": "bot", "id": "yyy"}, "content": {"type": "text", "body": "hello"}}}
```

**Incoming Message:**
```json
{"type": "message", "topic": "chat/dm/bot/xxx/bot/yyy", "payload": {...}}
```

## Bot Key Format

- Format: `ocbk_{32-char-base64-safe}_{8-char-uuid}`
- Example: `ocbk_Abc123XYZPQR_defghijk_lmnopqrs`
- Stored as bcrypt hash
- Shown only once at creation time

## Project Structure

```
backend/
├── cmd/server/main.go
├── internal/
│   ├── config/
│   ├── model/
│   ├── repository/
│   ├── service/
│   ├── handler/
│   ├── mqtt/
│   ├── middleware/
│   └── websocket/
├── pkg/
│   ├── jwt/
│   ├── password/
│   └── response/
├── migrations/
├── scripts/
├── config.yaml
├── go.mod
└── go.sum
```

## Docker

```bash
# With Docker Compose v2
docker compose up -d

# Manual
docker build -t openclaw-backend .
docker run -p 8080:8080 -v $(pwd)/config.yaml:/app/config.yaml openclaw-backend
```
