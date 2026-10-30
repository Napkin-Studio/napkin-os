# Middleware API — `napkin.middleware/1`

Status: **binding** for the host, the templates, the stand-in middleware and the
real one. Reads with: `docs/contracts/campaign-clan.md` (Contract 3 — what a
`change` may contain), `docs/contracts/os-layer.md` (Contract 4 — decisions,
addresses, M3/M4), `docs/contracts/peripherals.md` (Contract 5 — the
model, research, retrieval and layers ports behind the middleware).

The one HTTP contract between the Napkin host and the middleware. The host and
the templates depend on this document only — never on an implementation.

**The swap guarantee.** Two implementations exist: the dependency-free stand-in
in `mock-middleware/`, and the FastAPI middleware in `server/`. Both must pass
`mock-middleware/contract_test.py` **unchanged**. The suite names no
implementation, no port and no backend; if the real middleware needs the suite
edited to pass, the middleware is wrong or this contract is, and the fix is
made here first. Moving from one to the other is changing one value, the
`middleware` endpoint in `workspace.yaml`. No template, host or test code may
name the stand-in, its port, or branch on which implementation answered.

---

## 1. Request — host → middleware

`POST <endpoint>` where `<endpoint>` is `proxies.middleware.endpoint` in
`workspace.yaml` (path `/v1/tasks`). The app sends it through the host's
`clan://api-proxy` with `request_kind: "middleware"`; the host adds auth and the
`clan` context. The app never talks to the middleware directly.

```json
{
  "request_kind": "middleware",
  "payload": { "task": "extract_ask | research_lens | synthesise_findings | start_campaign | answer_question | compose_report | draft_brief | regenerate_field | fix_parts | job_status",
               "input": { "...": "task-specific, below" } },
  "clan": { "id": "<document_id>", "revision": "<manifest id>",
            "version": "<doc version the host holds>",
            "app": { "app_id": "...", "version": "..." },
            "schema": {}, "data": {}, "facts": [], "findings": [], "pipeline": {},
            "decision_chain": {}, "context": "...", "lineage": {},
            "upstream_payload"?: {}, "upstream_skipped"?: [] }
}
```

- `clan.id` is the document's identity — the manifest's `document_id`, which
  every revision carries unchanged (a file written before it existed uses its
  manifest `id`). It is the `<doc-id>` prefix of every address. `clan.revision`
  is the manifest `id` of the revision the host read, fresh on every write;
  informational. `clan.version` is the host's version of the archive (for the
  desktop, `sha256:` of its bytes). `clan.id` is required for every task,
  `clan.version` for every task except `job_status`. `facts` / `findings` are the members' lists (a
  `{facts: [...]}` / `{findings: [...]}` object is also accepted);
  `decision_chain` is `{decisions: [...]}`; `pipeline` is the parsed
  `app/pipeline.yaml`. The host sends the whole `clan` — the document as it
  holds it now — on **every** request, `job_status` included: a
  `start_campaign` job reads it on each poll (§8.4).
- **Upstream is sent as an index** (2026-09-29). A spun-off document holds
  its parent's data frozen at `data.upstream.<id>` (Contract 4 §5), often
  larger than the document itself. The host replaces it in `clan.data` with

  ```json
  "upstream": { "<id>": { "direct": true, "keys": ["campaign", "selection", "materials", "intake", "report"],
                          "open_contests": [{ "id": "ct_…", "key": "…", "fact_ids": ["f_…", "f_…"] }] } }
  ```

  one entry per key: `direct` whether it is `lineage.carried.document_id`,
  `keys` the frozen copy's top-level keys, `open_contests` its
  `selection.contested` entries still `open` and not resolved in the chain
  (Contract 4 §7.2), each with the `fact_id` of every value.
  The carried pins and findings are not here: they are merged into the
  document's own members and arrive in `clan.facts` and `clan.findings`. The
  frozen data reaches a model only as §10.13 says. `upstream` is read-only:
  a `data_patch` that names it is refused (Contract 4 §8.1).
- **`upstream_payload`** (2026-09-30): the research a brief carries, as Sai's
  brief engine takes it — exactly the engine's `upstream` object,
  `{brand?, category?, competitors, facts, decisions}` — printed by the
  extract's `upstream` printer (`clan_sdk::extract::upstream`,
  `docs/contracts/clan-extract.md` §1.1, §11.3) from the document's own
  bytes: the frozen copy, the merged members and the carried chain. `facts`
  are ADR 0014's fact rows (`research_facts`), `decisions` ADR 0015's
  decision rows (`research_decisions`): rejected and verified findings,
  resolved and open contests, edits and verdicts with a person's reason, and
  client answers, with people's words verbatim and names from the account
  (a dummy account in the host until accounts exist). A value marked
  `model: false` reads `[Marked confidential]` in both, wherever it appears;
  a corpus-only mark hides nothing here, and the brief's own `model: false`
  marks (`<brief id>#<field>`) are matched too. `category` is the first of
  the research's categories that maps to one of the engine's (the fixed
  table `clan_sdk::extract::CATEGORY_MAP`: `soft_drinks.*` → `food_drink`,
  `alcohol.*` → `alcohol`, …); none maps, it is left out and named in
  `upstream_skipped`.
  - **When.** Sent when the document runs the brief tasks — its pipeline
    declares `draft_brief` or `regenerate_field`, or it is a Brief Maker
    document — and carries research (a `data.upstream` copy holding
    `campaign`, the direct parent first); absent otherwise. It rides every
    request on such a document, as the rest of `clan` does; `draft_brief`
    reads it (§10.14), and a task that does not simply ignores it.
  - **Never a halt.** The printer refuses nothing: what it could not print
    is named in `upstream_skipped`, `[{what, why}]` (an id or member path
    and a fixed reason, never a value), present only when something was
    left out. Its absence is not an error: the brief is drafted without
    research.
  - It is built at the call and never stored, logged or cached by the host.
- **Task → handler.** `payload.task` is resolved against `clan.pipeline.tasks.<task>.handler`
  (`name@major`). When the document carries no pipeline, the middleware's
  declared built-in map is used (`extract_ask@1`, `research_lens@1`,
  `synthesise_findings@1`, `start_campaign@1`, `answer_question@1`,
  `compose_report@1`, `draft_brief@1`, `regenerate_field@1`, `fix_parts@1`).
  A Brief Maker document whose pipeline predates `fix_parts` runs it through
  the built-in handler until it declares it, as `ask_research` and
  `reconsider`. A person's
  review calls no middleware task; the view follows each review with
  `reconsider@2` (Contract 3 §6.4).
  Any other task the pipeline does not declare, an
  unregistered handler, a handler registered for a different task, or a major
  the middleware does not implement is a hard error (M4) — never a
  fall-through to a default. `job_status` is a transport verb and is not
  resolved against the pipeline. `answer_question` **is** resolved (the
  pipeline must declare it), but like `job_status` its reply describes the job
  it answers (§2, Jobs).
- **Scope (org/brand) is never in the request** (M3). The middleware derives it
  from auth. A request that carries `scope`, `tenant`, `org`, `org_id` or
  `tenant_id` at the top level of the body, `payload`, `payload.input` or `clan`
  is refused with `400 invalid_input` — a caller must not be able to widen what
  it reads. In development the tenant is a fixed dev tenant from middleware
  configuration, reported back in `trace.scope`.

### Task inputs

| Task | `input` | Notes |
|---|---|---|
| `extract_ask` | `{ "prompt": "...", "attachments": [{ "name", "sha256", "text"? }] }` | `text` is the host-extracted text. An attachment without it is recorded as unread and grounds nothing. Nothing to read at all is `400 invalid_input` |
| `research_lens` | `{ "lenses"?: [lens ids], "markets"?: [ISO 3166-1 alpha-2] }` | Defaults: all eight lenses × `campaign.markets`. One run per lens × market (N4), merged by entity + key + market. `UK` is not a code (the UK is `GB`). Research with no markets or no categories is `400 invalid_input` (gate `research`) |
| `synthesise_findings` | `{ "lenses"?: [lens ids], "redo"?: "audience" }` | Reads `clan.facts` (pins only). Never proposes a finding the document already holds, a rejected one included, and sends the rejected ones (statement, reason) to the model. `redo: "audience"` proposes `campaign.audience` again without rejected findings, replacing only an audience the agent proposed, and writes nothing else |
| `start_campaign` | `{ "prompt": "...", "attachments": [{ "material_id", "name", "sha256", "text"? }] }` | The chat intake (§8). Long. Each `material_id` must be a key of `clan.data.materials` with that `sha256` (the view indexes the file first). Nothing to read at all is `400 invalid_input`, as for `extract_ask` |
| `answer_question` | `{ "job_id": "...", "question_id": "...", "option_id"?: "...", "text"?: "..." }` | Exactly one of `option_id` / `text` (§8.3) |
| `compose_report` | `{}` | Short. Re-composes `data.report` from the document as it stands (§8.5) |
| `draft_brief` | `{ "prompt"?: "...", "attachments": [{ "name", "sha256", "media_type"?, "asset"?, "text"?, "image"?: { "media_type", "data" } }] }` | Brief Maker (§10). Long. `image` is base64 bytes of a picture attachment (§10.1). Nothing to read at all is `400 invalid_input` |
| `regenerate_field` | `{ "field": "<dotted field key>", "guidance"?: "..." }` | Brief Maker (§10.10). Long. `field` one of the eighteen keys of §10.4 |
| `fix_parts` | `{ "verdict": "<decision id>", "guidance"?: "..." }` | Brief Maker (§10.15). Long. `verdict` a bad verdict still standing on the brief |
| `job_status` | `{ "job_id": "..." }` | Free: never charged to quota (§9) |

Lens ids, in taxonomy order: `market_structure`, `brands_positioning`,
`consumer_culture`, `category_codes`, `rhythm_moments`, `media_spend`,
`regulation_clearance`, `effectiveness_evidence`.

## 2. Response — middleware → host (HTTP 200)

```json
{
  "api": "napkin.middleware/1",
  "task": "research_lens",
  "handler": "research_lens@1.0",
  "job": { "id": "job_...", "state": "queued | running | needs_input | done | failed",
           "progress": { "done": 3, "total": 16 },
           "stage": "research", "question": null,
           "started_at": "...", "finished_at": null, "error": null },
  "result": { "summary": "human-readable one-liner", "...": "task-specific, display only" },
  "change": null,
  "trace": { "scope": { "org": "...", "brand": "..." }, "backend": "...", "model": null,
             "hits": [{ "id": "...", "scope": "...", "source": "..." }],
             "usage": { "input_tokens": 0, "output_tokens": 0 } }
}
```

- `handler` is `name@major.minor` — the form `findings[].derived_by` and
  `selection.lenses_run[].handler` must match (`^[a-z_]+@\d+(\.\d+)?$`). Its
  name and major are the ones the pipeline declared.
- `result` is display only. Nothing in it is written to the document.
  `result.messages` (`start_campaign`, `answer_question`, `compose_report`)
  is `[{ "id": "msg_...", "text": "...", "stage": "..." }]`: the job's chat
  narration so far, in order. Each id is also the key the middleware writes
  that message under in `intake.messages` (§8.2), so the view shows the list
  while the change is in flight and de-duplicates by id once it lands.
- `job.stage` and `job.question` are present on `start_campaign` jobs (and
  the replies of `answer_question`, which describe one), on
  `compose_report` replies (`stage: report`, `question: null`, §8.2), and on
  `draft_brief` and `regenerate_field` jobs (`question: null` always, §10.6);
  other tasks omit them. `job.question` is non-null exactly when `job.state` is
  `needs_input`.
- `trace.usage` is what was actually spent; an implementation that ran no model
  reports zeros and never an estimate. `trace.model` is `null` when no model ran.
  `trace.hits` lists what was read: facts (`scope` = layer, `source` = origin
  URI) or sources (`source` = the source URI).
- A 200 body never has a top-level `error` key.

### Jobs

- **Short tasks** (`extract_ask`, `compose_report`) answer `job.state: done`
  and a `change` in one response.
