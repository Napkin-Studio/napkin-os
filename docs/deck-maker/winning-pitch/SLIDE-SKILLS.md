# Skills and techniques to make the Deck Maker slides better

Scope: Deck Maker (`napkin-deck-handoff/engine/deck`), three renderers (python-pptx, single-file web, HyperFrames).
Basis: two lens plans (visual quality, feasibility) built from skill files read on disk plus a few web pages.
Confidence tags: [F] = rests on a file someone read, [W] = rests on a web page or search snippet, [?] = not confirmed.
Nothing was run; no model calls; no commits. Skills are guidance unless a file says it ships code.

## 1. The answer in 8 lines

1. First, build stage h: a deterministic visual QA written by us (render PNG at about 150 dpi, geometry, contrast, font-floor and filler-string checks; flag only, never rewrite text). Spec from the pptx skill checklist and motion-studio thresholds. [F]
2. Second, one shared theme-token object (with `accent_ink`) read by `render_pptx.THEME` and `render_web.theme_css`, via the existing `--brand` path, plus a stdlib contrast gate. [F]
3. Third, a native-shape layout library in `render_pptx.py` (6 to 8 named layouts) mirrored by name in the web CSS; designed with dataviz form rules and the pptx design rubric. [F]
4. Fourth, honest placeholder cards (dashed, role tag, status chip), layout only, DRAFT mark kept. [F]
5. Fifth, port the four web execution mockups to native pptx shapes from one shared frame spec. [F]
6. Then diagram and stat visuals drawn from the slide's own data (artifact-diagramming method, dataviz stat tile, hyperframes stat-bar end states). [F]
7. Icons, images, brand kits, fonts: wait for ADR 0027 and a person's licence approval. Do not use media-use, canvas-design, registry blocks or any fourth renderer.
8. Model-based critique is optional, paid, asked first, layout-only; not in the first pilot.

## 2. Everything considered

Effort: S small, M medium, L large. Verdict: use now / pilot / later / skip.

