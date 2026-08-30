#!/usr/bin/env bash
set -euo pipefail

# Start the optional visual companion. Loopback is the default; remote binds
# require an explicit --allow-remote acknowledgement.
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
PROJECT_DIR=""
FOREGROUND="false"
FORCE_BACKGROUND="false"
BIND_HOST="127.0.0.1"
URL_HOST=""
IDLE_TIMEOUT_MINUTES=""
ALLOW_REMOTE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir) [[ $# -ge 2 ]] || { echo '{"error":"--project-dir requires a value"}'; exit 1; }; PROJECT_DIR="$2"; shift 2 ;;
    --host) [[ $# -ge 2 ]] || { echo '{"error":"--host requires a value"}'; exit 1; }; BIND_HOST="$2"; shift 2 ;;
    --url-host) [[ $# -ge 2 ]] || { echo '{"error":"--url-host requires a value"}'; exit 1; }; URL_HOST="$2"; shift 2 ;;
    --idle-timeout-minutes) [[ $# -ge 2 ]] || { echo '{"error":"--idle-timeout-minutes requires a value"}'; exit 1; }; IDLE_TIMEOUT_MINUTES="$2"; shift 2 ;;
    --open) export BRAINSTORM_OPEN=1; shift ;;
    --allow-remote) ALLOW_REMOTE="true"; shift ;;
    --foreground|--no-daemon) FOREGROUND="true"; shift ;;
    --background|--daemon) FORCE_BACKGROUND="true"; shift ;;
    *) printf '{"error":"Unknown argument: %s"\n}' "$1"; exit 1 ;;
  esac
done

if [[ -z "$URL_HOST" ]]; then
  if [[ "$BIND_HOST" == "127.0.0.1" || "$BIND_HOST" == "localhost" || "$BIND_HOST" == "::1" ]]; then URL_HOST="localhost"; else URL_HOST="$BIND_HOST"; fi
fi
if [[ -n "$IDLE_TIMEOUT_MINUTES" ]]; then
  [[ "$IDLE_TIMEOUT_MINUTES" =~ ^[1-9][0-9]*$ ]] || { echo '{"error":"--idle-timeout-minutes must be a positive integer"}'; exit 1; }
  export BRAINSTORM_IDLE_TIMEOUT_MS=$((IDLE_TIMEOUT_MINUTES * 60 * 1000))
fi
# Environment is data, not authorization. Remote binding is enabled only by the
# explicit argv flag parsed above and forwarded as a discrete child argument.
unset BRAINSTORM_ALLOW_REMOTE

if [[ -n "$PROJECT_DIR" ]]; then
  PROJECT_REAL="$(cd -- "$PROJECT_DIR" 2>/dev/null && pwd -P)" || { echo '{"error":"--project-dir must resolve to an existing directory"}'; exit 1; }
  SESSION_DIR="$PROJECT_REAL/.claude/all-about-agents/brainstorm/$$-$(date +%s)"
  export BRAINSTORM_PORT_FILE="$PROJECT_REAL/.claude/all-about-agents/brainstorm/.last-port"
  export BRAINSTORM_TOKEN_FILE="$PROJECT_REAL/.claude/all-about-agents/brainstorm/.last-token"
else
  SESSION_DIR="$(mktemp -d "${TMPDIR:-/tmp}/brainstorm-XXXXXX")"
fi

STATE_DIR="$SESSION_DIR/state"
PID_FILE="$STATE_DIR/server.pid"
SERVER_ID_FILE="$STATE_DIR/server-instance-id"
mkdir -p "$SESSION_DIR/content" "$STATE_DIR"
umask 077
SERVER_ID="$(printf '%s-%s-%s' "$$" "$(date +%s)" "${RANDOM:-0}" | tr -cd 'A-Za-z0-9_-')"
printf '%s\n' "$SERVER_ID" > "$SERVER_ID_FILE"
SERVER_ARGS=("$SCRIPT_DIR/server.cjs" "--brainstorm-server-id=$SERVER_ID")
if [[ "$ALLOW_REMOTE" == "true" ]]; then SERVER_ARGS+=("--allow-remote"); fi

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(tr -cd '0-9' < "$PID_FILE")"
  if [[ -n "$OLD_PID" ]]; then kill "$OLD_PID" 2>/dev/null || true; fi
  rm -f -- "$PID_FILE"
fi

OWNER_PID=""
if command -v ps >/dev/null 2>&1; then OWNER_PID="$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ' || true)"; fi
export BRAINSTORM_DIR="$SESSION_DIR" BRAINSTORM_HOST="$BIND_HOST" BRAINSTORM_URL_HOST="$URL_HOST" BRAINSTORM_OWNER_PID="$OWNER_PID"

if [[ -n "${CODEX_CI:-}" && "$FOREGROUND" != "true" && "$FORCE_BACKGROUND" != "true" ]]; then FOREGROUND="true"; fi

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
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then echo '{"error":"Server failed to start"}'; exit 1; fi
    sleep 0.1
  done
  if [[ "$READY" != "true" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    echo '{"error":"Server failed to start within 5 seconds"}'
    exit 1
  fi
  wait "$SERVER_PID"
  exit $?
fi

nohup node "${SERVER_ARGS[@]}" > "$STATE_DIR/server.log" 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null || true
printf '%s\n' "$SERVER_PID" > "$PID_FILE"

for _ in $(seq 1 50); do
  if [[ -f "$STATE_DIR/server-info" && -f "$STATE_DIR/connection-url" ]]; then
    node -e 'const fs=require("fs"); const info=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); info.url=fs.readFileSync(process.argv[2],"utf8").trim(); process.stdout.write(JSON.stringify(info)+"\n")' "$STATE_DIR/server-info" "$STATE_DIR/connection-url"
    exit 0
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then echo '{"error":"Server failed to start"}'; exit 1; fi
  sleep 0.1
done
echo '{"error":"Server failed to start within 5 seconds"}'
exit 1