- **Long tasks** (`research_lens`, `synthesise_findings`, `start_campaign`,
  `draft_brief`, `regenerate_field`)
  answer `job.state: queued | running`; the caller polls `job_status`. A
  `queued`, `running` or `needs_input` reply **may** carry a `change` for work
  finished since the previous reply — `start_campaign` does, stage by stage
  (§8.4), and so does `draft_brief` (§10.9); `research_lens` and `synthesise_findings` send `change: null` until
  `done`. The `done` poll carries the (last) change; later polls of a done job
  return the same change again. **The host applies any reply's `change`,
  whatever the job's state.** Real research runs minutes and must survive the
  laptop closing (N2), so a job outlives the request that started it.
- **`needs_input`** (`start_campaign` only): the job is waiting for the person.
  It carries `job.question` (§8.3) and stays so — polls are free and change
  nothing — until an `answer_question` for it is accepted, or until its wait
  runs out and the job goes on with the question's stated default (§8.3;
  *changed 2026-09-30*: no stage may halt a research job).
- `progress.total` is the number of units of work: for `research_lens`, one per
  lens × market. `progress.done` never goes backwards.
- A `job_status` response describes the job: its `task` and `handler` are the
  job's own (`research_lens`, `research_lens@1.0`) — never `job_status` —
  because the host copies the handler onto the decisions it applies. The same
  holds for `answer_question`: its reply is `task: start_campaign`,
  `handler: start_campaign@1.x`.
- A job belongs to the tenant (from auth) and the document it was started on.
  Polling it from another tenant or another `clan.id` is `404`, the same as an
  id that never existed.
- `failed` carries `job.error: { type, message }`. For the tasks that send no
  staged changes it carries no change; a failed `start_campaign` carries the
  change for any stages finished since the previous reply, plus an agent
  message saying which stage failed. What already landed stays.

## 3. `change`

```json
{
  "doc": "<the clan.id it was computed for — the document_id>",
  "base_version": "<the clan.version it read>",
  "read": { "campaign.problem": { "value": "...", "origin": "stated", "...": "..." },
            "materials.mat_email01": null },
  "data_patch": { "campaign": { "<field>": { "value": "...", "origin": "extracted", "gate": "...",
                                              "source": {}, "decision": "d_..." } },
                  "selection": {}, "materials": {} },
  "facts_append": [ "entries per facts.schema.json" ],
  "findings_append": [ "entries per findings.schema.json" ],
  "findings_update": [ { "id": "fi_...", "confidence": "high | medium | low", "cites": [ "f_..." ],
                         "status": "superseded", "superseded_by": { "finding": "fi_...", "decision": "d_..." },
                         "recheck": { "decision": "d_...", "note": "..." } } ],
  "sources_append": [ { "id": "src_...", "uri": "https://...", "title": "...", "publisher": "...",
                        "published_at": "YYYY-MM-DD | null", "retrieved_at": "YYYY-MM-DD",
                        "tier": "...", "domain": "...", "licence": "open" } ],
  "decisions": [ { "id": "d_...", "kind": "edit | finding | contest | pin | verdict (§10.7)", "agent": "<handler>",
                   "action": "...", "rationale": "...", "targets": ["<doc-id>#<path>"],
                   "cites": ["f_...", "src_...", "mat_..."], "handler": "...", "backend": "...",
                   "timestamp": "...",
                   "reasoning": { "decided": "...", "because": [ { "point": "...", "cites": ["f_..."] } ],
                                  "rejected": [ { "option": "...", "why": "..." } ],
                                  "certainty": { "level": "high | medium | low", "why": "..." },
                                  "would_change_if": "...", "attention": "..." } } ]
}
```

Every change must leave the document valid against the campaign schemas
(`app/templates/campaign-research/{schema,facts.schema,findings.schema}.json`):

- **`read`** is the read-set: for each field the `data_patch` writes, the value
  the job read there, keyed by dotted path into `shared/data.yaml`
  (`campaign.<field>`, `materials.<id>`, `selection.<key>`,
  `intake.messages.<id>`, `report`); a field that was
  absent was read as `null`. Every path the patch sets (every leaf of the
  merge patch — a non-object, `null` included, or an empty object) must lie at
  or under one of its keys. It is what the host judges a stale base by (§4);
  required whenever `data_patch` sets anything, `{}` or absent when it sets
  nothing.
- **`data_patch`** is a JSON merge patch (RFC 7396) over `shared/data.yaml`. It
  never touches `projection` (host-owned). Because a merge patch replaces arrays
  whole, a patch to an array (`selection.lenses_run`, `gaps`, `contested`, a
  list field) carries the full array: what the document held plus this run's
  entries. Objects (`selection.coverage`, `coverage_by_market`, `materials`)
  merge key-wise. The merged data must validate against `schema.json`.
  `intake.messages` is a map for exactly this reason: a patch adds its keys
  and never replaces the person's. `report` is written whole — the patch
  carries the entire object (§8.5).
- **Campaign fields** are envelopes per Contract 3 §2. `extracted` carries a
  `source` span whose `quote` is verbatim in the cited material; `proposed`
  carries `fact_ids` that are pins in the document. A field the material does
  not support is **absent** — the extraction decision lists it in `abstained`.
  `budget_band` is a band, never the figure; its span has no quote. A field
  whose origin is `confirmed` or `stated`, or that carries an unanswered bad
  verdict, is never written (Contract 3 §2.2).
- **Materials.** Spans cite material ids. An attachment is matched to
  `data.materials` by `sha256`; material the document has not indexed yet is
  added to `data_patch.materials` with licence `client-confidential` (the
  strictest class) until a human reclassifies it.
- **`facts_append`**: each entry validates against `facts.schema.json`, and so
  does the document's facts list after the append. Every fact carries sources
  (source ids), confidence **derived** from source tier + corroboration (never
  self-reported), licence (the strictest of its sources), `as_of` (when true) ≤
  `retrieved_at` (when learned), `origin fact://<layer>/<entity path>/<key>@<version>`,
  and the `decision` that pinned it. No two pins share entity + key + market
  with different values. A pin carries `quotes`: for each of its `src_`
  sources, the verbatim passage that source gave for the value.
  *Changed 2026-10-19* (brief-fact-provenance): an entry is one of two kinds.
  A **layer copy** carries `origin` and `version`, as above. A **document
  pin** carries `kept_in_document: {why, measure_proposed}` instead, and no
  `origin` or `version`: a fact research found outside the measure list,
  kept so a brief can cite it, and never written to the layers. It still
  names the `layer` it would belong to, its `src_` sources with their
  `quotes`, its derived confidence, licence, `as_of`, `retrieved_at` and
  `decision`. Its id is deterministic (`f_` + a seeded base32 of the
  document, entity, key, market, value and `as_of`), so a rerun names the
  same pin. One pin per entity + key + market still holds across both
  kinds: an identity the document already pins is not pinned again, and a
  different value for it is a contest note, never a second pin. Only Brief
  Maker writes document pins (the Research Tool does not yet), and only when
  the document's own embedded `facts.schema.json` allows the
  `kept_in_document` branch; on an older brief the fact stays a run-log
  note (§10.13 item 9, §10.16).
- **`sources_append`** (optional): a record for every `src_` source a new pin
  or contest value cites — `id` and `uri` required, with its title, publisher,
  dates, tier, domain and licence — so a citation in the document leads to
  where it was read without a call to the layers. The host keeps the first
  record it is given for an id; a later one for the same id is dropped, never
  a conflict (two lenses citing one page under different titles).
- **Contests.** Two runs disagreeing on one entity + key (+ market) produce a
  `selection.contested` entry, `status: open`, carrying every value with its
  `fact_id`, `from`, `sources` and `quotes`, and a `contest` decision targeting it. None
  of the contested values is pinned — nothing is silently picked.
- **`findings_append`**: each validates against `findings.schema.json`; always
  `status: proposed` (only a human verifies — D1 amended); `derived_by` = the
  response's `handler`; every `cites` id is a pin in the document; confidence is
  the lowest cited confidence, one lower for a single or any stale citation
  (Contract 3 §6.1).
- **`findings_update`** (`reconsider@2`, Contract 3 §6.4): changes an existing
  finding in place. Only `confidence`, `cites`, `status: superseded` with
  `superseded_by` (the finding that replaces it, appended in this change or
  already held), and `recheck` (on a `verified` finding a review re-checked
  and that still holds) may be set; a statement, verification or rejection is
  never changed. A finding a person rejected takes only `confidence`. Each
  updated finding must be in `read` as `findings.<id>`, the whole finding as
  the job read it; one that differs now refuses the change (`409`, rerun).
  An entry the finding already matches is skipped. Applied after
  `findings_append`.
- **`decisions`**: ids `d_…`, kinds from Contract 4, `targets` are
  `<doc-id>#<entity-keyed path>` (never positional), `handler` and `backend`
  equal the response's. Every envelope's and fact's `decision` names one of
  them.
- **`reasoning`** (Contract 4 §3, the shape and its rules). **Required** on
  every decision of kind `pin`, `contest`, `finding` or `verdict`, on every
  `edit` whose action is `propose`, and on whatever the document's app
  declares in its `app/pipeline.yaml` (R1 is app knowledge, so the app
  declares it and the host applies it — Contract 4 §3):

  ```yaml
  reasoning:
    kinds: [...]      # decision kinds required on top of the floor above
    edits: [...]      # dotted data paths: an edit whose targets lie at or under one must say why
  ```

  A declaration the host cannot read refuses the change (M4). The Research
  Tool declares `edits: [campaign, selection, report]` — the agent-written
  fields; Brief Maker declares its eighteen fields' top-level keys plus
  `capture` and `review` (§10.2). For the Research Tool that is: extract (`extract`,
  `extract_ask`), identify (`identify` when it writes a field), the roster
  `lookup` pin, `select`, every `research_run`, the `research_merge` pin,
  every `open_contest`, every `synthesise_finding`, `propose_audience`, and
  `report` / `compose_report`. An `edit` that only posts a chat message or
  indexes a material (`narrate`, an identify question, `stage_failed`) may
  omit it; an implementation should still send it. Its rules:
  - every id a `because` point cites resolves in the document as it stands
    after the change — a pin, a finding, a decision, a material, a contest or
    a gap, a value a contest holds, a source a pin or a contested value rests
    on — or is an address on it (`<doc-id>#…`), or is a source in
    `result.sources`;
  - `certainty` is derived, never the model's: for a `pin` it is the lowest
    derived confidence of the pins it targets; for a `finding` it is the
    finding's derived confidence; for the rest, the implementation's stated
    rule from the evidence (coverage for a run, verified quotes for an
    extraction, how the brand was settled for identify);
  - where a model call decided (extract, identify, select, synthesise,
    report), the model may write `because`, `rejected`, `only_option`,
    `would_change_if` and `attention`; the implementation checks every cite
    against the ids the model was given, drops a point whose cites do not all
    resolve or that states a figure without a cite, and, when no point is left,
    writes its own from the evidence and sets `attention`;
  - `rationale` is its one-line summary (`decided` + the first point) unless
    the implementation sends its own; a host fills it from the reasoning when
    it is empty.
