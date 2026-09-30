#!/usr/bin/env bash
# Starts the Angular CLI MCP server on the Node version pinned in .nvmrc.
# Angular CLI 22.2 refuses to run on Node < 22.22.3, and MCP clients may launch servers with an older
# system Node. stdout is the MCP protocol channel, so everything else goes to stderr.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

if [ -z "${NVM_DIR:-}" ]; then
  for candidate in "$HOME/.nvm" /opt/nvm; do
    if [ -s "$candidate/nvm.sh" ]; then NVM_DIR="$candidate"; break; fi
  done
fi

if [ -n "${NVM_DIR:-}" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
  export NVM_DIR
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" --no-use >&2
  version="$(cat .nvmrc)"
  nvm use "$version" >&2 || { nvm install "$version" >&2 && nvm use "$version" >&2; }
fi

if [ -x node_modules/.bin/ng ]; then
  exec node_modules/.bin/ng mcp
fi
exec npx -y @angular/cli mcp
