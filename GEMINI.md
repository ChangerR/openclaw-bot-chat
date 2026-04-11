# GEMINI.md

## Project Overview
OpenClaw Bot Chat is a multi-component messaging system designed for OpenClaw integration. It provides a Go-based backend for real-time communication via MQTT and WebSockets, a Next.js frontend for management and chatting, and a dedicated Node.js/TypeScript plugin for OpenClaw side runtime.

### Core Architecture
- **Backend (`backend/`):** Go application using the Gin web framework.
  - **Database:** PostgreSQL for persistent storage (users, bots, messages).
  - **Cache:** Redis for real-time features and caching.
  - **Messaging:** MQTT (Mosquitto) for pub/sub message distribution.
  - **Communication:** REST APIs and WebSockets.
- **Frontend (`frontend/`):** Next.js application (App Router).
  - **Styling:** Tailwind CSS.
  - **State Management:** Zustand.
- **Plugin (`plugins/openclaw-bot-chat/`):** Node.js runtime plugin using WebSockets to connect to the backend.

## Building and Running

### Prerequisites
- Docker and Docker Compose
- Go (1.23+)
- Node.js (>=22.0.0)

### Development Mode
The project provides a set of scripts to manage the development environment:

1.  **Start Backend Stack (Postgres, Redis, Mosquitto, Backend):**
    ```bash
    ./scripts/dev-up.sh
    ```
    *This script also ensures a test account is created (default: `tester` / `test123456`).*

2.  **Start Frontend Development (HMR):**
    ```bash
    ./scripts/dev-front.sh
    ```

3.  **Logs and Status:**
    - `./scripts/dev-logs.sh`: View combined Docker logs.
    - `./scripts/dev-ps.sh`: Check service status.

4.  **Stop Development Environment:**
    ```bash
    ./scripts/dev-down.sh
    ```

### Production/Containerized Deployment
Use the root `docker-compose.yml` for a full stack deployment:
```bash
docker compose up --build -d
```

## Project Structure
- `backend/`: Go source code.
  - `cmd/server/`: Entry point (`main.go`).
  - `internal/`: Core logic (handlers, services, repositories, models).
  - `migrations/`: SQL migration files.
- `frontend/`: Next.js source code.
  - `src/app/`: App router pages.
  - `src/components/`: Reusable React components.
  - `src/contexts/`: React contexts (e.g., Auth).
- `plugins/openclaw-bot-chat/`: OpenClaw plugin source.
- `scripts/`: Development and utility scripts.
- `deploy/`: Nginx and other deployment configurations.

## Development Conventions

### Backend
- **Framework:** Gin (HTTP), GORM (ORM).
- **Organization:** Follows clean architecture principles:
  - `handler`: Request/Response handling.
  - `service`: Business logic.
  - `repository`: Data access logic.
  - `model`: GORM models and data structures.
- **Configuration:** Managed via `config.yaml` and environment variables (using Viper).
- **Authentication:** JWT-based.

### Frontend
- **Framework:** Next.js (TypeScript).
- **Styling:** Tailwind CSS with Vanilla CSS where needed.
- **State:** Use Zustand for global state management.
- **Patterns:** Prefer Functional Components and Hooks.

### Messaging
- Messages are routed through MQTT.
- Conversation IDs follow patterns like `user/{uid}/bot/{bid}` or `group/{gid}`.

## Key Files
- `README.md`: General project documentation and deployment guide.
- `docker-compose.yml`: Main service orchestration.
- `backend/migrations/init.sql`: Database schema definition.
- `scripts/dev.env.example`: Template for development environment variables.