- **Staged writes** (any change sent on a reply before `done`, and every
  `start_campaign` change). A stage may be delivered more than once, so each
  must be recognisable as a repeat:
  - every field the `data_patch` writes is named by the `targets` of a
    decision in the same change (`<doc-id>#campaign.problem`,
    `<doc-id>#intake.messages[msg_…]` for the patch path
    `intake.messages.msg_…`, `<doc-id>#report`), and a repeat sends the same
    decision ids — the host then skips the field (§5);
  - agent chat messages therefore carry a decision too (one decision may
    target a stage's fields and its message together);
  - a later stage that deliberately rewrites a field an earlier stage wrote
    uses a **new** decision id and a `read` holding the value the earlier stage
    wrote (or takes `base_version` from the `clan.version` of the request it
    was computed on) — otherwise it reads as a stale write over its own
    earlier value and contests itself.
- **Source records.** Facts cite source *ids*; the source records (URI, tier,
  licence) live in the layer. An implementation may echo them in
  `result.sources` for display; the document does not store them.

## 4. Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":{"type":"unknown_task","message"}}` | task not in the contract, or not declared by the document's pipeline |
| 400 | `{"error":{"type":"unknown_handler","message"}}` | handler unregistered, for another task, malformed, or an unimplemented major |
| 400 | `{"error":{"type":"invalid_input","message"}}` | body not JSON; `request_kind` not `middleware`; no task; no `clan.id` / `clan.version`; scope in the request; bad lens, market or attachment; nothing to read; gate not met |
| 401 | `{"error":{"type":"unauthenticated","message"}}` | credentials missing or wrong (when the deployment requires them) |
| 400 | `{"error":{"type":"invalid_input","message"}}` | also: `start_campaign` attachment whose `material_id` is not in `clan.data.materials` with that `sha256`; `answer_question` with a `question_id` that is not the job's open question, neither or both of `option_id` / `text`, an `option_id` not among the question's candidates (an escape option is answered with `text`), `text` when `allow_text` is false; `compose_report` with no pin and no finding to cite |
| 404 | `{"error":{"type":"unknown_job","message"}}` | job id unknown to this tenant and document |
| 409 | `{"error":{"type":"job_state","message"}}` | `answer_question` for a job that is not `needs_input` (already answered, done or failed); `start_campaign` or `compose_report` while a `start_campaign` job on the same document is `queued`, `running` or `needs_input` — one composition of a document at a time; `draft_brief` while a `draft_brief` or `regenerate_field` job on the same document is `queued` or `running`, and `regenerate_field` while a `draft_brief` job, or a `regenerate_field` job for the same field, is (§10.11) |
| 400 | `{"error":{"type":"invalid_input","message"}}` | also: `draft_brief` or `regenerate_field` on a brief whose `data.locked` is true; `regenerate_field` for a field not in §10.4 or in `data.locked_fields`; an `image` over 5 MB or of another media type (§10.1) |
| 409 | `{"error":{"type":"version_conflict","message"}}` | `base_version` is stale — only an implementation that holds the document (the web product) can know this |
| 500 | `{"error":{"type":"internal","message"}}` | anything else. The message never carries request content |

Never a 200 with a fallback. For `request_kind: middleware` the host passes
the body's `error` through to the app as the proxy envelope's `error` —
`{ "type", "message" }`, those two strings and nothing else — with `data:
null` and the status. (For every other request kind it strips upstream error
bodies and says only `upstream returned <status>`.) That is why a message
never carries request content. `401 unauthenticated` reaches the app the same
way: the host's configured secret is missing or wrong, which the app can
report but not fix.

**Stale base.** A job reads the document once, when it starts. If the document
moved on before the job finished, the `done` change still names the version it
read in `base_version`, and `read` says what it read. An implementation that
does not hold the document (the desktop case) returns it anyway and the
**host** decides, field by field (N2: "if a human edited a different fact
meanwhile, nothing conflicts; if they edited the same one, the job's write
becomes a contested value"):

- each `read` key the patch writes under is judged as one field: if the
  document still holds there what the job read — or already holds what the job
  would write — the patch applies there;
- if it holds something else, nothing is written there. The host records an
  open `contest` decision targeting `<doc-id>#<path>`, with `values`: the
  document's current value (`from: document`) and the job's (`from: <handler>`,
  with `base_version` and what it read). Job decisions that target only
  contested fields are held inside the contest (`withheld`, cited by id), not
  appended — they describe a write that did not happen;
- `facts_append` and `findings_append` are append-only and always apply;
  `findings_update` applies only when every finding it updates is as the
  job read it, else the whole change is refused;
- a stale base with a `data_patch` and no `read` is refused:
  `{ "applied": false, "reason": "stale base and no read-set; rerun" }`, and
  so is a `read` that does not cover every path the patch sets.

The store's own expected-version check (the document moving between the
host's read and its write) is separate and not yet implemented (W2-A4). One
that does hold the document may answer `409`.

## 5. Who applies a change — the host, never the app

The template never writes middleware output. When a `clan://api-proxy` reply for
`request_kind: middleware` carries a `change`:

1. the host checks `change.doc` equals the open document's `document_id`, else
   refuses;
2. applies it through the single write funnel as ONE Change: `data_patch` →
   `shared/data.yaml`, `facts_append` → `shared/facts.yaml`, `findings_append`
   then `findings_update` → `shared/findings.yaml`, `sources_append` → `shared/sources.yaml`, decisions appended with `actor: process:middleware`,
   `handler` and `backend` the response's, `scope` the one the host resolved,
   and the decision's own `id`, `kind`, `targets`, `cites`, `rationale` and
   `reasoning` as fields (`claimed_agent` = its `agent` when that is not the
   actor). A change carrying a decision whose `reasoning` is required (§3) and
   absent, or present and malformed, is refused whole —
   `{ "applied": false, "reason": "decision d_… (pin) carries no reasoning; …" }`
   — rather than accepted with a flag: reasoning is what the decider knew when
   it decided and cannot be added later without being invented, and the
   refusal names the decision so the fix lands at the source on a rerun. A
   contest the host opens over a stale write (§4) carries the host's own
   reasoning in the same shape;
3. rebuilds `projection` (pins by fact id, findings by id, `built_from` hashes)
   per Contract 3 §5;
4. emits the usual patch event so the view re-renders, and returns the envelope
   to the app with `change` replaced by

   ```json
   { "applied": true, "version": "<new>", "base_stale": false,
     "applied_fields": ["campaign.problem"], "contested_fields": [], "contests": [] }
   ```

   (`contests` the ids of the `contest` decisions it opened), or
   `{ "applied": false, "reason": "..." }`. When a change landed the envelope
   also carries `clan: { id, revision, version, data }` — the document as it
   now stands — beside `data`.

Applying is idempotent. A field whose decisions — every decision in the
change whose `targets` name it — are all already in the chain is a repeated
stage: it is skipped entirely, neither re-applied nor contested, and not
listed in `applied_fields` or `contested_fields`. Other entries already present are skipped: a fact or finding
with the same id and the same content (the same id with different content is
refused — a pin is frozen), a decision whose `id` is already in the chain
(or held in a contest), a contest already open over the same field and value.
A change of which nothing is new — every fact, finding and decision present,
the patch a no-op — is `{ "applied": false, "reason": "already applied" }`, so
a re-poll of a `done` job changes nothing.

In the web product the same apply runs server-side in-process (P2); the envelope
does not change.

## 6. Auth

The host holds the secret (`secrets.yaml`, `proxies.middleware.secret_ref`) and
sends it as `Authorization: Bearer <secret>` (`auth_kind: bearer`) or
`x-api-key` (the default). The sandboxed app never sees it. The middleware maps
the credential to a tenant — that mapping is the only source of scope.

## 7. Dev wiring

```yaml
# <app-config-dir>/workspace.yaml
proxies:
  middleware:
    endpoint: http://localhost:8790/v1/tasks    # the stand-in
    # endpoint: https://middleware.example/v1/tasks   # the real one — the only line that changes
    auth_kind: bearer
    secret_ref: middleware_api                  # key in secrets.yaml
```

**Configure `proxies.middleware` explicitly.** Other request kinds fall back
to `agent_url`; `middleware` never does. With no `proxies.middleware` the host
sends nothing and answers the task itself — the proxy envelope with `ok:
false`, `data: null` and `error: { "type": "no_middleware", "message" }` —
and a browser build with no network answers every task the same way. `GET
clan://middleware` answers `{ "api": "napkin.middleware/1", "configured":
bool }` — presence only, never the endpoint — so an app can say so on open.
The host still refuses any reply that does not carry `"api":
"napkin.middleware/1"` (an endpoint pointed at the wrong service): the app
sees an error naming the API and nothing is applied.

- Stand-in: `python3 mock-middleware/server.py` (stdlib only), `:8790`,
  `POST /v1/tasks`, `GET /healthz`. See `mock-middleware/README.md`.
- Contract suite: `python3 mock-middleware/contract_test.py --base-url <url>
  [--schema-dir app/templates/campaign-research] [--token <secret>]`. The real
  middleware must pass it unchanged.

---

## 8. The chat intake — `start_campaign`, `answer_question`, `compose_report`

The owner, 2026-09-23: *"The start campaign should work like a chat bot input.
Allow me to type prompt, attach any relevant material and return the campaign
to me, the middleware should be able to figure out the brand and category and
then give me the relevant research using the prompt and the model can then
send the relevant report to render."* Three decisions bind it: the report is
**structured blocks the app renders**, never model-written HTML, and every
claim cites pins or findings; when brand or category is ambiguous the bot
**asks back in the chat** and research waits — it never guesses the subject
brand; **only task submissions spend quota** (§9). What the document holds —
`intake.messages`, `report`, `selection.lenses_skipped` — is Contract 3
§16–17.

### 8.1 The flow

1. A new Research Tool document opens on a chat composer: prompt, attach
   files, Send.
2. The view uploads each file (`clan.uploadAsset`) and indexes it under
   `data.materials.<mat_id>`, indexes the prompt as a `kind: prompt` material
   (sha256 of the text's UTF-8 bytes), and writes the person's message into
   `intake.messages` — one human write. Then it sends `start_campaign`.
3. `start_campaign` is **one** middleware job (M1: orchestration lives in the
   middleware), in six stages, in order:

   | Stage | Does | Writes |
   |---|---|---|
   | `extract` | `extract_ask` (Contract 3 §3): deterministic layer lookups, then one structured-output call — every field except `brand`, `client_org`, `categories` | `campaign.*` (extracted / proposed), `materials`, pins |
   | `identify` | the subject brand, the client and the categories, by §8.6; may enter `needs_input` | `campaign.brand` (extracted), `client_org`, `categories` (proposed) — or a question |
   | `select` | which lenses × `campaign.markets` this prompt needs | `selection.lenses_skipped` |
   | `research` | `research_lens` over the selected pairs only | pins, `selection.*` |
   | `synthesise` | `synthesise_findings` | findings, `campaign.audience` / `in_market` (proposed) |
   | `report` | composes the report (§8.5) | `report` |

   Every stage writes at least one short agent message into
   `intake.messages` (`role: agent`, its `job_id` and `stage`).
4. Each reply may carry a `change` for the stages finished since the previous
   one (§8.4); the host applies it. The chat shows `job.stage`,
   `job.progress` and the messages.
5. When `identify` cannot decide, the job enters `needs_input` with
   `job.question`; the view shows it as a bot message with buttons; the
   person's answer goes back with `answer_question`; the job continues.
6. When `done`, the view renders `data.report` on top of the campaign, then its
   `confirm` list (D3's confirmation step, Contract 3 §16.3).
7. **Refresh report** sends `compose_report`, which re-composes the report
   from the document as it now stands.

For `start_campaign`, `progress` counts stages: `{ "done": <stages
finished>, "total": 6 }`. The research fan-out is narrated in messages, not in
`progress`.

### 8.2 Replies

Every reply of a `start_campaign` job — to `start_campaign`, `job_status` or
`answer_question` — is the §2 envelope with `task: start_campaign`,
`handler: start_campaign@1.x`, and:

```json
{ "job": { "id": "job_…", "state": "needs_input", "stage": "identify",
           "progress": { "done": 1, "total": 6 },
           "question": { "id": "q_…", "text": "Which brand is the client's?",
                         "address": "<doc-id>#campaign.brand", "allow_text": true,
                         "options": [
                           { "id": "lunasa", "label": "Lúnasa",
                             "value": { "ref": "brand/lunasa", "name": "Lúnasa" },
                             "origin": "extracted",
                             "source": { "material_id": "mat_…", "locator": "¶1", "quote": "…" } },
                           { "id": "none", "label": "None of these" } ] },
           "started_at": "…", "finished_at": null, "error": null },
  "result": { "summary": "Waiting for you: which brand is the client's?",
              "messages": [{ "id": "msg_…", "text": "…", "stage": "extract" }, "…"] },
  "change": { "…": "the stages finished since the previous reply" } }
```

`compose_report` replies `task: compose_report`, `handler:
compose_report@1.x`, `job.state: done`, `job.stage: report`.

### 8.3 Questions and answers

`job.question` is `{ id, text, options, allow_text, address? }`, the same
object the middleware writes into the thread as the question message's
`question` (schema `definitions/question`):

- `address` is `<doc-id>#campaign.<field>`, the field the answer settles.
  Every `identify` question has one.
- An **option with a `value`** is a candidate. `value` is the complete value
  for that field, typed as Contract 3 §2.3 types it (a `{ref, name}` for
  `brand`, a ranked leaf list for `categories`, a code list for `markets`).
  `origin` says where the candidate came from and it carries what that origin
  carries: `extracted` + `source` (a span in the material), `proposed` +
  `fact_ids` (pins), or `stated` (the person's own words, from an earlier
  free-text answer).
- An **option without a `value`** is the escape ("None of these", "Something
  else"). A question with an escape, or with no options, has `allow_text:
  true`. Choosing the escape opens the text box; the answer is sent as
  `text`, never as the escape's id.

**The answer is the person's write, not the middleware's.** Before sending
`answer_question` the view writes, as a human, the person's message
(`role: user`, `job_id`, `answer: { question_id, option_id | text }`) and,
for an option answer, the field at `address`:

| Picked option's `origin` | The view writes the field as |
|---|---|
| `extracted` / `proposed` | `origin: confirmed`, `confirmed_from: <origin>`, `by: human:<id>`, keeping the option's `source` / `fact_ids` |
| `stated` | `origin: stated`, `by: human:<id>` |

That is D3's confirmation made in the chat: the person's answer becomes a
`confirmed` (or `stated`) field with the person as `by`, and the middleware
never writes a confirmed or stated field (Contract 3 §2.2). The middleware
continues with the answered value and never writes the answered field.

A **`text` answer** writes only the message. The middleware resolves the text
— to the brands, leaves or market codes it names — and asks again: a new
question (new id) whose candidates are what the text resolved to, the
last-resort candidate being the text itself as a new entity (`origin:
stated`, a brand `{ref: brand/<slug>, name: <text>}`). The field is then
written from that pick. Free text steers a question; it never becomes a field
value without the person picking it. When nothing resolves (a leaf or market
the taxonomy does not know), the new question says so and allows text again.

`answer_question` is accepted only when the job is `needs_input` and
`question_id` is `job.question.id` (else `409 job_state` / `400
invalid_input`, §4). Its request's `clan` — which now holds the person's write
— becomes the job's base for the stages that follow. The reply describes the
job: `running` (or `needs_input` again, with the next question).

*Changed 2026-09-30 (the owner: no stage may halt a research job).* A question
nobody answers does not hold the job for ever. After a wait (30 minutes in the
real middleware) the job goes on with a **stated default**, written with an
`identify` decision and an agent message saying so: for `categories`, the
material's most likely candidate (`origin: extracted` with its span, or
`proposed` with its pins), certainty `low`, `attention` asking the person to
confirm it; for the `brand`, nothing: the subject brand is never guessed, and
the field stays open; for `markets`, or any question with no such candidate,
the field stays open. Once one question has gone unanswered, any later
question in the same job takes its default at once. A later `answer_question`
is `409 job_state`, saying that nobody answered in time.

### 8.4 Staged changes

- A reply carries the change for every stage finished since the previous reply
  (none: `change: null`). It **may** repeat stages already sent — every
  staged write carries its decision (§3, *Staged writes*), and the host skips
  a field whose decisions are all in the chain (§5), so a repeat is harmless.
  A middleware that cannot know whether its previous reply arrived should
  repeat every finished stage whose decisions are not yet in the
  `clan.decision_chain` the request carried.
- One change may span several stages. `base_version` is the version the
  earliest of them read; `read` holds, per path, what the stage that wrote it
  read.
- The host applies each reply's change regardless of `job.state` and returns
  its outcome in place of `change`, as for `done` (§5).
- The **`report` stage** composes from the document as the host holds it: from
  the `clan` of the first request (a poll) whose `clan.decision_chain` holds
  every decision of the earlier stages — i.e. once they have landed. Until
  then the job stays `running`, `stage: report`. *Changed 2026-09-30:* it
  never stays there for ever. A staged change missing from three polls after
  it was sent is sent on its own, and missing from three more polls the host
  has refused it. The middleware then stops sending it, so the stages after
  it can land, and records the refused stage as a gap (below). The report does
  not wait for it. When no poll brings the earlier stages within a wait (ten
  minutes in the real middleware), the report is composed from the job's own
  copy of the document, and its decision's `attention` says so; **Refresh
  report** composes it again from the document.
- **No stage halts the job** (the owner, 2026-09-30). A stage can raise, have
  its model call refused or answered with output that never validates, run
  out of its time, or have its change refused by the host. None of these
  fails the job. The stage becomes a **gap**: a decision with the stage's own
  action (`extract`, `identify`, `select`, `research`, `synthesise`,
  `report`) and no field target. Its reasoning says why the stage did not
  finish and what the job does without it, and an agent message says the
  same in the crew's words (what we could not finish, why, and what we did
  instead; never a stage name, *changed 2026-09-30*); the stage and the kind
  stay in the reasoning and the logs. The next stage then runs, and the job
  ends `done`. Each reply's `result.gaps` lists `[{stage, reason}]` (display
  only), so the view shows a step the job went on without as skipped. A research gap
  also writes each selected lens × market into `selection.gaps`, with a
  `research_run` decision per pair, so the report names them and the view
  can offer to look again. With no model plan, `select` runs every lens in
  every market. With nothing to cite, the `report` stage writes no report,
  and its decision says why. `failed` is left for a fault in the job runner
  itself.

### 8.5 The report

`data.report` (Contract 3 §17) is written by the `report` stage and by
`compose_report`, and by nothing else. The patch sets `report` whole, with a
decision targeting `<doc-id>#report`, `read: { "report": <what the request's
document held> }`, and one agent message. It is composed from the request's
`clan`:

- `based_on`: `{ version: clan.version, facts_sha256, findings_sha256 }`, the
  two hashes copied from `clan.data.projection.built_from` — the host's hashes
  of the members the report describes.
- Every `claim` — the headline, each summary line, each `claim` block — cites
  at least one pin or finding present in `clan.facts` / `clan.findings`. None
  cites a rejected finding; no `finding` block shows one. A claim states no
  figure that is not in a cited pin (or verbatim in a cited finding); the
  view renders figures from `pins` blocks. `gap` and `contest` blocks name
  `selection.gaps` / `selection.contested` ids.
- `confirm` and `not_researched` follow Contract 3 §17.
- A model may compose it (structured output, the block schema enforced);
  every cite is checked against the document before the change is sent. The
  model's own confidence is never read.

### 8.6 Identify rules

The stand-in and the real middleware both follow these.

- **Subject brand.** Exactly one brand clearly the client — named in the
  prompt as ours or the client's, a `Brand:` label, or the only brand in the
  material — is written `campaign.brand`, `origin: extracted`, with the
  evidence span. (Contract 3's `proposed` is reserved for values derived from
  pins; a brand read from the material is `extracted`.) Several brands, or
  subject vs comparator unclear → `needs_input`: "which is the client's?",
  options the brands found (`extracted`, each with its span) plus "None of
  these". No brand → `needs_input`, free text.
- **Categories.** From the subject brand's roster row when one exists (a
  brand-layer fact `roster.categories…`, pinned) → `campaign.categories`,
  `origin: proposed`, citing the pin. Otherwise a ranked array of at most two
  candidates → `needs_input`: options the candidates (and, when there are
  two, both together — each option's value is a whole list) plus "Something
  else". Never classify by retrieving.
- **Client.** From the roster row (`roster.client_org`) → `proposed`; else as
  `extract_ask` would.
- **Markets.** None in the material → `needs_input`, free text; research
  cannot run without them (gate `research`).
- The answer becomes a `confirmed` field, by the person (§8.3), and the job
  continues. The subject brand is asked before categories: the roster row
  depends on it.

## 9. Quota

Only **task submissions** spend agent quota: the host (the web product's
meter) charges one unit for each `request_kind: middleware` request whose
task is not `job_status` — `start_campaign`, `answer_question`,
`compose_report` and the older tasks alike — before sending it, and refuses
over the cap with its own `429` (the middleware never sees the request).
`job_status` polls are free: a job is polled for minutes, and a poll spends
nothing upstream.

## 10. Brief Maker — `draft_brief`, `regenerate_field`, `fix_parts`

Brief Maker moves off `engine/agent-server/` (a bare-JSON backend whose output
the view wrote itself) onto the middleware. The engine's semantics port; its
transport does not. Every rule in §1–§5 holds: the reply is the §2 envelope,
the output is a job whose `change` the **host** applies — never bare JSON —
and nothing the view receives is written by the view. The peripherals each
stage uses are Contract 5 §6.

*Changed 2026-09-29*, for briefs spun off from research (Contract 4 §5): the
drafters read `clan.findings` and may cite `fi_` (§10.1, §10.3, §10.7), capture
stays free of research as well as of retrieval (§10.3), a brief is locked by
an `approve` on it rather than by a data flag (§10.5), and §10.13 says which
research evidence each loop gets and that nothing marked `model: false`
reaches a model. The drafters never read findings before, so research could
not reach a brief; and the data flag let a view lock around the lock list.

### 10.1 Input

`draft_brief`: `{ "prompt"?, "attachments": [...] }`.

- `prompt` — the planner's typed ask (`data.brief_input`). It is a material
  (`kind: prompt`, sha256 of its UTF-8 bytes).
- Each attachment — `name`, `sha256` of its bytes, and what can be read:
  `text` (host-extracted, as for `extract_ask`), or `image: {media_type,
  data}` (base64 bytes; `image/png | image/jpeg | image/gif | image/webp`, at
  most 5 MB decoded, else `400 invalid_input`). `media_type` and `asset` (the
  document path of the bytes, from `reference_assets[].path`) are recorded on
  the material. An attachment with neither `text` nor `image` is recorded
  **unread** and grounds nothing.
- At least a non-empty `prompt`, a `text` or an `image`; else `400
  invalid_input`.

The drafters also read `clan.facts` and `clan.findings` (§1) — in a brief
spun off from research, the pins and findings it carried (§10.13); capture
never does.

The middleware indexes every material itself, in `data_patch.materials`
(§10.4); the view does not index first. Material ids are deterministic —
`mat_` + the first 16 hex of the sha256 — so a repeat, or a second draft over
the same file, names the same material.

### 10.2 The pipeline declaration

Brief Maker's `app/pipeline.yaml` becomes a declaration like the Research
Tool's (M2):

```yaml
pipeline: napkin-briefing
version: 2
request_kind: middleware
contract: middleware-api/1#10

tasks:
  draft_brief:
    handler: draft_brief@1
    job: long
    stages: [extract, draft, judge]
  regenerate_field:
    handler: regenerate_field@1
    job: long
    stages: [draft, judge]

fields:                      # app key -> how it is filled; the handler reads this map
  project_name:              { class: captured }
  client:                    { class: captured }
  background:                { class: captured, rubric: background }
  objectives.commercial:     { class: captured, rubric: objectives }
  objectives.behavioural:    { class: captured, rubric: objectives }
  objectives.attitudinal:    { class: captured, rubric: objectives }
  audience:                  { class: captured, rubric: audience }
  competitor_context:        { class: captured, rubric: competitor_context }
  budget_and_scope:          { class: captured, rubric: budget_scope }
  mandatories:               { class: captured, rubric: mandatories }
  tone_and_world:            { class: captured, rubric: tone_world_assets }
  insight:                   { class: drafted, rubric: insight, loop: loop4_insight }
  single_minded_proposition: { class: drafted, rubric: smp, loop: loop5_proposition }
  reasons_to_believe:        { class: drafted, rubric: reasons_to_believe, loop: loop6_substantiation }
  desired_response.think:    { class: drafted, rubric: desired_response, loop: loop5_proposition, drafter: desired_response }
  desired_response.feel:     { class: drafted, rubric: desired_response, loop: loop5_proposition, drafter: desired_response }
  desired_response.do:       { class: drafted, rubric: desired_response, loop: loop5_proposition, drafter: desired_response }
  open_questions:            { class: composed }

merge_policies:
  materials: append
  passages: append
  capture: last-write
  review: last-write
  "*": ask
```

`rubric` names a field of the golden-brief rubric, bundled with the handler
and versioned with it (Contract 5 §9, O9). The Brief Maker reads the server's
copy, `server/napkin/brief/golden_brief.schema.json`, which differs from
`engine/golden-brief/golden_brief.schema.json` on purpose (ADR 0034, 0035): it
has the job, barrier and objection fields and the planning skill's tests. The three `desired_response`
leaves share one drafter: they are a ladder.

### 10.3 The flow

One job, three stages, in order. `progress` counts stages: `{done, total: 3}`.

| Stage | Does | Writes (on the reply after it finishes) |
|---|---|---|
| `extract` | Transcribe each image (Contract 5 §1.6). **Loop 1 — no-loss capture:** one structured-output call over the materials returning the eighteen Loop-1 keys (the engine's `EXTRACTION_SYSTEM`: each item `{value, status: fact \| assumption, quote, material_id}`, plus `how_to_win` and `open_questions`); every `fact` quote checked verbatim in its material — an item whose quote is not found is dropped and its words stay unmapped; the no-loss ledger over the materials' segments. **Loop 2 — the working brief:** the captured fields, derived from the capture by the engine's `map_brief` rules (a Loop-2 client fact is never an insight or an SMP). The **BetterBriefs scorecard** (`SCORECARD_SYSTEM`: seven dimensions and single-mindedness, evidence quoted verbatim) | `materials`, `capture`, `review` (scorecard), every captured field it can support |
| `draft` | For each drafted field not locked, **one drafter, all in parallel** (N4). A drafter builds its loop's query from the working brief (the captured fields' values — never raw material, never the capture itself), asks the retrieval port for the packs whose `loops` include its loop (and, for insight and substantiation, each case pack at its own `k`), and drafts: insight and SMP by tournament (N candidates in one call, ranked, auto-gated, one sharpen pass), the rest once. It may cite passages (`psg_…`), capture items (`cap_…`), pins in `clan.facts` (`f_…`) and findings in `clan.findings` (`fi_…`, §10.13) — nothing else. Drafters never see each other's drafts | nothing yet: a draft lands only once judged |
| `judge` | **Serial** (N4). The Judge (§10.8) judges every field that holds or will hold a value, then the brief as a whole; one revision per failed drafted field, by its drafter with the Judge's `fix`, re-judged once. Composes `open_questions` | the drafted fields that passed, the `passages` they cite, verdicts, proposals, `review` (with the Judge), `open_questions` |

**The one hard rule: capture is RAG-free and research-free.** The `extract`
stage has no retrieval or research capability (Contract 5 §3.4): nothing
retrieved and nothing from research — no pin, finding, contest or report,
own or carried — is fed to Loop 1, and no captured field cites a passage, a
pin or a finding. The no-loss ledger measures
fidelity to the client's own words, and injected text craters it.

**The planned engine** (*added 2026-10-19*, brief-fact-provenance). The
default flow (`NAPKIN_BRIEF_FLOW=planned`) runs `extract → context → draft →
judge`: Sam plans the brief and runs the research it lacks, Dara drafts every
part at once, and Jude (or jev's check loop) has the parts that need it
rewritten. Capture stays RAG-free and research-free as above. What changes is
where a part's value may come from: in the planned engine every part,
captured-class parts included, may rest on the client, the research (`f_`,
`fi_`), the library (`psg_`) or an assumption, and its decision says which.

- **Basis** is `client | research | library | assumption`, and it is
  derived from the part's claims (§10.7), never taken from the model's
  label. A part is `client` only when a capture item mapped to its key
  supports it: an item in `data.capture.items` (or this job's capture) whose
  quote holds the part's figures (for an `assumption`-status item, which has
  no quote, its value). The mapping is `working_brief()`'s for background,
  audience, competitor context, the objectives, tone and world, mandatories
  and budget and scope; the item's own name for `client` and
  `project_name`; `key_message` for the SMP; `proof_points` for reasons to
  believe; `strategic_angle` and `business_problem` for insight; `objective`
  (same type) and `success_metrics` for desired response. A value the
  working brief already holds is not, by itself, the client's words. A
  `builds_on_client` point takes the same gate.
- **Provenance is added after drafting, never by restricting it.** Dara's
  draft call, its inputs and its schema are unchanged, and she is never asked
  for claim bookkeeping. One cleaner (`server/napkin/brief/provenance.py`,
  `clean_parts`) runs after every draft and every rewrite on every path:
  draft, review revise, the jev check-loop rewrite, `fix_parts`
  (§10.15) and the brief engine's rewrites (§10.14). It splits each value
  into claims, ties each one to the facts, capture items and passages that
  support it, recomputes every worked-out figure, and derives the basis and
  certainty. **It never edits a value.** A claim nothing supports is kept,
  marked `to_confirm`, and said in `attention`; it is never dropped or
  reworded, and neither the literal-number rule (`rules/cite.clean_claim`)
  nor any judge applies to a brief value.
- **Facts outside the measure list** that the context stage's research
  finds are kept as document pins (§3 `facts_append`, `kept_in_document`) in
  this job's change, before the draft, so Dara can cite them and the cleaner
  can tie to them. They are never written to the layers.

**Omitted, not blank.** No patch sets a brief field to `""`, `[]`, `{}` or
`null`, and no patch removes one. A field nothing supports is absent from the
patch and named in its stage decision's `abstained`. A second draft never
blanks a box.

**Parallel drafting in v1** runs in-process: each drafter owns one field, so
the fan-out cannot collide (N4's reason), and the job's staged change carries
the result. Branches (`agents/<user>.<agent>.<task>/`) are the web product's
mechanism for the same thing and change nothing here.

### 10.4 What the document holds

Brief Maker's `shared/data.yaml`. The eighteen fields keep their bare shapes
(`schema.json`: strings, or arrays of strings for `reasons_to_believe`,
`tone_and_world`, `mandatories`, `open_questions`); provenance lives in the
decisions that target them, not in an envelope. Addresses are
`<doc-id>#<dotted key>` — `#insight`, `#objectives.commercial` — and a nested
patch merges key-wise (`{objectives: {commercial: …}}` leaves `behavioural`
alone).

Four blocks, written only by the middleware — additions to Brief Maker's
`schema.json` (shapes: `docs/contracts/peripherals/brief-maker.schema.json`;
Contract 5 §9, O5 and O12):

```yaml
materials:                        # as Contract 3 §1, plus two optional keys; merges key-wise
  mat_9f2c0a1b3d4e5f60:
    kind: prompt | client_brief | email | deck | image | other
    name: "Glenmore brief.pdf"
    sha256: "…"
    media_type: application/pdf
    asset: human/assets/…
    received_at: 2026-09-24T09:00:00Z
    licence: client-confidential  # the strictest class until a human reclassifies it
    unread: true                  # optional: nothing readable arrived
    transcribed: { model: claude-opus-5, backend: "…" }   # optional: its text is a vision transcription
    text: "…"                     # optional, kind prompt only: the prompt's words, at most 4000 chars
capture:                          # Loop 1; replaced whole by each extract stage
  built_at: …
  handler: draft_brief@1.0
  items:
    cap_1a2b3c4d5e6f7a8b:
      key: business_problem       # one of the eighteen Loop-1 keys
      value: "…"
      status: fact | assumption
      quote: "…verbatim in the material…"   # required for fact
      material_id: mat_…
      objective_type: commercial | behavioural | attitudinal   # objective items only
  gaps: [budget, decision_makers] # Loop-1 keys the material does not answer
  how_to_win: [{ kind: stated_evaluation_criteria | unstated_needs | likely_landmines | winning_themes | proof_required, point, evidence, material_id }]
  ledger: { total_segments, mapped_segments, coverage_pct, unmapped: [{ segment, material_id }] }
review:                           # replaced whole by extract, then by judge
  built_at: …
  handler: draft_brief@1.0
  based_on: { version }           # the clan.version the job read
  scorecard:
    dimensions: [{ dimension, verdict: pass | vague | missing, evidence?, fix? }]   # the seven, in order
    single_mindedness: { verdict: single | multiple, split_into: [] }
    summary: "…"
  judge:                          # absent until the judge stage
    reason_codes_version: "1"
    fields: { <key>: { outcome: passed | revised | failed | kept | absent, checks: [{ check, method: auto | llm | human, status: pass | fail | review, note, fix? }] } }
    dependencies: [{ id, status: pass | fail | review, note }]
    definition_of_done: [{ id, status: pass | fail | review }]
    health: 0-100                 # golden_critic's score, computed by code
passages:                         # every passage a decision cites; merges key-wise
  psg_3b9f0c2e7a41d5c8e210: { uri, pack, scope, licence, source, section, citation, text, text_sha256, pack_version, retrieved_at }
```

`cap_` ids are `cap_` + the first 16 hex of `sha256(key + "\n" + value + "\n"
+ material_id)`; `psg_` ids are the retrieval port's (Contract 5 §3.2). A
scorecard `evidence` is a verbatim quote from a material (checked; one not
found is dropped), absent for `missing`. The view renders `review` in place of
the old context panel; the middleware no longer returns a `context`.

*Changed 2026-10-19* (brief-fact-provenance; owner: store the prompt's words
so Sources can quote them). A material of `kind: prompt` may carry `text`:
the planner's typed ask, verbatim, at most 4000 characters. It is the
client's words, so its licence is `client-confidential` like any material.
An attachment's text is never stored here; it stays in the host's
`.extracted/` sidecar. The middleware writes `text` only when the brief's
embedded `schema.json` allows it (an older brief's `materials` refuse
unknown keys, and pack would refuse the document); otherwise the prompt is
indexed as before and Sources names it without quoting it.

### 10.5 Fields the middleware never writes

- **Locked.** The brief is locked when `clan.decision_chain` holds an
  `approve` decision, not superseded, whose `targets` include `clan.id`
  (Contract 4 §7.1) — or, in a brief made before it locked through
  `/approve`, when `data.locked` is `true`. A carried `approve` (it targets
  the parent) does not lock the brief. Locked, both tasks are `400
  invalid_input`. A key in `data.locked_fields` — or whose top-level key is
  there — is locked: not drafted, not written, not proposed; its
  `result.fields` state is `kept`.
- **Human-held.** A field is held by a person when the latest decision in
  `clan.decision_chain` that wrote it is a person's: its `actor` begins
  `human` (or, with no `actor`, its `agent` does). A decision *wrote* key `K`
  (top-level `T`) when its `targets` include `<doc-id>#K` or `<doc-id>#T`, or,
  with no `targets`, its `fields_changed` includes `T` and either `K` is `T`
  or its `action` names no sibling `T.<x>` other than `K` (the view's own
  rule). A field that holds a value no decision wrote is human-held.
- **An unanswered bad verdict** by a person on the field (Contract 3 §2.2)
  makes it human-held too: it is not silently re-drafted. `fix_parts` is the
  exception: a person's bad verdict on a part it fixes is part of the problem
  they asked the crew to fix, so it does not hold that part (§10.15).

The middleware **proposes** instead of writing a human-held field: the value
goes in `result.proposals` (§10.6) and the change carries an `edit` decision
with `action: propose`, `targets: ["<doc-id>#K"]`, the value as
`proposed_value`, and reasoning — and no `data_patch` for `K`. Accepting is
the view's human write of `K` (as §8.3's answers are), citing the proposal's
decision from a point of its reasoning (`reasoning.because[].cites`: the host
keeps a view claim's reasoning, not a top-level `cites`); its rationale names
the proposer and never an id
(`Accepted Dara's new version of the single-minded proposition.`). Briefs from
before 2026-10-23 named the id in the rationale instead (`Accepted d_…: …`), and
readers still understand that form. Ignoring a proposal changes nothing. Locked
fields are not even proposed. A human-held `open_questions` is proposed like
any field.

### 10.6 Replies

The §2 envelope; `task` and `handler` are the job's own (`draft_brief@1.x`,
`regenerate_field@1.x`) on every reply, `job_status` included.

```json
{ "job": { "id": "job_…", "state": "running", "stage": "draft",
           "progress": { "done": 1, "total": 3 }, "question": null,
           "started_at": "…", "finished_at": null, "error": null },
  "result": { "summary": "Drafting 4 fields in parallel.",
              "fields": {
                "background":                { "state": "done",     "by": "extract" },
                "budget_and_scope":          { "state": "absent",   "by": "extract" },
                "insight":                   { "state": "drafting", "by": "drafter" },
                "single_minded_proposition": { "state": "drafting", "by": "drafter" },
                "mandatories":               { "state": "kept",     "by": null },
                "…": "every one of the eighteen keys" },
              "proposals": [ { "field": "audience", "value": "…", "decision": "d_…" } ] },
  "change": { "…": "the stages finished since the previous reply" } }
```

- `job.stage`: `extract | draft | judge` (`regenerate_field`: `draft |
  judge`). `job.question` is always `null`: Brief Maker never waits for the
  person mid-job.
- `result.fields` — all eighteen keys, each `{state, by}`. `state`: `waiting
  | extracting | drafting | judging | revising | done | proposed | absent |
  kept | failed`; `by`: the worker doing it or that last did it — `extract |
  drafter | judge` — or `null`. This is what lets the view show Extract, one
  Drafter per field and the Judge working for real. `done`: written by a change
  already sent or in this reply. `failed`: judged bad twice, or its stage did
  not finish (a gap, §10.9); not written. `absent`: nothing supports it.
- `result.proposals` — the proposals so far (§10.5). Display only.
- `result.withheld` — the ids kept out of every model call because a
  `classify` mark says `model: false` (§10.13, item 6). Display only; absent
  when nothing was withheld.
- `trace.hits` — each passage read (`id` its `psg_`, `scope` `house` or
  `agency:<org>`, `source` its `uri`) and each pin cited.

### 10.7 Decisions and reasoning

Every decision in a Brief Maker change carries `reasoning` (Contract 4 §3),
whatever the host currently requires (Contract 5 §10, item 6): each one writes
an agent field. `agent` is the worker — `draft_brief@1.x/extract`,
`…/drafter`, `…/judge` — so the chain says who did it; `handler` is the
reply's.

| Decision | Kind | Targets | Cites |
|---|---|---|---|
| one per captured field written | `edit`, action `extract` | `#K` | the `cap_` items and `mat_` it rests on |
| the capture | `edit`, action `capture` | `#capture`, each new `#materials[mat_…]` | the `mat_` ids; flatten tail `material_read`, `unread`, `abstained` (keys not written) |
| the scorecard, the review | `edit`, action `score` / `review` | `#review` | `mat_` ids / the verdict decision ids |
| one per drafted field written | `edit`, action `draft` (`regenerate` for §10.10) | `#K` | its `psg_`, `cap_`, `f_`, `fi_` grounds; in the planned engine every claim cite too, flatten `claims` |
| one per judged field | `verdict`, `polarity: good \| bad`, `reason_code` when bad, `taxonomy_version: "reason-codes/1"` | `#K` | the edit decision it judges; loop-7 `psg_` |
| a coherence failure | `verdict`, polarity `bad` | every field it names | their edit decisions |
| a proposal | `edit`, action `propose`, flatten `proposed_value` | `#K` | as a draft or an extraction |
| the open questions | `edit`, action `questions` | `#open_questions` | the verdicts and capture gaps they come from |

Reasoning, by what decided:

- **Captured field.** `because`: the client's words, each point citing its
  `cap_` item. `only_option`: the value is what the client wrote. `certainty`
  (derived): `high` — every cited item is a `fact` whose quote was found
  verbatim in typed material; `medium` — an `assumption` among them, or a quote
  from a transcribed image; `low` — the value rests on assumptions alone.
  `would_change_if`: the client's material says otherwise, or a person edits
  it.
- **Drafted field.** `because`: the drafter's grounds, each citing passages,
  capture items, pins or findings; a point stating a figure cites the pin
  holding it, and a point that cites a finding and states a figure cites that
  finding's pins too (its `cites` that are in `clan.facts`).
  `rejected`: the losing tournament candidates, each with why it lost (the
  ranking's reason, a failed auto check, walking onto a competitor's ground).
  `certainty` (derived, never the model's): `high` — every rubric check passed
  first time and the grounds cite passages from at least two packs, or a pin
  (or a verified finding) and a passage; `medium` — passed with checks left at `review`, or grounded
  in one pack; `low` — passed only after revision, or grounded in no passage
  (retrieval unconfigured, failed or empty — `attention` then says so). A
  field whose kept points cite a finding not yet verified is at most
  `medium`, and its `attention` includes "rests on a finding not yet
  verified" (§10.13).
- **Verdict.** `decided`: the outcome; `because`: one point per check that
  decided it; `certainty`: `high` when auto checks alone decided, `medium` when
  a model check did; `attention` on every bad verdict and every check left at
  `review`.
- As §3: the model may write `because`, `rejected`, `would_change_if` and
  `attention`; the middleware checks every cite against the ids it gave the
  model, drops a point whose cites do not all resolve or that states a figure
  without a pin, and writes its own point from the evidence when none is left.
  The model's self-reported confidence is never asked for or read (the engine's
  `confidence_floor` does not port).

**Cites resolve in the document after the change** (§3), extended for these
tasks: a `psg_` resolves when `data.passages` holds it, a `cap_` when
`data.capture.items` does, and an `fi_` when `clan.findings` holds it with
status `proposed` or `verified` — a rejected finding never resolves, and a
point citing one is dropped. Every passage a decision cites is therefore written
into `passages` by the same change.

**Claims** (*added 2026-10-19*, brief-fact-provenance). In the planned
engine (§10.3), each part's writing decision (action `draft`, `propose`, or
`regenerate`) carries a flatten-tail key `claims`: what each sentence-sized
claim in the value rests on. The cleaner writes it; the model never does.

```yaml
claims:
  - text: "The €8.99 'for life' offer was over in 10 days"   # verbatim in the value
    kind: derived            # fact | derived | client | to_confirm
    cites: [f_A, f_B]        # the pins, findings, passages or capture items it rests on
    working: "15 Oct 2026 - 5 Oct 2026 = 10 days"   # derived only: how it was worked out
    calc: { op: days_between, inputs: [...] }       # derived only, when one was parsed
    check: recomputed        # derived and fact: recomputed | stated | false
    by: match                # match (code, through the part's own cites) | model (tie_claims, checked in code) | net (code) | writer (Dara's own "To confirm:" line)
    suggest: [f_C]           # to_confirm only: ids that may support it, never cited
```

- **`fact`**: the claim's figures are in a cited pin's quote (or a finding's
  pins, or a passage). `check: false` when a figure is not (a stated €9.99
  against a pin saying €8.99). A sentence with no figure is a fact only when
  the pin's own words say it (its content words, the brands left out, found
  in the pin); naming the same brand is not enough (*2026-10-20*). A brand
  named in digits (48) is a name, not a figure. A sentence `tie_claims`
  marks `states: false` (an instruction, a proposal, a title) and that has no
  figure is no claim.
- **`derived`**: the claim is worked out from its inputs, which may mix
  `f_` and `cap_`. `working` shows how. The cleaner recomputes each `calc`
  (`days_between`, `difference`, `sum`, `ratio`, `percent_change`,
  `product`) from the full quotes of every source of each input, anchoring a
  relative date ("from today") to the source's `published_at` when the
  source dated the page itself. `recomputed`: the working holds. `stated`:
  no calc could be parsed, or a date could not be anchored. `false`: it
  recomputes to something else; the value is kept and `attention` says
  "Check the working". A figure worked out from the sentence's own
  figure over a period it names ("€12.99 a month … the first year comes to
  €155.88": `product`, 12.99 × 12) is `derived`, even when some pin happens
  to state the same figure; that pin is cited beside the working.
- **`client`**: the claim is in a capture item's quote, citing its `cap_`
  and `mat_`. Certainty comes from the capture (`capture_certainty`), never
  a fixed `high`.
- **`to_confirm`**: nothing the document holds supports it, or Dara wrote
  the line as "To confirm: …" (`by: writer`), whatever a pin near it says. The value is
  unchanged; `attention` reads "To confirm: <claim>", certainty is `low`,
  and `cites` is empty. A coincidental match (a pin pair whose sum is right
  but whose entities the sentence does not name, or that the part did not
  cite and `tie_claims` did not name) goes only in `suggest`.

Rules:

- Every claim cite is in the decision's `cites` and resolves in the document
  after the change, so a pin marked wrong or replaced later reaches every
  conclusion resting on it (the view flags them, and the next clean reties
  them or marks them `to_confirm`).
- A model-named tie (`by: model`) stands only when code confirms it: each
  figure is in the named inputs, the calc recomputes, every named pin is
  used in the calc, and each input's entity (or a brand its quote names) is
  named in the sentence or is the brief's brand. Otherwise it is a
  `suggest`.
- Certainty for `fact` and `derived` claims is Contract 3 §6.1's: the
  lowest confidence among the cited pins, one lower for a single pin or a
  stale one. A recomputed working costs nothing more; `stated` is one step
  lower; `false` is `low`. The part's certainty is its lowest claim's.
- **Because and attention.** A client claim's point cites its `cap_` and
  `mat_`. A fact or derived claim's point cites its pins; a derived one reads
  "Worked out: <working>". An assumption's why and every `to_confirm`
  sentence go to `attention`, never into an uncited point. No point borrows
  the plan's or the materials' ids so that a figure seems cited.
- `cites` stays flat and `basis` stays one word, so readers that know
  neither claims nor kinds keep working.

**What the host keeps.** The host reads a middleware decision whole into
the chain: `id`, `kind` (`verdict` included), `agent`, `action`, `targets`,
`cites`, `rationale`, `reasoning`, the verdict fields (`polarity`,
`reason_code`, `taxonomy_version`, `reviewer_role`), `licence`,
`claimed_agent`, `fields_changed`, `superseded_by`, and every other key as
sent — the flatten tail (`abstained`, `material_read`, `unread`,
`proposed_value`, …). `actor`, `scope`, `handler`, `backend` and `timestamp`
are the host's (§5); a decision that sent its own keeps it as
`claimed_<field>`. Brief Maker's view finds a field's decisions by `targets`
(what `clan://chain` returns), and by `fields_changed` for a person's
patch-data, which has no targets.

### 10.8 The Judge

The engine's `golden_critic.py`, ported into the middleware, with the rubric
bundled with the handler. It never sees a drafter's prompt, candidates or
grounds — only the brief as it would stand, the rubric and loop-7
decision-rule passages (UC-6).

1. **Auto checks** in code: `within_limit`, `single_sentence`,
   `single_minded`, `reveals_why`, `max_items`, `three_levels`, `all_three`,
   `has_constraint`, `has_deliverables`, `names_rivals`.
2. **Model checks**, one structured call per field, one field at a time,
   carrying all its pending `llm` checks with the rubric's good and bad examples
   (`critic_prompts_batched`), schema `{<check>: {verdict: pass | fail, reason,
   fix}}`.
3. **Coherence**, once every field is judged: the dependencies
   (`backbone_balance`, `smp_derivation`, `rtb_supports_smp`,
   `response_ladders`, `ownable_needs_competitors`) and the definition of done,
   including `one_strategy` — the brief pulling in several directions,
   per-field drafting's risk (N4).
4. **Gating.** A drafted field with a failed check is revised once and
   re-judged; failing again it is **not written** — state `failed`, a bad
   verdict with `attention`, an open question "Agree the <label>." A captured
   field is never rewritten (it is the client's words): a failed check on it
   is a bad verdict with `attention` and an open question to take back to the
   client. A coherence failure never removes a field: it is a bad verdict on
   every field it names, with `attention`; an unanswered bad verdict is on the
   lock list (Contract 4 §7), so a person answers it before the brief locks.
5. **Reason codes** for bad verdicts: `within_limit`, `single_sentence`,
   `single_minded`, `one_strategy`, `max_items` → `not_single_minded`;
   `ownable`, `not_a_tagline` → `cliche`; `smp_derivation`,
   `rtb_supports_smp`, `supports_smp`, `response_ladders`, `derives_from`,
   `linked`, `backbone_balance` → `off_strategy`; `has_constraint` (budget
   against ambition) → `unfeasible`; anything else → `other`, with the check's
   reason as the text. Pending the creative director's redline (Contract 5
   §9, O11).
6. `review.judge.health` is `golden_critic._health`, computed by code.
7. **Open questions** (`open_questions`, written whole): the capture's open
   questions formatted `[<priority>] <question> — <why>` (the engine's
   `_format_question`), then one per failed field, then one per bad verdict on
   a captured field. Never a question the material already answers.

### 10.9 Staged changes

As §8.4: a reply carries the change for every stage finished since the
previous one and may repeat them with the same decision ids; the host skips a
field whose decisions are all in the chain.

- **After `extract`**: `materials`, `capture`, `review` (scorecard), the
  captured fields, and their decisions. `read` holds, per path, what the job
  read (`null` for absent).
- **After `judge`**: the drafted fields that passed, `passages`, verdicts,
  proposals, `open_questions`, and `review` again — a deliberate rewrite, so a
  **new** decision id and a `read` holding the value the extract stage wrote
  (§3, *Staged writes*).
- `draft` sends no change. *Changed 2026-09-30:* a stage that does not finish
  does not fail the job. It is a gap, as in §8.4: one decision with no field
  target (action `capture`, `draft` or `review`; agent `…/extract`,
  `…/drafter` or `…/judge`), and the fields it was working on become
  `failed`. Then the next stage runs, and the job ends `done`, with
  `result.gaps` listing `[{stage, reason, detail}]` (display only; absent
  when there are none). A judge stage that does not finish writes no draft
  unjudged. What landed stays.
- The `done` poll carries the last change; later polls repeat it.

### 10.10 `regenerate_field`

`{ field, guidance? }` — redraft one field.

- `field` is one of the eighteen keys; any other, or a locked one (§10.5), is
  `400 invalid_input`.
- Stages `draft` — one drafter; a captured field is re-derived from the
  capture, never from retrieval; `guidance` goes to the drafter as the
  planner's steer — then `judge` — that field's checks, then the coherence
  checks that involve it. `desired_response.*` redrafts the named leaf only,
  with the other two as context. `progress`: `{done, total: 2}`.
- It writes the field (an `edit`, action `regenerate`; `draft` on a planned
  brief, where the redraft runs as a one-part fix, §10.15 — plus its verdict)
  — or, when the field is human-held, proposes it (§10.5): pressing Redraft
  asks for a draft, and the planner decides whether it replaces their words. A
  draft Jude still fails after one revision is placed all the same, with low
  certainty and his reasons in its attention (an empty part helps nobody);
  `result.summary` says so and the bad verdict is recorded.
- **What steered a draft is on the record.** Its reasoning carries the
  planner's guidance as a point in their own words, `Your ask: “…”`, cited
  against the part (on a planned brief, against what wrote it), and its
  `decided` line says so: `Drafted the insight on your ask.`
- **The loop is recorded as it happened.** When Jude sends a draft back and
  Dara revises it, the change carries three decisions for the part, in this
  order: the draft he sent back (`superseded_by` the rewrite; certainty low,
  `Jude sent it back`), his verdict on it (`bad`, citing that draft, his
  reasons as its points), and the rewrite, citing the verdict, with the point
  `Jude's note: …` and the line `Rewrote the insight on Jude's note and your
  ask.` Nothing is collapsed into one line. The same holds for `draft_brief`'s
  whole-brief review and for `fix_parts` (§10.15); there, Jude's pass on a
  part he sent back that his final review no longer flags is a `good` verdict
  with a reason, so his note is answered on the record and not only by a
  draft.
- *Changed 2026-10-19* (brief-fact-provenance; owner: no orphan route left).
  On a brief drafted by the planned engine (§10.3), `regenerate_field` runs
  as a one-part `fix_parts` (§10.15) with no verdict: the field is the only
  part, `guidance` is the planner's steer, and the rewrite passes through
  the provenance cleaner like every other path, so its decision carries
  `claims` (§10.7) and its basis is derived from them. The task name, its
  input and its `409` rules (§10.11) are unchanged; its replies carry
  `fix_parts`' stages. The
  field-by-field flow above still applies to a brief the planned engine did
  not draft.

### 10.11 Errors and concurrency

- `draft_brief` or `fix_parts` while any `draft_brief`, `fix_parts` or
  `regenerate_field` job on the same document is `queued` or `running` →
  `409 job_state`. `regenerate_field` while a `draft_brief` or `fix_parts`,
  or a `regenerate_field` for the same field, is → `409 job_state`.
  `regenerate_field` jobs for different fields may run together.
- A model failure in `extract` is a gap (§10.9), not the job's end. The
  captured fields are `failed`, and the drafters draft from what the document
  holds. A scorecard that cannot be made leaves the capture standing and the
  review out. A retrieval
  failure in `draft` does not: the drafter drafts without passages, certainty
  `low`, `attention` naming the failure. A model failure for one drafter makes
  that field `failed`; the others continue.
- Quota: each submission is one unit (§9); polls are free.

### 10.12 Contract suite additions

`mock-middleware/contract_test.py` gains, run against both middlewares:

- `draft_brief` with a prompt only → a long job whose replies carry `stage`
  and `result.fields` for all eighteen keys; the `done` change validates
  against Brief Maker's schema with the §10.4 blocks; no field is `""`, `[]`,
  `{}` or `null`; every written field is named by a decision's `targets`;
  every decision carries well-formed reasoning; every `cap_` and `psg_` cite
  resolves in the data after the change.
- In the field-by-field engine, every captured field's decision cites only
  `cap_` and `mat_` ids. In the planned engine (§10.3) a captured-class part
  may also cite `f_`, `fi_` and `psg_`; one whose basis is `client` cites a
  capture item mapped to its key. Every `fact` capture item's quote is a
  substring of its material's text.
- *Added 2026-10-19.* In the planned engine: every claim cite (§10.7)
  resolves in the document after the change and is in its decision's
  `cites`; every figure, date, duration and price in a written value lies in
  a claim (none is left untied and unmarked); no `because` point that states
  a figure cites nothing; and every value equals what the drafter wrote (the
  cleaner never edits one).
- A key in `locked_fields` is in no patch; a field last written by a human
  decision is in no patch and is in `result.proposals`.
- `regenerate_field` for an unknown or a locked field → `400`; a second
  `draft_brief` while one runs → `409`.
- Polling a `done` job again returns the same change.

### 10.13 Research-fed briefs

*Added 2026-09-29.* A brief can now start from a research document (Contract
4 §5): its pins, findings and sources are merged into the brief's members,
its data is frozen at `data.upstream.<research id>`, and its chain — contests,
verdicts, classify marks — comes with it. This section says which of that
reaches which loop, so research feeds the drafting without touching the
client's words, and each call carries only what it needs.

1. **Where it arrives.** Carried pins in `clan.facts`, carried findings in
   `clan.findings`, carried marks in `clan.decision_chain`, and the frozen data
   as the §1 index only. A brief is *research-fed* when `data.upstream` is not
   empty; one that is not keeps §10.3 exactly.
2. **Evidence by loop.** Chosen in code, per drafter, before any model call.

   | Stage · loop | Gets from the research | Never |
   |---|---|---|
   | `extract` · Loop 1, Loop 2, scorecard | Nothing | Any pin, finding, contest, report or `campaign.*` value |
   | `draft` · `loop4_insight` (insight) | Findings of lenses `consumer_culture`, `category_codes`, `rhythm_moments`, `brands_positioning`, and the pins they cite | |
   | `draft` · `loop5_proposition` (SMP, desired response) | Findings of `brands_positioning`, `consumer_culture`, `category_codes`, and their pins | |
   | `draft` · `loop6_substantiation` (reasons to believe) | Findings of `effectiveness_evidence`, `market_structure`, `brands_positioning`, `regulation_clearance`, and their pins | |
   | `judge` · loop 7 | Nothing: it judges the brief as it would stand (UC-6) | The drafters' findings and pins |

   The client's own material that travelled with the research — a frozen
   `materials` entry whose `asset` is in the brief's `human/assets/` — may be
   attached to `draft_brief` like any upload. It is the client's words, so it
   becomes a material of the brief (`mat_` from its bytes, §10.1) and is
   captured; it is never cited as research.
3. **The selection.** For each drafter:
   1. candidate findings: status `proposed` or `verified`, of the loop's
      lenses, not withheld (item 6);
   2. ordered verified first, then proposed; then `confidence` high, medium,
      low; then `derived_at`, newest first; **at most 12**;
   3. pins: those the chosen findings cite that `clan.facts` holds, not
      `replaced_by` another (the replacement is given instead), not a value of
      an open contest (item 5), not withheld; **at most 40**;
   4. a finding is sent as `{id, statement, status, confidence, lens,
      markets, cites}`, `cites` narrowed to the pins sent; a pin as today.
   The ids sent, with the passages and capture items, are the only ids the
   drafter may cite: a cite outside them is dropped (§10.7).
4. **Unchecked findings are cited only** (owner default, 2026-09-29; may be
   reversed). A `proposed` finding may ground insight, SMP, reasons to believe
   and desired response. It is shown there as **"derived by the agent"**;
   certainty is at most `medium`; `attention` includes "rests on a finding
   not yet verified". It never fills a captured field and never enters
   capture. A person verifies it in the brief (`/verify`, which also sends
   the research a `backref`) or upstream.
5. **Contests.** A pin that is a value of an open contest — the brief's own,
   or one the §1 index lists under `open_contests` (its `fact_ids`) — is not
   sent: nothing is picked yet. Once a person resolves it (Contract 4 §8.1), the chosen pin is
   in `clan.facts` like any other.
6. **`model: false` never goes into a payload.**
   - The mark that holds on an item is the newest `classify` decision in
     `clan.decision_chain`, not superseded, targeting it — own or carried.
     Ids are never remapped, so a mark on `<research id>#facts[f_…]` holds for
     `f_…` in the brief. A mark on a data path holds for everything under it.
   - An item whose mark has `model: false` is withheld from **every** model
     call of every stage: the drafters, the Judge, the capture call and a
     vision transcription. A finding that cites a withheld pin is withheld
     too — its statement may restate the figure. A material so marked is
     recorded `unread` and grounds nothing. A brief field so marked is left
     out of the working brief and the Judge's brief; its `result.fields` state
     is `kept`.
   - The withheld ids are listed in `result.withheld` (display only). An id
     never sent can never be cited, so none reaches a decision.
7. **Cost** (owner default, 2026-09-29; may be reversed). Each drafter gets
   only item 3's selection — never `clan.facts` or `clan.findings` whole, and
   never the frozen data. Prompt caching is not used until a measured run
   shows what it saves.
8. **The extract.** For the brief engine, the research arrives as
   `clan.upstream_payload` (§1): the extract's `upstream` printer, fact rows
   and decision rows, which the engine adapter sends as `payload.upstream`
   (§10.14). The research's campaign fields and report reach no drafter
   (`docs/contracts/clan-extract.md` §11.5). The middleware's own drafters
   still get findings and pins only, as above.
9. **Facts outside the measure list** (*added 2026-10-19*,
   brief-fact-provenance). Research the context stage runs for a brief may
   find facts the measure list does not name. They are kept as document pins
   (§3 `facts_append`, `kept_in_document`, carrying the candidate's layer and
   sources) in the brief only, after `merge_rules.merge` against the pins it
   holds, so one identity holds one pin. They are listed first among the
   held facts Dara sees, so the 400-fact cap never cuts them. They are never
   written to the layers; the measure is still proposed. On a brief whose
   embedded facts schema predates `kept_in_document` the fact stays a run-log
   note, and a claim resting on it is `to_confirm` with the fact id in
   `suggest`. The Research Tool keeps its gap notes as before.
10. **Rewrites keep what was worked out** (*added 2026-10-19*). Every
    rewrite (review revise, the jev check loop, `fix_parts`, the brief
    engine's) carries the part's prior claims, `research_upstream` and the
    draft's library, and asks Dara to keep a worked-out conclusion unless the
    instruction says it is wrong. The rewrite passes through the cleaner like
    the draft. A conclusion a rewrite lost is counted in the run log
    (`derived_lost`), never restored by code.
11. **Judges never strip a conclusion** (*added 2026-10-19*). Jude grades a
    `derived` claim on its working and inputs, not on whether its number is
    literally in a fact, and code sets a recomputed derived claim to
    `supported` whatever Jude says. In jev mode the cleaner's `to_confirm`
    and `check: false` claims are added to `rv.claims` as code-derived
    `unsupported` verdicts, and `explain_flags` sees each claim with its
    working. In both modes **no claim verdict adds a part to the revise list
    or the check loop's todo** by itself, and a failed `tie_claims` call
    rewrites nothing.

When built, §10.12 gains, for a research-fed brief: no captured field's
decision cites an `f_` or `fi_`; a drafted decision citing a `proposed`
finding has certainty at most `medium` and the `attention` of item 4; no
decision cites an id marked `model: false`; every `fi_` cite resolves in
`clan.findings` and is not rejected.

### 10.14 Drafting through the brief engine

*Added 2026-09-30* (owner: Sai's engine is the brief generator; we adapt to
it and never change it). With `NAPKIN_BRIEF_ENGINE_URL` set, `draft_brief`
is drafted by the engine's agent server (`engine/agent-server/server.py`),
and the job turns its answer into the §10 change. Unset, nothing here
applies. `regenerate_field` is unchanged either way. The adapter is
`server/napkin/brief/engine.py`.

1. **The request.** One `POST <url>/`, waiting at most 900 s:
   `{request_kind: "agent", payload: {task: "draft_brief", input, attachments:
   [{name, extracted_text}], upstream?}, clan: {data: {project_name?,
   client?}}}`. `input` is the prompt's text (`""` when there is none). Each
   other readable material is an attachment. A picture is transcribed
   first (Contract 5 §1.6), and one that cannot be read is recorded unread
   and not sent. *Changed 2026-09-30:* every material is the client's, so
   `input` is the brief the engine captures: the prompt's text, then each
   readable material's text under a plain heading of ours (`--- From the
   client: <name> ---`), never the engine's `===== ATTACHMENT` header, whose
   text it treats as supporting context, never as fact. Only a picture's
   vision transcription goes in `attachments`. `loops37: true` is sent (the
   engine's own switch for Loops 3–7: insight, SMP, reasons to believe);
   `NAPKIN_BRIEF_ENGINE_LOOPS37=0` leaves it to the engine host's
   `BRIEF_LOOPS37`. A name (`project_name`, `client`) that a `model: false`
   mark holds (§10.13 item 6) is left out of `clan.data`, and the engine's
   value for it is not taken (`kept`). `upstream` is `clan.upstream_payload` (the extract's
   `upstream` printer, clan-extract.md §1.1, §11.2), narrowed to `brand`,
   `category`, `competitors`, `facts` and `decisions`, and left out when it
   is empty. Nothing else in the document is sent: the materials go whole
   (they are the brief; a material mark is not read here yet, §10.13 item 6).
2. **The reply** is mapped by the §10.3–§10.5 rules. Omitted, not blank. A
   locked field is `kept`. A value equal to what the document holds is not
   written, nor proposed (`map_brief` echoes the names sent). Otherwise a
   field a person holds is proposed. Each written field (per
   leaf) gets one `edit`, action `draft`, `agent draft_brief@1.x/drafter`
   (Dara), flatten `drafted_by: "brief-engine"`. Its cites are the `mat_` ids
   the engine read and, for every `fact_ref` on that leaf, the fact id when
   `clan.facts` holds it, or the research finding by its own id.
   The refs themselves ride as flatten `fact_refs`. A ref the document holds
   neither way is not cited, and the run decision says so. `certainty` is
   `medium`, or `low` with `attention` for a draft the engine's rationale
   names under "DRAFTS TO REVIEW".
3. **Attention items.** `open_questions` is written whole (action
   `questions`), and its `attention` lists them. Each `fact_conflicts` entry
   is an `edit`, action `flag_conflict`, targeting `#facts[<id>]` (or the
   finding), whose `attention` asks a person to settle which is current. The
   engine picks no winner, and neither does the middleware.
4. **The run decision** (action `draft_run`, targeting the materials)
   records `material_read`, `unread`, `abstained`, the engine's `rationale`
   as a point, `research_facts` and `research_decisions` when the reply
   carries them (under `meta`), and the engine's `context` as
   `engine_context`. Its `attention` names a degraded run, a non-Claude
   answer, a capture without the model, research rows the engine skipped,
   and values in a shape the field cannot hold.
5. **No Judge.** The engine checks its own drafts, so the `judge` stage does
   nothing: no verdicts, no `review`. The stages stay `extract | draft |
   judge` for the view. The engine is called from `extract`, which reports
   `job.stage: draft` and each field `drafting`/`drafter` while it waits.
   `result.engine` is `{state: waiting | running | used | skipped,
   reason?}` (display only).
6. **Never a halt.** Any of these makes the job run the middleware's own
   `extract → draft → judge`, exactly as without the setting: a timeout, an
   unreachable engine, a non-2xx, a body that is not a JSON object or
   carries `error`, a reply with no brief field, or a reply that cannot be
   mapped. The reason (`result.engine.reason`) never carries request or
   reply content. It is added to the capture decision's `attention` (or,
   when the fallback's own capture does not finish either, to that stage's
   gap decision, whose action is also `capture`, §10.11) and to
   `result.summary`; the job still ends `done` with `result.gaps` (no stage
   halts the brief, §8.4). A readable reply that is thin is not a failure:
   what it has lands, and the rest is `absent` and named in `abstained`.
   The engine call runs inside the `extract` stage, so that stage's time
   limit (60 minutes) covers the engine's 900 s plus the fallback capture.
7. **Rewrites are cleaned; the engine's draft is not** (*added
   2026-10-19*, brief-fact-provenance). When the engine's draft is checked
   and parts are rewritten (`EngineCheckedBriefJob`), each rewrite reads
   `provenance.evidence` (the same facts the planned engine's Dara sees,
   upstream headline cites included) and passes through `clean_parts`
   (§10.3), so it carries `claims` (§10.7) and a derived basis. The engine's
   own draft keeps item 2's cites and is not cleaned.

