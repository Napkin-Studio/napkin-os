# Design: an allow-listed agent context

Branch `feat/align-confidential-prices`, head `38cae6e1`. Design only; nothing is built.
Rule (owner): "Confidential means Napkin's own systems never take the part in; the agency and the client see everything." No prices or costs in agent context; `run_cost` and `set_budget` never go to agents.

## 1. Why the current shape keeps leaking

`ops/read.rs clan_context_for_agent` (545) copies the whole `.clan` through `confidential::scrubbed_clan` (384) and then removes what `Marks::covers` names. Every host-made copy of a value is a new address the subtraction must know about:

| Leak | Where | Cause |
| --- | --- | --- |
| 1 Version history | `ops/edit.rs:340-348` writes `before` and `fields_changed`; `confidential.rs:449-452` tests only `targets` | an `edit` has no `targets`, so the old words of a confidential field go out |
| 2 Quotes | `confidential.rs:195` | source mark applied under `projection.pins.<f>.quotes`, not `facts[f].quotes` |
| 3 Copy under a new id | `Marks::covers_path` matches by id only | same fact, new id, no mark |
| 4 Finding cites a closed fact | none | the statement restates the fact |
| 5 File names | `Marks::asset` (251), `drop_confidential_attachments` (read.rs:333) | matched by name per call site; names stay in free text |
| 6 App payload | `confidential::redact` (341) | text match, 24-character floor; numbers, short strings, partial quotes pass |

The client wall does not have this problem because `napkin-web/src/clean.rs` and `ops/client_pieces.rs` (`BRIEF_FIELDS`, `BRIEF_NEVER`, `SPECS`) read named fields only, and `tests/client_link.rs` holds every schema key to one list or the other.

## 2. Two approaches

**A (recommended): a typed builder and a sealed request type.** New module `crates/napkin-host/src/outgoing.rs`. Nothing is copied and scrubbed; each outgoing key is read by name from a `SafeDoc`. `proxy_call` accepts only an `Outgoing`, which only this module can construct. About 36 hours.

**B: keep `scrubbed_clan`, invert it at entry level, and seal the sender.** `scrubbed_clan` copies only named zip entries instead of all of them, the chain test gains `fields_changed` and `before`, the quotes path is fixed, and `proxy_call` takes the same sealed `Outgoing`. About 14 hours. It closes leaks 1, 2 and the bypass risk, but `shared/data.yaml` is still walked whole, so the next host-made copy inside the data (as `projection` was) leaks again. It does not address 3 to 6.

Recommendation: A. B's sealed type is step 1 of A, so B is a valid first merge if the blockers must close today.

## 3. Approach A in detail

### 3.1 The choke point

```
outgoing.rs   (wasm-clean: serde_json, serde_yaml, clan_sdk, sha2, unicode-normalization only)
  pub struct SafeDoc      // only constructor: SafeDoc::of(&Document); holds Marks + Closed
  pub struct Outgoing     // private field; no Deserialize, no From<Value>
  Outgoing::task(&SafeDoc, kind, payload: &Value) -> HostResult<Outgoing>   // api_proxy
  Outgoing::judge(&judge::Prepared, version)   -> Outgoing                  // judge_run.rs:68
  Outgoing::prompt(text)                       -> Outgoing                  // proxy::agent_prompt, no document
  pub fn inspect(&self) -> &Value              // tests read, cannot build
  pub(crate) fn into_body(self) -> Value       // called in proxy.rs only
```

`proxy::proxy_call(cfg, kind, out: Outgoing, agency)` replaces the `Value` parameter. `Session::outgoing(kind, payload)` replaces `Session::attach_extracted_text`, `redact_confidential` and `clan_context_for_agent` (session.rs:392-414), which are deleted. `ops/judge.rs prepare`, `searchindex.rs` (508) and `confidential::feed_view` read through `SafeDoc` accessors instead of `Marks::scrub` on raw data, so the Judge request and the search index share the one reader.

### 3.2 The allow list (`CONTEXT_KEYS`, a const; anything not named is not sent)

