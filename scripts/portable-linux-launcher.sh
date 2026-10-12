#!/bin/sh
branchwork_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sandbox_helper="$branchwork_dir/electron/chrome-sandbox"
if [ "$(stat -c '%u:%a' -- "$sandbox_helper" 2>/dev/null || true)" != "0:4755" ]; then
  set -- --no-sandbox "$@"
fi
exec "$branchwork_dir/electron/electron" "$@" "$branchwork_dir/app"
