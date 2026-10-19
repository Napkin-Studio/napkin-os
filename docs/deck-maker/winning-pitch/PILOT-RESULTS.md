# Deck Maker pilot results: native layouts and stage h

Date: 2026-10-18. Nothing is committed. All work is in
`napkin-deck-handoff/engine/deck` and its tests, plus generated output under
`engine/outputs/pilot/`. No model calls were made (no `--live`).

## 1. What was built

Three pieces, with no new dependency, no icons, no images and no new fonts.

1. **Theme token module** (`theme.py`, new). One frozen `Theme`: cream, navy
   and rust palette; `accent_ink` A8431D (5.63:1 on paper, 5.03:1 on panel);
   type scale (title 36 / body 16 / caption 11 / floor 10); 0.65 in margins;
   a stdlib WCAG `contrast()`, `tune()` and `check_palette()`. A `classic`
   theme keeps the old white/amber look with layouts off. A brand JSON applies
   as before; a missing `accent_ink` is derived by darkening the accent to 4.5:1.
2. **Native-layout library** in `render_pptx.py`. `choose_layout()` is a pure
   rule table keyed on slide type and block kinds. Layouts: cover,
   emphasis_bar, chart (native chart, hero big-number panels), execution,
   territory (plus wide variant), placeholder_card, quote_cards, comparison,
   big_number, kpi_row, timeline_strip, role_grid, native_table (long tables
   split in two halves), cards (bullet list for 8+ items). A layout raises
   `NoFit` when text will not fit at 10 pt or more, or the block kind is
   unknown; the slide is then drawn by the earlier flow. `Renderer.layouts`
   records what each slide got. Notes, sections, watermark, CHECK FAILED flag,
   hidden appendix, animations and `--master` are unchanged. `render(...,
   theme='napkin')` is new. Claims are now appended to speaker notes (a
   "Claims:" list). An existing defect was fixed: kv values that are lists
   used to print as a Python list repr and now render as separate paragraphs.
3. **Deterministic rendered-slide QA, stage h** (`qa_render.py`, new), wired
   into `run_deck.py` after the PDF/PNG render, with a `--no-qa` flag. It
   writes `qa.json`, adds a `qa` line and a `qa_render` stage with seconds to
   `report.json`, and never fails the run (a corrupt or missing pptx becomes
   one error). Checks: off_slide, margin, text_overlap, text_overflow
   (character-count estimate), min_font (floors title 28, body 12, caption
   10), placeholder, contrast (WCAG 4.5:1, 3:1 for large text), and pixel
   checks mostly_empty and one_corner from a 30 dpi PPM read by a pure-Python
   P6 parser. Only python-pptx and the standard library are used.

Files changed, by lane:

- Layouts lane: `deck/render_pptx.py`, `deck/theme.py` (new),
  `deck/tests/test_render_layouts.py` (new), `deck/README.md`.
- Stage h lane: `deck/qa_render.py` (new), `deck/tests/test_qa_render.py`
  (new), `deck/run_deck.py` (import, `--no-qa`, marked block), `deck/README.md`
  (section appended at the end).

## 2. Test results

- Layouts lane: `cd engine && PYTHONPATH=. python3 -m pytest -q deck/tests .`
  gave **118 passed in 6.99s** (98 existing plus 20 new). This includes a
  LibreOffice conversion of a golden-deck render.
- Layouts lane audit over the five live deck.json files: every title and
  block string present in the pptx text, no shape past the slide, no run under
  10 pt. 0 problems in all five. All five pptx files converted with soffice.
- Stage h lane: the same command gave **98 passed in 1.36s**, including 21 new
  tests in `test_qa_render.py` (clean slide has zero findings; each check
  fires on a synthetic defect; PPM parser; corrupt and missing pptx never
  raise; `qa.json` written; run_deck records the stage; `--no-qa` skips it).
- Review findings: both lanes were reviewed; the result was "nothing to fix"
  for each. No report of what the skeptics dropped was supplied to this
  write-up, so none is claimed.
- Not run: no full `run_deck` against real soffice in the stage h lane (tests
  stub the renderers); `render_web` and `run_deck` end to end were not run
  beyond existing tests by the layouts lane.

## 3. The five live decks, old vs new renderer

Replay method: `run_deck` without `--live`, from the recorded stages, no
model call. The old side is the recorded live render. Judges: three blind
judges per deck, scoring /5. "Same deck.json" means slides and order are
identical; `meta.built_at` differs on every deck (replay time), which is why
the raw comparison flagged A, investor B and investor C as not identical.
`validation.json` was identical for all five, which shows only the renderer
changed.

### Summary

