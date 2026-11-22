# Contract: the Territories document

`ie.napkin.territories`. Feature `territories-contract` (wave 1). Every other Territories feature reads or writes this
document, so the shape is written once, here and in one schema, before the engine or the screens exist.

| What | Where |
|---|---|
| The schema (draft-07, closed: unknown members are refused) | `app/templates/territories/schema.json` |
| The additive-only lock | `app/templates/territories/schema.lock.json` |
| The validator every feature calls | `engine/territory/contract.py` |
| The fixtures (fictional: Linea, a weekend return by rail in Ireland) | `app/templates/territories/example/` |
| The fixture builder | `engine/territory/example_build.py` |
| The contract test | `engine/territory/tests/test_contract.py` (engine suite) |
| The CLI conformance case | `test-sandbox/pipeline/conformance.mjs`, T25a and T25b |

## 1. Where it runs

Territories runs **inside the middleware**, like Brief and Research (owner, 2026-11-23). Middleware task handlers
(`server/napkin/handlers`) call `engine/territory` in-process. There is no engine server, no sidecar and no routes of
its own. The document is the only state: a run's stage, its gates and its answers live in `data.run`, so a job that dies
resumes from the document, and the app reads the same document through the host. The middleware image must carry
`app/templates/territories/schema.json` (or set `NAPKIN_TERRITORIES_TEMPLATE` to where it was copied).

## 2. The flow it carries

