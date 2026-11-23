# Session hand-off, 2026-11-24

Everything from this Claude Code session that existed only on the laptop is either in this folder or pushed to its own branch, so the work can resume on another machine. This branch exists only to carry the hand-off: **do not merge it into develop.**

## Resuming on another machine

1. Clone the repo and fetch everything:
   ```sh
   git fetch origin
   git switch chore/session-handoff-2026-11-24
   ```
2. **Memory.** Claude Code's memory for this project is in `memory/`. Copy it into the new machine's Claude project folder. The folder name is the repo path with `/` replaced by `-`, for example:
   ```sh
   mkdir -p ~/.claude/projects/<path-of-your-clone-with-dashes>/memory
   cp handoff/2026-11-24/memory/*.md ~/.claude/projects/<…>/memory/
   ```
3. **Older branches that were never pushed.** There are 64 of them, from October to 2026-11-21. Most are superseded spikes and fixes. They are in `unpushed-branches.bundle` (the list is in `unpushed.txt`). Restore any of them with:
   ```sh
   git fetch handoff/2026-11-24/unpushed-branches.bundle '<branch>:<branch>'
   ```
   The bundle holds only the commits missing from origin, so fetch from origin first.
4. **Notes, plans and mocks** that lived in `~/Documents/napkin-local-keep` are in `keep/`. The paths in the notes point at `~/Documents/napkin-local-keep/…`; on a new machine, read them as `handoff/2026-11-24/keep/…`.
5. Start a Claude session and tell it: *"Read handoff/2026-11-24/README.md and keep/resume/*.md, then carry on."*

## Not in here, on purpose

- **The session transcript.** It holds the full conversation, including client discussion, so it stays local: `~/.claude/projects/-home-batunii-Documents-Code-napkin-studio-production-tool/5f9369b1-b1e6-4fd3-b44c-d946c8ad0c67.jsonl`. To resume the conversation itself, copy that file yourself.
- **Client material:**
  - `stena-rehearsal/`, `acne-demo-leftovers/`;
  - the `spike/acne-stena-demo` branch, which has 77 local commits not on origin. Its push was refused earlier by the licence guard. Keep it on this laptop, or push it yourself.
- **Secrets and infra values:** `*.tfvars`, `config.production-tool.json`, `.env`.
- **Runtime folders:** the local stacks' data, logs, node_modules, the mock repo copies and their virtualenvs.
- **Files from earlier work, left untouched:**
  - The `napkin-studio` main checkout has staged changes on `feat/sonnet-default-caching` (`features/sonnet-default-caching.clan`, `production-tool/relay/director/model.py`) and an untracked `design/assets/pfp/`.
  - This worktree has the RTK block added to `CLAUDE.md`, plus `.rtk/` and the file `Claude Agent @ napkin-studio-production-tool`.

## Where each piece of work stands

| Work | Branch | State |
|---|---|---|
| Territories (all merged fixes) | `feat/territories` @ b8375bc7 | pushed |
| Local look-ups via `claude -p` + Production in the launcher | `feat/territories-local-full` @ 3533bd92 | pushed, not yet merged into feat/territories; see `keep/resume/launcher.md` |
| Deck round 3 (cover, storyboard, ids, idea line, tender note) | `fix/deck-round3` | pushed; storyboard follow-ups ("Role:" leak, "Contains wheat." panel) paused; see `keep/resume/deck-round3.md` |
| Production as a CLAN app, Stage 3 | `feat/pc-jobs-relay` @ 6fbb1413 | pushed |
| Production as a CLAN app, Stage 2 | PR #281 | hold until the 4-tool UAT pass |
| Brief version | PR #285 | open |
| Trash | PR #286 | open, mergeable |
| Shell / brief polish | PR #288 | open, mergeable |
| Production round 3 | PR #289 | open, mergeable |
| Brand Clan v2 | `feat/brand-clan-v2`, `feat/brand-clan-v2-build` | pushed; phase 2 next |

## Waiting on Shrey

1. **Territories redesign:** approve the mock (`keep/territories-redesign/mock/index.html`; screens in `mock/png/`) and the 7 decisions. Recommendations are in `keep/resume/README.md`.
2. **Look-ups with an empty market:** accept the local research port's open look-up (`market: ""`), or have Territories send a real market.
3. **One real Runway picture check** through the local launcher (at most $1). The command is in `keep/resume/launcher.md`; it needs `RUNWAY_API_KEY` in the environment.

## Order after that

1. Merge #285, #286, #288 and #289 once CI is green. Open the deck round 3 PR after the storyboard follow-ups.
2. UAT round 4:
   - deploy develop to UAT;
   - Shrey deploys the relay (director.v18, faces);
   - run the 4 tools fresh on a new fictional brand.
3. Build the approved Territories redesign, then drive Territories end to end against the mock.
4. Merge `feat/territories-local-full` into feat/territories.
5. Production as a CLAN app (priority 1), then Territories, then Brand Clan. All of these go to UAT only after the 4-tool pass.
