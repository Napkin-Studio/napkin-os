# Slide bake-off: eight ways to make the same six slides look better

> The contact-sheet images this report refers to (`bakeoff/*.png`) are not committed (about 5 MB); the builds can be regenerated from the scratch folder named below.

Companion to `SLIDE-SKILLS.md` (skills on this machine) and `SKILL-MARKET.md` (market sweep and licences).
Scratch builds live under `napkin-deck-handoff/engine/outputs/slide_bakeoff/<variant>/`. Nothing tracked was changed.
All content is invented.

![Baseline against the top-ranked variant, slides 1, 4 and 5](bakeoff/ALL.png)

Left: baseline. Right: `icons` (ranked first by both blind rankings). Rows: slides 1, 4, 5.

## 1. What was tested

- The same six slides (cover statement, insight, measurement table, investment draft, traction, channel roles), built eight ways.
- Words held identical. Every variant read the same `content.json`. Fidelity was checked in code (`shared/fidelity.py`, 98 strings: titles, blocks, claims).
- Judging: three blind vision judges per variant (scores on seven criteria, best and worst slide), plus two blind rankings of all eight decks under shuffled labels. All judges were Sonnet-family agents, so a style bias is possible.
- n = 6 slides, one build per variant. The scores are 1 to 5 and are means over the three judges.

Variants:

| Variant | Label | What it is |
|---|---|---|
| baseline | V-31 | The current Deck Maker renderer, same resolution |
| own | V-12 | Our own python-pptx layout library (Theme plus named layouts) |
| icons | V-16 | `own` plus Lucide icons and one Altair chart |
| loop | V-53 | `own` plus a render, review, fix loop and a geometry checker |
| siril9 | V-47 | siril9/presentation-skill (pptxgenjs, QA gate) |
| kos2001 | V-08 | kos2001/ppt-generator (python-pptx JSON spec, audit) |
| fdesign | V-25 | frontend-design guidance plus the impeccable linter, hand-written HTML |
| fslides | V-39 | zarazhangrui/frontend-slides, Swiss Modern preset, hand-authored HTML |

## 2. Results

Per-criterion means: Hier = hierarchy, Read = readability, Pol = polish, Cons = consistency, Msg = message fit, Hon = honesty, Client = client-ready.

| Variant | Tool | Overall | Hier | Read | Pol | Cons | Msg | Hon | Client | Fidelity | Rank (R1, R2) | Effort |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fdesign | frontend-design + impeccable, HTML | 3.8 | 4 | 4 | 3 | 4 | 4 | 5 | 3 | 91.8% | 2, 2 | large |
| own | own python-pptx layouts | 3.6 | 4 | 3.7 | 3 | 4 | 4 | 4.3 | 3 | 91.8% | 4, 4 | medium |
| loop | own plus review loop | 3.6 | 4 | 3.3 | 3 | 4 | 4 | 4.3 | 3 | 91.8% | 5, 3 | small (on top of own) |
| fslides | frontend-slides, HTML | 3.6 | 4 | 4 | 3 | 4 | 3 | 5 | 3 | 91.8% | 3, 5 | large |
| icons | own plus Lucide plus Altair | 3.5 | 4 | 3 | 3 | 4 | 4 | 4 | 3 | 91.8% | 1, 1 | medium |
| kos2001 | kos2001/ppt-generator | 3.1 | 3 | 3.7 | 3 | 4 | 3 | 4 | 2 | 91.8% | 6, 8 | medium |
| baseline | current Deck Maker render | 2.7 | 3 | 3 | 2 | 3 | 2.7 | 4 | 2 | 100% | 8, 7 | small |
| siril9 | siril9/presentation-skill | 2.6 | 3 | 3 | 2 | 3.3 | 2 | 3.7 | 2 | 91.8% | 7, 6 | large |

Licence and flags:

