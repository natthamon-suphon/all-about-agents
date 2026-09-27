#!/usr/bin/env bash
set -euo pipefail

# Stop one server and remove its session. Only a canonical, disposable temp
# session is acted on; any other path is refused and left untouched.
SESSION_DIR="${1:-}"
if [[ -z "$SESSION_DIR" ]]; then echo '{"error":"Usage: stop-server.sh SESSION_DIR"}'; exit 1; fi

# One method canonicalizes both sides of the compare. On macOS, TMPDIR ends in
# "/" and sits under the /var link, and /tmp links to /private/tmp.
canonical_dir() {
  [[ -d "$1" ]] || return 1
  (CDPATH='' cd -- "$1" 2>/dev/null && pwd -P)
}

is_disposable_session() {
  local canonical="$1"
  local parent base root
  parent="$(dirname -- "$canonical")"
  base="$(basename -- "$canonical")"
  [[ "$base" =~ ^brainstorm-[0-9]+-[0-9]+$ || "$base" =~ ^brainstorm-[A-Za-z0-9_-]{6,}$ ]] || return 1
  for root in "${TMPDIR:-/tmp}" /tmp; do
    root="$(canonical_dir "$root")" || continue
    [[ "$parent" == "$root" ]] && return 0
  done
  return 1
}

command_line_for_pid() {
  local pid="$1"
  if [[ -r "/proc/$pid/cmdline" ]]; then tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null || true; else ps -ww -p "$pid" -o command= 2>/dev/null || true; fi
}

# The id is matched as one whole argument, so a prefix of another id never matches.
is_our_server() {
  local pid="$1" expected="$2"
  [[ "$pid" =~ ^[0-9]+$ && "$expected" =~ ^[A-Za-z0-9_-]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  command_line_for_pid "$pid" | grep -E -- "(^|[[:space:]])--brainstorm-server-id=$expected([[:space:]]|\$)" >/dev/null 2>&1
}

# A first stop removes the session, so a repeat stop has nothing to do.
if [[ ! -e "$SESSION_DIR" ]]; then echo '{"status":"not_running","removed":false}'; exit 0; fi

canonical="$(canonical_dir "$SESSION_DIR" || true)"
if [[ -z "$canonical" ]] || ! is_disposable_session "$canonical"; then
  echo '{"status":"refused","removed":false,"error":"not a disposable brainstorm session directly under TMPDIR or /tmp"}'
  exit 1
fi

finish() {
  rm -rf -- "$canonical"
  printf '{"status":"%s","removed":true}\n' "$1"
  exit 0
}

STATE_DIR="$canonical/state"
[[ -f "$STATE_DIR/server.pid" ]] || finish "not_running"
PID="$(tr -cd '0-9' < "$STATE_DIR/server.pid")"
EXPECTED_ID="$(tr -d '[:space:]' < "$STATE_DIR/server-instance-id" 2>/dev/null || true)"
is_our_server "$PID" "$EXPECTED_ID" || finish "stale_pid"

kill "$PID" 2>/dev/null || true
for _ in $(seq 1 20); do
  is_our_server "$PID" "$EXPECTED_ID" || break
  sleep 0.1
done
# Re-prove identity before the forced kill; the PID may have been reused.
if is_our_server "$PID" "$EXPECTED_ID"; then kill -9 "$PID" 2>/dev/null || true; sleep 0.1; fi
if is_our_server "$PID" "$EXPECTED_ID"; then echo '{"status":"failed","error":"process still running","removed":false}'; exit 1; fi
finish "stopped"
