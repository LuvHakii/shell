#!/usr/bin/env bash
set -eo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

apply_patches nushell
cp "$REPO/nushell/Cargo.lock" "$REPO/host/Cargo.lock"
CARGO_TARGET_WASM32_WASIP1_RUSTFLAGS="--remap-path-prefix=$REPO/=" cargo_wasm "$REPO/host"
ship "$REPO/host/target/wasm32-wasip1/release/nu.wasm" nu.wasm
