#!/usr/bin/env bash
# Baut das Upload-Paket für den Chrome Web Store: dist/bulk-manager-for-chatgpt-<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./extension/manifest.json').version")
OUT="dist/bulk-manager-for-chatgpt-${VERSION}.zip"
mkdir -p dist
rm -f "$OUT"
for f in extension/*.js; do node --check "$f"; done
(cd extension && zip -q -r -X "../$OUT" manifest.json background.js content.js icons)
echo "$OUT"
