#!/usr/bin/env bash
set -euo pipefail

# Start the optional visual companion. Loopback is the default; remote binds
# require an explicit --allow-remote acknowledgement.
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
PROJECT_DIR=""
FOREGROUND="false"
BIND_HOST="127.0.0.1"
URL_HOST=""
IDLE_TIMEOUT_MINUTES=""
ALLOW_REMOTE="false"
# Environment is data, not authorization. Drop every inherited BRAINSTORM_*
# value; the flags below set the ones the server needs, and remote binding is
# enabled only by the explicit argv flag forwarded as a discrete child argument.
unset "${!BRAINSTORM_@}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir) [[ $# -ge 2 ]] || { echo '{"error":"--project-dir requires a value"}'; exit 1; }; PROJECT_DIR="$2"; shift 2 ;;
    --host) [[ $# -ge 2 ]] || { echo '{"error":"--host requires a value"}'; exit 1; }; BIND_HOST="$2"; shift 2 ;;
    --url-host) [[ $# -ge 2 ]] || { echo '{"error":"--url-host requires a value"}'; exit 1; }; URL_HOST="$2"; shift 2 ;;
    --idle-timeout-minutes) [[ $# -ge 2 ]] || { echo '{"error":"--idle-timeout-minutes requires a value"}'; exit 1; }; IDLE_TIMEOUT_MINUTES="$2"; shift 2 ;;
    --open) export BRAINSTORM_OPEN=1; shift ;;
    --allow-remote) ALLOW_REMOTE="true"; shift ;;
    --foreground|--no-daemon) FOREGROUND="true"; shift ;;
    --background|--daemon) FOREGROUND="false"; shift ;;
    *) node -e 'process.stdout.write(JSON.stringify({ error: `Unknown argument: ${process.argv[1]}` }) + "\n")' -- "$1"; exit 1 ;;
  esac
done

if [[ -z "$URL_HOST" ]]; then
  if [[ "$BIND_HOST" == "127.0.0.1" || "$BIND_HOST" == "localhost" || "$BIND_HOST" == "::1" ]]; then URL_HOST="localhost"; else URL_HOST="$BIND_HOST"; fi
fi
if [[ -n "$IDLE_TIMEOUT_MINUTES" ]]; then
  [[ "$IDLE_TIMEOUT_MINUTES" =~ ^[1-9][0-9]*$ ]] || { echo '{"error":"--idle-timeout-minutes must be a positive integer"}'; exit 1; }
  export BRAINSTORM_IDLE_TIMEOUT_MS=$((IDLE_TIMEOUT_MINUTES * 60 * 1000))
fi
umask 077
if [[ -n "$PROJECT_DIR" ]]; then
  PROJECT_REAL="$(cd -- "$PROJECT_DIR" 2>/dev/null && pwd -P)" || { echo '{"error":"--project-dir must resolve to an existing directory"}'; exit 1; }
  # A tracked .aaa or .aaa/brainstorm link in a cloned project would move the
  # screens outside it, so refuse links and prove the resolved path.
  SCREEN_ROOT="$PROJECT_REAL/.aaa/brainstorm"
  if [[ -L "$PROJECT_REAL/.aaa" || -L "$SCREEN_ROOT" ]]; then echo '{"error":"--project-dir has a symlinked .aaa or .aaa/brainstorm folder"}'; exit 1; fi
  mkdir -p "$SCREEN_ROOT"
  [[ "$(CDPATH='' cd -- "$SCREEN_ROOT" && pwd -P)" == "$SCREEN_ROOT" ]] || { echo '{"error":"--project-dir screen folder resolves outside the project"}'; exit 1; }
fi

