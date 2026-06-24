#!/usr/bin/env bash
# Convenience dev launcher (POSIX). Backend in foreground, Vite in background.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -d "$root/frontend/node_modules" ]; then
  (cd "$root/frontend" && npm install)
fi

echo "[dev] starting Vite -> http://localhost:51173"
(cd "$root/frontend" && npm run dev) &
vite_pid=$!
trap 'kill $vite_pid 2>/dev/null || true' EXIT

echo "[dev] starting backend -> proxy :51080, web/ws :8770"
cd "$root"
python -m backend
