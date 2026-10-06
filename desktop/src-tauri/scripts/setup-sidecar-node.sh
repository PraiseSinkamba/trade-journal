#!/usr/bin/env bash
# setup-sidecar-node.sh
# Download the Node.js sidecar binary that Tauri ships as `binaries/node`.
# Run from the desktop/ workspace:  pnpm setup:sidecar
#
# Mirrors the binary Node v24.11.0 Windows x64 (win-x64) from nodejs.org/dist,
# extracts it, renames node.exe to the Tauri-required triple-suffixed name, and
# verifies the SHA-256 before placing it in src-tauri/binaries/.
#
# Re-runnable: skips download + extract when the destination is already present
# and matches the expected SHA-256.

set -euo pipefail

# Resolve src-tauri/binaries relative to this script regardless of CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TAURI_DIR="$REPO_ROOT/desktop/src-tauri"
BIN_DIR="$TAURI_DIR/binaries"

NODE_VERSION="24.11.0"
TRIPLE="x86_64-pc-windows-msvc"
BINARY_NAME="node-${TRIPLE}.exe"
EXPECTED_SHA256="b7d912484d42e7a0d0cb5b26a86410ec973a79ece7d61ad535e2d1a97a9026e1"
DOWNLOAD_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip"

DEST="$BIN_DIR/$BINARY_NAME"

mkdir -p "$BIN_DIR"

if [ -f "$DEST" ]; then
    actual="$(sha256sum "$DEST" | awk '{print $1}' | tr '[:upper:]' '[:lower:]')"
    if [ "$actual" = "$EXPECTED_SHA256" ]; then
        echo "Sidecar already in place at $DEST (sha256 matches)."
        exit 0
    fi
    echo "Existing sidecar hash mismatch (got $actual). Re-downloading."
    rm -f "$DEST"
fi

WORK_DIR="$(mktemp -d -t tj-sidecar-${NODE_VERSION}.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

ZIP_PATH="$WORK_DIR/node.zip"
echo "Fetching $DOWNLOAD_URL"
curl --fail --location --silent --show-error -o "$ZIP_PATH" "$DOWNLOAD_URL"

echo "Extracting..."
unzip -q "$ZIP_PATH" -d "$WORK_DIR"

# node-v24.11.0-win-x64/node.exe (Windows .zip preserves the top-level dir)
EXTRACTED="$WORK_DIR/node-v${NODE_VERSION}-win-x64/node.exe"
if [ ! -f "$EXTRACTED" ]; then
    # Fallback: walk the tree in case of an upstream layout change.
    EXTRACTED="$(find "$WORK_DIR" -name node.exe -type f | head -n 1)"
fi
if [ -z "$EXTRACTED" ] || [ ! -f "$EXTRACTED" ]; then
    echo "node.exe not found in downloaded archive" >&2
    exit 1
fi

mv -f "$EXTRACTED" "$DEST"

actual="$(sha256sum "$DEST" | awk '{print $1}' | tr '[:upper:]' '[:lower:]')"
if [ "$actual" != "$EXPECTED_SHA256" ]; then
    echo "SHA-256 mismatch after download. expected=$EXPECTED_SHA256 actual=$actual" >&2
    exit 1
fi

echo "Installed sidecar to $DEST (sha256 verified)."