| Variant | Licence | Flags |
|---|---|---|
| baseline | n/a | Red CHECK FAILED banner on s3 and s6 and DRAFT tags are visible, so not client-ready |
| own | python-pptx MIT, lxml BSD-3; Georgia and Avenir Next are system fonts, not bundled | No new dependency. Avenir Next is Apple-only, so a font decision is needed. Needs a layout-selection rule per slide type (ADR 0026) |
| icons | Lucide ISC (some MIT from Feather), Altair BSD-3, vl-convert BSD-3 (bundles resvg MPL-2.0 and fonts), python-pptx MIT, pandas BSD-3 | Icons and charts are not in the deck schema, so ADR 0027 (proposed, not accepted) must allow them. New assets and dependencies need a licence entry a person approves. Icons and chart are PNGs, not editable. cairosvg (LGPL-3.0) failed to load and must not be adopted |
| loop | python-pptx MIT, Pillow HPND; LibreOffice and poppler used for render only | Checker reads macOS system fonts for measurement. A Linux CI needs a metric-compatible font. Stage would sit after the renderer in ADR 0026 |
| siril9 | MIT for the tool; npm and pip tree (sharp, react, pandas, pyarrow and more) not audited | Adds Node plus a very large pinned Python venv. Injects its own words ("TABLE INDEX", "Gate N", "FOCUS", "READOUT"), which breaks the words-are-fixed rule. Optional image generation and Wikimedia fetch must stay off. Its own QA gate went red on its own output |
| kos2001 | MIT; python-pptx MIT, Pillow HPND; pymupdf AGPL-3.0 (preview scripts only) | Do not vendor the pymupdf scripts. Fit engine pushes to shorten titles, which conflicts with ADR 0023. Calibri theme font is not redistributable. Bundled Malgun Gothic must not ship |
| fdesign | impeccable Apache-2.0 (prebuilt Rust binary); frontend-design LICENSE.txt not opened, unverified | HTML cannot become an editable pptx. Iowan Old Style and Avenir Next are Apple fonts. Binary counts as a dependency at the licence gate. The linter is weak for slides |
| fslides | MIT; system Helvetica Neue and Arial Black (preset fonts load from a CDN) | HTML only, no data-to-slide API, and the skill is LLM-driven. Needs an HTML renderer ADR or a hand port of the style into python-pptx |

Fidelity note: 91.8% (90 of 98) is identical for every variant except the baseline. All 8 misses are claim-ledger strings in `content.json` that reword the visible blocks (the slide 2 "63% of Fernley drinkers..." claim and seven slide 3 "label baseline value" claims). Every title and block was verbatim in every variant. The builders chose not to add reworded duplicate text. This is a `content.json` and `fidelity.py` ruling to make (should fidelity test claims or only visible blocks), not a design defect. The baseline scores 100% because it renders the claims.

## 3. The blind rankings

Label map: V-31 baseline, V-12 own, V-16 icons, V-53 loop, V-47 siril9, V-08 kos2001, V-25 fdesign, V-39 fslides.

| Position | Ranking 1 | Ranking 2 |
|---|---|---|
| 1 | V-16 icons | V-16 icons |
| 2 | V-25 fdesign | V-25 fdesign |
| 3 | V-39 fslides | V-53 loop |
| 4 | V-12 own | V-12 own |
| 5 | V-53 loop | V-39 fslides |
| 6 | V-08 kos2001 | V-47 siril9 |
| 7 | V-47 siril9 | V-31 baseline |
| 8 | V-31 baseline | V-08 kos2001 |

Both rankings agree on the top four places (icons, fdesign, then own, loop and fslides in the middle) and put the baseline, siril9 and kos2001 in the bottom three. They disagree on the order of the bottom three. Note that the per-variant scores put fdesign first (3.8) and icons fifth (3.5), while the rankings put icons first. Scores and rankings measure slightly different things, so treat icons and fdesign as joint leaders.

Contact sheets: `bakeoff/<variant>.png` (3 by 2 grid of s1 to s6).

## 4. What the judges said, by variant

**baseline** ([sheet](bakeoff/baseline.png)). Clean, legible serif and sans on one system but mostly plain text and default tables. Best slide s5 (three large stats with amber rules). Worst s4 (wall of bracketed bullets, empty lower third), and s3 once (long headline over a dense 7-row table). Tables have top-aligned text and uneven rows. The red CHECK FAILED banner on s3 and s6 and the DRAFT tags are honest but not client-ready. The dark s1 shares nothing with the white slides.

**own** ([sheet](bakeoff/own.png)). Strong navy, cream and rust system with serif and sans pairing, one accent bar. Stats are stat cards, comparisons are tables. Best s5 (headline, three big numbers, supporting table). Worst s4 (three dashed placeholder boxes repeating similar text, doubled heading, cramped, uneven heights). Weak points: s1 has a narrow body column and empty space; s3 is a dense table with a three-line headline; s6 wraps labels awkwardly ("out-of-/home"). No fake imagery, but flat and text-led.

