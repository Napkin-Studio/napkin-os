# Brand Clan branch review, 2026-11-23 (review only; no code changed)

Step 0 done: feat/brand-clan (19 commits, tip 947775c4) is now on origin. The pre-push hook ran
rust, wasm, conformance, frontend, middleware, mock-backend, image, licences: all passed. No bypass used.
PR link offered by GitHub: /Napkin-Studio/napkin-os/pull/new/feat/brand-clan (not opened).

## 1. What is built
Everything of the approved design except the Production Tool part.
- Attach and detach in the SDK, host routes, CLI (conformance case). Frozen copy of the kit under upstream, version, Update.
- Brand Clan app (ie.napkin.brand): schema, view, example kit. Brief Maker 0.10 and Research 0.5 declare they accept it.
- Harvest: offered only after a client review of accepted or accepted-with-changes; one confirmed write publishes kit v+1.
- Middleware tasks brand_identify and brand_seed (roster and brand layer only, no model), mock parity.
- Shell: Brand Clan chip and popover, harvest panel, Brief Maker look proposal (Apply / Keep mine, never silent).
- Contract docs/contracts/brand-clan.md as built; os-layer 5.7; middleware-api 12. Run once in headless Chromium.
- Not built: Production Tool Bring in, project.brand in contract-v3, Research seeding of campaign.brand, local smoke on the real stack.

## 2. Already matches the new decisions
- Frozen copy plus Update: a kit change never silently changes a made document. This is the right base for re-theme.
- Brief look is a proposal, never applied. Kit is per brand; "brand" is a client, so per-client style is already the shape.
- Strictly per agency, no house seed (still the owner's rule; see question 3).
- Harvest only from accepted documents, never automatic: matches review-stays-in-document. Facts stay in the brand layer.
- Carries the whole kit chain unpinned: matches spin-off-carries-everything.
- Confidential: nothing in the branch writes client material to a Napkin sink beyond the existing layers path. Not re-audited in depth;
  harvest offers brand-worthy items a person ticks, which should skip Confidential-marked parts (unchecked, see C5).
- No compatibility shims (serde defaults only so old documents validate).

## 3. Changes needed
C1. Rebase onto develop and drop the duplicate attach. Large (1 to 2 days).
 develop already has its own attach (crates/clan-sdk/src/attach.rs, AttachSpec/Attached in manifest.rs, /attach routes in
 napkin-host routes.rs and library.rs, os-layer 5.7, tests/attach.rs), built for "research linked to a brief" and
 written to match the Brand Clan carry. The branch's phase 1 (SDK, host, CLI attach) is the same feature twice.
 Keep from the branch only what develop lacks: app/templates/brand, harvest.rs, brand server tasks, mock, shell chip/harvest panel, brand-clan.md.
 Re-run the attach and conformance tests against develop's version; port any branch behaviour develop lacks (pin_source_decisions false
 default, harvest hooks, hoisting) as small additions. Conflicts in section 4.
