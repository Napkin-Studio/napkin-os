# Paused 2026-11-24: where everything stands

Owner asked to pause all agents. Nothing below is lost; each line says how to pick it up.

## Waiting on the owner
- **Territories redesign mocks.** Approval plus 7 decisions.
  - Mock: `../territories-redesign/mock/index.html` (PNGs in `mock/png/`). Audit: `../territories-redesign/AUDIT.md`.
  - Recommendations I sent:
    1. primary button in the step header;
    2. engine progress option A (crew in the job status, about ½ day);
    3. auto-advance to a "crew is back" screen;
    4. Greenlight as ranked rows;
    5. title 38 px;
    6. each route's palette gets a dark-mode variant;
    7. Pictures in World as a single line plus Make pictures.
  - Also fix in the build: raw finding ids (`fi_…`) in Pick cards and Booth notes become plain words.
  - Mock sources: `mock/src/design.{js,css}` + `mock/build.py`. build.py reads `app/templates/territories/index.html` from a removed worktree; repoint it at any feat/territories checkout to rebuild.
  - On approval: write it into `features/territories.clan` design, build on feat/territories, then drive end to end against the mock PNGs.
- **Look-up box on Greenlight.** Left out per the approved look-ups design. Owner to decide when seeing the mocks; I recommend leaving it out.

## Branches
- **feat/territories:** pushed at b8375bc7, includes fix/territories-pages. Worktree `~/Documents/Code/napkin-wt-territory-plan`.
- **fix/deck-round3:** paused mid storyboard fixes ("Role:" text leak, "Contains wheat." panel, mirrored frames 5–6). See `deck-round3.md` once the agent writes it. The PR into develop is not opened yet; open it after those two fixes.
- **feat/territories-local-full:** look-ups via `claude -p` plus Production with real Runway in the local launcher (cap $10, key from env only). See `launcher.md`. After it merges into feat/territories, the owner exports RUNWAY_API_KEY.

## Open PRs into develop (merge after CI)
- **#285** fix/brief-node-version
- **#286** feat/library-trash
- **#288** fix/shell-brief-polish
- **#289** fix/production-round3
- **#281** feat/pc-page (Stage 2): HOLD until the 4-tool UAT pass.
- **Stage 3 (E1+E2) and ajv precompile:** PRs not opened yet.

## After those
1. UAT round 4: deploy develop to UAT. The owner deploys the relay (director.v18, faces). Then a fresh 4-tool run on a new fictional brand.
2. Drive the whole of Territories myself again and report (owner's request).
3. Brand Clan phase 2:
   - tool chips;
   - Production node;
   - deck look;
   - Territories style;
   - clan:file-added.

## Running / stopped
- **Still running:** the owner's local Territories stack, 8399/8395/20591 (not an agent; left for the owner).
- **Stopped:** my owner-eye stack (8699) and driver (9791). The driver script is in `tools/owner-eye-driver.mjs`.
