#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

load_env_file

echo "Starting OpenClaw Bot Chat with the test-claw profile..."
print_runtime_summary

compose up --build -d "$@"
compose ps

cat <<EOF

Startup finished.
Check backend health: curl http://127.0.0.1:8080/health
Check frontend page:  curl -I http://127.0.0.1:${FRONTEND_BIND_PORT}/login
Tail logs:            ./scripts/docker-logs.sh
Stop services:        ./scripts/docker-down.sh
EOF