---

### 10.15 `fix_parts`

*Added 2026-10-19* (owner: when Jude leaves a problem on a brief, the planner
asks the crew to fix it: Sam finds what it lacks, Dara rewrites the parts
together, Jude checks them).

`{ verdict, guidance? }` — fix the problem a bad verdict names.

- `verdict` is the id of a bad verdict in `clan.decision_chain`, not
  superseded, that targets one or more of the eighteen keys of §10.4 not
  written since (a later `edit` or `resolve`, not a proposal). Any other id,
  a verdict every part of which is answered, a locked brief, or a verdict whose
  parts are all locked is `400 invalid_input`.
- **The problem** is the verdict's own words (its reasoning's `decided` and
  points), then those of every person's bad verdict still standing on the
  same parts. The job's parts are the verdict's open parts.
- Stages `context` — Sam: one plan call (`plan_fix`) with the brief as it
  stands, the parts, the problem and every fact and finding the brief holds,
  giving each part an instruction and the research the fix lacks; that
  research runs as `draft_brief`'s (§10.13): already-held needs skipped (jev),
  at most two runs, each pin and source in the change, its raw facts written
  to the layers as every research run's are — then `draft` — Dara rewrites
  the parts together in one call (`fix_brief_parts`) from the problem, the
  instructions and the facts, never one a person excluded — then `judge` —
  `draft_brief`'s Judge on the parts only (the whole-brief review, or with
  jev the check loop), whose one rewrite reaches only those parts.
  `progress`: `{done, total: 3}`.
