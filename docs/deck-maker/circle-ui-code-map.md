# Deck Maker, new UI: code-change map

Design record: `features/deck-maker-circle-ui.clan` (approach B: current app + agent circle + missing screens).
`T` = `app/templates/deck-maker/` ; `A` = `T/index.html` (1284 lines, 92.7 KB; two scripts: pure `<script id="deck-logic">` l.206-745 run by tests in a VM, page script l.747-end). Line numbers verified against the file.

## 1. Summary and phases

Everything lives in one file plus `T/schema.json`, `T/example/`, `docs/contracts/deck-maker.md`, `app/tests/deckMaker.test.ts`. No dependency, no infra, no packer change: `npm run apps` (app/package.json l.19) -> `make_deck_maker.rs` l.61 reads `index.html`, writes `public/apps/deck-maker.app.clan`. Deck Maker is unlisted (`app/src/shell/comingSoon.ts` l.42), so no user sees it until a later listing PR. One PR per phase into `develop`, feature `deck-maker-circle-ui`, branch `feat/deck-maker-circle-ui`. The design must be approved by the owner first (CLAUDE.md step 3).

| Phase | Scope | Files | Size | Demonstrable at end |
|---|---|---|---|---|
| 0 (prep, S) | Copy circle geometry (8 agents) into the repo; schema additions; fixtures under `T/example/states/`; `?state=` dev loader | schema.json, example/states/*.yaml, A (loader) | S | Every fixture validates; screens loadable by name |
| 1 Circle swap | `circleSvg`, `agentState`, tables; delete `MARK_SPIN` (l.792) and `.spin/qspin` (l.140-141); status card (l.1029) and gate avatar (l.1012) use it | A, test | M | Current gate-1 screen with circle 60px + 32px avatar, state word, reduced motion |
| 2 Running states | `build()` split; content box; status card first; failed routed to Build; done view; slow word; hand-off blend | A, schema, fixtures | L | 11 running screens (reading to done) from fixtures |
| 3 Gates 2 and 3 | gate registry, territory pick, idea body, `approveGate` choice, decisions, Checked-so-far per gate | A, schema, contract doc | L | Gate 1, 2, 3 approve in the stub host; approvals recorded |
| 4 Review/Present | Approve the deck, all-supplied, selectable appendix, confirm once, export rows, report line | A, schema | M | Review-ready and Export-ready screens |
| 5 (only if allowed) | Live shader circle | A (or second file, host serves only `human/index.html`) | M-L | Not planned: flat vector is the decision; see Q3 |

## 2. The 22 FINAL screens (canvas `Fin01`..`Fin22`)

Current renderers: `screenOf` l.781, `start` l.935, `build` l.998, `review` l.1046, `presentScreen` l.1091, `bar` l.794, `builtLine` l.819, `builtOf` l.992.

| # | Screen | Current | New | Code and change | Ph |
|---|---|---|---|---|---|
| 1 | Start | `start()` | same | none (restyle is out of scope) | - |
| 2 | Start answered | `start()` | same | none | - |
| 3 | Build clicked | `#build` sets `view.screen='build'` | running "reading inputs" | `build()` default branch l.1022-1024 replaced by `buildStage` | 2 |
| 4 | Build run | bare title + "waiting for the engine" | content box + status card | `contentBox`, `statusCard` | 2 |
| 5 | Hand-off | none | blended circle, word "Handing off" | `blend()`, `agentState().handoff` | 1-2 |
| 6 | Storyline drafting | none | box, Strategy, Writing | stage `storyline`, status `now` | 2 |
| 7 | Gate 1 | `build()` l.1005-1019 | same + circle avatar + circle card | extract `beatsBody`, byte-identical; swap l.1012, l.1029 | 1, 3 |
| 8 | Slow | none | state word "Taking longer than usual" | `run.agent.slow` flag, no time | 2 |
| 9 | Gate 2 territories | none | 3 rows, first pick marked, Pick/Edit/Ask Dex | `territoriesBody`, `view.pick`, `approveGate(...,choice)` | 3 |
| 10 | Idea drafting | none | box, Idea, Thinking/Writing | as 6 | 2 |
| 11 | Gate 3 idea | none | idea line, TV and social rows, chips, Approve/Edit/Ask Dex | `ideaBody` | 3 |
| 12 | Copy | none | box, Copy | as 6 | 2 |
| 13 | Deck build | none | box, Deck | as 6 | 2 |
| 14 | Check | none | box, Review, "Checking" | as 6 | 2 |
| 15 | Retry (failed) | `failed` routes to Start (l.781-785) | Build with failure card + retry | `screenOf` failed->build; `failView`; `data-retry=<stage>` (toast now) | 2 |
| 16 | Done | `done` -> review | Build done card + "Open the deck" (`data-go="review"`) | `doneView`; routing keeps `done` -> review, Build reachable by `data-go=build` | 2 |
| 17 | Review | `review()` l.1046-1089 | same + appendix toggle | l.1077 span -> button | 4 |
| 18 | Review needs | `supplyPanel` l.887 | same | none | - |
| 19 | Review ready | none | all supplied + "Approve the deck" | `supplyPanel` all-supplied state, `approveDeck` | 4 |
| 20 | Present | `presentScreen()` l.1091 | confirm shown once | replace `confirmPanel` (l.1108 area) by `data-sourced` line + `data-go=review` | 4 |
| 21 | Present last | same | disabled rows when nothing built | keep disabled look | 4 |
| 22 | Export ready | `fmts` l.1098, `ready=!!s.exports[key]` l.1112 | Open/Download + file names; Animated "Not built yet" | `exportRows`, `reportLine` | 4 |

## 3. Data and schema additions (all optional; `run` has no `additionalProperties:false`, so current data still validates)

Add to `T/schema.json` (the schema is also silent on `exports` and `change_requests`, which the code already reads l.776, 1111, 1235: add both).

| Field | Type | Writer |
|---|---|---|
| `run.agent` | `{key: strategy\|idea\|research\|brief\|copy\|deck\|approval\|review\|dex, activity: work\|write\|think\|read\|check\|human\|error\|complete\|waiting, step_index:int, step_total:int, to?:key, slow?:bool}` | server (host); fixture until then |
| `run.stages[].items[]` | `{text, status: done\|now\|pending}` (content box) | server runner |
| `run.error` | `{stage, message, retryable:bool}` (with `state: failed`) | server |
| `run.done` | `{summary, slides:int, appendix:int, to_supply:int}` | server |
| `run.gate.agent` | key (circle at gate; else Strategy for gates 1-2, Idea for 3) | server |
| `run.gate.territories[]` | `{id, n, name, thought, why}`; plus `first_pick` (id), `picked` (id) | server (from `c_territories.json`: `ranking.order[0]`) |
| `run.gate.idea` | `{line, basis, territory_id, executions:[{n, channel, summary, tag?}], rests_on:[{label,tone}]}` | server (from `d_idea.json`) |
| `run.approvals.<gate>` | add `decision: approve\|edit\|retry`, `picked?`, `note?` (keeps `{by,at}`) | app now, server later |
| `run.decisions[]` | `{gate, kind: approve\|edit\|retry, by, at}` | app |
| `run.gate_requests[]` | `{gate, kind, at, status:'waiting'}` (edit/retry asks, like `change_requests`) | app |
| `exports.<web\|pptx\|pdf\|anim>` | `oneOf` legacy `true`, legacy file-name string, or `{file, url?, bytes?}` | server |
| `deck.appendix_ids[]`, `slide.appendix` | string[], bool (`appendix_count` stays fallback) | server; app may write via `put` |
| `run.approvals.deck` | `{by, at}` (deck approval) | app |

Rules: no percent and no time fields are ever rendered (`report.seconds` exists; never show it). Gate id equals stage id (`storyline`, `territories`, `idea`), as the example already does.

Example data: keep `T/example/data.yaml` untouched (Lumen, gate 1; the packer reads only that file). Add `T/example/states/*.yaml` (not packed; dev and tests only): `reading, handoff, storyline, gate1, territories, slow, gate2, idea, gate3, copy, deck, check, failed, done, review-ready, export-ready, export-none` (17). Dev loader: `?state=<name>` fetches the file only when `window.__CLAN__` is absent.

## 4. Circle component spec

Place in `deck-logic` (testable): `AGENTS`, `MATS`, `RING`, `STAGE_AGENT`, `agentState`, `circleSvg`, `arcPath`, `blend`. Embed 8 agents' geometry from `agents.json` (a list of 30 entries keyed by `name`, not a string key; needs Strategy n3, Idea n7, Research n2, Brief n1, Copy n9, Deck n21, Approval n24, Review n23), rounded to 3 decimals, about 3 KB.

Signatures:
- `circleSvg({agent, to?, activity, size, label?}) -> string`: `viewBox="-1.15 -1.15 2.3 2.3"`, `role="img"`, `aria-label="<Agent>, <state word>"`, `data-activity`, class `cir s60|s32`.
- `agentState(run) -> {agent, activity, word, role, step_index, step_total, handoff}`. Order: `run.agent`; else derive: open gate -> `human`; `state:failed` or stage `failed` -> `error`; `done` -> `complete`; nothing running -> `waiting`; else by stage via `STAGE_AGENT`: inputs/scans -> brief or research (read), storyline -> strategy (write), territories -> idea (think), idea -> idea (write), copy -> copy (write), check -> review (check), review -> approval. Unknown key -> neutral waiting circle; never throws.
- `blend(from, to, p)`: both geometries, gradient front at p; reduced motion shows p=0.5 plus the word.
- `arcPath(cx,cy,rho,a0,sweep) -> d`.

| Activity | State word | Ring |
|---|---|---|
| work / write | Working / Writing | solid accent #FF4F2E, slow turn |
| think | Thinking | dotted #7A5AF8 |
| read | Reading | ticks #B87100 |
| check | Checking | two-beat #238A55 |
| human | Needs you | bold #E0560C, static |
| error | Failed, retrying | broken #16191D + dot |
| complete | Done | full accent |
| waiting | Waiting | two short neutral arcs |
| handoff | Handing off | blend, solid accent |
| any + `slow` | word + " · taking longer than usual" | unchanged |

Materials: Strategy graphite, Idea and Research glass, Brief and Review pearl, Copy, Deck, Approval paper; flat radial gradient, no shader. Step text only as "Step N of M" when given. Sizes 60 (status card), 32 (avatar), 34 (stage rows, optional, skip unless asked). Ring colours as CSS tokens `--ring-*` defined in all three token blocks (light, dark, OS-dark), because a page test (`deckMaker.test.ts` l.132) forbids raw hex in CSS; hex inside the JS SVG strings is allowed. Animation only under `@media (prefers-reduced-motion:no-preference)`; the global kill rule at A l.198 stays. `render()` (l.1121) rewrites `#app.innerHTML`, so animations restart on each state change; acceptable, never re-render on keystrokes.

## 5. Must keep (the Map board)

- Ids and data attributes: `#approve`, `#build`, `#confirm`, `#supply`, `data-edit="beats"`, `data-retry`, `data-go`, `data-tab`, `data-slide`, `data-change`, `data-act="appendix"`, `data-pres`, `data-export`, `data-supply`, `data-confirm`, `data-verify`, `data-confirm-count`, `data-to-supply`, `data-sourced`, `data-built-from`, `data-up-changed`, `data-qtext`, `data-qskip`, `qt_<id>`, `ptext`, `client`, `project`, `agency`, `#app`, `#toast role=status`.
- Classes: `.stage`, `.ring.done/.now/.failed`, `.build` grid, `.dex`, `.beat`, `.thumb`, `.fmt`.
- Functions (exported names of `DeckLogic`, typed in `deckMaker.test.ts` l.20-45): `approveGate` (l.271: refuses a non-open gate; returns `{state:'building', gate:null, approvals}`), `gateHolds` (l.289), `toSupply` (667), `confirmList` (692), `verifyPatch`, `sourcedCounts` (719), `presented`, `statusOf`, `checksFor`; page: `screenOf`, `put` (756, sole writer, `clan.patchData`), `d()` (769, defaults `run`), `bar`, `builtLine` (819), `render` focus restore (l.1123), click dispatch (l.1215-1240, every control must be a `<button>` with a `data-*`).
- Script id `deck-logic`; `MARK` 24px top-bar mark and its four hex fills (test l.158); one `</body>`; two `<textarea>`; no `/Needed/`.
- `put()` decision strings `approve <id>` and rationale `gate n of of approved`; writes only `intake.answers`, `intake.verified`, `change_requests`, `run`.
- Gate-1 markup stays byte-identical (tests render it).
- Everything works with `exports` absent, `appendix_count` only, `run.agent` absent, `gate.checks` absent (guard `gate.checks.map`).

## 6. Test and CI plan

- CI: `scripts/check.sh --only frontend` (lint, `npm test`, `npm run build` in `app/`; ci.yml frontend job l.62-90) plus `--only rust` once for the packer (`crates/clan-sdk/tests/spinoff.rs` l.781; bump version 0.2.0 -> 0.3.0 in `make_deck_maker.rs` l.127 and the assert). Run `cd app && npm run apps` after each phase. `app/node_modules` is absent here: `npm ci` first.
- Add to `app/tests/deckMaker.test.ts` (stub-DOM `mount()` l.256, no browser): per fixture, assert rendered HTML (status card first, `role="img"` and aria-label with state word, content box states, gate 2 has 3 rows and one marked first pick, gate 3 buttons, failed shows retry, done shows "Open the deck", review-ready shows "Approve the deck", export rows ready/disabled, Animated always disabled). Logic: `agentState` table, `approveGate` with choice, `decisionPatch`, `checkedFor`, `exportRows` (absent, `true`, object), `reportLine`, `appendixOf`, `screenOf(failed)`.
- Guards: no `\d\s?%` and no time range (`\d+\s?(min|sec|hours?)`) in the rendered HTML of every fixture; reduced-motion block present; every button class has min-height >= 44px; contrast function over the token block (>= 4.5 text, >= 3 rings), light and dark; every fixture and `example/data.yaml` valid against `schema.json` (hand-check required keys if no validator exists; no new dependency); the current example renders unchanged.
- Manual (not CI; Playwright is not an app dependency): serve `A` with `?state=`, screenshot each of the 22 at 1440 and 390, light and dark, reduced motion emulated, against the `.dc.html` frames and `deck-ui/now3`, `now4`, `now5`. Mobile rule at l.196 collapses `.build` under 1100px: keep.
- Rollout: unlisted, nothing in `infra/`, revert the PR to roll back.

## 7. Risks and open questions (owner and Shrey)

1. Circle placement conflict (see end): centre area with 144px (CHANGES.md) or the 60px card with a content box (requirement R1/R2). Plan follows the requirement; the box is cheap to drop.
2. Top-bar `MARK` (l.789, 802) does not spin and is the brand logo: keep (CHANGES.md agrees). Only `MARK_SPIN` goes.
3. Flat vector instead of the shader: confirm with Shrey. A shader would need a second file or ~1000 inline lines.
4. Dex or agent name next to the circle (Shrey's open item); `label` stays overridable.
5. Edit and Ask Dex on every gate have no spec: toast plus `gate_requests` write only; the engine cannot act on them. `data-retry` today only toasts.
6. Gates: engine has no gates (`run_deck.py`), and `features/deck-maker-server.clan` declares gates storyline, territories, review, not idea. This UI needs storyline, territories, idea. Reconcile with the server owner.
7. Designs show things the engine and app cannot supply today: execution "30S" duration and one-line summary, "To confirm" chip, "Mandatories 0 of 3 met", budget lines, per-territory "Why it fits" (only `why` and judge `reasons`), territory `blind_pick` (derive from `ranking.order[0]`; do not show `chosen_by` text), "taking longer than usual" (needs a server flag; no client timer), step index and total, hand-off pairing, item-level progress, deck-level approval and an Approval stage (none exists), appendix slide ids (engine writes a count only), export file names and URLs, a host actor name for attribution (today the literal `'You'`, l.1227).
8. Display stage ids (`inputs, scans, storyline...`) differ from engine ids (`a0,a,b,c,d,i,fit,e`): the server must emit display ids or ship the map.
9. The server design says the app writes only the decision; today `approveGate` writes the whole `run` (l.1227-1229). Keep optimistic until the server lands; avoid both writing `approvals`.
10. Approve the deck with open "to supply" items: allowed with counts shown (assumed from R16); needs a ruling. Confirm list removed from Present is a behaviour change.
11. Contrast: #B87100 and #7A5AF8 thin strokes are under 3:1 on some surfaces; state is always also text; tune tokens with Shrey (he marked the fixed colours CHANGE).
12. Targets: `.btn.sm`, `.thumb`, `.pill` controls are below 44px: audit.
13. The missing screens are drawn in the Circle look; building in the app's own look (assumed) needs owner confirmation.
14. Reference geometry lives in /tmp/_sr: copy into the repo first. Do not touch `.claude/worktrees/prompt-signoff`.

## 8. Effort (one engineer plus agents)

| Phase | Effort |
|---|---|
| 0 prep, fixtures, loader | 1 day |
| 1 circle swap | 1.5 days |
| 2 running states | 3 days |
| 3 gates 2 and 3 | 3 days |
| 4 review, present, export | 2 days |
| Test, contrast, screenshots, a11y pass (spread) | 2 days |
| Total | about 12.5 days (2.5 weeks), matches the design's 2 to 3 weeks. Phase 5 not estimated. |

Real data for phases 2 to 4 depends on `features/deck-maker-server.clan`; until then fixtures drive everything.

## 9. Phase 6: the status circle grows in place

While an agent works or the run waits (work, write, think, read, check, handoff, waiting, so also slow and Waiting for the engine) the status card's circle is 130px and the card is a column; at a gate (Needs you), on failure and when done it is 60px in a row. `DeckLogic.circleSizeFor(state)` decides (130 or 60); `circleSays(who)` gives the three honest lines (who it is, what it is doing or why nothing runs, that it grows and shrinks). The enlarged circle sits in a `<button data-orb class="orbb">` whose aria-label says the agent and the state once (the svg inside is aria-hidden); pressing it (click, Enter or Space) shows the next line in `[data-say]`, four presses inside 1.1s get the shrug. Pointer hover, press ripple and drag turn come from the Orbs engine; `Orbs.kick` gives a keyboard press the same ripple.

- Growth: `render()` records the card's height and the circle's size and place first (`cardBefore`), then `growCard` plays the change: the circle scales from where it was (FLIP, no travel), the card height follows, the text fades in, 300 ms `cubic-bezier(.2,.8,.2,1)`. The content box and the other columns do not move. Under `prefers-reduced-motion: reduce` there is no size animation: the size is instant with a 200 ms cross-fade.
- Slot key: `Orbs.scan` keys a circle by where it lives (`dex`, `dstat`, `status`), never by size (only an unnamed place also uses width), and `upgrade` resizes the same circle when the width changes, so the ring, turn and a pour in progress survive growing and shrinking. The gate's waiting card (aside.stack) shares the `status` slot.
- Markup: `statusCard` and the new `waitingCard` use `.srow` + `.slot` + `.stext`; the enlarged card adds `.hero`. The gate card ("Waiting for you") and gate 1 are byte-identical to before. No time and no percentage are shown anywhere, including the waiting prompt.
- Flat fallback: `circleSvg` scales to any size (viewBox fixed), so without WebGL the 130px flat circle and the button still work.