| Deck | Slides | Old /5 | New /5 | Judges: new / old / tie | Text kept | Stage h old | Stage h new |
|---|---|---|---|---|---|---|---|
| agency A | 29 | 2.7 | 3.8 | 3 / 0 / 0 | 96.3% strings (about 99% words) | 215 | 89 |
| agency B | 34 | 2.6 | 3.8 | 3 / 0 / 0 | 97.4% | 411 | 208 |
| agency C | 35 | 2.7 | 3.9 | 3 / 0 / 0 | 100% | 446 | 235 |
| investor B | 18 | 2.8 | 4.0 | 3 / 0 / 0 | 99.64% | 172 | 61 |
| investor C | 14 | 2.7 | 4.0 | 3 / 0 / 0 | 100% | 233 | 102 |

Mean of the five: old 2.70, new 3.90. All 15 judge votes went to new.

### Per criterion (old to new)

| Deck | hierarchy | readability | polish | consistency | message fit | honesty | client ready |
|---|---|---|---|---|---|---|---|
| agency A | 3 to 4 | 3.3 to 4 | 2 to 4 | 3 to 4 | 2 to 4 | 4 to 4 | 2 to 3 |
| agency B | 3 to 4 | 3 to 4 | 2 to 4 | 2.3 to 4 | 2.7 to 4 | 4 to 4 | 2 to 3.3 |
| agency C | 3 to 4 | 3 to 4 | 2.3 to 4 | 3 to 4 | 2 to 4 | 4 to 4 | 2.3 to 3.7 |
| investor B | 3 to 4 | 3 to 4 | 2.3 to 4 | 3 to 4 | 2.7 to 4 | 4 to 4 | 2.3 to 4 |
| investor C | 3 to 4 | 3 to 4 | 2 to 4 | 3 to 4 | 2.7 to 4 | 4 to 4 | 2 to 4 |

### Stage h by check (old to new)

| Deck | min_font | contrast | text_overflow | text_overlap | margin | placeholder | other |
|---|---|---|---|---|---|---|---|
| agency A | 161 to 86 | 37 to 0 | 8 to 0 | 6 to 0 | 2 to 2 | 1 to 1 | |
| agency B | 323 to 198 | 47 to 0 | 19 to 0 | 12 to 0 | 9 to 9 | 1 to 1 | |
| agency C | 351 to 225 | 48 to 0 | 23 to 1 | 15 to 0 | 8 to 8 | 1 to 1 | |
| investor B | 146 to 60 | 14 to 0 | 10 to 0 | n/a | 1 to 1 | n/a | mostly_empty 1 to 0 |
| investor C | 191 to 99 | 33 to 0 | 6 to 0 | n/a | 3 to 3 | n/a | |

Notes: the investor C new total is 102 (99 min_font plus 3 margin); the old
summary line was 56 errors and 177 warnings. Agency B in-run QA, with
validation passed, read "2 errors, 205 warnings on 26 slides".

### Render seconds (render_pptx + PDF/PNG, from report.json)

| Deck | Old | New | New qa_render stage |
|---|---|---|---|
| agency A | 3.95 (0.26 + 3.69) | 4.84 (0.36 + 4.48) | 0.73 |
| agency B | 3.76 (0.47 + 3.29) | 4.75 (0.53 + 4.22) | 0.76 |
| agency C | 4.81 (0.61 + 4.20) | 4.58 (0.52 + 4.06) | 0.74 |
| investor B | 3.70 (0.32 + 3.38) | 3.96 (0.28 + 3.68) | 0.59 |
| investor C | 3.97 (0.36 + 3.61) | 4.49 (0.30 + 4.19) | n/a |

The native pptx render itself is about the same speed; the extra is mostly
the PDF/PNG conversion, which has more shapes to draw. Assemble times in the
old reports (59 s to 90 s) were live model time and are not comparable.

### Text kept: what was missing

- Agency A (96.3%): the small numerals 01 to 05 (old 01x2, 02x2, 03x2, 04x2,
  05, 06, 07 at word level) are no longer drawn. Four old strings were raw
  Python list reprs dumped as one block; their words are all present as
  separate cards or bullets. The new pptx also adds the fixed labels PROPOSED
  and TO SUPPLY ten times each, which are not in deck.json.
- Agency B (97.4%): 14 of 532 old strings missing, all two-digit numerals
  01 to 09 and 01 to 07. New pptx also carries PROPOSED and TO SUPPLY. Table
  cells re-laid out as cards were not verified word for word.
- Investor B (99.64%): only "03" missing (decorative numeral, not deck copy).
- Agency C and investor C: 100%, no missing strings.

The numerals are decorative labels the old renderer drew. Whether dropping
them is intended has not been confirmed.

## 4. What the judges said

New renderer, defects (all three judges, all decks, mostly minor):

- Empty lower areas remain: agency A slides 2 to 5 and 7; agency B slides
  3, 4, 5 and 7; agency C slides 2, 5 and 7; investor B slides 3, 7 and 8;
  investor C slides 4 to 6 and the cover.
- Uneven card or panel heights: dark quote card taller than its neighbours
  (agency A slide 4, agency B slide 4); dark panel gap before the closing
  line (slide 8 in agency A and B).
- Agency B slide 7 headline wraps awkwardly; slide 6 "can." sits alone in the
  TO card.
