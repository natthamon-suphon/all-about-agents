#!/usr/bin/env bash
set -u

if [ "$#" -lt 3 ] || [ "$1" != "test" ] || [ "$2" != "--" ]; then
  echo "fixture runner expects: test -- <file>" >&2
  exit 2
fi

case "$3" in
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
    echo "unknown fixture: $3" >&2
    exit 3
    ;;
esac
