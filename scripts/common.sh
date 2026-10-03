#!/usr/bin/env bash

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ROOT=$HOME/shell-build

WASI_SDK_VER=34.0
AST_GREP_VER=0.45.3
export WASI_SDK_PATH=${WASI_SDK_PATH:-$ROOT/wasi-sdk-$WASI_SDK_VER-x86_64-linux}
AST_GREP=$ROOT/ast-grep-$AST_GREP_VER/ast-grep

# each rule must match exactly its "# want <id> <n>" count; skipped while the pin, rules and overlay are unchanged
apply_patches() {
  local src=$REPO/$1 want
  want="$(git -C "$REPO" rev-parse ":$1") $(cd "$REPO" && find patches overlay -type f \( -path "patches/$1/*" -o -path "overlay/$1/*" \) | sort | xargs -r cat | git hash-object --stdin)"
  [ "$(cat "$src/.patched" 2>/dev/null)" != "$want" ] || return 0
  if [ -e "$src/.git" ]; then
    git -C "$src" reset -q --hard
    git -C "$src" clean -fdq
  fi
  git -C "$REPO" submodule update -q --init --depth 1 "$1"
  [ ! -d "$REPO/overlay/$1" ] || cp -r "$REPO/overlay/$1/." "$src/"
  for r in "$REPO/patches/$1"/*; do
    [ -e "$r" ] || continue
    if [[ $r == *.sh ]]; then
      (cd "$src" && bash -e "$r")
      continue
    fi
    want_counts=$(grep '^# want ' "$r" | cut -d' ' -f3,4 | sort)
    got=$(cd "$src" && "$AST_GREP" scan -r "$r" --json=stream | jq -r .ruleId | sort | uniq -c | while read -r n id; do echo "$id $n"; done)
    if [ "$got" != "$want_counts" ]; then
      echo "$r: match counts changed, update the rules for this version"
      diff <(echo "$want_counts") <(echo "$got")
      exit 1
    fi
    (cd "$src" && "$AST_GREP" scan -r "$r" -U >/dev/null)
  done
  echo "$want" > "$src/.patched"
}

cargo_wasm() {
  local dir=$1
  shift
  export CARGO_PROFILE_RELEASE_OPT_LEVEL=z CARGO_PROFILE_RELEASE_LTO=true CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 \
    CARGO_PROFILE_RELEASE_PANIC=abort CARGO_PROFILE_RELEASE_STRIP=true CARGO_PROFILE_RELEASE_DEBUG=false
  (cd "$dir" && cargo build --release --target wasm32-wasip1 "$@")
}

ship() {
  mkdir -p "$REPO/dist"
  cp "$1" "$REPO/dist/$2"
  echo "$2 raw $(stat -c %s "$REPO/dist/$2") br $(brotli -Zc "$REPO/dist/$2" | wc -c)"
}
