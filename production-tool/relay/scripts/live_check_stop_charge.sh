#!/usr/bin/env bash
# Live check (b) of features/runway-sheet-sync.clan: does Runway charge for a render we stop?
# A person runs this; agents never do (at most $0.40 of real credits, a 4 s veo3.1_fast clip).
#
#   set -a; source .env; set +a      # RUNWAYML_API_SECRET; the script never opens .env
#   production-tool/relay/scripts/live_check_stop_charge.sh <https first-frame image> [cancel after s]
#
# Run it with nothing else using the key, on a UTC day nothing else used veo3.1_fast. It reads
# creditBalance (GET /v1/organization, free), submits the clip, cancels it after 15 s (or the
# second argument), waits 90 s and reads creditBalance again. A cancelled task cannot be fetched
# again, so the balance is the only witness. Paste the last line into the feature log:
#   scripts/feature log runway-sheet-sync "live check (b): <creditBalance before -> after>"
set -euo pipefail
image="${1:?usage: $0 <https first-frame image URL> [cancel after seconds]}"
after="${2:-15}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"
exec uv run --frozen --python 3.12 python scripts/runway_smoke.py --live --max-usd 2 \
  --ops clip --model veo3.1_fast --duration 4 --image-url "$image" --cancel-after "$after"