- It writes only the parts (an `edit`, action `draft`, each) and the review;
  a part a person wrote last is proposed (§10.5). `open_questions`, when not
  a part, only gains what Jude says only the client can answer. A part's later
  edit answers the verdict (Contract 4, the lock list). After a rewrite with
  jev, Jude's argument note is placed as a new bad verdict only while jev
  still reads the argument as broken.
- `result.summary`: how many parts were fixed, proposed, and the new facts.
- *Changed 2026-10-19* (brief-fact-provenance). Dara's rewrite passes
  through `clean_parts` (§10.3), so each part's decision carries `claims`
  (§10.7). The client's words come from `data.capture.items`, the capture
  the document holds, so the client guard holds here as on the draft. The
  fix note no longer asks for an unsupported claim to be left out, nor bans
  a figure that is not literally in a cited fact: a worked-out figure is
  tied by the cleaner, and one nothing supports is kept as `to_confirm`.

### 10.16 The run log

*Added 2026-10-19* (brief-fact-provenance). The dogfood run log
(`server/napkin/runlog.py`, one JSON-lines file per job under
`NAPKIN_RUNLOG_DIR`) is not part of the change, but what it may hold is a
contract, because client material is confidential.

- **Bodies.** With `NAPKIN_RUNLOG_BODIES` unset, a model call is logged by
  its sizes only, a search by its ids and sizes, and every note this feature
  adds or changes holds only ids, kinds and counts. A decision line carries
  its agent, action, targets, certainty level, cite counts and claim kinds,
  and its `decided`, `why_certain`, `because` and `attention` text only when
  bodies are on. With `NAPKIN_RUNLOG_BODIES=1`, every model call's payload
  and reply and every search's queries, URLs and returned page text (title,
  `published_at` and text, capped per result) are logged too.