Three steps, three decisions (the owner's demo):

1. **Pick** (`run.gate.id = pick`). The brief and research arrive read. `focus.insights` are ranked by evidence strength with the top ones
   `ticked`. A person ticks or adds insights and approves.
2. **Explore** (`run.stage = explore`, no gate). The crew (`crew`) goes out, one trail each (`expeditions`), landing `territories` (routes) at a
   measured `distance`. The Review agent fixes the spread itself (`actions`, each with Undo) and records `spread`. Steering is optional.
3. **Greenlight** (`run.gate.id = greenlight`). Every route is `developed` (a world, checks, marks, a blind rank). A person greenlights as many as
   are worth making (`greenlit`) and sends them (`sends`). Routes not chosen travel too.

## 3. Members of `shared/data.yaml`

Writers: **person** (the app, on a click), **engine** (`engine/territory`, through a middleware handler), **host** (the spin-off, the host's
validation). Readers: **view** (the Territories app), **Deck** (Deck Maker), **Production** (the production tool), **share** (the client review share).
`*` = required. Every member is additive-only (section 6).

| Member | Written by | Read by | What |
|---|---|---|---|
| `schema_version`* | engine | all | `1`. Bumped only for a break, which section 6 forbids until v2 |
| `title`* | engine | view, Deck | Project title |
| `upstream.<doc id>` | host (spin-off) | engine, view | The brief and the research, frozen whole. Read-only for everyone else. Brief fields are bare values (`insight`, `smp`, ...) |
| `projection` | host (spin-off) | view | The carried research's pins, findings and sources as the host reads them, built at spin-off from the merged members (`projection.pins`, `.findings`, `.sources`, `.built_from`). Read-only for everyone. The screen counts from it; the engine reads the members. Added by `territories-spinoff-in` (additive) |
| `finds[]` | engine (look-up), person (keeps it) | view, Deck | The tool's own finds, `x_` ids. Separate from research pins; never written back to Research |
| `focus.sources[]`* | engine, person | view | `{id (a cite), in_play}`: in or out of play. By id only, no value is copied |
| `focus.insights[]`* | engine, person | view, engine | `{id in_*, kind, text, evidence[], strength, ticked, by, rank?, derived?}`. At most 25 |
| `journey[]` | engine | view | The weekend journey's stops: `{key touchpoint, day, where}` (later fed from the media plan) |
| `crew[]`* | engine, person (adds one) | view | `{id cr_*, direction, role, name, short, heading, angle, colour?}`. At most 8 |
| `expeditions[]`* | engine | view | One trail per crew member per run: `{id ex_*, crew, state, insights[], way[], turn, routes[] (at most 4), steer[]}`. `way[]` is what it picked up, each with a `cite` |
| `territories[]`* | engine, person (vote, park, kill, lead line, dial) | view, Deck, Production, share | Routes, at most 32. See section 4 |
| `spread` | engine (Review) | view | `{threshold, close[], gaps[]}` |
| `greenlit[]`* | person | view, Deck, Production | `{territory_id, by, at, rests_on_derived[], derived_resolution, note?, sensitive_review?}` |
| `asks[]` | engine, person (answers) | view | The Booth's questions: only for derived evidence at greenlight, near a mandatory, or a sensitive review |
| `actions[]` | engine | view | What the engine did by itself, each with Undo (`undone`) |
| `lookups[]` | engine | view | Look-ups through the research port: `{id lq_*, q, status, found[]}`. Counts only; no price |
| `notes[]` | engine | view | Notes on the record, shown in the Booth |
| `sends[]` | person | Deck, Production | `{id snd_*, to deck-maker or production-tool, territory_ids[], not_chosen[], by, at, status}`. `not_built` until production-spinoff merges |
| `review.sensitive` | person | view | `{required, status not_needed or missing or done}`. Safe-messaging categories only |
| `run`* | engine (state, stages, gate, agent, calls, error, done), person (approvals, decisions, gate_requests) | view | Mirrors `deck-maker`'s run block, so gates behave the same. `calls` is counts only. **No cost member**: costs are for the Napkin team, never the product (Sai, 2026-11-19) and prices live only in the decision history |

Landscape and whitespace are not here (non-goal); `territories-landscape` adds `landscape.yaml` additively.

### 3.0 A document just spun off

Continue in, Territories (`territories-spinoff-in`) carries the Brief or Research document **whole** (os-layer 5.1: its data, frozen under `upstream.<doc id>`;
its decisions in the chain; the pins, findings and sources merged into this document's members; its assets), with the spin-off declared by
`crates/clan-sdk/examples/make_territories.rs` (`accepts` Brief Maker and Research Tool, `upstream: true`, no map, no lift). Research brought through a brief
is hoisted beside it: both sit under `upstream`. Hosts start a document from `{}`, so a document just spun off holds **only `upstream` and `projection`**.
It does not validate yet (the engine's members are required) and does not need to: the engine's first write adds `schema_version`, `title`, `focus`, `crew`,
`expeditions`, `territories`, `greenlit` and `run` in one patch, and every document after that passes the whole contract. A spin-off carries no `run`, so no gate
is open and none is passed: `run.approvals` starts empty, however often the same source is carried. Brief alone, research alone, or neither all start the same way.

`engine/territory/carried.py` is the ONE reading of what arrived (`read` for the screen, `engine_input` for the engine); the page's counts are tested equal to it over
`example/spunoff/` (the document the host produced for a real spin-off, written by `crates/napkin-host/tests/territories_spinoff.rs`).

### 3.1 Citing, never copying (LESSONS 7)

A claim names its source by id and never copies the value. The grammar (`definitions.cite`):

- `brief:<field>`: reads `data.upstream.<brief doc id>.<field>`, where `<field>` is one of the contract's brief fields. A real Brief Maker document keeps three of them under its own key (`smp` is `single_minded_proposition`, `tone_world_assets` is `tone_and_world`, `budget_scope` is `budget_and_scope`): `carried.BRIEF_KEYS` maps them (equal to `engine/deck/inputs.py` CLAN_FIELDS, by test) and `contract.known_cites` reads both, so a cite resolves against a real brief and against a fixture.
- `f_XXXXXX`: a research pin, `fi_XXXXXX`: a research finding. Both read the carried `facts` and `findings` members (ids match
  `campaign-research/facts.schema.json` and `findings.schema.json`).
- `x_XXXXXX`: one of the document's own `finds`.

`contract.check(doc, facts=, findings=)` proves every cite resolves, so an upstream field that does not arrive fails a test instead of showing
"No research brought in".

## 4. A route (`territories[]`)

A superset of Deck Maker's stage-d card: `id name thought why mood references risks sketch` are all required, so a pick lands in Gate 2 without
translation. `engine/territory/cards.py card()` keys all carry over by name, with one change: develop's blind `score` is stored as `blind`
(`{total, of: 35, by_dimension, advisory}`) beside the person-facing `rank` (the judge's order; the person sees only the rank).

| Member | Notes |
|---|---|
| `tier` | Judged risk: `safe`, `stretch`, `brave` (`ladder.TIERS`). Stored, not shown by default |
| `band`, `distance` | Measured distance from the brief, 0 to 1. `band` is shown as Core / Stretch / Far out and **must equal `contract.band_of(distance)`** (core under 0.35, stretch under 0.65, far_out from 0.65) |
| `crew`, `origin` | The crew member that found it; `origin.kind` is `crew`, `further`, `pull`, `cross` or `person` |
| `state` | `found` (a thought) or `developed` (adds `world`, `checks`, `marks`, `pictures`: required by the schema) |
| `status` | `live`, `parked`, `killed`. A killed route carries `kill_reason` (required) |
| `evidence[]` | Cites. Empty means unproven and is shown so |
| `marks` | `{fit, ownable, risk}`, 1 to 5: the three chips at greenlight |
| `world` | `palette` (ink on bg at least 4.5 to 1), `type` (`newsreader` or `geist_extra_bold` only), `headlines` (four corners of the tone and energy dial), `lines` (at most 16), `tv`, `radio`, `social`, `seat`, `crm`, `music`, `sonic`, `refs`, `not`, `scenes`, `dial`, `dial_set?`, `lead?`, `starred[]`. Only this block is read by the touchpoint templates |
| `checks[]` | `{id ck_*, kind proposition or mandatory or landscape or evidence or judge or contrast or rival, status ok or warn or fail or unchecked, text, cite[]}` |
| `pictures[]` | One slot per pictured place. v1 draws `sketch` slots from the palette (`scene` required). `frame` needs `image`, `sha256` and `rights`; `gap` needs `gap_reason` (an honest gap, never the key visual reused). The same hash may not fill two slots |
| `proof_cases[]`, `frames[]`, `visual`, `assumes[]`, `ready`, `vote`, `tension` | Carried from `cards.py`; `frames` is reserved for `territories-pictures-frames` |

## 5. Gates and blocked states (LESSONS 11)

`run.gate` is `null` or `{id: pick|greenlight, n, of, dex, checks[], blocked_by[], agent}`. `blocked_by[]` says in words why the gate cannot
be passed: `nothing_picked`, `no_routes`, `derived_evidence`, `near_mandatory`, `sensitive_review`. The contract refuses (a) a gate that is blocked
without saying so, (b) a `sent` send while a greenlit route's `rests_on_derived` is unresolved (`derived_resolution: pending`) and (c) a `sent` send
while a required sensitive review is not `done`. Every blocked state is a fixture (section 8), so the engine's hold logic
(`territories-gates`) tests against the exact documents the app will see.

`derived_resolution`: `verified` when the route rests on no derived finding or the person verified it, `sent_flagged` when they chose to send
it flagged, `pending` until they answer. `rests_on_derived` must list every `proposed` finding the route cites.

### 5.1 The gate machine (`engine/territory/gates.py`, feature `territories-gates`)

One pure module serves the middleware handler, replay and the tests; its state is the document (`data.run`, `greenlit`, `asks`, `review`) and nothing
in a server's memory. `approvals.<gate>`, `decisions[]` and `review.sensitive` carry an optional `inputs` (12 hex chars, `gates.inputs_hash`): what the
person was looking at. An approval or review counts only while it equals the current hash, so one given for other inputs passes nothing, and a new
Approve always replaces an old one (an edit never disables it).

| Call | For |
|---|---|
| `evaluate(doc, findings=)` | The screen: `gate`, `blocked_by`, `can_approve`, `can_approve_with_reason` (greenlighting nothing), `approval {valid, stale, words}`, open `asks`, `sensitive`, `inputs`, `checks`, `words`, `next` |
| `next_step(doc)` | `{do: open_gate/hold/run/finish/failed/idle, stage, gate, words}` |
| `approve`, `greenlight_route`, `remove_route`, `answer_ask`, `record_review`, `request`, `settle_requests` | The person's moves (`remove_route` takes a route off the greenlit list, drops its asks and refreshes the open gate): `(doc, refusals in words)`; a request is answered with what was done or why not |
| `open_gate`, `sync_asks`, `drive(doc, stages)` | The engine: write the gate and its asks; run stages only when `next_step` says run, stopping in words (`run.error`) on a missing stage, the cap or an error |

Defaults taken: the sensitive review is a named person's (never `engine`), done after greenlighting, void when the greenlight inputs change; greenlighting
nothing is allowed with a reason and sends nothing; pressing Explore is the pick approval, recorded as a decision with the ticked insights' hash.

### 5.2 The crew (`engine/territory/routes.py`, feature `territories-engine-routes`)

Explore is `routes.explore(doc, llm, facts=, findings=)`, the `explore` entry of `gates.drive` (`routes.stage(llm, ...)`). It refuses to run unless
`gates.next_step` says run Explore (`routes.NotReady`, in words). It writes `crew`, `expeditions`, `territories` (state `found`), `spread` and `actions`
in one go, or `run.error` in words with the document otherwise untouched (a retry re-pays nothing that finished: one stage per heading,
`route_<direction>`, keyed by its message).

| Part | What it does |
|---|---|
| Headings | Five in parallel (`routes.CREW`; a document's own `crew` wins). Each is sent the ticked insights it begins from (`start_from`: the picks dealt round the crew), every in-play source, and the OTHER headings' remit as `avoid` (a re-run also gets what the others brought back). 2 to 3 routes each (never above 4 per trail, 16 live in all) |
| What the code owns | `cites` only in-play ids (a pick named in cites stands for its sources; a route with no cite, or an id not in play, is refused and listed in `info["dropped"]`; a heading with every route refused is asked once more); the words within the schema lengths; ids (`contract.mint`); `band` from `distance` (`contract.band_of`); a route resting on an unchecked finding says so in its `risks` |
| Checks on every route | develop's `pipeline._kill` (crew wording `prompts/kill_crew.md`: not killed for going where its heading sent it; killed routes stay with `kill_reason`), develop's sort (`tier`, idea group) and ONE blind `distance` rating, in parallel |
| The spread | `spread.close`: pairs of live routes under `CONFIG.threshold` (same idea group, or word overlap); `spread.gaps`: a distance band with no live route, or a bearing wider than `CONFIG.arc` with no member that came back |
| Review fixes | At most `CONFIG.max_pair_fixes` close pairs rewritten outward and `CONFIG.max_gap_agents` agent sent into a gap, each an `actions[]` entry (`agent: review`). `spread_fix`: `territory_ids = [moved route, its replacement, the route it was too close to]`; the moved route is **parked**, never deleted. `sent_agent`: `territory_ids` = the routes the new `custom` crew member brought back |
| `routes.undo(doc, action_id, by)` | No model call. `spread_fix`: replacement goes, original is live again. `sent_agent`: crew member, trail and routes go. The action stays, `undone: true`. A later steer does not fix an undone pair again |
| `routes.steer(doc, llm, crew_id, kind, by, with_=)` | `further`, `pull`, `cross` (needs `with_`), `stop`. Re-runs ONLY that heading: its found routes are replaced, a developed one is parked. The instruction is in `expeditions[].steer`; `routes.steer_decision` is the history entry. `(doc, refusals in words)` |
| Theme | `territory.theme` and `insight.theme` (optional, 1 to 40 characters): the idea group in a few words, the chip under a card. Routes take develop's sort group (`routes.themed`); insights take the model's own words (`insights.theme_of`). Absent when there is none, never an id |
| Cost | About 11 calls (5 headings, kill, sort, distance, up to 3 repair calls and the two checks on what they made), about USD 0.45 to 0.60 on a real brief at the 2026-11-23 prices. Prices stay in the history, never in the document |

Dev harness: `python -m territory.routes --doc <pick state> --facts f.json --findings fi.json [--live] [--baseline]`; `routes.cards(doc, 3)` feeds
`compare.blind_pack` against `compare.baseline`.

### 5.3 The worlds (`engine/territory/world.py`, feature `territories-engine-develop`)

Develop is `world.develop_ex(doc, llm, facts=, findings=)`, the `develop` entry of `gates.drive` (`world.stage(llm, ...)`). It refuses to run unless
`gates.next_step` says run Develop (`routes.NotReady`, in words). It develops every **live** route that is still a thought (`state: found`; parked and
killed routes are left alone) into `state: developed` with `world`, `checks`, `marks`, `pictures`, `blind` and `rank`, sets `journey` (the weekend's six
stops) if absent, and returns `(doc, info)`; or the same document with `run.error` in words. Stage names live in `llm.STAGE_MODEL` (`world`,
`world_checks`, `judge`, `world_more`); prompts are in `engine/territory/prompts/`.

| Part | What it does |
|---|---|
| Writing | `world` stage: one call per batch of 4 routes (batches at once), never per touchpoint, then ONE more call for every route whose world was refused, naming why. Each route has a `palette_lean` (a starting hue and light/dark, spread by the golden angle) so routes written in parallel look different; `info["palette_clash"]` lists pairs that still look alike |
| What the code owns | Words and characters per field (`world.CONFIG`: a headline 14 words, a line 12, a TV frame 30, ...); at most 12 lines kept (the schema holds 16); markdown stripped; text with `(to confirm)`, `TBC`, a bare `SUPER`, brackets, snake_case keys, `derived`, internal ids or a Confidential part is refused (a list item is dropped, a headline refuses the world); ink moved until it reads at 4.5 to 1 (`readable_ink`); font held to `newsreader` / `geist_extra_bold`; scenes and radio voices held to their lists |
| Checks (`checks[]`) | In order: `proposition`, `mandatory`, `rival` (ONE `world_checks` call for all routes; a verdict that did not come back is `unchecked`, never `ok`; `unchecked` is also what a brief with no proposition or no mandatories gets, in words), `evidence` (code: `warn` when a cited finding is derived or the words state a price or percentage the brief and research do not), `contrast` (code), `landscape` (a safety pack's watch words, `warn`), `judge` (the rank). At most 8 |
| The blind judge | ONE `judge` call on a second model (Sonnet, the writer is Opus). It is sent the brief, and per route under a shuffled letter: the thought, the tension, the evidence in words and the words of the world. Never a name, tier, band, distance, heading or id. An incomplete score gets one more call; a route never fully scored has no `blind` (nothing is made up). `blind` is the /35 score (stored), `rank` the judge's order (shown; `world.show`), `tier` stays the sort step's judged tier |
| Marks | `fit` and `ownable` are the judge's scores for them (else the checker's verdicts); `risk` is `world.risk_mark`: the judged tier, plus one for a derived finding, plus one for a mandatory under strain |
| Pictures | One `sketch` slot per TV frame and one each for the story, poster, table card and email, from the palette (`scene` matches `world.scenes`) |
| Safety packs | `engine/deck/packs/*.yaml` are read when the brief or research names a pack's trigger (`world.packs_for`, no YAML parser: the middleware image stays light; `NAPKIN_TERRITORY_PACKS` points elsewhere). A banned phrase or banned imagery refuses the world; watch words go in the route's `risks` and a `landscape` check; `review.sensitive` is set `{required: true, status: missing}` (never `done`: a named person does that, `gates.record_review`). **The packs folder must be in the middleware image**: if none is found Develop refuses (`retryable: false`) rather than run without the rules |
| `world.more(doc, llm, id, by)` | "Write more like this": one call, `world.lines` grows by up to 6 (never above 16), nothing else changes |
| `world.push(doc, llm, id, by, instruction=)` | Writes ONE route's world again from its current one, runs its judged checks again and the judge again over the whole set (a rank is relative): 3 calls. `starred`, `lead` and `dial_set` (a person's) stay |
| Cost | About 4 calls for 6 routes (2 batches, checks, judge; a fifth if the judge left a score empty), about USD 0.45 on a real brief at the 2026-11-23 prices; about 7 calls for 16 routes. Prices stay in the history, never in the document |

Dials need no model: `headlines` holds the four corners, `lines` the rest, `dial` the natural position. Dev harness:
`python -m territory.world --doc <result or data.json> --facts f.json --findings fi.json [--keep N] [--live]`.

## 6. Additive only

- A new member is **optional**. A member is never removed or retyped, an enum value is never dropped, nothing newly becomes required.
- `schema.lock.json` records every member path with its type and every enum value. `contract.lock_problems()` (and the test) fail on a break.
  After an additive change: `cd engine && PYTHONPATH=. python -m territory.contract lock`, and commit the new lock with the schema.
- Enums, id patterns and limits live **only** in `schema.json`. The engine reads them (`contract.enum`, `contract.pattern`, `contract.limit`); a test
  fails if `ladder.TIERS`, `ladder.SCORE_DIMS`, Brief's `BRIEF_FIELDS` or the agent roles drift from them.
- Length discipline (LESSONS 16) is a schema maximum: 25 insights, 8 crew, 4 routes per trail, 32 routes, 16 lines per world. The engine clamps
  to `contract.limit(...)` **before** it writes; the host refuses a list over its maximum. "About 5 routes per heading" is the engine's target.

## 7. Using the contract

```python
from territory import contract

contract.validate(doc)                               # raises ContractError; .words is the list of refusals in words
problems = contract.check(doc, facts=f, findings=fi)   # schema + cites resolve + bands + gates + text leaks + prices
contract.validate_shape("territory", card)           # one emitted shape (insight, expedition, crew_member, territory, world, check,
contract.validate_all("insight", insights)           #   picture, greenlit, ask, action, lookup, note, send, find, journey, spread, run)
contract.enum("band"); contract.limit("territories"); contract.pattern("id_territory"); contract.band_of(0.4)
contract.mint("territory", "<stable seed>")          # deterministic ids: a resumed run never re-mints
contract.refusal_error(problems, "develop")          # the host's refusal as run.error, in words, retryable
contract.example("data") / contract.example("greenlight_derived_pending")   # fixtures
```

The engine calls `validate_shape` on each piece as it makes it and `check` on the whole before writing. A refusal is carried into `run.error`
(`state: failed`, `retryable`, `refused[]` in words) and shown to the person; it is never dropped and never retried silently.

Text that must never reach a person fails `lint`: `(to confirm)`, `~~`, `**`, `{{ }}`, `field is null`, a bare `None` or `null`, a leading `# `.
No member name or key matching `cost`, `price`, `usd`, `eur`, `spend` may appear anywhere outside `upstream`.

## 8. Fixtures

All fictional (Linea, Galway line). `example_build.py` writes them; the test fails if the committed files differ from its output.

| Path | State |
|---|---|
| `example/data.json` | The finished run: 5 crew, 11 routes (8 developed, 2 found, 1 killed), 3 greenlit, sent to Deck Studio, Production hand-off `not_built` |
| `example/facts.json`, `example/findings.json` | The carried research members (valid against the campaign-research schemas); three findings are derived (`proposed`) |
| `example/spunoff/data.json`, `facts.json`, `findings.json`, `seen.json` | A real spin-off (research to brief to Territories) as the host produced it, and what the reader and the page make of it |
| `example/states/pick.json` | Step 1 open |
| `example/states/explore_running.json` | The crew out, routes landing |
| `example/states/explore_back.json` | Every trail home; the Review agent's two fixes are real, undoable actions (the parked first version is in the document) |
| `example/states/greenlight_open.json` | Gate open, nothing greenlit (`nothing_picked`) |
| `example/states/greenlight_derived_pending.json` | A greenlit route rests on an unverified derived finding; the ask is open |
| `example/states/greenlight_sensitive_missing.json` | Sensitive review required and missing |
| `example/states/failed_refused.json` | The host refused an engine reply; `run.error` in words (an over-long list, an unknown id) |

## 9. Demo constants to members

| Demo (`prototype.html`) | Member |
|---|---|
| `BRIEF.fields` `brief:smp` | `upstream.<brief id>.smp`, cited `brief:smp` (`brief:tone` is `brief:tone_world_assets`) |
| `SRC` pins `f_0412` and findings `fi_03` | `f_` and `fi_` ids with real 6+ character A-Z0-9 tails |
| `SRC` `x_01..x_09` | `finds[]`, `id_find` |
| springboards, insights | `focus.insights[]` |
| `EXPS` (`k, role, name, brief, ang, col`) | `crew[]` (`id, direction, role, name, heading, angle, colour`) |
| `EXPS[].way, turn, finds` | `expeditions[].way, turn, routes` |
| `TERR` `t.sc`, `t.judge` | `marks`, `rank` |
| `TERR` `H, extra, more, tv, radio, social, seat, crm, music, sonic, refs, not, dial, P, font, fw, fs` | `world.*` |
| `JOURNEY`, `TPN` | `journey[]`, `definitions.touchpoint` |
| `HIST`, Booth notes | `notes[]`, `actions[]`, `asks[]` |
| the Booth's spend text | nothing: prices stay out of the document (`run.calls` holds counts) |

## 10. Defaults taken (owner may override)

From `territories-contract`'s open questions, defaults in force: `tier` (judged) and `band` (measured) are separate fields; both scores are stored,
only the rank is shown; ceilings are 5 headings by up to 4 routes plus the planner's own and one added (8 crew, 32 routes) and 25 insights.
