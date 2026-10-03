#!/usr/bin/env bash
set -eo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

apply_patches awk
make -C "$REPO/awk" HOSTCC=cc \
  CC="$WASI_SDK_PATH/bin/clang --target=wasm32-wasip1 --sysroot=$WASI_SDK_PATH/share/wasi-sysroot -mllvm -wasm-enable-sjlj" \
  CFLAGS="-Oz -flto -D_WASI_EMULATED_SIGNAL" \
  ALLOC="$(cwd_object) -lwasi-emulated-signal -lsetjmp -Wl,-mllvm,-wasm-enable-sjlj,--strip-all,--gc-sections"
ship "$REPO/awk/a.out" awk.wasm
