#!/usr/bin/env bash
# Renders the style frames to PNG at 2x with headless Chrome, using the book's own fonts.
#   site/book/art/style-frames/render.sh <out-dir> <fonts-dir> [page ...]
# <fonts-dir> holds book_display.ttf, book_text.ttf, book_strong.ttf and book_hand.ttf (Kalam).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$(realpath "$1")"; fonts="$(realpath "$2")"; shift 2
node "$here/frames.mjs" "$out" "$@" > "$out/.list"
while read -r svg; do
  name="$(basename "$svg" .svg)"
  cat > "$out/$name.html" <<HTML
<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:book_display;src:url(file://$fonts/book_display.ttf)}
@font-face{font-family:book_text;src:url(file://$fonts/book_text.ttf)}
@font-face{font-family:book_strong;src:url(file://$fonts/book_strong.ttf)}
@font-face{font-family:book_hand;src:url(file://$fonts/book_hand.ttf)}
html,body{margin:0;background:#fff}svg{display:block}
</style></head><body>$(cat "$svg")</body></html>
HTML
  timeout 90 google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=2 --window-size=595,842 --virtual-time-budget=4000 \
    --allow-file-access-from-files --screenshot="$out/$name.png" "file://$out/$name.html" >/dev/null 2>&1
  echo "$out/$name.png"
done < "$out/.list"
