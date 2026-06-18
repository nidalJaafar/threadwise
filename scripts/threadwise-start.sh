#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-30000}"
OPEN_HOST="${THREADWISE_OPEN_HOST:-localhost}"
URL="http://${OPEN_HOST}:${PORT}"
PID_FILE="${ROOT_DIR}/.threadwise.pid"
LOG_FILE="${ROOT_DIR}/.threadwise.log"

cd "${ROOT_DIR}"

if [ ! -d "${ROOT_DIR}/.next" ]; then
  npm run build
fi

if [ -f "${PID_FILE}" ]; then
  EXISTING_PID="$(cat "${PID_FILE}")"
  if kill -0 "${EXISTING_PID}" >/dev/null 2>&1; then
    printf 'ThreadWise is already running at %s\n' "${URL}"
    xdg-open "${URL}" >/dev/null 2>&1 || true
    exit 0
  fi
fi

PORT="${PORT}" HOSTNAME="0.0.0.0" nohup npm run start >"${LOG_FILE}" 2>&1 &
SERVER_PID="$!"
printf '%s' "${SERVER_PID}" >"${PID_FILE}"

printf 'Starting ThreadWise on %s...\n' "${URL}"

for _ in $(seq 1 60); do
  if curl -fsS "${URL}" >/dev/null 2>&1; then
    printf 'ThreadWise is ready at %s\n' "${URL}"
    xdg-open "${URL}" >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 1
done

printf 'ThreadWise did not become ready in time. Check %s\n' "${LOG_FILE}" >&2
exit 1
