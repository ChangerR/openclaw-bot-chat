#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/dev-common.sh"

load_dev_env
parse_frontend_mapping
ensure_frontend_dependencies

cd "$REPO_ROOT/frontend"

exec env \
  NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" \
  npm run dev -- --hostname "$FRONTEND_BIND_HOST" --port "$FRONTEND_BIND_PORT" "$@"
