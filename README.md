# OpenClaw Bot Chat

这个仓库目前包含 3 个部分：

- `backend/`: Go 后端，提供 REST API、WebSocket、MQTT 转发
- `frontend/`: Next.js 管理端 / 聊天界面
- `plugins/openclaw-bot-chat/`: OpenClaw 侧运行插件

## API 文档

当前 API 文档已单独维护在：

- `docs/API.md`

这份文档覆盖：

- 用户 HTTP API
- bot runtime HTTP API
- WebSocket 接入方式
- 会话 topic / conversation id 规则

如果后续改动了路由、请求体或响应字段，优先同步更新 `docs/API.md`。

## 推荐部署方式

核心服务推荐直接用 Docker Compose 部署。当前仓库已经补齐了前端生产镜像，启动后会拉起：

- PostgreSQL 15
- Redis 7
- Eclipse Mosquitto 2
- Go backend
- Next.js frontend

## 开发模式

如果你希望改完前端代码立刻看到效果，开发模式不要启动 compose 里的 `frontend`，而是：

- Docker 只负责 `postgres`、`redis`、`mosquitto`、`backend`
- 前端在宿主机上跑 `next dev`
- Nginx 继续反代到本机前端开发端口

仓库里已经提供了开发模式脚本：

```bash
./scripts/dev-up.sh
./scripts/dev-front.sh
./scripts/dev-ps.sh
./scripts/dev-logs.sh
./scripts/dev-down.sh
```

首次执行会自动生成 `scripts/dev.env`。默认配置仍然对齐 `test-claw.changer.site -> 127.0.0.1:4173` 这套反代。如果你只是本机开发，可以把 `scripts/dev.env` 改成自己的地址，例如：

```bash
DOMAIN=127.0.0.1:4173
NEXT_PUBLIC_API_URL=http://127.0.0.1:8080
NEXT_PUBLIC_API_WS_HOST=127.0.0.1:8080
```

开发模式还会自动保底创建一个固定测试账号，默认是：

- 用户名：`tester`
- 邮箱：`tester@example.com`
- 密码：`test123456`

如果你想改成别的固定凭证，直接修改 `scripts/dev.env` 里的 `DEV_TEST_*` 变量。

开发模式启动顺序：

1. `./scripts/dev-up.sh`
2. 另开一个终端执行 `./scripts/dev-front.sh`
3. 浏览器打开 `http://test-claw.changer.site` 或你在 `scripts/dev.env` 里配置的地址

### test-claw 脚本

如果你的站点域名就是 `test-claw.changer.site`，并且 Nginx 反代按 `127.0.0.1:4173 -> frontend`、`127.0.0.1:8080 -> backend` 这套映射走，直接用仓库里的脚本：

```bash
./scripts/docker-up.sh
./scripts/docker-ps.sh
./scripts/docker-logs.sh
./scripts/docker-down.sh
```

首次执行 `./scripts/docker-up.sh` 会自动生成 `scripts/test-claw.env`，里面包含：

- `DOMAIN=test-claw.changer.site`
- `FRONTEND_PORT_MAPPING=127.0.0.1:4173:3000`
- `BACKEND_PORT_MAPPING=127.0.0.1:8080:8080`
- 自动生成的 `DATABASE_PASSWORD` / `MQTT_PASSWORD` / `JWT_SECRET`

这些脚本现在会直接通过根目录的 `docker-compose.yml` 管理前后端，不再额外在宿主机单独启动 frontend。

Nginx 配置样例已放在：

- `deploy/nginx/test-claw.changer.site.conf`

### 1. 准备环境

要求：

- Docker
- Docker Compose v2 (`docker compose`)

可选但建议先设置的环境变量：

```bash
export BACKEND_PORT_MAPPING=8080:8080
export FRONTEND_PORT_MAPPING=3000:3000
export POSTGRES_PORT_MAPPING=5432:5432
export REDIS_PORT_MAPPING=6379:6379

# 浏览器访问后端用的公开地址
export NEXT_PUBLIC_API_URL=http://localhost:8080
export NEXT_PUBLIC_API_WS_HOST=localhost:8080

# 生产环境务必修改
export JWT_SECRET='replace-with-a-real-secret'
export MQTT_PASSWORD='replace-with-a-real-password'
export DATABASE_PASSWORD='postgres'
```

