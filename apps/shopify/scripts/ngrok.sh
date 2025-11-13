#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-4001}"

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok is required. Install from https://ngrok.com/download" >&2
  exit 1
fi

echo "Starting ngrok tunnel on port ${PORT}..."
ngrok http "${PORT}"
