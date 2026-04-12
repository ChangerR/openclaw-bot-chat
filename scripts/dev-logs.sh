#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/dev-common.sh"

load_dev_env

if [[ $# -gt 0 ]]; then
  compose logs -f "$@"
  exit 0
fi

compose logs -f backend postgres redis emqx
