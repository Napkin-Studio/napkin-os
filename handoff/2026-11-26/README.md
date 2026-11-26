# Hand-off, 2026-11-26: the 5-tool flow on UAT

**Do not merge this branch.** It is notes and copies of working scripts, not product code.

Start by reading `CLAUDE.md`, then `clan read agent napkin-studio.clan`. The owner's working rules are summarised below and in `CLAUDE.md`; ask Shrey for the rest.

## The goal

The owner's words: "Since 4 tool passes. Let's go to 5 tool one now - including territories and brand clan." Then: "I need prod as clan also on UAT" and "Test on local before pushing … To UAT".

So the target is the **5-tool flow on UAT**, run as the acceptance test:

1. Research powers the Brief.
2. Correct the Brief and lock it.
3. Territories: add 2–3 of your own ideas, explore, greenlight 3.
4. Continue in → Production, running **as a CLAN app**: 3 route nodes, with scripts linked to each.
5. 3 full flows with **two different Brand Clans**.
6. Mark finals → Continue in → Deck.

The rule before UAT: the combined develop is click-tested live, locally, before any UAT deploy. Branch pushes for CI don't need to wait for that.

The 4-tool gate passed on UAT on 2026-11-25 (develop 91fcb6b6). The staging release of it is deferred; it needs a staging terraform plan, then the owner's apply.

## Where things are (about 04:00, 2026-11-26)

Merged into develop tonight:
- #339, #342, #343, #336, #344: Production, shell and web fixes.
- #354, #357, #356: deck fixes (the fit verdict with no title, the storyboard slide title, the self-named film's name and client).
- #359: a deck from a brief whose research has Confidential marks now builds.

The merge queue was landing these, **in this order**:

| PR | Branch | Notes |
|---|---|---|
| #348 | fix/production-accept-4 | Pushed 03:53. One e2e test, `film-reopen.spec.ts:5`, flaked once on it and passed on re-run. |
| #351 | fix/deck-final-step | |
| #346 | fix/research-discover-players | |
| #345 | feat/deck-beat-editor | Mock approved by the owner. |
| #318 | feat/brand-clan-v2-build | Brand Clan phase 2. |
| #281 | feat/pc-page → develop | Production as a CLAN app, stage 2. CI green and walked live locally. |
| #353 | feat/territories-uat-infra | Territories EFS store, plus a pictures switch (off). |

Check what actually merged with `gh pr list --state merged --limit 20`.

Then, still to do:

1. **Production stage 3, #292** (feat/pc-jobs). Once #281 has squash-merged:
   1. Merge origin/develop into feat/pc-jobs.
   2. Retarget the PR to develop: `gh pr edit 292 --base develop`.
   3. Push with `scripts/pc-push.sh <worktree> feat/pc-jobs`. It waits for an exclusive check slot, because the production-tool e2e uses port 5199.
   4. Queue it.

   Then do the same for **#304** (feat/pc-ajv-precompile) after #292. The local merges were already made on this machine: pc-jobs is at 798accdd and pc-ajv at 162fd2c1. They may be pushed by the time you read this; check `git log origin/feat/pc-jobs`.
2. **Territories, #352** (feat/territories → develop):
   1. After #318 merges, merge develop into feat/territories, then merge **#331** (feat/territories-brand-style) into it.
   2. The conflict resolutions were already rehearsed on `test/territories-rehearsal`, which is in `unpushed-branches.bundle`. The #318 conflicts: `registry.py`, mock-middleware, `pyproject` and `uv.lock` (pyyaml plus pypdfium2, then re-lock), app `package.json` "apps" and the Dockerfile, and `app-template.gen.ts` (regenerate).
   3. `features/territories-cloud.clan` also exists on #353. Take develop's copy and re-merge with `scripts/clan-remerge.py`.
   4. #355 (frames kept as the document's linked assets) and #358 (quotation marks, the material question, the plain-words refusal) are already merged into feat/territories.
3. **The combined local 5-tool run on develop, on live backends.**
   - Use your own spare ports. **Never** use the owner's stack on 8091/8788, and never Shrey's own projects.
   - Runway key: `~/.config/napkin/runway.key`. Pass it only through env, as `RUNWAY_API_KEY` and also `RUNWAYML_API_SECRET` for the middleware. Never print it.
   - Use two Brand Clans for the client (e.g. "Original" and "Zero").
   - Fix what breaks, with a feature record each time.
