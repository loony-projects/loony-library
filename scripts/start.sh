#!/usr/bin/env bash
# Starts the backend and/or frontend in the background.
#
#   scripts/start.sh            # both
#   scripts/start.sh backend    # API only   (PORT from backend/.env, default 4000)
#   scripts/start.sh frontend   # Vite dev server (FRONTEND_PORT, default 5173)
#
# Logs go to .run/<app>.log, the process group id to .run/<app>.pid.
# Stop with scripts/stop.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.run"
mkdir -p "$RUN_DIR"

backend_port() {
  local port
  port="$(grep -E '^PORT=' "$ROOT/backend/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]"' || true)"
  echo "${port:-4000}"
}
frontend_port() { echo "${FRONTEND_PORT:-5173}"; }

listening() { lsof -ti:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# start <name> <dir> <port> <ready-url> <command...>
start() {
  local name="$1" dir="$2" port="$3" url="$4"
  shift 4
  local log="$RUN_DIR/$name.log" pidfile="$RUN_DIR/$name.pid"

  if listening "$port"; then
    echo "$name: already running on port $port"
    return 0
  fi
  if [ ! -d "$dir/node_modules" ]; then
    echo "$name: dependencies missing - run 'npm install' in ${dir#"$ROOT"/}" >&2
    return 1
  fi

  # setsid gives the app its own process group, so stop.sh can stop npm
  # and the server it spawned together.
  (cd "$dir" && setsid "$@" >"$log" 2>&1 < /dev/null & echo $! >"$pidfile")

  local waited=0
  until curl -sf -o /dev/null "$url"; do
    if ! kill -0 "$(cat "$pidfile")" 2>/dev/null; then
      echo "$name: exited during startup - last log lines:" >&2
      tail -n 20 "$log" >&2
      rm -f "$pidfile"
      return 1
    fi
    if [ "$waited" -ge 60 ]; then
      echo "$name: not answering at $url after 60s - see $log" >&2
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "$name: running at http://localhost:$port (log: ${log#"$ROOT"/})"
}

start_backend() {
  local port
  port="$(backend_port)"
  start backend "$ROOT/backend" "$port" "http://localhost:$port/api/health" npm start
}

start_frontend() {
  local port
  port="$(frontend_port)"
  start frontend "$ROOT/frontend" "$port" "http://localhost:$port" npm run dev -- --port "$port" --strictPort
}

case "${1:-all}" in
  backend) start_backend ;;
  frontend) start_frontend ;;
  all)
    start_backend
    start_frontend
    ;;
  *)
    echo "usage: $0 [backend|frontend|all]" >&2
    exit 2
    ;;
esac
