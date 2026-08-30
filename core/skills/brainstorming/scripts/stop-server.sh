#!/usr/bin/env bash
set -euo pipefail

# Stop one server and remove only a canonical, disposable /tmp session.
SESSION_DIR="${1:-}"
if [[ -z "$SESSION_DIR" ]]; then echo '{"error":"Usage: stop-server.sh SESSION_DIR"}'; exit 1; fi

STATE_DIR="$SESSION_DIR/state"
PID_FILE="$STATE_DIR/server.pid"
SERVER_ID_FILE="$STATE_DIR/server-instance-id"

mark_stopped() {
  local reason="$1"
  rm -f -- "$STATE_DIR/server-info"
  printf '{"reason":"%s","timestamp":%s}\n' "$reason" "$(date +%s)" > "$STATE_DIR/server-stopped"
}

canonical_session_dir() {
  [[ -d "$1" ]] || return 1
  if command -v realpath >/dev/null 2>&1; then realpath -- "$1" 2>/dev/null && return 0; fi
  (cd -- "$1" 2>/dev/null && pwd -P)
}

is_disposable_session() {
  local canonical="$1"
  local parent base
  parent="$(dirname -- "$canonical")"
  base="$(basename -- "$canonical")"
  [[ "$parent" == "${TMPDIR:-/tmp}" || "$parent" == "/tmp" ]] || return 1
  [[ "$base" =~ ^brainstorm-[0-9]+-[0-9]+$ || "$base" =~ ^brainstorm-[A-Za-z0-9_-]{6,}$ ]]
}

command_line_for_pid() {
  local pid="$1"
  if [[ -r "/proc/$pid/cmdline" ]]; then tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null || true; else ps -ww -p "$pid" -o command= 2>/dev/null || true; fi
}

is_our_server() {
  local pid="$1" expected="$2"
  kill -0 "$pid" 2>/dev/null || return 1
  [[ -n "$expected" ]] || return 1
  command_line_for_pid "$pid" | grep -F -- "--brainstorm-server-id=$expected" >/dev/null 2>&1
}

if [[ ! -f "$PID_FILE" ]]; then
  mark_stopped "not_running"
  echo '{"status":"not_running"}'
  exit 0
fi

PID="$(tr -cd '0-9' < "$PID_FILE")"
EXPECTED_ID="$(tr -d '[:space:]' < "$SERVER_ID_FILE" 2>/dev/null || true)"
if ! is_our_server "$PID" "$EXPECTED_ID"; then
  rm -f -- "$PID_FILE" "$SERVER_ID_FILE"
  mark_stopped "stale_pid"
  echo '{"status":"stale_pid"}'
  exit 0
fi

kill "$PID" 2>/dev/null || true
for _ in $(seq 1 20); do
  if ! kill -0 "$PID" 2>/dev/null; then break; fi
  sleep 0.1
done
if kill -0 "$PID" 2>/dev/null; then kill -9 "$PID" 2>/dev/null || true; sleep 0.1; fi
if kill -0 "$PID" 2>/dev/null; then echo '{"status":"failed","error":"process still running"}'; exit 1; fi

rm -f -- "$PID_FILE" "$SERVER_ID_FILE" "$STATE_DIR/server.log"
mark_stopped "stop-server.sh"

CANONICAL_SESSION="$(canonical_session_dir "$SESSION_DIR" 2>/dev/null || true)"
if [[ -n "$CANONICAL_SESSION" ]] && is_disposable_session "$CANONICAL_SESSION"; then
  rm -rf -- "$CANONICAL_SESSION"
fi
echo '{"status":"stopped"}'