4. **The UAT terraform plan**, once #292 and #353 are on develop. In `infra/envs/uat`, follow `UAT-APPLY.md` step 3.
   - It needs the live `production_relay_url` and `production_relay_secret_arn`, read from the current UAT web task definition, or the plan strips Production.
   - It also needs `production_service_key_arn`: `aws secretsmanager describe-secret --profile napkin --secret-id napkin-hackathon/SERVICE_KEY --query ARN --output text`.
   - Read the plan. It should show only:
     - web gaining NAPKIN_PRODUCTION_SERVICE_KEY and NAPKIN_PRODUCTION_UPLOAD_ORIGIN;
     - the Territories EFS access point, mount and NAPKIN_TERRITORY_DATA;
     - the policy additions.
   - **The owner applies. Agents never apply.**
5. **Deploy, the same hour:**
   - `gh workflow run deploy-production-tool.yml -r develop -f parts=relay`
   - then `gh workflow run deploy.yml --ref develop -f environment=uat -f ref=develop`
   - Then verify in AWS, per `UAT-APPLY.md` step 5.
6. **Run the 5-tool flow on UAT.** The UAT spend cap was $25, of which $14.65 has been used.
7. **Turn Territories pictures on for UAT.** After #352 is on develop, set `territory_images = true` in the UAT tfvars, plan, and the owner applies. The owner chose $2 per document. It reuses the `napkin-hackathon/RUNWAY_API_KEY` secret.

## Infra already done

- **Hackathon stack.** Applied by the owner at about 03:50 on 2026-11-26:
  - the `napkin-hackathon/SERVICE_KEY` secret was created and its value put (version 228255e3, AWSCURRENT);
  - the relay `$LATEST` SECRET_ARNS includes it;
  - the `live` alias is still **v33** until the relay deploy in step 5.
- **Staging is not affected.** Staging web (`napkin-staging-web:35`) has no Production or relay settings, so the stage 3 relay deploy can't break it.

## Owner decisions from this session (all recorded in feature records)

- **Territories on UAT:** EFS for its run data. Pictures on, $2 per document.
- **Territories frames reach the page:** "host stores the bytes". The frames job returns each picture, and the host saves it as a linked asset in the document. Done in #355.
- **Stage 3 relay vs staging:** check first, and hold if staging uses the relay. Checked: it doesn't.
- **Parked:**
  - "Make together" as continuous takes. The design is on feat/make-together-continuous, with 5 open questions.
  - The multi-route deck.
- **Still open for the owner:**
  - A46: Script card titles. The recommendation is that each card shows its own title.
  - The end-card typeface from the Brand Clan, which needs font files.
  - Deck page previews wearing the Brand Clan look, which needs a mock.

## Known issues not yet fixed

- A flaky e2e test: `production-tool/web/e2e/canvas-picture/film-reopen.spec.ts:5` ("open a project on the canvas first").
- Deck: a rollout mid-build wipes deck engine run files, because the run folder isn't on EFS.
- The first Lock click occasionally doesn't take.
- A logo upload can land beside the Brand board.
- A 6 s script target gives a 15 s storyboard.

## Working rules on the GB10 machine

- At most 2 hook checks at once. Count them only with the anchored pattern:
  `pgrep -f '^(/usr/bin/env )?(/usr/bin/|/bin/)?bash scripts/check\.sh --range'`.
  An unanchored pattern matches its own wait loop.
- A push that touches production-tool needs **no** other check running, because of port 5199.
- `scripts/merge-queue.sh`:
  - usage: `[WAIT_FOR=<pr>] [SLOTS=n] [UAT=1] bash merge-queue.sh <pr> ...`;
  - it merges develop in, auto-resolves only `.clan` conflicts with `clan-remerge.py`, pushes, waits for CI, then squash-merges;
  - it deploys UAT only with `UAT=1`;
  - run **one** queue at a time: parallel queues race on the shared `uat-flow-fixes.clan` and lose merges.
- `.clan` files are zip archives and can't be merged by git. Use `scripts/clan-remerge.py`.
- Never use `--no-verify` or the bypass variables. No Co-Authored-By lines. Never delete merged branches. Never apply terraform. Never deploy production.

## Files here

- `UAT-APPLY.md`: the Production stage 3 apply and deploy sequence.
- `scripts/`: `merge-queue.sh`, `clan-remerge.py`, `pc-push.sh`.
- `unpushed-branches.bundle`: `accept/run3` (the local acceptance integration), `test/territories-rehearsal` and `test/territories-brand-318` (#318 and #331 merges rehearsed onto Territories), and `fix/territories-live`. Restore one with `git fetch handoff/2026-11-26/unpushed-branches.bundle test/territories-rehearsal:test/territories-rehearsal`.