| Item | Offers for slides | Plugs in | Effort | Risk | Licence / ADR | Verdict | Source |
|---|---|---|---|---|---|---|---|
| pptx (Anthropic skill) design rules and QA checklist | 15-item defect list, font floors (title 36-44, body 14-16, caption 10-12), design rubric, structured-deck pattern | Authoring, QA spec | S | Low as guidance | Proprietary, no copies or derivatives; "every slide needs an image or icon" breaks ADR 0023 [F] | use now (ideas only) | `~/.claude/skills/synced/4f02e1d5-.../pptx/SKILL.md` lines 137-148, 234-266; `LICENSE.txt` |
| pptx skill scripts (validate.py, thumbnail.py, soffice.py, add_slide.py, XSDs) | XSD and relationship validation, contact sheet | QA | n/a | High (licence) | Proprietary; fails gate | skip | same folder, `scripts/`; `LICENSE.txt` |
| Own stage h (geometry plus pixel QA) | Overflow, off-slide, margins, font floor, title drift, contrast, filler scan | `run_deck.py` lines 193-197, findings list `render_pptx.py` ~106 | M | Low to medium (LibreOffice substitute fonts, false positives) | No new dependency (Pillow, python-pptx in use); person confirms "inspired by" line [F] | use now | `engine/deck/run_deck.py:193-197`; `render_pptx.py` docstring "planned, not built"; ADR 0026 DK-028 |
| Shared theme tokens plus `accent_ink` | One palette, type scale, spacing for all renderers; fixes amber text at about 2.2:1 on white in pptx | `render_pptx.THEME`, `render_web.theme_css`, `--brand` | S | Low | Do not ship a new default brand or font (ADR 0027); any bundled font needs `licences/fonts.toml` entry [F] | use now | `render_web.py` comment lines 28-29; `run_deck.py:149-157` |
| frontend-design (plugin skill) | Plan-then-wireframe method, token discipline, anti-template list | Authoring review lens | S | Low; "come up with copy" and "aesthetic risk" must be overridden | Apache-2.0, prose only [F] | use now (as review lens) | `~/.claude/plugins/cache/claude-plugins-official/frontend-design/ea10b213686c/skills/frontend-design/SKILL.md` lines 47-53 |
| Native-shape layout library | Big-number panel, KPI row, comparison, 2x2, timeline strip, role grid, meter, emphasis bar | `render_pptx.py` `_flow`/`_generic`; web `CSS_LAYOUT` | M to L | Medium: `_est_h` is a char-count guess; drift between renderers | No dependency; every visual from slide's own data with ref [F] | pilot (after stage h) | `render_pptx.py` `_flow`; `spec.SLIDE_TYPES`; slide-14 and slide-16 PNGs |
| dataviz (built-in skill) | Form table, stat-tile and hero-figure contract, palette method, CVD and contrast validator | Authoring; QA | S to M | Low; reference palette would pre-empt ADR 0027 | No licence text found [?]; write our own check, do not vendor `validate_palette.py` | use now (method) | `/private/tmp/claude-501/bundled-skills/2.1.301/.../dataviz/references/choosing-a-form.md`, `marks-and-anatomy.md` 70-95 |
| artifact-diagramming (built-in skill) | Depict the mechanism, label arrows, inline SVG rules | Web render; pptx connectors from same data | M | Medium: two drawing paths; python-pptx cannot embed SVG | No dependency; nodes only from input with refs [F] | later (pilot step 5) | skill text as loaded; Deck Maker audit |
| artifact-design (built-in skill) | Token, light/dark, consistency checklist for the web deck | Web render authoring | S | Low | Artifact font and CDN rules do not apply to the engine | use now (checklist) | skill text as loaded |
| Honest placeholder cards | Dashed empty cards, role tag, status chip, one "to supply" strip | `render_pptx.py`, `render_web.py` | S | Low to medium: can make a draft look finished | Layout only; keep DRAFT and `internal_leak` gate; rewording "To confirm" is an ADR 0023 copy decision | use now | `hyperframes-registry/references/placeholder-material.md`; `spec.py` PLACEHOLDER_PREFIX; slide-16 PNG |
| pptx execution mockups (phone, search, audio, poster) | Closes "not in the .pptx" gap | `render_pptx._execution` from `spec.frame_for` | M | Medium: redraw drift | No dependency; screenshot route needs a browser binary under gate | later (pilot step 4) | ADR 0026 Consequences; `render_web.py` `_Slide.mock`; slide-08 PNG |
| Bind `--master` to real layouts and placeholders | Real master styling, footer, logo, slide number | `render_pptx.py` `_layout('Blank')`, `run_deck.py --master` | M | Medium: needs designer master; PowerPoint untested | Master fonts and logo are ADR 0027 inputs; python-pptx lock status unverified [?] | later | `render_pptx.py` header; python-pptx docs (https://python-pptx.readthedocs.io/en/latest/user/slides.html) [W] |
| hyperframes check and snapshot | Layout, contrast audit and stills for the slideshow only | New step after `render_hyperframes.render` | S | Low to medium: needs Node and network; sees only slideshow; lint error gives "0 samples" | hyperframes Apache-2.0 (one line read); no entry in `policy.toml` for hyperframes, gsap, sharp [F] | later | `hyperframes-core/SKILL.md` 70, 95-99; `slideshow/SKILL.md` 509-526 |
| slideshow skill (notes, fragments, hotspots) | Already used by engine; proof-branch hotspots idea | HyperFrames output | S | Drift if not mirrored | "bottom-up sizing" rule would add content | skip as new work | `slideshow/SKILL.md` 128-238 |
| hyperframes-creative (palettes, typography, placeholder, contrast-report.mjs) | Type ramp ideas, tabular-nums, `contrast-report.mjs` on HTML | Authoring; slideshow QA | S | Video-pixel sizes; Google fonts fetched at build | Fonts unchecked vs gate; script needs npm (sharp, producer) | pilot (ideas only) | `hyperframes-creative/references/typography.md`, `scripts/contrast-report.mjs` header |
| hyperframes-animation (stat-bars-and-fills, data-in-motion) | Static end-states of bar, ring, column from a value | Web stat block, pptx shapes | S | Low; motion only in one renderer | Ideas only | pilot (step 5) | `hyperframes-animation/rules/stat-bars-and-fills.md`; `data-in-motion.md` |
| hyperframes-registry blocks, frame-presets | Reference for charts, flowcharts, cards | Reading only | S | Demo copy and invented numbers; WebGL; network at install | Per-item licences unread [?] | skip (read for ideas) | `hyperframes-registry/references/discovery.md` |
| animate-text (Pixel Point) | 24 effect names | Slideshow | S | Drift | "no explicit license declared upstream" [F] | skip | `hyperframes-animation/adapters/animate-text.md` |
| motion-studio | Safe-area and text thresholds; 51 video styles; leave-behind MP4 | Thresholds into stage h | S (numbers only) | As renderer: fourth engine, invents concept, Chromium plus ffmpeg | Untracked, no stated licence; fonts trigger gate | skip as renderer; use numbers | `.claude/skills/motion-studio/reference/typography.md`, `formats.md`; `engine/ms.js` audit() |
| media-use (resolve image, icon, logo) | Catalog images, icons, logos, ledger design | none | L | High: HeyGen account, network, non-deterministic, trademarks, cache leak, telemetry | Catalog licence unstated; ADR 0023/0028/0027 | skip (copy ledger idea into ADR 0027) | `~/.claude/skills/media-use/SKILL.md`, `references/resolve.md`, `memory.md` |
| canvas-design / generated or stock imagery | Decorative art | none | n/a | Adds content not given; fetches fonts | ADR 0023/0028, 0027 | skip | https://raw.githubusercontent.com/anthropics/skills/main/skills/canvas-design/SKILL.md [W] |
| theme-factory, brand-guidelines (Anthropic) | Pattern: palette plus font pair as one object | Authoring | S | Anthropic brand not usable; LICENSE.txt unread | ADR 0027 | skip (pattern only) | https://raw.githubusercontent.com/anthropics/skills/main/skills/theme-factory/SKILL.md [W] |
| Icon sets: Tabler (MIT), Lucide (ISC) | SVG icons, deterministic by slide kind | Shared lookup in both renderers | M | Medium: no SVG in python-pptx; notices must ship | Not checked against `policy.toml`; blocked on ADR 0027 | later | https://github.com/tabler/tabler-icons ; https://lucide.dev/license [W] |
| Marp, Slidev, reveal.js, PptxGenJS | CSS themes, Mermaid, auto-animate | Inspiration only | L | Fourth renderer, Node tree; Marp PPTX mostly images; Slidev PPTX [?] | MIT each [W]; gate burden | skip | https://github.com/marp-team/marp-cli ; https://github.com/slidevjs/slidev |
| pptx MCP servers, PPTAgent | Render-to-PNG pattern; PPTEval rubric idea | none | M | Small projects; PPTAgent overlap/overflow claim NOT verified on the repo page [?]| PPTAgent is MIT (read on its repo page); reference decks are ADR 0027 inputs | skip (rubric idea only) | https://github.com/samos123/pptx-mcp ; https://github.com/icip-cas/PPTAgent [W] |
| Model critique loop (AutoPresent, Reviewer/Refiner) | Judges taste no script can | Optional flag on stage h | M | Paid; gains about 2 to 4 points over 2 to 3 rounds, one setting regressed at round 3 (arXiv 2501.00912); the second paper (2502.15412) was not fetched [?] | README `--live` rule: ask first; layout-only | later (needs spend approval) | https://arxiv.org/html/2501.00912v2 ; https://arxiv.org/html/2502.15412v1 [W] |
| WCAG 1.4.3 and 1.4.11 | 4.5:1 text, 3:1 large text and graphics | Contrast gate | S | None | Numbers only | use now | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html [W] |
| Chart-text and perception guidance (Datawrapper, Cleveland-McGill, Tufte, Mayer) | Direct labels, aligned bars over pies, restraint | Authoring | S | Low; Mayer evidence is instructional, low confidence | Ideas only | use now (as heuristics) | https://www.datawrapper.de/blog/text-in-data-visualizations/ [W] |

## 3. Recommended stack as a pipeline

Authoring lenses (a person or agent uses them when writing renderer code, with the override "slide text is never invented"):
- pptx renderer: the pptx skill's design rubric and font floors, frontend-design plan-then-wireframe, python-pptx native shapes and charts. No skill code is copied.
- Web deck: artifact-design checklist plus the shared tokens; the HyperFrames slideshow inherits through `slide_views`.
- Charts and diagrams: dataviz form table (stat tile, KPI row, meter, emphasis bar, table past about 7 classes) and stat-tile contract; native python-pptx charts from fact values; artifact-diagramming rules (label arrows, depict mechanism) with nodes taken from `steps` and `fromto` blocks first, inline SVG in web and autoshapes plus connectors in pptx from the same data.
- Icons: none yet. Interim: numbered step markers drawn as shapes (functional, no asset). After ADR 0027 and a licence entry: one SVG set (Tabler or Lucide), chosen by rule from slide kind.

Pipeline:
1. `deck.json` plus `--brand` JSON gives tokens (colours, `accent_ink`, fonts, size scale).
2. Renderers (pptx, web, HyperFrames) read tokens; layouts share names.
3. soffice gives PDF; render PNG at about 150 dpi (pypdfium2 "vision" extra or pdftoppm). NOTE: the engine currently renders PNGs at 60 dpi (run_deck.py:196, pdftoppm -r 60), so raising this is itself a change to the baseline and the time budget; take 'before' images at the same dpi as 'after'.
4. Stage h (new module beside `validate.py`): per slide, check shapes off-slide or past 0.5in margin, estimated text overflow, overlapping text boxes, body under 14pt and caption under 10pt, title position drift between same-type slides, number split from its unit, blank zones, contrast pairs (4.5:1, 3:1 large), and Deck Maker filler strings. Output: findings into the existing findings list and `validation.json`; Pillow contact sheet per deck.
5. Feedback: findings drive deterministic fixes (smaller type step, switch to a named layout, split slide) chosen by code or a person; one round; text is never edited by the check.
6. Optional later, asked first: a paid vision critique that may change layout only.
7. Slideshow only: `npx hyperframes check` and `snapshot`, failing on lint errors or 0 samples.
8. Human step: open one pptx in real PowerPoint each release (substitute fonts Carlito and Caladea mean LibreOffice PNGs are not proof for PowerPoint).

## 4. Pilot plan

Baseline for every step: the same slides from the sample decks (`engine/outputs/winning_pitch_test/agency/B/out/png/slide-01, -08, -14, -16`; `investor/B` slide-05; `investor/C` slide-10), rendered before and after at the same dpi. Rubric criterion `presentability` (`rubric.json` line 178, weight 10 percent: "at most 4 bullets and 2 lines per bullet; word budgets met; ... full-sentence headlines") plus code-checkable stage h findings.

Step 1. Stage h v1 (geometry, font floor, contrast, filler scan).
- Touch: new `engine/deck/qa_visual.py`, `run_deck.py` (dpi and call), `render_pptx.py` (findings hook), tests under deck tests.
- Acceptance: run on all six decks; report lists at least the known issues (amber text under 4.5:1, repeated "Proposed (not given by the client)" rows on slide-16, "To confirm" and "[Agency]" on slide-01); zero false "pass" on a planted overflow fixture; runtime added under 10 seconds per deck; no change to any slide text (diff of deck.json unchanged).
- Needs decision first: whether "reimplement the checklist ideas" is acceptable relative to the proprietary pptx licence (a person confirms). Any new package goes through the licence gate; pypdfium2 is already an optional extra.

Step 2. Shared tokens plus `accent_ink` plus contrast gate.
- Touch: `render_pptx.py` THEME, `render_web.py` theme_css/_brand_css, `run_deck.py --brand`, a small tokens module.
- Acceptance: every text/background pair in the default and one brand file at or above 4.5:1 (3:1 for 18pt or 14pt bold), checked by stage h; pptx and web resolve identical hex values for the same token (unit test); stage h contrast findings on the six decks fall to zero.
- Needs decision first: fonts. Naming Cambria or Calibri ships nothing; naming or bundling an OFL font needs a `licences/fonts.toml` entry approved by a person. No new default palette until ADR 0027 is decided.

Step 3. Layout library v1 (three layouts first: KPI row of stat tiles, comparison columns, process strip) plus honest placeholder cards.
- Touch: `render_pptx.py` (`_generic` fallthrough), `render_web.py` CSS and markup, `spec.py` only if a layout map is needed.
- Acceptance: slides 14 and 16 re-rendered use a named layout; stage h reports no overflow; presentability bullets-per-slide still at most 4 and 2 lines each; every number keeps its ref and footnote (existing `numbers_trace` check passes); DRAFT mark and `internal_leak` audience gate unchanged; before/after side-by-side shows more than one non-table layout in the sample decks; pptx and web use the same layout names.
- Needs decision first: wording of "To confirm" is a copy decision (ADR 0023); do not change in this step.

Step 4. Port two web mockups (phone, search result) to native pptx shapes via a shared frame spec.
- Touch: `render_pptx._execution`, `spec.frame_for`/FRAMES, `render_web._Slide.mock`.
- Acceptance: slide-08 no longer prints "Image prompt (illustrative)" as the only visual; frame text equals the deck.json copy lines (string equality test across both renderers); stage h clean.
- Needs decision first: none beyond ADR 0023 (content must be the person's own text).

Step 5. Data-derived diagram and stat-bar end states (only from existing `steps`, `fromto`, ref'd stats).
- Touch: `render_web.slide_views`, `render_pptx._flow`, render_hyperframes static state.
- Acceptance: bar or ring length equals the resolved fact value within 1 percent (test); every drawn value shows its ref; no invented nodes (node labels all found in deck.json); web and pptx agree on node count.
- Needs decision first: if a diagram block is added to `deck.json` schema, that amends ADR 0016 (owner approval).

Held back until the owner decides: images and icons (ADR 0027 proposed, not accepted), brand kit and fonts, any `licences/*.toml` entry (needs `NAPKIN_LICENCE_APPROVED`; an agent never sets it), the paid model critique (spend approval), hyperframes in the gate.

## 5. What not to use, and why

- Anthropic pptx skill scripts and its pptxgenjs path: proprietary, no copies or derivatives; Node, not python-pptx. Use the text as guidance only.
- media-use resolve: HeyGen sign-in and network, non-deterministic, catalog licence unstated, logos imply relationships and are trademarks, generates pictures on a miss, global cache can leak another client's brand, telemetry. Take only the ledger fields idea for ADR 0027.
- canvas-design and any generated or stock imagery: content the person did not give (ADR 0023/0028).
- motion-studio as a renderer: MP4 only, fourth engine, invents concept (SKILL step 2), untracked, no stated licence. Numbers only.
- Registry blocks, liquid-glass, social cards, animate-text, frame-presets: demo copy and fake figures break traceability; WebGL and network; unread or missing licences; presets are brand kits.
- Marp, Slidev, reveal.js, PptxGenJS, pptx MCP servers, PPTAgent: fourth renderer or second pptx writer; Node trees for the gate; renderers must agree.
- Applying "every slide needs an image or icon", "come up with copy", "take aesthetic risk", executive summary or divider slides, bottom-up market sizing, ghost words: would add text or slides the inputs lack; breaks ADR 0023 and `PITCH_MAX = 18`.
- Video rules applied blindly (no legends, no gridlines, no pie charts): a deck that must show sources may need axes and labels.

## 6. What could not be read or verified

Not run: any command (hyperframes check, snapshot, catalog, contrast-report.mjs, soffice, validate scripts). Every capability above comes from files or pages, not observation.

Not read or only partly read:
- ADR 0027 and 0028 only in part (heads); positions on them come partly from the brief. Licence gate: `licences/policy.toml` partly read; whether the gate scans `engine/deck` is unconfirmed; python-pptx not found in `engine/uv.lock` (lock status unverified); no `binaries.toml` entry found for soffice or pdftoppm.
- `render_web.py` and `render_hyperframes.py` middles (CSS and JS) skimmed by grep only; `validate.py`, `assemble.py`, `evaluate.py` not read.
- Only six of about 85 sample PNGs viewed.
- hyperframes registry catalog (about 400 items claimed; only a 97-block sample in `discovery.md`); per-block licences unknown. 12 of 13 frame-presets and 8 of 9 palettes unread.
- motion-studio: `engine/ms.js` beyond `audit()`, all styles beyond the first 2500 bytes of `commercial.json`.
- dataviz: no licence line found; palette lines 60-188 and several references unread; `validate_palette.py` skimmed (stdlib imports only), not run.
- Anthropic skills LICENSE.txt for theme-factory, frontend-design (repo copy), brand-guidelines, canvas-design, web-artifacts-builder: not read.
- Artifact preview or ArtifactCheck: not available to the researcher, so untested.
- Real PowerPoint and Keynote output: none; fonts in PNGs are LibreOffice substitutes.

Web items the skeptics dropped: the DROPPED list was empty (nothing was removed). Items that remain only on weak web evidence and should be treated as low confidence:
- Paper2Video tree-search layout variants (PDF body unreadable; search summary only) [W, low].
- mcp-pandoc-md2pptx and sibling MCP servers (search snippet; licence unverified) [W, low].
- Mayer multimedia meta-analysis effect sizes (abstract via search; instructional domain, not pitches) [W, low].
- Slidev PPTX editability (page did not say; unverified) [?].
- Font Awesome Free licence (fetch returned no licence text; unverified) [?].
- Tufte data-ink quote and Cleveland-McGill tier order (secondary sources, original not opened) [W, medium].
- PPTAgent and SlideGen overflow claim (not supported by the repo page; PPTAgent is MIT) [?].

## Ranked top five

1. Stage h deterministic visual QA, written from scratch.
2. Shared theme tokens with `accent_ink` and a contrast gate.
3. Native-shape layout library keyed by slide type, mirrored in web CSS.
4. Honest placeholder cards (layout only).
5. Native pptx execution mockups from a shared frame spec.
