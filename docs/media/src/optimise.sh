#!/bin/sh
# Re-encodes the PNGs in docs/media losslessly with ffmpeg (best predictor,
# highest zlib level), keeping a file only when its pixels are unchanged
# (compared by MD5 of the decoded RGBA) and it is smaller. Opaque images are
# written as RGB, which drops an alpha channel that holds nothing.
#   sh docs/media/src/optimise.sh
set -eu
media=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for f in "$media"/*.png "$media"/screens/*.png "$media"/patterns/*.png; do
  [ -f "$f" ] || continue
  case "$(basename "$f")" in contact-sheet.png) continue ;; esac
  format=rgba
  # Opaque if every alpha value is 255: the alpha plane's MD5 matches a plane of 255s.
  size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$f")
  alpha=$(ffmpeg -v error -i "$f" -vf alphaextract -f md5 - 2>/dev/null || true)
  full=$(ffmpeg -v error -f lavfi -i "color=white:s=$size:d=0.04" -frames:v 1 -pix_fmt gray -f md5 - 2>/dev/null || true)
  if [ -z "$alpha" ] || [ "$alpha" = "$full" ]; then format=rgb24; fi
  ffmpeg -v error -y -i "$f" -pix_fmt "$format" -pred mixed -compression_level 9 "$tmp/out.png"
  before=$(ffmpeg -v error -i "$f" -pix_fmt rgba -f md5 -)
  after=$(ffmpeg -v error -i "$tmp/out.png" -pix_fmt rgba -f md5 -)
  if [ "$before" = "$after" ] && [ "$(stat -f%z "$tmp/out.png" 2>/dev/null || stat -c%s "$tmp/out.png")" -lt "$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")" ]; then
    mv "$tmp/out.png" "$f"
    echo "smaller: ${f#"$media"/}"
  else
    echo "kept:    ${f#"$media"/}"
  fi
done
