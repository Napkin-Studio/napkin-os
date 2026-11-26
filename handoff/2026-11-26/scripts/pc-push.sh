#!/bin/bash
# usage: pc-push.sh <worktree> <branch>  — waits for no hook check, then pushes through the hook
wt="$1"; br="$2"
pat='^(/usr/bin/env )?(/usr/bin/|/bin/)?bash scripts/check\.sh --range'
while :; do
  while [ "$(pgrep -f "$pat" | wc -l)" -ge 1 ]; do sleep 20; done
  sleep 15; [ "$(pgrep -f "$pat" | wc -l)" -eq 0 ] && break
done
echo "[$(date +%H:%M)] pushing $br"
cd "$wt" && git push origin "$br" 2>&1 | grep -v -e '^hint' -e 'gh event' -e '^  - ' | tail -40
echo "[$(date +%H:%M)] push exit ${PIPESTATUS[0]}"
