#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

load_env_file

if [[ $# -gt 0 ]]; then
  compose logs -f "$@"
  exit 0
fi

compose logs -f frontend backend postgres redis mosquitto