| Outgoing key | Read from | Rule |
| --- | --- | --- |
| `id`, `revision`, `version`, `document_type`, `app`, `lineage`, `workspace_client` | manifest | ids and names, as today |
| `schema`, `pipeline` | `agent/output-schema.json`, `app/pipeline.yaml` | whole; they hold no document content |
| `data.<key>` | `shared/data.yaml` | `<key>` is in `AGENT_SPECS[app]` (new table beside `client_pieces::SPECS`; an app with no entry falls back to its schema's top-level properties). Below the key, each node is dropped when `Marks::touches` says so. Never copied: `projection`, `upstream`, `locked`, `signers`, `handoffs`, `budget_hours` |
| `data.projection` | rebuilt | `members::projection()` called on the safe member lists; `built_from` hashes taken from the stored block (the middleware reads them, middleware-api 8.5) |
| `data.upstream` | `read::upstream_index` | keys, `direct`, open contest ids; no frozen value |
| `facts[]` | `shared/facts.yaml` | not in `Closed`; fields are the list in `members::projection` (layer, entity, key, market, value, unit, as_of, confidence, licence, method, retrieved_at, sources, version, status, pin_reason, replaced_by) plus `id`, `review`; `sources` and `quotes` lose every closed source id |
| `findings[]` | `shared/findings.yaml` | not in `Closed`; id, statement, status, confidence, cites, lens, review |
| `sources[]` | `shared/sources.yaml` | not in `Closed`; `members::SOURCE_FIELDS` plus `id` |
| `edits{}` | `shared/edits.yaml` | entry whose `key` does not `touch` a mark |
| `decision_chain.decisions[]` | `agent/decision-chain.yaml` | section 3.3 |
| `context` | `agent/context.md` | sent only when the document and what it carries hold no mark (today's behaviour, confidential.rs:470) |
| `upstream_ask` | `read::upstream_ask` | each `BRIEF_ASK_PATHS` value tested with `Marks::carried` |
| `upstream_payload`, `upstream_skipped` | `clan_sdk::extract::upstream` | run on a `ClanFile` that `SafeDoc::as_clan()` assembles from the rows above only, then every row naming a `Closed` id is dropped |
| `withheld` (new) | builder | `{count, addresses[]}`: addresses and ids, no values, so a task does not draft over a part it was not shown |

Materials: a material row is sent by id with `kind`, `sha256`, `media_type`; `name`, `file`, `text` only when the material is open.

### 3.3 Decisions, edits and version history

The confidentiality of an entry is derived from what it touches, not from `targets`. `touched(d)` is the union of `targets`, `fields_changed`, the keys of `extra.before`, and `cites`. New `Marks::touches(address)`: true when a mark covers the address **or lies under it** (a write to `objectives` carries `objectives.behavioural` in its `before`).

- Kinds are allow-listed in `DECISION_ALLOW: &[(kind, &[field])]`. `run_cost`, `set_budget` and any kind not listed are not sent at all, so a new cost kind is out by default.
- An open entry sends the fields its kind lists (for `edit`: id, kind, agent, actor, action, targets, cites, fields_changed, superseded_by, timestamp, rationale).
- A closed entry (any touched address `touches`) sends ids only: id, kind, agent, actor, targets, superseded_by, timestamp, licence.
- `before`, `reasoning` and any `extra` key are never sent. No middleware code reads `before` (grep of `server/napkin`), and `ops/versions.rs` serves it only to the shell.
- `without_outsider_text` (read.rs:518) becomes the `client_review` row of the table.

### 3.4 How a mark follows a fact

`Closed::of(clan)` is computed once per request, to a fixed point:

1. Seed: every fact, finding, source and material that `Marks::covers` names, from the document's own marks, the carried chain's marks, and each frozen copy's `confidential_fields` and licences (`Marks::carried`). Member ids are unique across documents, so a member mark travels with a spin-off as it does today.
2. Copy: a fact with the same `(layer, entity, key, market)` and the same normalised `value` as a closed fact is closed, as is the other end of a `replaced_by`.
3. Source to fact: a closed source's id and quotes are removed from every fact; a fact left with no open source is closed.
4. Citation: a finding that cites a closed fact is closed. A decision that cites a closed id is closed by 3.3.
5. A data field is not closed by citation alone (it would close most of a research-fed brief); the person marks the field. Open question 4.

### 3.5 Attachments and file names

One function, `outgoing::asset_key(name)`: percent-decode to a fixed point (at most 3 passes), NFC, backslash to slash, strip `./` and `human/assets/`, basename, lower case. `Closed.assets` holds the key **and the sha256** of every closed material's file. An attachment is dropped when its key or its `sha256` is in the set, so a renamed copy is caught. `Marks::asset` and `drop_confidential_attachments` are deleted. The host fills `text`, `image`, `document` and `images` itself from the asset (`read::splice_*`); a value the app supplied in those keys is discarded.

### 3.6 What an app may add: typed slots

`TASK_SLOTS: &[(task, &[(key, Slot)])]`, one row per task of middleware-api section 1. A key not listed is dropped and counted; an unknown `task` on kind `middleware` is refused with 400.

| Slot | Check |
| --- | --- |
| `Id` (`about`, `verdict`, `job_id`, `question_id`, `material_id`, `option_id`) | id pattern; in `Closed` is refused with 422 `confidential_target` |
| `Enum`, `Bool` (`lenses`, `markets`, `intake`, `redraft`, `skip`) | fixed values |
| `FieldKey` (`regenerate_field.field`) | a schema key; refused when it `touches` a mark |
| `FromDoc(address)` (`draft_brief.prompt` is `data.brief_input`) | the host reads it through `SafeDoc`; the app's value is ignored |
| `Attachments` | section 3.5 |
| `PersonText` (`guidance`, `question`, `text`, `answers`, `extract_ask.prompt`) | words typed in this request; length cap; `confidential::redact` as a net with the floor lowered to 12 characters, whitespace and case folded, plus every closed file name |

Numbers, short strings and partial quotes can only travel in a `PersonText` slot, typed by a person in that request. That is the residual; see open question 2.

### 3.7 Migration

Delete: `scrubbed_clan`, the `KEEP` list, `read::redact_confidential`, `read::clan_context_for_agent`, `drop_confidential_attachments`, `Marks::asset`, `READERS` entries "agent context", "agent payload", "proxy". Keep: `Marks`, `covers`, `scrub` (the nested walk under an allowed key), `is_confidential`, `scrubbed_data` for `feed_view`, and `redact` as the net on `PersonText` only. The nine tests at read.rs:1304-1508 and the tests in `tests/confidential.rs` move to `Outgoing::inspect`. Contracts to amend: `docs/contracts/middleware-api.md` section 1 (`before` and closed entries' words absent, `withheld`, dropped keys), `os-layer.md` C4 and line 1389, `mock-middleware/contract_test.py`.

### 3.8 Tests, each written failing first (`crates/napkin-host/tests/confidential.rs`)

1. `an_edit_of_a_confidential_field_sends_no_before_and_no_words` (also a write to the parent key).
2. `a_confidential_sources_quote_is_in_no_fact_and_no_pin`.
3. `a_fact_copied_under_a_new_id_stays_closed`.
4. `a_finding_that_cites_a_closed_fact_is_not_sent`, with the spin-off rig (`spun_off()`).
5. `a_confidential_file_is_dropped_under_every_spelling_and_by_hash` (`%20`, `%2520`, `./`, `human/assets/`, upper case, NFD, renamed).
6. `an_app_payload_keeps_only_its_named_slots` (extra key with a number, a 10-character string and a half quote).
7. Default deny: a canary in an unknown data key, an unknown zip entry, an unknown decision kind and an unknown `extra` key is in no `Outgoing`.
8. Seal: a `compile_fail` doctest constructing `Outgoing` outside the module; a source test that `reqwest` appears only in `proxy.rs`, `into_body(` only in `outgoing.rs` and `proxy.rs`, and `proxy_call(` call sites pass a value from an `Outgoing::` constructor. This replaces the string check in `every_reader_calls_the_one_test...`.
9. `no_cost_kind_and_no_cost_key_is_sent` (`run_cost`, `set_budget`, `estimate_eur`, `charged_eur`, `price_eur`, `budget_hours`, `usage`).

### 3.9 wasm32

`outgoing.rs` is pure and compiles with `--no-default-features`; `proxy.rs` and `judge_run.rs` stay behind `native`. `scripts/check.sh:147` must pass. Source-reading tests use `std::fs` under `#[cfg(test)]` only, as `confidential.rs` does now. No new dependency (`sha2`, `unicode-normalization` are already in the workspace).

### 3.10 What legitimate content is lost

`agent/context.md` whenever a mark exists; rationale and reasoning of closed entries; all `before`; findings built on a closed fact; a carried brief's frozen data beyond the ask; extra payload keys an app sends today. Mitigations: the `withheld` block and a 422 on a closed `FieldKey`, so nothing is drafted blind and the person is told ("Napkin did not read 3 parts"); later, replace `context.md` with `agent/context.yaml` entries `{about: <address>, text}` so each note is decided by address.

## 4. Effort (Sonnet builder, approach A)

Failing tests 3; `touches` and `Closed` 4; `SafeDoc` and the context builder 6; `DECISION_ALLOW` 3; `TASK_SLOTS` and attachments 5; sealed `Outgoing`, proxy, judge_run, session, routes 3; moving existing tests 4; Judge and search index onto `SafeDoc` 3; contracts, mock middleware, pytest 2; `check.sh`, wasm, e2e 62 and 73: 3. Total about 36 hours.

## 5. Risks

- A middleware task reads a key that is no longer sent. Only `data`, `facts`, `findings`, `sources`, `edits`, `decision_chain`, `schema`, `pipeline`, `upstream_ask`, `workspace_client`, `id`, `version` are read in `server/napkin` (grep); the contract suite must run before merge.
- Not verified: the payload shapes of `request_kind: "agent"` apps (no template call site was found by grep); the builder inventories them first and adds rows or the app breaks.
- Not verified: whether a copied fact carries an explicit origin field; rule 3.4(2) assumes none and matches on identity and value.
- The fallback to schema keys for an app with no `AGENT_SPECS` row trusts the app's schema. It can be removed once every installed app has a row.
- Free text on an open entry (a rationale that quotes a confidential part) is not caught by address. The net in 3.6 runs over it; it is not a control.

## 6. Open questions for the owner

1. C4 says a classify mark's `model` flag lets the agency's own agents read a part. The branch ignores it (never sent). Keep never, or honour `model: true` for drafting tasks only?
2. A person types a confidential number into a question to an agent. Allowed as the person's own act, or refused when the document holds any mark?
3. `budget_and_scope` is one of the thirteen brief fields and the drafters write it. Is the client's budget a "price" that must stay out of agent context?
4. A fact with one confidential and one public source: keep the value and drop the quote (designed), or close the fact?
5. A finding that cites one closed fact among several: close it (designed), or only when every cite is closed? And should a brief field that cites a closed fact close too?
6. With any mark on a document, `agent/context.md` is withheld whole. Acceptable until notes are stored by address?