- **Where bodies are on.** On staging, always (owner, 2026-10-19: staging
  logs what the models and searches saw, so a brief can be traced claim by
  claim). Staging's roster holds only Napkin accounts, its run log is read
  only by them through `/api/dogfood/runlog`, and the dogfood purge empties
  it. Production never sets it. Terraform holds both
  (`infra/modules/services` variable `middleware_runlog_bodies`, `true` only
  in `infra/envs/staging`; `stack.tftest.hcl` asserts it). Locally, set it
  for test prompts only.
- **`provenance`**, one note per clean (§10.3):

  ```yaml
  stage: draft | revise | check | fix | engine_checked
  parts:
    background:
      basis_said: client          # what the model labelled it
      basis: research             # what the claims derive
      claims: [{ n: 1, kind: derived, rests_on: [f_A, f_B], by: match, check: recomputed, suggest: [] }]
      dropped_cites: 0            # cites that did not resolve
      to_confirm: 0
      missed: 0                   # sentences the code net marked that tie_claims did not name
      derived_lost: 0             # worked-out claims a rewrite lost
  tie_call: ok | failed | skipped
  ```

  `rests_on` is `none` for a claim nothing supports. No claim text, value,
  quote or working is written with bodies off.
- **`unlisted_measures`** is `[{key, fact_id}]`: the measure research found
  outside the list, and the id of the fact (the document pin that keeps it,
  §10.13 item 9). Never its quote or URI with bodies off.
- A research unit's model calls name their job in the CloudWatch line, and
  the `napkin.model` line carries `cache_read` and `cache_write` tokens.

## 11. Client review — no middleware task

*Removed 2026-09-30* (owner: no extra model call). `find_client_parts`, the
task that asked a model which parts of a document a client's answer was
about, is gone: no handler, no registry entry, no built-in map entry, no
stand-in. The host finds the parts itself, deterministically, from the
client's words and the app's part names (Contract 4 §7.5.2a), and nothing in
client review calls the middleware. A request for `find_client_parts` is
`400 unknown_task`.
