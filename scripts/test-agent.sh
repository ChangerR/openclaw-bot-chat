#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PLUGIN_DIR="$REPO_DIR/plugins/openclaw-bot-chat"
ENV_FILE="${BOT_CHAT_TEST_AGENT_ENV:-$SCRIPT_DIR/test-agent.env}"
GENERATED_CONFIG_DEFAULT="$PLUGIN_DIR/.test-agent.config.json"
COMMAND="${1:-start}"

usage() {
  cat <<EOF
Usage:
  ./scripts/test-agent.sh start
  ./scripts/test-agent.sh check
  ./scripts/test-agent.sh print-config

Environment file:
  $ENV_FILE

First run:
  cp ./scripts/test-agent.env.example ./scripts/test-agent.env
  edit ./scripts/test-agent.env
  ./scripts/test-agent.sh start
EOF
}

die() {
  echo "Error: $*" >&2
  exit 1
}

load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    die "missing env file: $ENV_FILE. Copy ./scripts/test-agent.env.example to ./scripts/test-agent.env first."
  fi

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

read_env_value() {
  local primary="$1"
  local fallback="${2:-}"

  if [[ -n "${!primary:-}" ]]; then
    printf '%s\n' "${!primary}"
    return 0
  fi
  if [[ -n "$fallback" && -n "${!fallback:-}" ]]; then
    printf '%s\n' "${!fallback}"
    return 0
  fi
  return 1
}

require_env_value() {
  local primary="$1"
  local fallback="${2:-}"
  local value

  if ! value="$(read_env_value "$primary" "$fallback")"; then
    if [[ -n "$fallback" ]]; then
      die "$primary or $fallback is required"
    fi
    die "$primary is required"
  fi

  if [[ -z "${value//[[:space:]]/}" ]]; then
    if [[ -n "$fallback" ]]; then
      die "$primary or $fallback is required"
    fi
    die "$primary is required"
  fi

  printf '%s\n' "$value"
}

