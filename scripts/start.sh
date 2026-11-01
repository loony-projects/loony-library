#!/usr/bin/env bash
# Starts loony-auth, the backend and/or the frontend in the background.
#
#   scripts/start.sh            # all three
#   scripts/start.sh auth       # loony-auth's auth-api (port from LOONY_AUTH_URL
#                               #   in backend/.env, default 8450), after applying
#                               #   its pending database migrations
#   scripts/start.sh backend    # API only   (PORT from backend/.env, default 4000)
#   scripts/start.sh frontend   # Vite dev server (FRONTEND_PORT, default 5173)
#
# loony-auth is found at LOONY_AUTH_DIR (default ~/projects/loony-auth); sign-in
# needs it. Without it the library still starts, read-only for visitors.
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
auth_dir() { echo "${LOONY_AUTH_DIR:-$HOME/projects/loony-auth}"; }
auth_port() {
  local url
  url="$(grep -E '^LOONY_AUTH_URL=' "$ROOT/backend/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]"' || true)"
  url="${url:-http://localhost:8450}"
  local port="${url##*:}"
  echo "${port%%/*}"
}

listening() { lsof -ti:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# start <name> <dir> <port> <ready-url> <command...>
# START_TIMEOUT (seconds, default 60) bounds the wait for <ready-url>.
start() {
  local name="$1" dir="$2" port="$3" url="$4" timeout="${START_TIMEOUT:-60}"
  shift 4
  local log="$RUN_DIR/$name.log" pidfile="$RUN_DIR/$name.pid"

  if listening "$port"; then
    echo "$name: already running on port $port"
    return 0
  fi
  if [ -f "$dir/package.json" ] && [ ! -d "$dir/node_modules" ]; then
    echo "$name: dependencies missing - run 'npm install' in ${dir#"$ROOT"/}" >&2
    return 1
  fi

  # setsid gives the app its own process group, so stop.sh can stop npm
  # and the server it spawned together. `exec` replaces the subshell, so $!
  # is the app itself (its pid is its group id) and no shell lingers holding
  # this script's stdout open.
  (cd "$dir" && exec setsid "$@" >"$log" 2>&1 < /dev/null) &
  echo $! >"$pidfile"

  local waited=0
  until curl -sf -o /dev/null "$url"; do
    if ! kill -0 "$(cat "$pidfile")" 2>/dev/null; then
      echo "$name: exited during startup - last log lines:" >&2
      tail -n 20 "$log" >&2
      rm -f "$pidfile"
      return 1
    fi
    if [ "$waited" -ge "$timeout" ]; then
      echo "$name: not answering at $url after ${timeout}s - see $log" >&2
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "$name: running at http://localhost:$port (log: ${log#"$ROOT"/})"
}

start_auth() {
  local dir port
  dir="$(auth_dir)"
  port="$(auth_port)"
  if [ ! -x "$dir/scripts/auth-api.sh" ]; then
    echo "auth: loony-auth not found at $dir (set LOONY_AUTH_DIR) - sign-in won't work" >&2
    return 0
  fi
  if listening "$port"; then
    echo "auth: already running on port $port"
    return 0
  fi
  # Its code may expect migrations not yet applied (a missing column makes
  # every hosted sign-in page fail), so bring the database up to date first.
  if command -v sqlx >/dev/null 2>&1; then
    local db
    db="$(grep -E '^DATABASE_URL=' "$dir/.env" | tail -1 | cut -d= -f2- | tr -d '"')"
    (cd "$dir" && sqlx migrate run --database-url "$db" --source migrations) | sed 's/^/auth: /'
  else
    echo "auth: sqlx not installed - pending loony-auth migrations not applied" >&2
  fi
  # The first start compiles it, which takes a while.
  START_TIMEOUT=300 start auth "$dir" "$port" "http://localhost:$port/ready" env SERVER_PORT="$port" scripts/auth-api.sh
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
  auth) start_auth ;;
  backend) start_backend ;;
  frontend) start_frontend ;;
  all)
    start_auth
    start_backend
    start_frontend
    ;;
  *)
    echo "usage: $0 [auth|backend|frontend|all]" >&2
    exit 2
    ;;
esac
