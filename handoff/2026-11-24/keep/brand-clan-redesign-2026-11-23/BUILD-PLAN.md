# Brand Clan build plan (2026-11-23)

Approved by the owner on 2026-11-23: "Approved. Build." Design: `DESIGN.md` (sections 4a, 4b, 8 included). Mocks: `mock/`.
Repo worktree: `/home/batunii/Documents/Code/napkin-wt-bc2`, branch `feat/brand-clan-v2` (from `origin/develop`). Feature record: `features/brand-clan.clan` (status `building`).
One branch, several lanes working in separate file sets. A lane that needs a file it does not own asks the owner of that file; it never edits it.

## Frozen contract (read before anything else)

Everything a lane may depend on is in **`docs/contracts/brand-clan.md`** and its machine-checked half, pushed first:

* `app/templates/brand-clan/schema.json`: the document (`ie.napkin.brand`). Published bible in `shared/data.yaml`; **`kit.version` is the published version**; draft, pending and old versions live in `app/brand/` and never reach a frozen copy.
* `docs/contracts/examples/brand-clan/*.json`: the vectors (`data.zero-v2`, `data.empty-v1`, `candidate.zero-draft-v3`, `changes.*`, `list.reply`, `view.reply`, `history.reply`, `proposal.request`). Tests pin the host to them.
* Routes and ops (contract section 5): `list`, `create`, `get`, `history`, `draft.save/start/discard`, `publish`, `proposal.set/accept/keep`, `default.set`, `work.update`, `asset.put/get`. Same ops on napkin-web (HTTP), wasm and desktop through `napkin_host::brand_clan::call`.
* The default is `default_brand_clan` on the client record. Work attaches a Brand Clan with develop's attach, unchanged (`app.attach.accepts: [ie.napkin.brand]`; Production also `many`); the frozen copy is `data.upstream.<brand clan document id>`; the version held is `lineage.attached[].version`.
* The Update chip is `/attach/update` (`work.update` from the client window). Nothing in a work document changes until a person presses it.
* Reader shapes (contract section 8): colours by deck token role, typography by `head/body`, logos by `light/dark/mark`, `imagery.bans[]`, `voice.rules[].kind`.
* Rules for every lane: no paid calls, no UAT, no deploy, no terraform, ports 5450-5459 only, never `--no-verify` or `NAPKIN_*` bypasses, log with `FEATURE_AGENT=claude scripts/feature log brand-clan "<what>"`, subjects `<area>: <imperative>`, no Co-Authored-By or Generated-with lines, no PR (the owner opens it).
* UI is done only when paired mock-vs-build screenshots (1280 and 1024) match and have been looked at; saved as `mock/build/build-<state>-<width>.png` next to the mock's `mock/shots/<state>-<width>.png`.

## Phase 1

### Lane A: the Brand Clan document, host, client window, editing (owner: this lane)

Order: contract pushed first (done when the SHA was sent to lane B), then:

1. Template app `app/templates/brand-clan`, packer `make_brand_clan`, Dockerfile line.
2. `napkin_host::brand_clan` (+ diff), the client record field, napkin-web routes, wasm and desktop `call`.
3. Shell Host API and the client window section to mocks b1, b2, b3, f1, f2, f3, f3b, f4, f4b.
4. Tests and paired screenshots.

Owns (exact):
* `docs/contracts/brand-clan.md`, `docs/contracts/examples/brand-clan/**`
* `app/templates/brand-clan/**`, `crates/clan-sdk/examples/make_brand_clan.rs`, `Dockerfile` (the Brand Clan lines only)
* `crates/napkin-host/src/brand_clan.rs`, `crates/napkin-host/src/brand_clan/**`, `crates/napkin-host/src/clients.rs`, the `pub mod` line in `crates/napkin-host/src/lib.rs`, `crates/napkin-host/tests/brand_clan*.rs`
* `crates/napkin-web/src/brand_clan.rs` and its one mount line in `crates/napkin-web/src/api.rs`/`lib.rs`; `crates/napkin-web/tests/brand_clan*.rs`
* `crates/napkin-wasm/src/lib.rs` and `app/src-tauri/src/main.rs` (the Brand Clan passthrough only)
* `app/src/host/{types,http,wasm,tauri}.ts` (the `brandClans` API and `ClientRecord.default_brand_clan` only)
* `app/src/shell/nui/ClientView.tsx`, `app/src/shell/nui/brandClans/**`, `app/src/shell/landing/BrandClanCard.tsx`, its CSS, `app/tests/brandClans*.test.tsx`
* `mock/build/**` (screenshots), `mock/tools/**`

### Lane B1: detection and build (phase 1, starts as soon as the contract is pushed)

