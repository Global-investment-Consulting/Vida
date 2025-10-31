#!/bin/sh

set -eu

: "${PORT:=3001}"

curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null
