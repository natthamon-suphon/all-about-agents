#!/usr/bin/env bash
set -u

if [ "$#" -ne 1 ]; then
  echo "fixture runner expects exactly one argument: <file>" >&2
  exit 2
fi

case "$1" in
  *"create pollution.sh")
    if [ -z "${POLLUTION_TARGET:-}" ]; then
      echo "POLLUTION_TARGET is required for this disposable fixture" >&2
      exit 2
    fi
    mkdir -p -- "$(dirname -- "$POLLUTION_TARGET")"
    : > "$POLLUTION_TARGET"
    ;;
  *"clean test.sh")
    ;;
  *)
    echo "unknown fixture: $1" >&2
    exit 3
    ;;
esac
