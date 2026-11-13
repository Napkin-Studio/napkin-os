# Continuing the Napkin OS build from this branch

Everything a person or an agent needs to carry on the build on `spike/fabletest` from another machine.

## Start here
1. `BUILD-LOG.md`, the last entry: what is built, what failed, and the numbered next action.
2. `docs/napkin-os-build-prompt-v3.1.md`: the governing prompt (it wins over v2 and v3).
3. This folder:
   - `builder-brief.md`: the shared brief every builder agent is given. Its last sections (Phase 2 addendum, Design addendum of 13 Nov, Speed addendum) win over the earlier text. Paths in it are for the Mac the build ran on; change them for yours.
   - `design-brief.md`: the brief every design agent is given.
   - `develop-alignment-audit.md`: every screen this build added, compared with develop (13 Nov).
   - `progress.html` and `progress.py`: the progress page and the script that recomputes its numbers (edit `REPO` and `PAGE` at the top).
4. The feature records under `features/`: `scripts/feature list`, `scripts/feature show <slug>`. A record's design is the spec for its builder.

## The rules of this build
- One branch, `spike/fabletest`. No pull request from it, nothing pushed to `develop` or `main`. Each record is built on `feat/<slug>` in its own worktree and merged here with `git merge --no-ff`.
- Develop is the model for how the product looks and behaves (owner's rule, 13 Nov). Merge `origin/develop` into this branch at the start of every wave.
- Fable designs and reviews anything important; Sonnet builds; at most three builders at once on one machine; builders run only their own tests; one full e2e run per wave.
- No paid or model call in any test. No `.env` read. Cannes Lions, Effie and WARC material is never opened. No `terraform apply` by an agent. No `--no-verify`, no bypass variables, no attribution lines in commits.
- Approvals so far were given in chat by Sai, with Laurence's relayed by Sai; each record's `design.approved_by` says so. ADR-004 is not signed.

## To resume with Claude Code
Open the repo on this branch and say: "Read docs/build-handoff/README.md and BUILD-LOG.md's last entry, then resume the Napkin OS build." Give builders `docs/build-handoff/builder-brief.md` with your own paths.

## Machine needs
Rust with the wasm32 target, Node 22, uv 0.13 or newer (older uv skips the dev groups), gitleaks for the `secrets` suite (`GITLEAKS_BIN`), Chrome for Playwright (`channel: 'chrome'` in a throwaway config), about 100 GB of free disk for worktree build folders.

## Not in the repo
- Branches in flight when this was written exist only on the first machine unless pushed: `feat/align-confidential-prices`, `feat/align-landing-look`, `fix/store-scan-under-lock`.
- The Deck Maker and Production UI prompt is Shrey's and runs as its own track with pull requests into develop.
- Phase 3 and 4 audits are being written to `/tmp/phase3-audit.md` and `/tmp/phase4-audit.md`; copy them here when they exist.