如果你是部署到远程主机，不要保留 `localhost`。例如：

```bash
export NEXT_PUBLIC_API_URL=https://api.example.com
export NEXT_PUBLIC_API_WS_HOST=api.example.com
```

### 2. 启动核心服务

在仓库根目录执行：

```bash
docker compose up --build -d
```

查看状态：

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend
```

### 3. 验证

- 后端健康检查：`http://<服务器地址>:8080/health`
- 前端页面：`http://<服务器地址>:3000/login`

默认端口：

- Frontend: `3000`
- Backend: `8080`
- PostgreSQL: `5432`
- Redis: `6379`

### 4. 停止

```bash
docker compose down
```

仅停止服务：

```bash
docker compose stop
```

连卷一起删除：

```bash
docker compose down -v
```

## 手动部署

如果你不想用 Docker，可以分服务启动。

### Backend

```bash
cd backend
go mod tidy
go run ./cmd/server
```

后端读取 `backend/config.yaml`，也支持用环境变量覆盖常用配置，例如：

- `APP_MODE`
- `DATABASE_HOST`
- `DATABASE_PORT`
- `DATABASE_USER`
- `DATABASE_PASSWORD`
- `DATABASE_DBNAME`
- `REDIS_HOST`
- `REDIS_PORT`
- `MQTT_BROKER`
- `MQTT_USERNAME`
- `MQTT_PASSWORD`
- `JWT_SECRET`

数据库初始化：

```bash
psql -U postgres -c "CREATE DATABASE openclaw_bot_chat;"
psql -U postgres -d openclaw_bot_chat -f backend/migrations/init.sql
```

### Frontend

```bash
cd frontend
npm ci
NEXT_PUBLIC_API_URL=http://localhost:8080 \
NEXT_PUBLIC_API_WS_HOST=localhost:8080 \
npm run build
npm start
```

如果部署到远程服务器，把 `localhost` 改成浏览器能访问到的后端域名或 IP。
如果前端和后端都在同一个域名下并由 Nginx 反代，也可以不传这两个变量，让前端走同域 `/api/*` 和 `/api/v1/ws`。

## 插件部署

`plugins/openclaw-bot-chat/` 不是前后端主站的一部分，它是 OpenClaw 侧的独立运行时。

推荐测试方式：

```bash
cp ./scripts/test-agent.env.example ./scripts/test-agent.env
vi ./scripts/test-agent.env
./scripts/test-agent.sh start
```

脚本会自动生成插件配置、执行构建并启动测试 agent。
启动时会同时把 runtime 日志写到 `plugins/openclaw-bot-chat/data/test-agent/logs/` 下的时间戳日志文件，并继续输出到当前终端。

`./scripts/test-agent.env` 里最关键的是：

- `BOT_CHAT_BASE_URL`
- `BOT_CHAT_ACCESS_KEY`
- `BOT_CHAT_BOT_ID`（某些场景需要）
- `OPENAI_COMPAT_BASE_URL`
- `OPENAI_COMPAT_API_KEY`
- `OPENAI_COMPAT_MODEL`

辅助命令：

```bash
./scripts/test-agent.sh check
./scripts/test-agent.sh print-config
```

常用调试环境变量：

- `BOT_CHAT_RUNTIME_DEBUG=1`：打开更详细的消息/请求/回复日志
- `BOT_CHAT_LOG_BODY_MAX_LEN=600`：限制消息内容预览长度
- `BOT_CHAT_LOG_SUMMARY_MAX_LEN=1500`：限制 JSON 摘要长度
- `BOT_CHAT_TEST_AGENT_LOG_DIR=...`：指定日志目录
- `BOT_CHAT_TEST_AGENT_LOG_FILE=...`：指定单次运行的日志文件

如果你不想走脚本，也可以手动启动插件：

```bash
cd plugins/openclaw-bot-chat
npm ci
npm run build
BOT_CHAT_BASE_URL=https://botchat.example.com \
ACCESS_KEY=ocbk_xxx \
OPENCLAW_AGENT_URL=http://openclaw-agent:port/path \
npm start
```
