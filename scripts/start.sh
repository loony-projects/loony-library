#!/usr/bin/env bash
# Starts loony-auth, the backend and/or the frontend in the background.
#
#   scripts/start.sh            # all three
#   scripts/start.sh auth       # loony-auth's auth-api (LOONY_AUTH_PORT, default
#                               #   8450), after applying its pending database
#                               #   migrations
#   scripts/start.sh backend    # API (PORT from backend/.env, default 4000), which
#                               #   also serves the built frontend - rebuilt here
#                               #   when its source changed - for the public site
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
# loony-auth's local port (LOONY_AUTH_URL in backend/.env is its public URL,
# e.g. https://auth.lovegood.in, so it doesn't say).
auth_port() { echo "${LOONY_AUTH_PORT:-8450}"; }

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

# The frontend build the backend serves on its own origin (the public site,
# https://books.lovegood.in): API calls relative to the page. Rebuilt when
# anything it's built from is newer than the last build.
build_frontend() {
  local dir="$ROOT/frontend" index="$ROOT/frontend/dist/index.html"
  [ -d "$dir/node_modules" ] || return 0
  if [ -f "$index" ] && [ -z "$(find "$dir/src" "$dir/public" "$dir/index.html" "$dir"/vite.config.* "$dir/package.json" -newer "$index" -print -quit 2>/dev/null)" ]; then
    return 0
  fi
  echo "frontend: building for the backend to serve (log: .run/frontend-build.log)"
  if ! (cd "$dir" && VITE_API_URL= npm run build) >"$RUN_DIR/frontend-build.log" 2>&1; then
    echo "frontend: build failed - see .run/frontend-build.log" >&2
    return 1
  fi
}

start_backend() {
  local port
  build_frontend || true
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
