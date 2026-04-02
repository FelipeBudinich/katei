#!/bin/zsh

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(pwd)}"
CONFIG_PATH="${1:-$ROOT_DIR/.agents/katei-auth-debug.config.json}"

CONFIG_JSON="$(node -e "const fs=require('node:fs'); const path=require('node:path'); const configPath=path.resolve(process.cwd(), process.argv[1]); const config=JSON.parse(fs.readFileSync(configPath,'utf8')); console.log(JSON.stringify({remoteDebuggingPort: config.chrome?.remoteDebuggingPort || 9222}));" "$CONFIG_PATH")"
REMOTE_DEBUGGING_PORT="$(node -e "const config=JSON.parse(process.argv[1]); console.log(config.remoteDebuggingPort);" "$CONFIG_JSON")"

bash "$ROOT_DIR/.agents/skills/katei-auth-debug/scripts/run-chrome.sh" "$CONFIG_PATH" >/tmp/katei-auth-debug-chrome.log 2>&1 &
CHROME_PID=$!

cleanup() {
  kill "$CHROME_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

for _ in {1..30}; do
  if curl -sS "http://127.0.0.1:${REMOTE_DEBUGGING_PORT}/json/version" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -sS "http://127.0.0.1:${REMOTE_DEBUGGING_PORT}/json/version" >/dev/null
node "$ROOT_DIR/.agents/skills/katei-auth-debug/scripts/exercise-board-lifecycle.mjs" --config "$CONFIG_PATH"
