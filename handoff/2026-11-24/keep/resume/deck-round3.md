# Deck round 3 (Harrowgate UAT): resume notes

Branch: fix/deck-round3 (from origin/develop ed98deac). No PR opened.
Worktree: /home/batunii/Documents/Code/napkin-wt-deck3 (kept).
SHA: 0e13f790 (features log; wip fdf5cc81; earlier 4cdfda39 fixes, c9f8598b deck-local.sh). Check `git ls-remote origin fix/deck-round3`
to see whether the push of 0e13f790 finished (the pre-push engine check takes about 5 minutes).

## Done
- All 8 UAT items fixed, tests in engine/deck/tests/test_deck_uat_round3.py (real Harrowgate deck as fixture in
  engine/deck/tests/fixtures/harrowgate/) and app/tests/deckMaker.test.ts. Feature log: features/uat-flow-fixes.clan.
- Coordinator's follow-up: "Role:" planning text (and the "made in Production" lines of added slides) is taken off client
  slides in export_clean.scrub (take_planning_text) and kept in the notes; lines beside a storyboard or out-of-home strip
  are one small footnote under the frames (pptx StoryboardLines, web .sb-foot), not a dark panel; the answer goes to notes.
- Full engine suite on fdf5cc81: 1940 passed, 3 skipped, 1 xfailed. App deckMaker tests passed before this commit.
- Evidence: /home/batunii/Documents/napkin-local-keep/full-flow-round3-2026-11-23/deck-fix/ (after-polish/ is the latest).

## Left, in order
1. Confirm the push of 0e13f790 landed (ls-remote). If the pre-push check failed, read its output and fix.
2. Re-run app tests and lint: `cd app && node tests/run.mjs deckMaker.test.ts && npx eslint tests/deckMaker.test.ts`
   (app/node_modules is a symlink to napkin-wt-merge-deck2/app/node_modules: remove it before any commit of app/; it is untracked).
3. Optional: web notes for non-Production decks lose the planning "answer" (pptx keeps it in notes); add it to the web notes if wanted.
4. Rename the commit subject from "wip:" if the owner wants a clean history (squash-merge makes it moot). Tell the coordinator, who opens the PR.

## Exact next command
git -C /home/batunii/Documents/Code/napkin-wt-deck3 ls-remote origin fix/deck-round3

## Mirrored frames 5 and 6
They are MY stand-in copies, not Production's. The UAT export held no picture bytes, so scripts built a stand-in bundle
(scratchpad mkbundle.py): the 4 real frames from the UAT PPTX plus mirrored, colour-reduced copies for frames 5 and 6
(ImageOps.mirror), which is why the pack text reads "ƎTAӘWOЯЯAH". Nothing shows Production itself mirroring frames. To be sure,
look at the real frames 5 and 6 in the Production project (they were not in the UAT PPTX, which only carried 4 of the 6).
