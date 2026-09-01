#!/usr/bin/env sh

set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || {
  printf '%s\n' 'Claude statusline unavailable: launcher directory could not be resolved.' >&2
  exit 1
}
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Claude statusline unavailable: Node.js was not found on PATH.' >&2
  exit 127
fi
if [ ! -f "$script_dir/statusline.mjs" ]; then
  printf '%s\n' 'Claude statusline unavailable: the renderer is missing.' >&2
  exit 1
fi

exec node "$script_dir/statusline.mjs"