- Agency C slide 3 stat cards repeat the bars below them and the bars are not
  on a shared scale; slide 6 has an empty third cell in the card grid.
- Investor C: stat numbers not baseline-aligned across cards (slide 3, also
  4, 6, 7); slide 8 table covers about 60% of the width.
- The CHECK FAILED flags remain visible, judged honest.

Old renderer, defects:

- Plain white bullet slides with the lower 40 to 55% empty on most content
  slides; widowed "it." on agency A titles; amber italic quotes and labels on
  white with weak contrast.
- Key claims demoted to bullets; stat blocks flattened (agency C slide 4,
  investor slides 4 and 8); table header text top-aligned and cramped; thin
  stat captions in small grey.
- Mixed card styles (shadowed rounded cards beside flat elements); agency C
  slide 8 closing text near-clipped at the panel edge; bar labels running into
  the left margin on agency C slide 3.

Why judges preferred new: layouts show the claim (cards, from/to, quote panel,
timeline, tinted stat cards), one consistent cream and rust system, centred
table cells.

## 5. Conclusions

- **New beat old on every deck**, 3 of 3 judges each time. Mean score 3.90
  against 2.70, a gain of 1.2 points. The gain is on hierarchy, polish,
  consistency and message fit (about 1 to 2 points); honesty was 4 on both
  sides, as expected since the words are the same.
- **Client ready is the weakest new criterion**: 3 to 3.7 on the three agency
  decks, 4 on the two investor decks. The new agency decks are better but are
  not yet judged ready to send as they stand.
- **Where it did not win outright**: empty lower thirds, uneven card
  heights, stat baselines, orphan words and the chart scale. These are layout
  balance issues, not overflow or clipping.
- **Stage h found real defects in the old output**: contrast (14 to 48 per
  deck, mostly amber text on white), text overflow, text overlap and (once) a
  mostly empty slide. The new renderer cleared contrast and overlap to 0 on
  all five and overflow to 0 on four; one overflow remains on agency C
  (slide 3, TextBox 6).
- **min_font is still the bulk of findings** (60 to 225 per deck), mostly 11
  pt labels under the stage h 12 pt body floor. The theme caption size (11)
  and the QA floor disagree; one of them should change.
- **The DRAFT watermark** (#E8A33D at 9 pt on white, 2.2:1) is a contrast
  finding on most old slides and was not touched.
- **Text is preserved in substance**, but "words are fixed" is not met to the
  letter: numerals 01 to 09 are dropped and PROPOSED / TO SUPPLY labels are
  added.

## 6. What still blocks a merge

- **ADR 0027 decisions** are not made by the lanes; they remain with the owner.
- **Design approval** under the feature workflow: no approved design record
  exists for this work in the data given.
- **Fonts**: Calibri and Cambria are not installed here; LibreOffice
  substituted metric-compatible fonts. No check was made with true fonts, and
  PowerPoint may wrap differently. The fonts also need a licence-gate check.
- **Licence gate** for anything new: nothing new was added, but the gate has
  not been run on this change.
- **Web deck and slideshow** (`render_web`) are still on the old look;
  `THEME` is kept so they still import, but they were not run.
- **Not done, per the lanes**:
  - `classic` is flow-only, not byte-identical to the old file; the old-flow
    fallback also now uses theme colours, a 10 pt floor and the list-value fix.
  - `run_deck.py` has no `--theme` flag.
  - Agency B s06 (dense proposition slide) falls back to the old flow.
  - Hidden appendix slides (territory, requirement_trace and others) were
    checked by audit only, not by eye. Only about 7 slides were viewed in
    PNGs: investor_B 1, 3, 12; agency_A 5, 12; agency_C 3, 14.
  - Chart hero figures show 58 and 62 with no percent sign (existing `fmt()`).
  - No multi-slide splitting of long tables beyond the two-column split.
  - Stage h: PNGs kept at 60 dpi (150 dpi costs about 3.7 s more on 29
    slides); no full `run_deck` against real soffice; one_corner never fired
    on live decks, so its threshold is only tested synthetically.
- **Code size**: `render_pptx.py` grew from about 580 to about 1600 lines; a
  split into a layouts module is advised but was outside the lane.
- **Notes change**: the Claims list in speaker notes changes notes text for
  layout themes.

## 7. Caveats

- Blind judges are Sonnet-family models, not people or a client.
- Five decks only, two investor and three agency.
- This is a recorded replay, not a new live run; the model stages were not
  re-run, so run-to-run variation in the writing is not tested.
- The old PNGs were re-rendered from the old PDF at the same 1600x900 size as
  the new ones. Only presented slides are in the PDFs (17 for agency decks,
  14 for investor decks); hidden appendix slides were not scored.
- Stage h overflow and overlap are character-count estimates and may include
  false positives; the old and new counts use the same estimator.
- Agency C's old-side QA total was derived with `check_pptx`; the summary
  form was not computed. The agency C PNGs were not opened by the lane that
  ran the replay.
- Text fit uses an estimator with generous glyph widths; real Calibri and
  Cambria may differ slightly.
