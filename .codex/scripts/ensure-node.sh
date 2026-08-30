#!/bin/sh

set -eu

NODE_VERSION="22.23.2"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
RUNTIME_ROOT="$REPO_ROOT/.codex/runtime"

case "$(uname -s):$(uname -m)" in
  Darwin:arm64)
    PLATFORM="darwin"
    ARCH="arm64"
    EXTENSION="tar.gz"
    ;;
  Darwin:x86_64)
    PLATFORM="darwin"
    ARCH="x64"
    EXTENSION="tar.gz"
    ;;
  Linux:x86_64)
    PLATFORM="linux"
    ARCH="x64"
    EXTENSION="tar.xz"
    ;;
  Linux:aarch64|Linux:arm64)
    PLATFORM="linux"
    ARCH="arm64"
    EXTENSION="tar.xz"
    ;;
  *)
    printf 'Unsupported platform for the vgpu Codex environment: %s\n' "$(uname -s):$(uname -m)" >&2
    exit 1
    ;;
esac

DIST_NAME="node-v${NODE_VERSION}-${PLATFORM}-${ARCH}"
ARCHIVE_NAME="${DIST_NAME}.${EXTENSION}"
NODE_HOME="$RUNTIME_ROOT/$DIST_NAME"

if [ ! -x "$NODE_HOME/bin/node" ]; then
  TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/vgpu-node.XXXXXX")
  trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM

  printf 'Downloading Node.js %s for %s-%s...\n' "$NODE_VERSION" "$PLATFORM" "$ARCH" >&2
  curl -fsSLo "$TEMP_DIR/$ARCHIVE_NAME" "https://nodejs.org/dist/v${NODE_VERSION}/${ARCHIVE_NAME}"
  curl -fsSLo "$TEMP_DIR/SHASUMS256.txt" "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"

  EXPECTED_SHA=$(awk -v archive="$ARCHIVE_NAME" '$2 == archive { print $1 }' "$TEMP_DIR/SHASUMS256.txt")
  if [ -z "$EXPECTED_SHA" ]; then
    printf 'Could not find %s in the Node.js checksum manifest.\n' "$ARCHIVE_NAME" >&2
    exit 1
  fi

  if command -v shasum >/dev/null 2>&1; then
    ACTUAL_SHA=$(shasum -a 256 "$TEMP_DIR/$ARCHIVE_NAME" | awk '{ print $1 }')
  elif command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_SHA=$(sha256sum "$TEMP_DIR/$ARCHIVE_NAME" | awk '{ print $1 }')
  else
    printf 'A SHA-256 checksum utility (shasum or sha256sum) is required.\n' >&2
    exit 1
  fi

  if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
    printf 'Node.js archive checksum verification failed.\n' >&2
    exit 1
  fi

  tar -xf "$TEMP_DIR/$ARCHIVE_NAME" -C "$TEMP_DIR"
  mkdir -p "$RUNTIME_ROOT"
  mv "$TEMP_DIR/$DIST_NAME" "$NODE_HOME"
fi

printf '%s\n' "$NODE_HOME/bin"
