#!/usr/bin/env bash
# Live check (a) of features/runway-sheet-sync.clan: does Aleph 2 run on our Runway key?
# A person runs this; agents never do (it spends about $1.12 of real credits).
#
#   set -a; source .env; set +a      # RUNWAYML_API_SECRET; the script never opens .env
#   production-tool/relay/scripts/live_check_aleph2.sh <https 4 s mp4> <https keyframe image>
#
# Sends one clip_edit on aleph2: the 4 s clip, a keyframe in the middle of the edit window 1-3 s
# (whole seconds, end exclusive), capped at $2 (--max-usd). It prints the plan first, then the
# task's state and Runway's reported cost. Paste the last lines into the feature log:
#   scripts/feature log runway-sheet-sync "live check (a): <state, cost, error if any>"
set -euo pipefail
video="${1:?usage: $0 <https 4 s mp4 URL> <https keyframe image URL>}"
keyframe="${2:?usage: $0 <https 4 s mp4 URL> <https keyframe image URL>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"
exec uv run --frozen --python 3.12 python scripts/runway_smoke.py --live --max-usd 2 \
  --ops clip_edit --video-url "$video" --input-s 4 --range 1-3 --keyframe-url "$keyframe"