# The session key, PID, and user events stay in this private temp session and
# never enter the project. --project-dir only keeps the screens.
SESSION_DIR="$(mktemp -d "${TMPDIR:-/tmp}/brainstorm-XXXXXX")"
STATE_DIR="$SESSION_DIR/state"
CONTENT_DIR="$SESSION_DIR/content"
if [[ -n "$PROJECT_DIR" ]]; then CONTENT_DIR="$SCREEN_ROOT/${SESSION_DIR##*/}"; fi
PID_FILE="$STATE_DIR/server.pid"
SERVER_ID_FILE="$STATE_DIR/server-instance-id"
mkdir -p "$CONTENT_DIR" "$STATE_DIR"
SERVER_ID="$(printf '%s-%s-%s' "$$" "$(date +%s)" "${RANDOM:-0}" | tr -cd 'A-Za-z0-9_-')"
printf '%s\n' "$SERVER_ID" > "$SERVER_ID_FILE"
SERVER_ARGS=("$SCRIPT_DIR/server.cjs" "--brainstorm-server-id=$SERVER_ID")
if [[ "$ALLOW_REMOTE" == "true" ]]; then SERVER_ARGS+=("--allow-remote"); fi

OWNER_PID=""
if command -v ps >/dev/null 2>&1; then OWNER_PID="$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ' || true)"; fi
export BRAINSTORM_DIR="$SESSION_DIR" BRAINSTORM_CONTENT_DIR="$CONTENT_DIR" BRAINSTORM_HOST="$BIND_HOST" BRAINSTORM_URL_HOST="$URL_HOST" BRAINSTORM_OWNER_PID="$OWNER_PID"

# A server that never became ready must not keep a live key. Stop it (a crashed
# server's PID may already belong to another process, so it is only reaped) and
# remove the screen folder if it is still empty. A timeout removes the whole
# temp session; a crash keeps only its redacted server.log for diagnosis.
# stop-server.sh cleans the kept session.
abort_start() {
  local reason="$1" log
  if [[ "$reason" != "crashed" ]]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  wait "$SERVER_PID" 2>/dev/null || true
  if [[ -d "$CONTENT_DIR" ]]; then find "$CONTENT_DIR" -maxdepth 0 -empty -exec rmdir -- {} +; fi
  if [[ "$reason" == "crashed" ]]; then
    find "$STATE_DIR" -mindepth 1 -maxdepth 1 ! -name server.log -exec rm -rf -- {} +
    log="$(printf '%s' "$STATE_DIR/server.log" | sed 's/[\\"]/\\&/g')"
    printf '{"error":"Server failed to start","log":"%s"}\n' "$log"
  else
    rm -rf -- "$SESSION_DIR"
    echo '{"error":"Server failed to start within 5 seconds"}'
  fi
  exit 1
}

if [[ "$FOREGROUND" == "true" ]]; then
  node "${SERVER_ARGS[@]}" > "$STATE_DIR/server.log" 2>&1 &
  SERVER_PID=$!
  printf '%s\n' "$SERVER_PID" > "$PID_FILE"
  READY="false"
  for _ in $(seq 1 50); do
    if [[ -f "$STATE_DIR/server-info" && -f "$STATE_DIR/connection-url" ]]; then
      node -e 'const fs=require("fs"); const info=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); info.url=fs.readFileSync(process.argv[2],"utf8").trim(); process.stdout.write(JSON.stringify(info)+String.fromCharCode(10))' "$STATE_DIR/server-info" "$STATE_DIR/connection-url"
      READY="true"
      break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then abort_start crashed; fi
    sleep 0.1
  done
  if [[ "$READY" != "true" ]]; then abort_start timeout; fi
  wait "$SERVER_PID"
  exit $?
fi

nohup node "${SERVER_ARGS[@]}" > "$STATE_DIR/server.log" 2>&1 &
SERVER_PID=$!
printf '%s\n' "$SERVER_PID" > "$PID_FILE"

for _ in $(seq 1 50); do
  if [[ -f "$STATE_DIR/server-info" && -f "$STATE_DIR/connection-url" ]]; then
    node -e 'const fs=require("fs"); const info=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); info.url=fs.readFileSync(process.argv[2],"utf8").trim(); process.stdout.write(JSON.stringify(info)+"\n")' "$STATE_DIR/server-info" "$STATE_DIR/connection-url"
    # Disown only after readiness, so abort_start can still wait for the child.
    disown "$SERVER_PID" 2>/dev/null || true
    exit 0
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then abort_start crashed; fi
  sleep 0.1
done
abort_start timeout
