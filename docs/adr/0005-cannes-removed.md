# ADR-0005: Cannes Lions material is removed

Status: written; the removals are run by a person. Feature record: `features/cannes-removal.clan`.
Decision of record: `docs/napkin-os-build-prompt-v3.1.md` section 8 (Laurence, 10 Nov 2026).

## The rule

Cannes Lions material stays out of every model and every retrieval. Effie and WARC material gets the
same care; whether it is removed too is an open question with the owner.

## What is removed, and from where

| What | Where | How |
|---|---|---|
| Chunks with `source` cannes | Every local index (`engine/rag/_index_v3`, `_v4`, `_v5`, `index`), on every clone | `engine/rag/cannes_removal.py remove` |
| Points with `source` cannes | Qdrant collections `Napkin_OS`, `napkin_rag`, `napkin_rag_v2`, `napkin_awardlib_test`, in the `house` store | same script, delete by filter |
| The raw export and generated markdown | `engine/reference/_raw/cannes.json`, `engine/reference/rag/cannes/`, `engine/reference/rag_test/cannes/` | same script |
| Source objects and their versions | S3 `corpus` bucket (non-current versions are kept 365 days, so versions go too) | runbook, by hand |
| Snapshots | S3 `backups` bucket and the RAG host disk | runbook, by hand |
| The ingest | `engine/ingest_cannes.py` exits with a message; it is no longer in `engine/pyproject.toml` | code, this record |
| The pack | `cannes` in `engine/rag/packs.lock` and `engine/packs_dist/cannes/` | regenerated or removed by a person (runbook) |
| Retrieval | `source nin [cannes]` rides on every search (`engine/rag/retrieve.py` `EXCLUDED_SOURCES`, record `harness`); the Qdrant mock no longer lists or maps a cannes pack | code |

The full map of where the material sat is `docs/discovery/cannes-map.md`. The steps, with a count
before and after for each store, are in `docs/runbooks/cannes-removal.md`.

## What can come back, and when

Only under a signed licence from Cannes Lions that allows use in AI systems (training, embedding and
retrieval by a model). The licence has to say, at least:

1. that licensed text may be embedded and served to a model, and by which providers;
2. that passages may be quoted in generated work, and how they must be attributed;
3. the term, and what must be deleted when it ends.

What would be restored: `engine/ingest_cannes.py` (the code is kept; only `main()` is stopped), the
`py-modules` entry in `engine/pyproject.toml`, and the `cannes` entry removed from `EXCLUDED_SOURCES`.
The material itself would come from the original export, never from a backup: no backup is kept.

## Not changed here

`EXCLUDED_SOURCES` still lists only `cannes`. Whether effie or warc join it is for the owner.
There is no WARC ingest in the repo (WARC is only a trusted web domain in `server/napkin/rules/tiering.py`).