**icons** ([sheet](bakeoff/icons.png)). Same system as own, plus consistent line icons and a bar chart with the latest bar highlighted beside the traction table. Best s5 (stat cards, highlighted bar, table: "4.3x growth is proven visually"). Worst s4 (three card styles, narrow ragged columns, an orphaned "55,000." line, cramped agreement block). Icons judged mostly decorative; the s1 clock icon floats. "Near client-ready, but s4 and s3 would need rework."

**loop** ([sheet](bakeoff/loop.png)). Same system as own after fixes. Best s5. Worst s4 (five tiles of mixed size, repeated placeholder sentences, the real ask sits low in the hierarchy). One judge: "competent and honest but dense in places, a client would accept it with a few fixes." Remaining: s1 narrow tall right column and an awkward "This bit's / yours" break; s2 four stats with equal weight; s6 reads as a list-table, not a process.

**siril9** ([sheet](bakeoff/siril9.png)). Consistent navy header band with teal and amber rails, but below it plain bullets and bare tables. Best s6 (clean table). Worst s4 (misaligned cards, a stranded budget card, "looks broken"). Stats (63%, 4.3x, 118%) are bullets or table cells, not stat callouts. Decorative timeline dots "look like fake progress". Large empty areas on s5, s2, s4. Reads as a rough draft.

**kos2001** ([sheet](bakeoff/kos2001.png)). Clean, honest, legible, with a black title band, blue accent, grey cards and zebra tables, but generic. Best s5. Worst s4 (three unequal regions, a floating paragraph with no heading, dashed yellow boxes look unfinished). s3 and s6 are plain full-width tables, s1 is a big italic paragraph, black bars vary in height. "Competent but template-looking."

**fdesign** ([sheet](bakeoff/fdesign.png)). Calm serif and green editorial system. Best s5 (large 4.3x, 118%, "2 of 40" beside an ARR table with proportional inline bars and the latest value in the accent). Worst s4 (mostly dashed beige placeholder boxes with a large dead gap). Honesty rated 5 (DRAFT tag, "To confirm"). s1 is a strong statement slide with an unused right half; s3 and s6 are well-set but dense tables; s2 cards have uneven fill. "Clean and competent, but not distinctive."

**fslides** ([sheet](bakeoff/fslides.png)). Swiss poster system: heavy black headlines, one orange accent, hairline rules, strong contrast. Best s5 (big orange numerals, dated table). Worst s2 twice and s4 once. The s2 stats are small bold sentences in identical outlined boxes, so the percentages are not pulled out. s3 sets the whole baseline column in orange, which reads as alarm. No imagery or chart, and several slides leave dead space at the bottom. Honesty 5 (dashed "PLACEHOLDER: a person must supply this" boxes).

Across all eight, the judges agreed on the same two slides: s5 (traction, big stats plus a table) was picked best in 21 of 24 judgements (siril9 picked s6 three times), and s4 (investment draft with placeholders) was picked worst in 21 of 24 (baseline once picked s3, fslides twice picked s2). Every variant scored honesty 3.7 or higher and "client-ready" 3 or lower.

## 5. Answers

**Which variant looks best?** Two answers. By judge scores, fdesign (3.8). By blind ranking, icons (first in both, fdesign second in both). The gap between 3.8, 3.6 and 3.5 is small for n = 6 and Sonnet judges, so the safe reading is: fdesign and icons lead, then own, loop and fslides in a middle pack, then kos2001, baseline and siril9. Everything that is not the baseline or siril9 beat the current renderer on score; the baseline scored 2.7.

**What do icons and charts add (icons vs own)?** Score: 3.5 against 3.6, so no gain on the judges' scale, and readability dipped (3 against 3.7). In the rankings, though, icons beat own in both (1st against 4th). Judges liked the highlighted bar chart on s5 and called the icons "simple line glyphs, not fake evidence", but also "mostly decorative". The chart is partly redundant with the table next to it, and it is a PNG with non-editable labels. Worth it for the traction chart; the icons are marginal. Both need ADR 0027 and a licence entry first.

**What does a render-review-fix loop add (loop vs own)?** Scores are equal (3.6 against 3.6) and the rankings split (5th and 3rd against 4th and 4th). The loop's measurable value was in defects: automated findings fell from 36 to 3. 28 of the 36 round-1 findings were font-size policy hits; visual-only defects (hyphen wraps, uneven KPI heights, an empty lower left) were not caught by the checker at all and needed a visual pass. Judges still saw the same weak slides (s4, s3, s1), so the loop did not change the look much. Its value is as a QA stage that catches overflow, overlap, small type and contrast, not as a design upgrade. It needs a render step and fonts that match.

