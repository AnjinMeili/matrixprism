#!/bin/sh
set -eu
root=$(mktemp -d /tmp/matrix-scene-cli-XXXXXX)
cleanup() {
  rm -f "$root/source.mrgb" "$root/trim.mrgb" "$root/show.scene" "$root/result"
  rm -f "$root/nested/show.scene"
  if test -d "$root/nested"; then rmdir "$root/nested"; fi
  rmdir "$root"
}
trap cleanup EXIT HUP INT TERM

# Two 1x1 RGB frames: red at 0 ms, green at 5 ms, duration 10 ms.
printf 'MRGB0001\001\000\000\000\001\000\000\000\002\000\000\000\000\000\000\000\020\047\000\000\000\000\000\000\000\000\000\000\000\000\000\000\377\000\000\210\023\000\000\000\000\000\000\000\377\000' > "$root/source.mrgb"

expect_error() {
  if "$@" > "$root/result" 2>&1; then
    echo "Expected command to fail: $*" >&2
    exit 1
  fi
  grep -q "Scene error:" "$root/result"
}
./scene-tool info "$root/source.mrgb" | grep -q '1x1 frames=2 duration-seconds=0.01'
./scene-tool trim "$root/source.mrgb" "$root/trim.mrgb" 0.002 0.009
./scene-tool info "$root/trim.mrgb" | grep -q 'frames=2 duration-seconds=0.007'
./scene-tool create "$root/show.scene" "$root/source.mrgb" "$root/trim.mrgb"
if grep -q "$root" "$root/show.scene"; then
  echo "Expected portable relative recording paths" >&2
  exit 1
fi
mkdir "$root/nested"
./scene-tool create "$root/nested/show.scene" "$root/source.mrgb"
grep -q '../source.mrgb' "$root/nested/show.scene"
./scene-tool range "$root/nested/show.scene" 1 0.001 0.009
expect_error ./scene-tool create "$root/show.scene" "$root/source.mrgb"
./scene-tool move "$root/show.scene" 2 1
./scene-tool list "$root/show.scene" > "$root/result"
head -n 1 "$root/result" | grep -q 'trim.mrgb'
./scene-tool range "$root/show.scene" 1 0.001 0.006
./scene-tool add "$root/show.scene" "$root/source.mrgb" 0 0.005
./scene-tool remove "$root/show.scene" 2
./scene-tool list "$root/show.scene" > "$root/result"
test "$(wc -l < "$root/result" | tr -d ' ')" = 2
expect_error ./scene-tool range "$root/show.scene" 1 0 1
expect_error ./scene-tool remove "$root/show.scene" 0
expect_error ./scene-tool trim "$root/source.mrgb" "$root/trim.mrgb" 0 0.005
./scene-tool remove "$root/show.scene" 2
expect_error ./scene-tool remove "$root/show.scene" 1
./scene-tool list "$root/show.scene" > "$root/result"
test "$(wc -l < "$root/result" | tr -d ' ')" = 1
echo "Scene CLI tests passed"
