# Runbook: remove Cannes Lions material

For a person with AWS and Qdrant access. An agent never runs this against real data and nothing here
is automatic. A deletion has no roll back. Rule: `docs/napkin-os-build-prompt-v3.1.md` section 8.
Record the date, your name, the command and its output beside each row of the table at the end.

## 0. Before you start

1. Read `docs/adr/0005-cannes-removed.md` and `docs/discovery/cannes-map.md`.
2. Approve the removal in the record (`features/cannes-removal.clan`), naming who runs which store.
3. Do not run `napkin-packs sync` or any ingest until step 4 is done: a sync can re-publish the pack.
4. Run every command from the repo root, with `engine/.env` loaded as usual for Qdrant.

## 1. See what is there (a dry run, changes nothing)

```
cd engine/rag
python cannes_removal.py plan --qdrant --collection Napkin_OS --collection napkin_rag \
  --collection napkin_rag_v2 --collection napkin_awardlib_test
```

It prints names, counts and sizes, never content: the rows and points with source cannes in each local
index and collection, the files it would delete, the tracked files for you to review, and a report on
Effie and award-library files. Keep the output. Use only the collections that exist on your cluster.

## 2. Remove from the stores this tool covers

```
python cannes_removal.py remove --qdrant --collection <each one> \
  --approved-by "Your Name" --log cannes-removal-<store>-<date>.json --execute
```

Without `--execute` it is a dry run. With it, the tool deletes cannes rows from the local indexes, deletes
the points by filter, deletes the raw export and generated markdown, and then re-counts. It exits non-zero
unless every count is 0. The log holds the counts before and after. Each person does this on their own clone.

## 3. Remove by hand (the tool never does these)

- **S3 corpus bucket.** List first: `aws s3api list-object-versions --bucket <corpus bucket> --prefix <the Cannes prefix>
  --query 'length([Versions,DeleteMarkers][])'`. Delete every version and delete marker of every Cannes object, not just
  the current one (the bucket keeps non-current versions 365 days). Re-run the list and record 0.
- **Snapshots.** List Qdrant snapshots for each collection (`GET /collections/<name>/snapshots`), and the `backups` bucket.
  Any snapshot taken while Cannes points existed still holds them. Delete those snapshots, or record why one stays.
- **RAG host disk.** Check for index copies or exports on the host and delete them.
- **Other machines.** Ask each person to run step 2 and to delete `engine/reference/_raw/cannes.json` and `engine/reference/rag/*`.
- **`napkin-cannes-dataset`.** This login could not open it. Someone with access lists it and decides. List names only.

## 4. Regenerate the pack list, then re-check

After every store reports 0: `napkin-packs sync` (it regenerates `engine/rag/packs.lock`; never edit it by hand).
Then check `grep -rn cannes server/napkin/brief/drafters.py mock-backend/qdrant_retrieval.py engine/rag/packs.lock` finds nothing.
Remove `engine/packs_dist/cannes/` (tracked digest) after the review below.

## 5. Review the tracked files (open each yourself; a model may not)

Decide keep, redact or remove, and write it beside the path. If a baseline is removed, re-measure and record the new one.
`engine/packs_dist/cannes/digest.md`, `engine/rag/golden/labels/pairs.jsonl`, `engine/rag/golden/labels/prelabels.jsonl`,
`engine/rag/golden/remeasure_2026-09-23/eval_ipa_cannes_playbook_500.json`, `engine/eval/baselines/v2-grounded-postrefactor.json`,
`engine/rag/calibration/local.json`, `engine/rag/calibration/nemotron.json`, `engine/deck/rubric.json`,
`docs/deck-maker/winning-pitch/rubric.json`, `engine/reference/awardlib/brand_categories.json`.

## 6. The award workbook question (Effie and WARC)

Question: does `engine/reference/_raw/awardlib/cases.xlsx` (5,493 cases) hold Cannes Lions cases or archive text?
A person checks, a model does not: open the workbook, filter the show or festival column for Cannes Lions, count the rows,
and read a sample of the insight and proposition columns to see whether they are own words or copied archive text.
Then check the built library the same way with the dry-run output of `engine/rag/cannes_removal.py plan` (the report-only
block gives names and sizes) and, in a Qdrant UI, a count of `source = awardlib` points whose show is a Cannes Lions show.
Record the answer in the record. If Cannes cases are in it, remove those rows and rebuild the library with `engine/ingest_awardlib.py`.
The 541 Effie-family cases and `engine/ingest_effie.py` (193 cases) wait for the owner's decision on effie.

## Table to fill

| Store | Command and output | Count after | Date | Name |
|---|---|---|---|---|
| Qdrant `Napkin_OS` | | 0 | | |
| Qdrant `napkin_rag` / `napkin_rag_v2` / `napkin_awardlib_test` | | 0 | | |
| Local indexes (each clone) | | 0 | | |
| Raw files and generated markdown | | gone | | |
| S3 corpus (current and versions) | | 0 | | |
| S3 backups and Qdrant snapshots | | 0 | | |
| RAG host disk | | gone | | |
| `napkin-cannes-dataset` | | decided | | |
| Tracked files (section 5) | | a decision per path | | |
| Award workbook check (section 6) | | answered | | |