C2. Make a kit's look re-themeable on a finished deck. Medium (2 to 3 days, mostly the Deck side).
 How the deck works now: engine/deck/look.py resolves the look token by token (brand tier, Style Pack, agency look, default) and the first
 build copies it to look.json in the run folder; later builds replay that copy; only a person's "update to current look" (--update-look)
 takes a new one. So re-theme is possible by design and the look is not baked into the slides. Gaps:
 - look.brand_tokens is a stub returning nothing, waiting for Contract 6 (and Shrey's asks in features/deck-look-kits.clan). The Deck
   never reads a Brand Clan today. Needs the mapping from visual.colours / typography / logos / imagery in the kit schema to the
   {colours, fonts, logos, imagery_bans, kit} shape (about 60 lines plus tests), in engine/deck/look.py and docs/contracts/deck-visuals.md 6.
 - --update-look only handles the agency look. It must also take a new kit (Update chip on the deck, or a different brand/client kit),
   re-resolve, and rebuild. Nothing may sit in slide words or layouts that depends on the look (the module already promises this).
 - Add a test: build with kit v1, update the kit to v2 or swap the kit, update look, same words, new tokens.
C3. Per-client, not per-agency, in the look order. Small to medium, decision needed (question 1).
 look.py has an "agency look" tier (the agency's accent dresses every deck) and wears defaults to agency, so the client kit's colours
 and type are ignored unless the deck wears client. That was Sai's 17 Nov rule; the owner's 23 Nov rule (each client has its own style)
 points the other way. The shell's agency looks (app/src/shell/agency/looks.ts) are chrome and can stay.
C4. Production, Territories and Deck should read the same client kit, through the same attach. Medium (3 to 5 days across tools).
 - Production is now the library app ie.napkin.production with its own document that has a client field (develop #277). So the planned
   contract-v3 project.brand {document_id, version} is no longer needed: use app.attach.accepts [ie.napkin.brand] plus a Bring in card
   that reads upstream.<brand>. Drop project.brand from the contract-v3 plan, keep the shared role payloads (swatches, font, rule)
   and their diff test. Files: production-tool/contracts, make_production.rs manifest, the Production chip (reuse the shell component).
 - Territories: replace the stand-in engine/territory/frames.py client_of / style_folder (on feat/territories) with the attached kit's
   visual.imagery; keep the folder as fallback only until the kit exists, then remove it (no compat). Add accepts to its manifest.
 - Deck: accept both a Brand Clan and a Style Pack (the Style Pack design says "one attach at a time"; the manifest uses
   app.attach.many, check develop's meaning). Do not replace one with the other.
 - Spin-off carries everything: attached kits must hoist from brief to Production to Territories to Deck without loss. The branch tests
   hoisting for brief to production; add Territories and Deck.
C5. Smaller items. Small.
 - Seed leaves an empty kit if seed fails (no delete route): make create-then-seed atomic or add delete.
 - Research cannot seed campaign.brand or client_org (envelope fields): its own small feature.
 - Check harvest skips Confidential-marked parts.
 - Match the client by the client record, not the typed name: the deck holds a logo "only when the brand name equals the brief's client".
 - Update brand-clan.clan next_step; contract-v3 note about project.brand.

## 4. Merge with develop
Branch is 238 commits behind develop (about 3000 files). git merge-tree reports conflicts in:
- Same-feature duplicates: crates/clan-sdk/src/attach.rs and tests/attach.rs (add/add), manifest.rs, instantiate.rs, lib.rs,
  napkin-host library.rs, ops/read.rs, lib.rs; test-sandbox/pipeline/conformance.mjs; docs/contracts/os-layer.md.
- Brand Clan docs: docs/contracts/brand-clan.md and features/brand-clan.clan (add/add; develop holds the design-time versions, the
  branch the as-built ones; take the branch's text, then update). middleware-api.md, server/napkin/registry.py.
- Shell: app/src/shell/AppHost.tsx, components/Toolbar.tsx, host/wasm.ts, docTitle.ts, app/package.json, app/tests/templates.test.ts.
- Apps: brief-maker/index.html, make_brief_maker.rs, make_campaign_research.rs; make_advertising_studio.rs (deleted on develop, edited on branch: delete it).
- Dockerfile.
Recommendation: do not merge develop in. Make a new branch from develop and port the branch's non-attach parts (C1).

## 5. Questions for the owner (recommended answer first)
1. Which wins for deck colours: the client's Brand Clan or the agency look? Recommend the client's kit by default (wears: client), the
   agency look only when the client has no kit. Reverses Sai's 17 Nov rule; tell Sai.
2. Re-theme: a deck takes a new look only when a person presses Update look (kit changed or a different client style)? Recommend yes,
   keep the recorded look otherwise, so a sent deck never changes by itself.
3. Style per client but kit per brand per agency: if two agencies serve the same client, each keeps its own kit (nothing crosses
   tenants)? Recommend yes, keep the 2026-10-19 rule; the client style is per agency until a client-owned kit is wanted.
4. Production, Territories and Deck read the kit through the same attach, with Bring in on Production? Recommend yes; drop
   project.brand from contract-v3.
5. Port the branch onto a fresh branch from develop rather than merging? Recommend yes.
6. Ship order: land the Brand Clan (without Production/Territories/Deck readers) first, then wire the three tools one PR each?
   Recommend yes, Deck first because brand_tokens is the stub.
