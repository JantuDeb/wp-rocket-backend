#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist"
ZIP_FILE="$OUT_DIR/wp-rocket-backend-connector.zip"

mkdir -p "$OUT_DIR"
rm -f "$ZIP_FILE"

cd "$ROOT_DIR"
zip -r "$ZIP_FILE" wordpress-connector \
  -x "wordpress-connector/.DS_Store" \
  -x "wordpress-connector/**/.DS_Store"

printf '%s\n' "$ZIP_FILE"
