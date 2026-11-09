# ADR 0033 — The award case library: a gated fill for thin categories

Status: built, off by default (for Sai) · Builds on 0006, 0010 · Code: `engine/ingest_awardlib.py`, `engine/rag/brief_context.py` (`_awardlib_fill`), `chunking.py`, `normalise.py` · Record: `features/award-data-fit.clan`

## Context

A workbook of 5,493 award cases ("Creative Chess Evidence") arrived. Each case is short (about 1,240 characters), its insight and proposition are Napkin reconstructions from public sources, its results are entrant-reported, and its rights are "public facts only, no asset reuse". The index holds 616 cases of its own (543 IPA, 73 Cannes): 16% from 2023 on, and thin in technology (17), fashion (17), healthcare (20), luxury (1) and b2b (0).

Three experiments, each blind-reviewed by two model raters (the feature record has the numbers):

1. All library cases added to the exemplars bucket, 40 UK IPA briefs, validator on: library cases scored 0.8 against 1.2 for existing cases; the before set was preferred 31 to 21.
2. The same on 40 held-out recent campaigns in thin categories: the library set was preferred 34 to 2 and 34 to 3; useful cards per brief rose from 0.35 to 1.43; briefs with no useful card fell from 28 to 8 of 40.
3. Library examples as few-shot material for drafting an insight and a proposition: no effect.

## Decision

Library cases enter retrieval only where the index has little of its own.

- `RAG_AWARDLIB=off` (the default): library rows are excluded by a `source nin awardlib` clause on the exemplars search. The widening ladder only drops `category` and `effectiveness_type`, so the clause survives every step. Nothing changes until a person turns the switch on.
- `thin`: when the brief's category has fewer than `RAG_AWARDLIB_THIN_MAX` (30) cases of its own (IPA, Cannes, Effie parents, counted from the store with `count_where`), one extra exemplars search runs, pinned to that category with `effectiveness_type` dropped (library cases carry none, so an exact match would exclude every one). Its rows join the baseline rows by score before the validator orders them, so the validator, the budget and the egress check treat one list.
- `on`: no gate. The experiments ran this way.

The gate fails closed. No category on the brief, a store that cannot count, or an unknown mode all withhold the library (an unknown value raises, like `RAG_VALIDATOR`).

Every library chunk is labelled in three places so the text cannot be shown without its provenance: the body's first paragraph, the embedded context header ("reconstructed strategy · entrant-reported results", which `Hit.render()` prefixes to every rendered hit), and the `rights` / `text_origin` frontmatter.

The metadata contract goes to 1.4.0 with one new `source` value, `awardlib`. No field is added, so nothing is backfilled and chunks written under 1.3.0 stay valid.

## Alternatives rejected

- Load everything into the exemplars bucket: worse on covered ground (experiment 1).
- A separate always-on bucket: changes every brief's prompt, for the same reason.
- Fill only when the baseline returns few exemplars: in both experiments every library exemplar landed in a brief that already had two or more, so it would never have fired.
- A relevance-only gate: the validator's ordering did not protect covered ground (experiment 1).
- A hard-coded list of thin categories: it goes stale when the index changes; the set is counted from the index.

## Consequences

- Production is unchanged until the index holds `awardlib` rows and `RAG_AWARDLIB=thin` is set. Rollback is `RAG_AWARDLIB=off`, no reindex.
- Briefs with no category get no library (the trace says so).
- The brand-to-category table (`engine/reference/awardlib/brand_categories.json`) is model-derived and not reviewed by the creative director; 640 of 1,810 brands are marked ambiguous. It agrees with the creative-director-reviewed corpus on 112 of 126 shared brands.
- Library `award_tier` comes from the awarding body's wording when it names a tier, else from the library's own outcome, else `other`. `Merit`, `Finalist` and `Nominee` stay `other` on purpose.

## Not decided

- The rights rule: whether the cases may be quoted verbatim in client-facing output, or used for reasoning only. Until it is decided the switch stays off in production.
- The threshold. 30 was chosen after the two experiments; a fresh gated A/B sweeps 20, 30 and 40.
- Whether the creative director reviews the ambiguous brands, and whether Education and the newer Cannes Lions categories earn contract values.
- Where the chunks are loaded (a new collection, or Napkin_OS). The Deploy workflow only swaps images, so setting `RAG_AWARDLIB` on a service goes through `infra/` and a person's `terraform apply`.
