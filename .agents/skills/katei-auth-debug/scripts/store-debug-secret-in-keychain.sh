#!/bin/zsh

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(pwd)}"
CONFIG_PATH="${1:-$ROOT_DIR/.agents/katei-auth-debug.config.json}"

CONFIG_JSON="$(node -e "const fs=require('node:fs'); const path=require('node:path'); const configPath=path.resolve(process.cwd(), process.argv[1]); const config=JSON.parse(fs.readFileSync(configPath,'utf8')); const baseUrl=new URL(config.baseUrl); console.log(JSON.stringify({service: config.auth?.secretKeychainService || 'katei-auth-debug', account: config.auth?.secretKeychainAccount || baseUrl.hostname}));" "$CONFIG_PATH")"
SERVICE_NAME="$(node -e "const config=JSON.parse(process.argv[1]); console.log(config.service);" "$CONFIG_JSON")"
ACCOUNT_NAME="$(node -e "const config=JSON.parse(process.argv[1]); console.log(config.account);" "$CONFIG_JSON")"

if [[ -n "${KATEI_DEBUG_AUTH_SECRET:-}" ]]; then
  SECRET_VALUE="$KATEI_DEBUG_AUTH_SECRET"
else
  read -r -s "?Katei debug auth secret: " SECRET_VALUE
  echo
fi

if [[ -z "$SECRET_VALUE" ]]; then
  echo "Missing Katei debug auth secret." >&2
  exit 1
fi

security add-generic-password -U -s "$SERVICE_NAME" -a "$ACCOUNT_NAME" -w "$SECRET_VALUE"
echo "Stored secret in macOS Keychain service=$SERVICE_NAME account=$ACCOUNT_NAME"
