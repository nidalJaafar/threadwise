#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="${HOME}/.config/systemd/user"
SERVICE_FILE="${SERVICE_DIR}/threadwise.service"
NODE_BIN="$(command -v npm)"

mkdir -p "${SERVICE_DIR}"

cat >"${SERVICE_FILE}" <<SERVICE
[Unit]
Description=ThreadWise local server
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT_DIR}
Environment=NODE_ENV=production
Environment=PORT=30000
Environment=HOSTNAME=0.0.0.0
ExecStart=${NODE_BIN} run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SERVICE

systemctl --user daemon-reload
systemctl --user enable --now threadwise.service

printf 'ThreadWise service installed and started.\n'
printf 'Status: systemctl --user status threadwise.service\n'
printf 'Logs:   journalctl --user -u threadwise.service -f\n'
