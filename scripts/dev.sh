#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
HOST="${HOST:-127.0.0.1}"

free_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "${pids}" ]]; then
    return
  fi

  echo "Stopping existing process on port ${port}: ${pids}"
  kill ${pids} 2>/dev/null || true

  for _ in {1..20}; do
    if ! lsof -tiTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
      return
    fi
    sleep 0.2
  done

  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "Force stopping process on port ${port}: ${pids}"
    kill -9 ${pids} 2>/dev/null || true
  fi
}

cleanup() {
  [[ -n "${BACKEND_PID:-}" ]] && kill "${BACKEND_PID}" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "${FRONTEND_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

free_port "${BACKEND_PORT}"
free_port "${FRONTEND_PORT}"

echo "Starting backend: http://${HOST}:${BACKEND_PORT}"
(
  cd "${ROOT_DIR}/backend"
  python3 -m uvicorn main:app --host "${HOST}" --port "${BACKEND_PORT}"
) &
BACKEND_PID="$!"

echo "Starting frontend: http://${HOST}:${FRONTEND_PORT}"
(
  cd "${ROOT_DIR}/frontend"
  VITE_API_BASE_URL="http://${HOST}:${BACKEND_PORT}/api" \
  VITE_API_ORIGIN="http://${HOST}:${BACKEND_PORT}" \
  npm run dev -- --host "${HOST}" --port "${FRONTEND_PORT}"
) &
FRONTEND_PID="$!"

echo
echo "TxnCatAI is starting."
echo "Frontend: http://${HOST}:${FRONTEND_PORT}"
echo "Backend:  http://${HOST}:${BACKEND_PORT}"
echo "Press Ctrl+C to stop both services."
echo

wait
