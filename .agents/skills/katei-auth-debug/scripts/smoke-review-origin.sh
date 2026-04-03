#!/bin/zsh

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(pwd)}"

if [[ $# -gt 0 ]]; then
  CONFIG_PATH="$1"
  shift
else
  CONFIG_PATH="$ROOT_DIR/.agents/katei-auth-debug.config.json"
fi

node "$ROOT_DIR/.agents/skills/katei-auth-debug/scripts/verify-review-origin.mjs" --config "$CONFIG_PATH" "$@"
