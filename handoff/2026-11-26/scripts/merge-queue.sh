#!/usr/bin/env bash
# Merge PRs into develop in order. For each: wait until the previous one merged, merge develop
# into the branch (only .clan conflicts are auto-resolved), push through the hook, wait for CI,
# squash-merge on all-green. Stops on a code conflict or a red check. Redeploys UAT at the end only with UAT=1 (owner: local test gates UAT).
# Usage: merge-queue.sh <pr> [<pr> ...]
set -uo pipefail
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
S=/tmp/claude-1003/-home-shrey-Code-Napkin-napkin-os/2d1b7e04-a11f-438a-9ba8-975a6f205db8/scratchpad
REPO=/home/shrey/Code/Napkin/napkin-os
REMERGE=$S/clan-remerge.py
cd $REPO
say(){ echo "[$(date +%H:%M)] $*"; }
slot(){ while [ $(pgrep -f '^(/usr/bin/env )?(/usr/bin/|/bin/)?bash scripts/check\.sh --range' | wc -l) -ge ${SLOTS:-1} ]; do sleep 20; done; }
merged_any=0
for w in ${WAIT_FOR:-}; do until [ "$(gh pr view $w --json state -q .state)" = MERGED ]; do sleep 60; done; say "#$w merged, starting queue"; done
for pr in "$@"; do
  st=$(gh pr view $pr --json state -q .state)
  [ "$st" = MERGED ] && { say "#$pr already merged"; merged_any=1; continue; }
  br=$(gh pr view $pr --json headRefName -q .headRefName); title=$(gh pr view $pr --json title -q .title)
  wt=$REPO/../mq-$(echo $br | tr / -)
  git fetch -q origin
  [ -d $wt ] || git worktree add -q --detach $wt origin/$br
  cd $wt; git fetch -q origin; git checkout -q --detach origin/$br
  if ! git merge-base --is-ancestor origin/develop HEAD; then
    git merge --no-commit --no-ff origin/develop >/dev/null 2>&1
    un=$(git diff --name-only --diff-filter=U)
    code=$(echo "$un" | grep -v '\.clan$' | grep -v '^$')
    if [ -n "$code" ]; then say "STOP #$pr: code conflicts: $code"; git merge --abort; exit 1; fi
    for f in $un; do uv run -q --with pyyaml python $REMERGE $f >/dev/null || { say "STOP #$pr: clan remerge failed on $f"; exit 1; }; git add $f; done
    git commit -q -m "features: merge develop into $br" || { say "STOP #$pr: commit failed"; exit 1; }
  fi
  slot
  if ! git push origin HEAD:refs/heads/$br >$S/mq-push-$pr.log 2>&1; then say "STOP #$pr: push refused (see $S/mq-push-$pr.log)"; grep -E "FAIL" $S/mq-push-$pr.log; exit 1; fi
  say "#$pr pushed"
  cd $REPO; sleep 45
  until gh pr checks $pr --watch --interval 30 >/dev/null 2>&1; [ -z "$(gh pr checks $pr 2>/dev/null | awk -F'\t' '$2=="pending"')" ]; do sleep 30; done
  bad=$(gh pr checks $pr 2>/dev/null | awk -F'\t' '$2!="pass"{print $1": "$2}')
  if [ -n "$bad" ]; then say "STOP #$pr: CI not green: $bad"; exit 1; fi
  gh pr merge $pr --squash --subject "$title" >/dev/null 2>&1
  sleep 5
  [ "$(gh pr view $pr --json state -q .state)" = MERGED ] || { say "STOP #$pr: merge did not happen"; exit 1; }
  say "#$pr merged ($title)"; merged_any=1
done
if [ $merged_any = 1 ] && [ "${UAT:-0}" = 1 ]; then
  gh workflow run deploy.yml --ref develop -f environment=uat -f ref=develop >/dev/null 2>&1; sleep 8
  say "UAT deploy started: run $(gh run list --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId') at develop $(git rev-parse --short origin/develop)"
fi
