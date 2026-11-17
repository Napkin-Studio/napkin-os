# Where Cannes Lions, Effie and WARC material sits

Decision of record: docs/napkin-os-build-prompt-v3.1.md section 8, Laurence, 10 Nov 2026.
Cannes Lions material stays out of every model and every retrieval. Effie and WARC
material gets the same care.

**How this map was made.** A read-only subagent read code, config, schemas, tests' code
and feature records. It opened no data file. For data files it used only names, sizes,
line counts and match counts. It ran no ingest, queried no store and made no network call.
Nothing was deleted. A person approves and runs any removal (feature record `cannes-removal`).

## The short version

- **Cannes material is in the retrieval index today.** foundation-spec.clan records 497 Cannes chunks out of 7,315 in the local index and in the Qdrant collection `Napkin_OS` (21 Sep 2026). `engine/rag/packs.lock` lists a `cannes` pack of 499 chunks.
- **The Brief Maker asks for it.** The cannes pack serves two brief loops (loop4_insight and loop6_substantiation). `server/napkin/brief/drafters.py` (CASE_LOOPS) and `mock-backend/qdrant_retrieval.py:47` name it.
- **Nothing excludes it.** `engine/rag/filters.py` can already express `source nin [cannes]`, but no default clause, flag or config uses it. The only hard-wired exclusion is for the award library.
- **No trace can prove its absence.** The brief retrieval trace (`engine/rag/brief_context.py:288`) records cite, scope, tenant and relevance per hit, not `source`. Phase 1 test 12 ("no source=cannes hit") needs that field.
- **No raw Cannes corpus is tracked in git.** `engine/.gitignore` ignores `reference/_raw/` and `reference/rag/`, and neither exists in this clone. The raw files live on people's machines and in AWS.
- **Deployed staging serves no passages at all.** `NAPKIN_RETRIEVAL_URL` is set nowhere in `infra/`, so the deployed Brief Maker gets nothing from any pack. The exposure is local runs, the hosted Qdrant cluster and the S3 corpus bucket.

## Ingest code

| Path | Reads | Writes | Tag |
| --- | --- | --- | --- |
| engine/ingest_cannes.py | engine/reference/_raw/cannes.json (a Lions "Love The Work" export) | engine/reference/rag/cannes/cannes_NNNN.md, one per case: insight, strategy, idea, execution, results | source: cannes |
| engine/ingest_effie.py | engine/reference/_raw/effie.csv or JSON (193 cases) | engine/reference/rag/effie/effie_NNNN.md | source: effie |
| engine/ingest_awardlib.py | engine/reference/_raw/awardlib/cases.xlsx (5,493 cases) and engine/reference/awardlib/brand_categories.json | engine/reference/rag/awardlib/, 1,190 chunks | source: awardlib, gated |
| engine/scripts/build_test_corpus.py | the local corpus | engine/reference/rag_test/, including 15 real Cannes cases | cannes |
| engine/scripts/backfill_source.py, distil_pack.py | chunks | the `source` field; pack digests | several |

`engine/pyproject.toml:35` registers ingest_cannes and ingest_effie. No WARC ingest exists:
WARC appears only as a trusted web domain in `server/napkin/rules/tiering.py:54`.

## Tracked files that may hold derived material

Not opened. A person must review each one, since a model may not.

| Path | Size | Why it is listed |
| --- | --- | --- |
| engine/packs_dist/cannes/digest.md | 2,412 B | A distilled digest of the cannes pack |
| engine/rag/golden/labels/pairs.jsonl | 508,382 B | 6 lines match "cannes"; likely holds case snippets |
| engine/rag/golden/labels/prelabels.jsonl | 118,240 B | 6 lines match |
| engine/rag/golden/remeasure_2026-09-23/eval_ipa_cannes_playbook_500.json | 6,437 B | 13 lines match |
| engine/eval/baselines/v2-grounded-postrefactor.json | 19,044 B | 12 lines match |
| engine/rag/calibration/local.json, nemotron.json | 6,433 B, 5,448 B | 4 lines match each |
| engine/rag/packs.lock | 1,186 B | Lists the cannes pack. Generated, never hand-edited |
| engine/deck/rubric.json, docs/deck-maker/winning-pitch/rubric.json | about 18.9 KB each | Name Cannes and Effies, probably only as criteria |
| engine/reference/awardlib/brand_categories.json | 143,062 B | Brand to category table, derived from the award workbook |

## Stores and indexes

| Store | What the repo says | Removal needs |
| --- | --- | --- |
| Qdrant `house` store and collection `Napkin_OS` | 497 cannes chunks of 7,315 (foundation-spec.clan, index_state) | A person deletes points where source=cannes, and decides on snapshots |
| Collections `napkin_rag`, `napkin_rag_v2`, `napkin_awardlib_test` | The test collection holds cannes 497 of 6,750 (award-in-brief-maker build log) | Confirm which clusters hold them, then delete |
| Local indexes `engine/rag/_index_v3`, `_v4`, `_v5` | v4 holds 497 cannes chunks | Rebuild without cannes, on every clone |
| S3 `corpus` bucket | "the licensed craft corpora (Cannes, D&AD, IPA, Effie...)" (infra/modules/storage/main.tf:2). Non-current versions kept 365 days | AWS access. Versioned objects survive a delete |
| S3 `backups` bucket and the RAG host disk | Qdrant snapshots taken by hand | AWS access |
| Local raw files | `engine/reference/_raw/cannes.json`, `_raw/effie.csv`, `_raw/awardlib/cases.xlsx`, `reference/rag/*` | Each person checks their own machine |

## Retrieval paths that can return a Cannes hit

- `engine/rag/retrieve.py` (BRIEF_SAFE filters only stage and status)
- `engine/rag/brief_context.py` (a cannes bucket, RECENCY_SOURCES)
- `engine/agent-server/research.py:4` (the corpus precedent tool searches ipa, cannes, effie)
- `mock-backend/qdrant_retrieval.py:47` (the dev retrieval port for the Brief Maker)
- `server/napkin/retrieval.py` and `server/napkin/brief/drafters.py` (CASE_LOOPS)
- `engine/rag/chunking.py:61,199` and `normalise.py` carry Cannes-specific handling

## The award case library (features award-data-fit, award-in-brief-maker)

- Built from a workbook of 5,493 cases. 1,190 pass the clean slice.
- The records say the insight and proposition are "Napkin reconstructions from public sources, not the entrant's words", with entrant-reported results. That matches the own-words rule.
- It is off by default and off everywhere: `RAG_AWARDLIB` unset means off, and it fails closed.
- 541 cases come from Effie-family shows. So the Effie care rule applies to it.

## Not determined, because it would mean reading the material

1. Whether the award workbook or its chunks include Cannes Lions cases or any archive text. The ingest dedupes against cannes, which suggests overlap.
2. Whether the tracked golden, eval and calibration files and the cannes digest hold case text or only ids and scores.
3. The live state of the hosted Qdrant cluster, the S3 corpus bucket and the RAG host disk.
4. What napkin-cannes-dataset holds. This login cannot open it.

## Tests that name cannes

About 60 mentions across 17 test files in engine/rag, mock-backend/tests, server/tests,
layers-service/tests, engine/deck/tests and app/tests/templates.test.ts. Most use inline
fixtures. They change with any pack or source removal.