Detection (a brand bible?), the one question (mocks a1, a2), the `brand_build` job. Writes only through `create` and `proposal.set` (contract section 7) as `process:brand_build`; uploads assets with `asset.put` first.
* Step 1 free rules over the host's extracted text (file name, "logo clear space", "colour palette", "typography", hex or Pantone codes, pages over 8); step 2 one Claude Haiku call on Bedrock when step 1 is unsure or positive: `{brand_bible, brand_name, confidence}`; capped and counted under Claude spend like the Territories frame check. The brand name is matched to the client record, never typed.
* `brand_build`: a stronger model reading the whole file in pieces (text, then page images for logos and colour chips); sections it cannot find are omitted and listed in `candidate.gaps`; nothing invented; nothing written unless it has content; 120-page cap asks first; failure leaves the source safe, shows the reason and a Retry. Confidential: same path as any document, never to shared layers, RAG, evals or run-log bodies.
* The file chip's small "Build a Brand Clan from this" action when detection fails or times out.

Owns (exact):
* `server/napkin/brand/**`, `server/tests/test_brand_*.py`, the brand lines of `server/napkin/registry.py`
* `mock-middleware/**` (the brand tasks) and `mock-backend/**` (only if the mock needs them)
* `docs/contracts/middleware-api.md` (the brand section)
* `app/src/shell/brand/**` (the question, the progress chip), `app/tests/brandQuestion*.test.tsx`; one mount line in `app/src/shell/AppHost.tsx` (agreed with the owner of that file)

#### Notes agreed with lane B (2026-11-23)
* First-build assets: `create` with the candidate first (files named `human/assets/<sha10>-<name>`), then `asset.put` into the new document. No pre-document upload route (contract section 7).
* Service credential for `process:brand_build`: `Authorization: Bearer <NAPKIN_BRAND_HOST_TOKEN>` plus `X-Napkin-Actor: process:brand_build`, on five routes only (contract section 7). Lane B reads `NAPKIN_BRAND_HOST_URL`, `NAPKIN_BRAND_HOST_TOKEN`.
* `host.brandClans.list(clientId)` exists on every host for the question (`app/src/host/brandClans.ts`).
* Lane B's card is a strip under the bar, not drawn inside the app's desk as mock a1 shows: the app frame is sandboxed and the shell cannot draw inside it. A known, accepted difference from the mock; the screenshot pair for a1/a2 records it.

## Phase 1 checks
`scripts/check.sh --only rust,wasm,frontend,desktop` (lane A); `--only middleware,mock-backend,frontend` (lane B1). No hand-run full check before a push; the pre-push hook runs the suites the change reaches.

## Phase 2: carry (after phase 1 lands on the branch; each lane reads only contract section 8)

### Lane C1: Brief chip and the Update chip on open work
Brand chip on Brief Maker and Research (mocks c1, c2): shows the Brand Clan the document holds, picks another (attach's replace verb), offers "Update" (`/attach/update`) when `lineage.attached[].version < kit.version` and opens the same what-changed list. The brief's look and logo slots offer the Brand Clan as a proposal ("Apply" / "Keep mine"), never silently. New work starts on the client's default. `accepts` on Brief Maker and Research manifests (Brief already lists it).
Owns: `app/templates/brief-maker/**`, `app/templates/campaign-research/**`, `crates/clan-sdk/examples/make_brief_maker.rs`, `make_campaign_research.rs`, `app/src/shell/brandChip/**`, `app/tests/brandChip*.test.*`.

### Lane C2: Production node (mocks d1, d2, d3; links per DESIGN 4a)
Auto-placed Brand Clan node when the client has one (the default), drawn like the colour and type boards, not linked; powers jobs only when linked; picker swaps it; a second node beside it; the link carries downstream (Script, then Storyboard, then Film; Key visual, then sizes), the nearest link up the graph wins; words from `voice`, pictures from `visual` and `imagery`. `attach.many` for Production declared per app only.
Owns: `production-tool/**` (web, clan-store, contracts additive only), `crates/clan-sdk/examples/make_production.rs`.

### Lane C3: Deck
`look.brand_tokens` filled from the frozen Brand Clan; the client's Brand Clan wins over the agency look (reverses Sai's 17 Nov rule; tell Sai in a Slack draft only); `--update-look` takes a new or different Brand Clan, re-resolves and rebuilds, same words; Update look (mocks e1, e2). Never re-themes unless a person presses it.
Owns: `engine/deck/**`, `app/templates/deck-maker/**`, `crates/clan-sdk/examples/make_deck_maker.rs`, `docs/contracts/deck-visuals.md` (section 6 only).

### Lane C4: Territories frames style
Read palette, imagery style and bans from the attached Brand Clan; remove `client_of` / `style_folder` in `engine/territory/frames.py` (no fallback kept).
Owns: `engine/territory/**`.

## Shared files (edit only by agreement; log which lane touched them)
`features/brand-clan.clan` (every lane logs with `scripts/feature log`; only lane A edits `design`), `Cargo.lock`, `app/package.json`, `crates/napkin-host/src/lib.rs`, `app/src/shell/AppHost.tsx`.
