#!/usr/bin/env bash
set -eo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

apply_patches coreutils
cargo add -q --manifest-path "$REPO/coreutils/src/uu/hostname/Cargo.toml" clap fluent uucore --features uucore/wide
RUSTC_BOOTSTRAP=1 cargo_wasm "$REPO/coreutils" --no-default-features \
  --features "feat_common_core nproc whoami logname id groups hostname stat env du"
ship "$REPO/coreutils/target/wasm32-wasip1/release/coreutils.wasm" coreutils.wasm
