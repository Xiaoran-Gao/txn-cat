#!/usr/bin/env bash
set -euo pipefail

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

stop_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "${pids}" ]]; then
    echo "No process is listening on port ${port}."
    return
  fi

  echo "Stopping process on port ${port}: ${pids}"
  kill ${pids} 2>/dev/null || true
}

stop_port "${BACKEND_PORT}"
stop_port "${FRONTEND_PORT}"
