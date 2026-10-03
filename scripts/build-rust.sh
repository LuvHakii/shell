#!/usr/bin/env bash
set -eo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

apply_patches "$1"
cargo_wasm "$REPO/$1" --bin "$2"
ship "$REPO/$1/target/wasm32-wasip1/release/$2.wasm" "$2.wasm"
