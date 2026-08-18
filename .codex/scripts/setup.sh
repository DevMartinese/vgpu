#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
NODE_BIN=$("$SCRIPT_DIR/ensure-node.sh")
PATH="$NODE_BIN:$PATH"
COREPACK_HOME="$REPO_ROOT/.codex/runtime/corepack"
export PATH
export COREPACK_HOME

cd "$REPO_ROOT"

printf 'Using %s and pnpm %s\n' "$(node --version)" "$(corepack pnpm --version)"
CI=1 corepack pnpm --store-dir "$REPO_ROOT/.codex/runtime/pnpm-store" install --frozen-lockfile
corepack pnpm run build
