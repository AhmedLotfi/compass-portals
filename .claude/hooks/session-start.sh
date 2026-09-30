#!/bin/bash
# SessionStart hook for Claude Code on the web. It installs the Node version pinned in .nvmrc and the npm
# dependencies, so builds, tests and linters work as soon as the session starts. Safe to re-run.
# stdout becomes session context, so progress output goes to stderr.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

export NVM_DIR="${NVM_DIR:-/opt/nvm}"
version="$(cat .nvmrc)"

# nvm.sh does not support `set -u`.
set +u
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" --no-use
nvm install "$version" >&2
nvm use "$version" >&2
node_bin="$(dirname "$(nvm which "$version")")"
set -u

chrome="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | sort -V | tail -1 || true)"

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export NVM_DIR=\"$NVM_DIR\""
    echo "export PATH=\"$node_bin:\$PATH\""
    echo 'export NODE_USE_ENV_PROXY=1'
    echo 'export NG_CLI_ANALYTICS=false'
    echo 'export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers'
    if [ -n "$chrome" ]; then
      echo "export CHROME_PATH=\"$chrome\""
    fi
  } >> "$CLAUDE_ENV_FILE"
fi

export PATH="$node_bin:$PATH" NG_CLI_ANALYTICS=false PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm install --no-audit --no-fund >&2

echo "Node $(node -v) and npm dependencies are ready."
