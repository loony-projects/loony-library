#!/usr/bin/env bash
# Stops what scripts/start.sh started.
#
#   scripts/stop.sh             # frontend, backend, and loony-auth if start.sh started it
#   scripts/stop.sh auth        # loony-auth, however it was started
#   scripts/stop.sh backend
#   scripts/stop.sh frontend
#
# Stops the app's whole process group (npm and the server it spawned),
# waiting up to 10s before forcing it. If there is no pid file (started
# some other way), stops whatever is listening on the app's port.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.run"

backend_port() {
  local port
  port="$(grep -E '^PORT=' "$ROOT/backend/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]"' || true)"
  echo "${port:-4000}"
}
frontend_port() { echo "${FRONTEND_PORT:-5173}"; }
# loony-auth's local port (LOONY_AUTH_URL in backend/.env is its public URL,
# e.g. https://auth.lovegood.in, so it doesn't say).
auth_port() { echo "${LOONY_AUTH_PORT:-8450}"; }

listeners() { lsof -ti:"$1" -sTCP:LISTEN 2>/dev/null || true; }

# stop <name> <port>
stop() {
  local name="$1" port="$2" pidfile="$RUN_DIR/$1.pid"
  local targets=()

  if [ -f "$pidfile" ]; then
    local pgid
    pgid="$(cat "$pidfile")"
    if kill -0 -- "-$pgid" 2>/dev/null; then targets+=("-$pgid"); fi
  fi
  for pid in $(listeners "$port"); do targets+=("$pid"); done

  if [ "${#targets[@]}" -eq 0 ]; then
    echo "$name: not running"
    rm -f "$pidfile"
    return 0
  fi

  kill -TERM -- "${targets[@]}" 2>/dev/null || true
  for _ in $(seq 1 20); do
    if [ -z "$(listeners "$port")" ] && ! kill -0 -- "${targets[0]}" 2>/dev/null; then
      rm -f "$pidfile"
      echo "$name: stopped"
      return 0
    fi
    sleep 0.5
  done

  kill -KILL -- "${targets[@]}" 2>/dev/null || true
  for pid in $(listeners "$port"); do kill -KILL "$pid" 2>/dev/null || true; done
  rm -f "$pidfile"
  echo "$name: forced to stop after 10s"
}

case "${1:-all}" in
  auth) stop auth "$(auth_port)" ;;
  backend) stop backend "$(backend_port)" ;;
  frontend) stop frontend "$(frontend_port)" ;;
  all)
    stop frontend "$(frontend_port)"
    stop backend "$(backend_port)"
    # loony-auth is shared with other apps: only stop it if start.sh started it.
    if [ -f "$RUN_DIR/auth.pid" ]; then stop auth "$(auth_port)"; fi
    ;;
  *)
    echo "usage: $0 [auth|backend|frontend|all]" >&2
    exit 2
    ;;
esac