resolve_path() {
  local raw="$1"
  if [[ "$raw" == /* ]]; then
    printf '%s\n' "$raw"
  else
    printf '%s/%s\n' "$REPO_DIR" "$raw"
  fi
}

prepare_log_file() {
  local log_dir
  local log_file
  local timestamp

  log_dir="$(resolve_path "${BOT_CHAT_TEST_AGENT_LOG_DIR:-plugins/openclaw-bot-chat/data/test-agent/logs}")"
  mkdir -p "$log_dir"

  if [[ -n "${BOT_CHAT_TEST_AGENT_LOG_FILE:-}" ]]; then
    log_file="$(resolve_path "$BOT_CHAT_TEST_AGENT_LOG_FILE")"
    mkdir -p "$(dirname -- "$log_file")"
  else
    timestamp="$(date '+%Y%m%d-%H%M%S')"
    log_file="$log_dir/test-agent-$timestamp.log"
  fi

  : >"$log_file"
  printf '%s\n' "$log_file"
}

write_generated_config() {
  local bot_chat_base_url
  local bot_chat_access_key
  local bot_chat_bot_id
  local handler_path
  local state_dir
  local generated_config

  bot_chat_base_url="$(require_env_value BOT_CHAT_BASE_URL)"
  bot_chat_access_key="$(require_env_value BOT_CHAT_ACCESS_KEY ACCESS_KEY)"
  bot_chat_bot_id="$(read_env_value BOT_CHAT_BOT_ID BOT_ID || true)"

  handler_path="$(resolve_path "${BOT_CHAT_TEST_AGENT_HANDLER:-plugins/openclaw-bot-chat/examples/openai-compatible-handler.cjs}")"
  state_dir="$(resolve_path "${BOT_CHAT_TEST_AGENT_STATE_DIR:-plugins/openclaw-bot-chat/data/test-agent}")"
  generated_config="$(resolve_path "${BOT_CHAT_TEST_AGENT_CONFIG:-$GENERATED_CONFIG_DEFAULT}")"

  mkdir -p "$(dirname -- "$generated_config")" "$state_dir"

  BOT_CHAT_BASE_URL="$bot_chat_base_url" \
  BOT_CHAT_ACCESS_KEY="$bot_chat_access_key" \
  BOT_CHAT_BOT_ID="$bot_chat_bot_id" \
  BOT_CHAT_TEST_AGENT_HANDLER="$handler_path" \
  BOT_CHAT_TEST_AGENT_STATE_DIR="$state_dir" \
  BOT_CHAT_TEST_AGENT_CONFIG="$generated_config" \
  node - <<'NODE'
const fs = require("node:fs");

function readString(name, fallback = "") {
  const value = process.env[name];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return fallback;
}

function readInt(name, fallback) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

const botKey = readString("BOT_CHAT_TEST_AGENT_KEY", "test-bot");
const config = {
  botChatBaseUrl: readString("BOT_CHAT_BASE_URL"),
  openClawAgentHandler: readString("BOT_CHAT_TEST_AGENT_HANDLER"),
  defaultBot: botKey,
  heartbeatIntervalMs: readInt("BOT_CHAT_HEARTBEAT_INTERVAL_MS", 15000),
  httpTimeoutMs: readInt("BOT_CHAT_HTTP_TIMEOUT_MS", 15000),
  reconnectBaseDelayMs: readInt("BOT_CHAT_RECONNECT_BASE_MS", 1000),
  reconnectMaxDelayMs: readInt("BOT_CHAT_RECONNECT_MAX_MS", 30000),
  stateDir: readString("BOT_CHAT_TEST_AGENT_STATE_DIR"),
  bots: {
    [botKey]: {
      accessKey: readString("BOT_CHAT_ACCESS_KEY"),
      enabled: true,
    },
  },
};

const defaultChannelPolicy = readString("BOT_CHAT_TEST_AGENT_CHANNEL_POLICY");
if (defaultChannelPolicy) {
  config.defaultChannelPolicy = defaultChannelPolicy;
}

const botId = readString("BOT_CHAT_BOT_ID");
if (botId) {
  config.bots[botKey].id = botId;
}

fs.writeFileSync(
  readString("BOT_CHAT_TEST_AGENT_CONFIG"),
  `${JSON.stringify(config, null, 2)}\n`,
  "utf8",
);
NODE

  printf '%s\n' "$generated_config"
}

ensure_plugin_dependencies() {
  if [[ ! -d "$PLUGIN_DIR/node_modules" ]]; then
    echo "Installing plugin dependencies..."
    (
      cd "$PLUGIN_DIR"
      npm ci
    )
  fi
}

build_plugin() {
  echo "Building test agent runtime..."
  (
    cd "$PLUGIN_DIR"
    npm run build
  )
}

print_runtime_summary() {
  local generated_config="$1"
  local log_file="$2"
  local bot_chat_base_url
  local bot_chat_access_key
  local bot_chat_bot_id

  bot_chat_base_url="$(require_env_value BOT_CHAT_BASE_URL)"
  bot_chat_access_key="$(require_env_value BOT_CHAT_ACCESS_KEY ACCESS_KEY)"
  bot_chat_bot_id="$(read_env_value BOT_CHAT_BOT_ID BOT_ID || true)"

  cat <<EOF
Starting Bot Chat test agent
  plugin dir:   $PLUGIN_DIR
  env file:     $ENV_FILE
  config file:  $generated_config
  service url:  $bot_chat_base_url
  bot key:      ${bot_chat_access_key:0:12}...
  bot id:       ${bot_chat_bot_id:-<auto>}
  model url:    $(require_env_value OPENAI_COMPAT_BASE_URL)
  model:        ${OPENAI_COMPAT_MODEL:-gpt-4o-mini}
  log file:     $log_file
  debug logs:   ${BOT_CHAT_RUNTIME_DEBUG:-1}
EOF
}

run_start() {
  local generated_config
  local log_file

  require_env_value OPENAI_COMPAT_BASE_URL >/dev/null
  require_env_value OPENAI_COMPAT_API_KEY >/dev/null

  generated_config="$(write_generated_config)"
  log_file="$(prepare_log_file)"
  ensure_plugin_dependencies
  build_plugin
  export BOT_CHAT_RUNTIME_DEBUG="${BOT_CHAT_RUNTIME_DEBUG:-1}"
  print_runtime_summary "$generated_config" "$log_file"

  export BOT_CHAT_CONFIG="$generated_config"
  export BOT_CHAT_TEST_AGENT_LOG_FILE="$log_file"

  (
    cd "$PLUGIN_DIR"
    exec > >(tee -a "$log_file") 2>&1
    echo "[$(date '+%Y-%m-%d %H:%M:%S%z')] launching test agent"
    echo "[$(date '+%Y-%m-%d %H:%M:%S%z')] BOT_CHAT_CONFIG=$generated_config"
    echo "[$(date '+%Y-%m-%d %H:%M:%S%z')] BOT_CHAT_RUNTIME_DEBUG=$BOT_CHAT_RUNTIME_DEBUG"
    exec npm start
  )
}

run_check() {
  local generated_config

  generated_config="$(write_generated_config)"
  ensure_plugin_dependencies
  echo "Validating test agent setup..."
  export BOT_CHAT_CONFIG="$generated_config"

  (
    cd "$PLUGIN_DIR"
    npm run check
  )
}

run_print_config() {
  local generated_config

  generated_config="$(write_generated_config)"
  echo "$generated_config"
  cat "$generated_config"
}

main() {
  case "$COMMAND" in
    -h|--help|help)
      usage
      ;;
    start)
      load_env
      run_start
      ;;
    check)
      load_env
      run_check
      ;;
    print-config)
      load_env
      run_print_config
      ;;
    *)
      usage
      die "unknown command: $COMMAND"
      ;;
  esac
}

main "$@"
