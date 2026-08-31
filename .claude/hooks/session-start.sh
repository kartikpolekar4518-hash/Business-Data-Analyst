#!/bin/bash
# Installs the graphify CLI so the vendored /graphify skill works in web sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

USER_BIN="$(python3 -c 'import site; print(site.USER_BASE)')/bin"
export PATH="$USER_BIN:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$USER_BIN:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

if command -v graphify >/dev/null 2>&1; then
  echo "graphify already installed: $(command -v graphify)"
  exit 0
fi

python3 -m pip install --quiet --user graphifyy \
  || python3 -m pip install --quiet --break-system-packages graphifyy

if command -v graphify >/dev/null 2>&1; then
  echo "graphify installed: $(command -v graphify)"
else
  echo "warning: graphifyy installed but 'graphify' not on PATH" >&2
fi
