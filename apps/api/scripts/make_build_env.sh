#!/usr/bin/env bash
set -Eeuo pipefail

COMMIT_SHA="${GITHUB_SHA:-$(git rev-parse --short HEAD)}"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if command -v node >/dev/null 2>&1; then
  VERSION="$(node -p "require('./apps/api/package.json').version" 2>/dev/null || echo '0.0.0')"
else
  VERSION="$(python3 -c "import json,sys;print(json.load(open('apps/api/package.json')).get('version','0.0.0'))" 2>/dev/null || echo '0.0.0')"
fi
NODE_ENV_VALUE="${NODE_ENV:-production}"
SERVICE_VALUE="${SERVICE:-vida-staging}"
REGION_VALUE="${REGION:-europe-west1}"

cat > build.env <<EOF_ENV
COMMIT_SHA=${COMMIT_SHA}
BUILD_TIME=${BUILD_TIME}
VERSION=${VERSION}
NODE_ENV=${NODE_ENV_VALUE}
SERVICE=${SERVICE_VALUE}
REGION=${REGION_VALUE}
EOF_ENV

ls -l build.env
head -n 20 build.env
