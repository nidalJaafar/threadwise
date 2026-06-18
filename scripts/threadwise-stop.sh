#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="${ROOT_DIR}/.threadwise.pid"

if [ ! -f "${PID_FILE}" ]; then
  printf 'ThreadWise PID file not found. Nothing to stop.\n'
  exit 0
fi

PID="$(cat "${PID_FILE}")"

if kill -0 "${PID}" >/dev/null 2>&1; then
  kill "${PID}"
  printf 'Stopped ThreadWise process %s.\n' "${PID}"
else
  printf 'ThreadWise process %s is not running.\n' "${PID}"
fi

rm -f "${PID_FILE}"