**Is any ready-made skill better than building our own layouts?**
- siril9: no. 2.6 against own at 3.6. Its QA gate failed on its own output, it injects its own words, and it needed post-processing that breaks its own contract.
- kos2001: no. 3.1 against 3.6. Its built-in layouts did not fit this content, and two custom layouts had to be written.
- frontend-design (fdesign): scored higher than own (3.8 against 3.6), but it is guidance only, so the layouts were hand-written HTML. The win is the design direction, not a tool. The output is HTML and cannot become an editable pptx.
- frontend-slides (fslides): equal to own (3.6) and likewise HTML, hand-authored; the skill has no data-to-slide API.
So no ready-made package beat building our own layouts for a data-driven pptx. The only things that scored higher were design directions applied by hand, and they do not carry over to python-pptx without a port.

**Which ones failed to run, and why?** None failed to produce six slides. Problems that came up:
- siril9: the QA gate was red on every run (29 accessibility errors on raw output, 21 after cleaning, all font-size floors); it also needs `soffice` on PATH. Its output needed a clean-up script.
- icons: cairosvg could not load libcairo and was dropped for vl-convert.
- kos2001: its audit over-flagged overflow that the render did not show (it is calibrated to Malgun Gothic).
- All eight: the fidelity script misses 8 claim strings (91.8%), except the baseline.

## 6. Recommendation for the Deck Maker

**pptx renderer.** Adopt the `own` approach: a Theme object plus named layouts (big_number_panel, kpi_row, comparison, timeline_strip, role_row, placeholder_card, emphasis_bar, native_table) on python-pptx and lxml, which the engine already uses and which need no licence change. Choose the layout per slide type by a written rule (an ADR amendment to 0026). Borrow from fdesign two ideas that judges liked and which need no new dependency: inline proportional bars drawn from the table's own figures, and strict accent-colour discipline (accent only on the key figure). Fix the known weak slides in the layout library first: s4 (investment draft with placeholders), s3 (dense table with a long title), s1 (empty space), s6 (wrapped labels).

**Web deck.** If a web or slideshow renderer is wanted, port the fdesign or fslides look (Swiss Modern or the green editorial system) as CSS in our own code; do not depend on the skills. Do not rely on HTML for the pptx.

**QA stage.** Add the `loop` stage as stage h after the renderer: geometry, overflow, overlap, minimum font size and contrast on the rendered PNG. Keep a short visual checklist for what it cannot see (hyphen wraps, balance, empty areas). It needs a font map for CI.

**Owner decides first.**
1. ADR 0027: whether icons and charts are allowed at all, and what brand (palette, fonts) the deck uses. The `icons` result suggests the chart is worth it and the icons are marginal.
2. Licence gate for anything new. A new package, font, icon set or binary (Lucide, Altair and vl-convert, impeccable, any bundled font) needs a `licences/*.toml` review and a person's approval. An agent must not add exceptions.
3. Font: Georgia and Avenir Next are Apple system fonts. Keep Calibri or bundle an open font that passes `licences/policy.toml`.
4. Claims against blocks: should fidelity test the claim ledger or only the visible blocks (ADR 0016 and 0023)? Until then the 91.8% score is a content problem, not a design one.
5. How a draft deck should show placeholders and the CHECK FAILED banner to a client, since every judge marked s4 and the baseline banners down.

**Drop.** siril9 (red gate, injected words, heavy dependency tree). kos2001 as a dependency (fit engine fights the verbatim rule, AGPL scripts, a template look). Treat frontend-design and frontend-slides as reference only. Do not adopt cairosvg.

## 7. Caveats

- Six slides, one build per variant. Differences of 0.1 to 0.3 are within noise.
- Judges were Sonnet-family agents (three per variant plus two rankings), so a shared style preference is possible. The scores and rankings disagree on the leader.
- Builders were agents of varying effort. The efforts ranged from small to large, and the HTML builders hand-wrote layouts that a tool would not generate.
- The baseline is the current renderer at the same resolution. Its red banners and draft tags were left in on purpose, which costs it client-ready points.
- Rendered in LibreOffice (pptx) and headless Chrome (HTML) only. Not checked in PowerPoint or Keynote. Calibri was not installed, so Avenir Next or Carlito stood in for it, and line breaks may differ.
- Fidelity was 91.8% for every variant but the baseline, for the same claim-string reason.
- No human and no client judged. Nothing here says a client would accept any variant.
