#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/dev-common.sh"

load_dev_env

compose down "$@"

cat <<EOF
Docker services stopped.
If ./scripts/dev-front.sh is still running, stop it with Ctrl-C in its terminal.
EOF
