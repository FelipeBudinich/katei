#!/bin/zsh

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(pwd)}"
CONFIG_PATH="${1:-$ROOT_DIR/.agents/katei-auth-debug.config.json}"

CONFIG_JSON="$(node -e "const fs=require('node:fs'); const path=require('node:path'); const configPath=path.resolve(process.cwd(), process.argv[1]); const config=JSON.parse(fs.readFileSync(configPath,'utf8')); console.log(JSON.stringify({binaryPath: config.chrome?.binaryPath || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', remoteDebuggingPort: config.chrome?.remoteDebuggingPort || 9222, userDataDir: config.chrome?.userDataDir || '/tmp/katei-auth-debug-profile'}));" "$CONFIG_PATH")"

CHROME_BINARY_PATH="$(node -e "const config=JSON.parse(process.argv[1]); console.log(config.binaryPath);" "$CONFIG_JSON")"
REMOTE_DEBUGGING_PORT="$(node -e "const config=JSON.parse(process.argv[1]); console.log(config.remoteDebuggingPort);" "$CONFIG_JSON")"
USER_DATA_DIR="$(node -e "const config=JSON.parse(process.argv[1]); console.log(config.userDataDir);" "$CONFIG_JSON")"

exec "$CHROME_BINARY_PATH" \
  --remote-debugging-port="$REMOTE_DEBUGGING_PORT" \
  --user-data-dir="$USER_DATA_DIR" \
  --no-first-run \
  --no-default-browser-check \
  about:blank
