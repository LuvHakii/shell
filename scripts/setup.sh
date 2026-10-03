#!/usr/bin/env bash
set -e

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

mkdir -p "$ROOT"

if [ ! -x "$AST_GREP" ]; then
  curl -fsSL -o /tmp/ast-grep.zip "https://github.com/ast-grep/ast-grep/releases/download/$AST_GREP_VER/app-x86_64-unknown-linux-gnu.zip"
  unzip -qo /tmp/ast-grep.zip ast-grep -d "$(dirname "$AST_GREP")"
fi

if [ ! -x "$WASI_SDK_PATH/bin/clang" ]; then
  curl -fsSL "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_VER%%.*}/wasi-sdk-$WASI_SDK_VER-x86_64-linux.tar.gz" | tar xz -C "$ROOT"
fi

cwd_object >/dev/null
