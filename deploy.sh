#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

log() {
  printf "\n[%s] %s\n" "$(date "+%H:%M:%S")" "$1"
}

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v code >/dev/null 2>&1; then
  echo "VS Code CLI (code) is required but was not found in PATH." >&2
  exit 1
fi

log "Installing dependencies"
npm install

log "Building extension (typecheck + lint + production bundle)"
npm run package

log "Packaging .vsix"
NODE_MAJOR="$(node -p "parseInt(process.versions.node.split('.')[0], 10)")"
if [[ "$NODE_MAJOR" -ge 25 ]]; then
  log "Detected Node $NODE_MAJOR.x, using Node 20 compatibility runner for vsce"
  npx -y node@20 node_modules/@vscode/vsce/vsce package
elif ! npx @vscode/vsce package; then
  log "Default vsce packaging failed, retrying with Node 20 compatibility runner"
  npx -y node@20 node_modules/@vscode/vsce/vsce package
fi

LATEST_VSIX="$(ls -t ./*.vsix 2>/dev/null | head -n 1 || true)"
if [[ -z "$LATEST_VSIX" ]]; then
  echo "Packaging finished but no .vsix file was found." >&2
  exit 1
fi

VSIX_NAME="${LATEST_VSIX#./}"
log "Installing extension into VS Code"
code --install-extension "$VSIX_NAME" --force

log "Done. Generated and installed: $VSIX_NAME"
