# Deck Maker skill market scan

Date of scan: 2026-10-16. Purpose: find skills, plugins, MCP servers, tools and libraries that could make Deck Maker slides look and read better. Constraints applied to each: licence (repo licence gate), image generation or fetching (ADR 0023 accepted; ADR 0027 proposed, NOT accepted), paid keys or network at runtime, headless use from Python or a shell.

Nothing here was installed or run. "Testable now" means it needs no paid key, no hosted account and no unverified licence step to try in a scratch directory. Star counts and licences are as read from each candidate's own page; last-commit dates were not visible on any GitHub page.

## 1. The ten most promising, ranked

Ranked by fit to the observed gaps (plain slides, few layouts, no check of the rendered result, pptx lacking web-deck mockups) and by how cheaply they fit a Python engine.

1. **siril9/presentation-skill** (MIT, 78 stars, v0.14.0). Builds editable pptx from `outline.json`: native charts and tables, a QA gate for geometry, placeholder detection, design rules and optional accessibility, plus rendered JPG review via soffice and pdftoppm. Core renderer is pptxgenjs, with a legacy python-pptx renderer. Plug-in: render and QA (structured data in, checked pptx out is our shape). Issue: it has a generated-image variant and an original visual library; whether it calls a model was unclear, so check before enabling. Needs Node and a Python venv. Testable now: yes (`npm run setup:python`).
2. **kos2001/ppt-generator** (MIT, 0 stars, 25 commits, unproven). Renders a JSON spec to native pptx with python-pptx: templates and layouts (README says 7/18 in one place, 6/13 in another), native-shape diagrams, a contact-sheet preview with an empty-space check, an audit script. Same stack as ours, so layouts and diagram code are directly comparable. Plug-in: authoring and render; read for layout ideas. Issue: none found, local only; too new to trust without review. Testable now: yes (python-pptx plus LibreOffice).
3. **Anthropic pptx skill, Visual QA pattern** (proprietary: "All rights reserved", no copying or derivative works). Pattern only, do not copy or vendor. Quoted checks: "Insufficient margin from slide edges (< 0.5")", "Elements too close (< 0.3" gaps)", "Low-contrast text", "Low-contrast icons". Commands: soffice headless to pdf, then `pdftoppm -jpeg -r 150`. Plug-in: QA, re-implemented by us with subprocess. Issue: licence gate fails on the code. Testable now: yes as a pattern (shell calls).
4. **Vega-Altair + vl-convert** (Altair BSD-3, vl-convert BSD-3; vl-convert is a v2 release candidate). Declarative charts exported to SVG, PNG or PDF with an embedded V8, no browser or Node. Described as the strongest chart path for headless Python. Plug-in: render (charts from the person's own numbers, no pictures). Issue: none found; font handling untested. Testable now: yes (`pip install altair vl-convert-python`).
5. **uchimata2/htmldeck** (MIT code; embedded fonts SIL OFL 1.1; 2 stars, 611 commits). Single-file offline HTML decks with SVG diagrams and charts, plus `tools/deck/check.py` (design-rule lint) and `critique.py`. Plug-in: web-deck authoring ideas and QA lint. Issue: no generated images; fonts are OFL so gate should accept but needs listing. Testable now: yes (plain Python plus local Chrome/Edge).
6. **pbakaus/impeccable** (Apache-2.0, 82.0k stars). CLI with 59 deterministic anti-pattern rules that scans HTML or URLs with no LLM or key: `npx impeccable detect <path|url> --json`. Plug-in: QA for the web deck, by subprocess. Issue: does not review pptx; live mode needs a local server and browser; README warns to review its script before use. Testable now: yes.
7. **PPTAgent / DeepPresenter** (MIT, 5.1k stars) plus its paper's PPTEval rubric (Content, Design, Coherence). Flow: agent authors HTML slides, renders, a vision model reviews, agent fixes, export to editable PPTX. Plug-in: QA (the review loop and rubric port to our renderer; its authoring is HTML to PPTX). Issue: text mode needs ATRIA_API_KEY and VISUAL_API_KEY; multimodal host mode avoids the vision key; upstream text-to-image creation conflicts with ADR 0023, keep off; its pip and npm dependencies need the gate. Testable now: yes for reading the rubric; running the skill needs Chromium, LibreOffice, uv, npm.
8. **Lucide icons** (ISC, plus MIT for Feather-derived icons). Line-icon SVGs beside bullets or cards; vendor chosen SVGs with the licence. Plug-in: render (rasterise for pptx). Issue: icons are extra content beyond what the person gave, so this is an ADR 0027 question even though no picture is fetched. Tabler (MIT) and Phosphor (MIT) are equivalent. Testable now: yes.
9. **CacinieP/slide-recipes (ppt-skills)** (MIT, 9 stars, 60 commits). `render-qa.mjs` checks overflow, overlap, off-canvas elements, bad image ratios, missing page badges; WCAG contrast from separate color:qa tooling; one Python helper `pptx-editable-check.py`. Plug-in: QA rules and recipes. Issue: configurable AI image generation via paid keys, keep it off (ADR 0023); Node-based; README counts inconsistent. Testable now: yes without keys.
10. **pixelmatch (ISC) + wcag-contrast-ratio (MIT)**. pixelmatch diffs two PNGs, so each slide can be compared with the last accepted PNG to catch regressions across the three renderers. wcag-contrast-ratio gives text-vs-background contrast from theme hex values; the ~10-line formula could be written in-house instead. Plug-in: QA, no LLM. Issue: none; wcag package last released 2015. Testable now: yes (`pip install pixelmatch wcag-contrast-ratio`).

Close runners-up: Noi1r/powerpoint-skill (100-point rubric, 29 hard rules; heavy system dependencies, so not testable now), D2 (SVG native in Go, MPL-2.0, PPTX export), Mermaid CLI (MIT, Chromium needed), HyperFrames slideshow skill (guidance for the renderer already in use; avoid media-use image parts).

## 2. All verified candidates

Kind: S skill, P plugin, M MCP server, L library or font, C CLI tool, SV hosted service. Test = testable now.

| Name | Kind | URL | Licence | Maturity | Install | Test | Issue |
|---|---|---|---|---|---|---|---|
| htmldeck | P | github.com/uchimata2/htmldeck | MIT; fonts OFL 1.1 | 2 stars, 611 commits | `/plugin marketplace add uchimata2/htmldeck` or clone, `python tools/deck/check.py` | yes | list OFL fonts |
| SlideOps | P | github.com/glukicov/slideops | MIT | 50 stars | `/plugin marketplace add glukicov/slideops` | yes | drift check is about code; copy the pattern |
| render-visual-skill | P | github.com/imshaikot/render-visual-skill | MIT | 10 stars | `claude plugin marketplace add imshaikot/render-visual-skill` | yes | Google Fonts at render time |
| Tweenkit (claude-motion-skills) | S | github.com/wmzspace/claude-motion-skills | MIT | 2 stars, docs partly Chinese | `/plugin marketplace add wmzspace/claude-motion-skills` | yes | needs Node + Playwright; renders bg/icons to images |
| keynot | P | github.com/shawnzam/keynot | MIT | 15 stars | `/plugin install keynot@claude-plugins-official` | yes | CDN fonts |
| pptx-deck-plugin | P | github.com/atomic-man007/pptx-deck-plugin | MIT per README, no LICENSE file seen | 0 stars, 5 commits | clone; `npm install pptxgenjs` | yes | brand extraction touches ADR 0027; PptxGenJS |
| FluidDocs Deck Builder | P | github.com/fluidform-ai/fluiddocs-deck-builder | MIT | 33 stars | `/plugin marketplace add FluidForm-ai/fluiddocs-deck-builder` | yes | deploy step is hosted; import keeps screenshots |
| pdf-forge | P | github.com/syx-labs/pdf-forge | MIT | 2 stars | clone; `bun install; ./install.sh` | yes | optional AI image generator; CDNs; low fit |
| dataink | S | github.com/oh-da/dataink | MIT | 0 stars, v3.3.0 | `/plugin marketplace add oh-da/dataink` | yes | none found |
| Adds Up | S | github.com/aphro4266/adds-up | MIT | 0 stars | `/plugin marketplace add aphro4266/adds-up` | yes | exact command not shown |
| frontend-design (plugin) | P | github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design | Apache-2.0 | 732,603 installs | already installed | yes | prompt only |
| Playwright MCP | M | github.com/anthropics/claude-plugins-official/tree/main/external_plugins/playwright | NOT VERIFIED | 223,398 installs | already available | yes | licence unchecked; use playwright-python for engine |
| Streamline Icons | M | github.com/webalys-hq/agent-plugins | plugin Apache-2.0; icons under paid plan | 2 stars | plugin, sign in | no | hosted OAuth; non-open icons |
| Supericons | M | github.com/curlymolelabs/supericons | repo MIT; per-set licences unverified | 1 star | `npx -y @supericons/mcp@latest` | yes | ADR 0027 question; simpler to vendor Lucide |
| StarryKit | P | github.com/starrykit/starrykit-plugin | MIT plugin; service terms unread | 97 stars | per README | no | hosted, OAuth, confidentiality |
| Presenton plugin | SV | github.com/presenton/presenton-claude-plugin | Apache-2.0 plugin | 1 star | Connectors tab | no | remote; README warns against confidential content |
| CoDesign (imgly) | M | github.com/imgly/codesign | plugins MIT; engine proprietary | 42 stars | `npx @imgly/codesign-mcp` | no | proprietary engine; no PPTX export |
| slide-revive | P | github.com/yn01/claude-plugins | not stated | 0 stars | plugin | no | unknown licence; wrong use case |
| Bauhaus Digital | S | github.com/lucasgpinheiro-rgb/bauhaus-digital | MIT | 0 stars | copy `skills/bauhaus-digital/` | yes | prompt only |
| anthropics/skills pptx | S | github.com/anthropics/skills/tree/main/skills/pptx | Proprietary, all rights reserved | ~181.6k stars (repo) | read only | yes | fails gate; pattern only (also see rank 3) |
| anthropics/skills canvas-design | S | .../skills/canvas-design | Apache-2.0 | official | copy folder | yes | abstract art conflicts with ADR 0023; bundled fonts need check |
| anthropics/skills theme-factory | S | .../skills/theme-factory | Apache-2.0 | official | copy folder | yes | palettes could seed theme tokens; fonts need policy check |
| anthropics/skills brand-guidelines | S | .../skills/brand-guidelines | Apache-2.0 | official | copy folder | yes | Anthropic branding; pattern for ADR 0027 only |
| anthropics/skills frontend-design | S | .../skills/frontend-design | Apache-2.0 | 995.5K installs | plugin or copy | yes | web deck only |
| zarazhangrui/frontend-slides | S | github.com/zarazhangrui/frontend-slides | MIT | 30.8k stars | `/plugin marketplace add https://github.com/zarazhangrui/frontend-slides` | yes | Google Fonts may load; has `extract-pptx.py` |
| op7418/guizang-ppt-skill | S | github.com/op7418/guizang-ppt-skill | AGPL-3.0 | 28.1k stars | `npx skills add ...` | yes | copyleft; ideas only; produces image prompts |
| ui-ux-pro-max-skill | S | github.com/nextlevelbuilder/ui-ux-pro-max-skill | MIT | 136.5k stars | `npm i -g ui-ux-pro-max-cli && uipro init --ai claude` | yes | Google font names need review; slides are premium |
| impeccable | S | github.com/pbakaus/impeccable | Apache-2.0 | 82.0k stars | `npx impeccable detect <path\|url> --json` | yes | web only |
| taste-skill | S | github.com/Leonxlnx/taste-skill | MIT | 98.0k stars | `npx skills add Leonxlnx/taste-skill` | yes | imagegen and brandkit parts conflict; text rules safe |
| vercel-labs web-design-guidelines | S | github.com/vercel-labs/agent-skills | MIT | 32.5k stars | `npx skills add vercel-labs/agent-skills --skill web-design-guidelines` | yes | LLM checklist; may fetch rules at runtime (unconfirmed) |
| HyperFrames slideshow skill | S | github.com/heygen-com/hyperframes | Apache-2.0 | 65.2k stars | via its CLI | yes | avoid media-use; registry blocks not audited |
| siril9/presentation-skill | S | github.com/siril9/presentation-skill | MIT | 78 stars | clone; `npm run setup:python` | yes | image variant unclear |
| Noi1r/powerpoint-skill | S | github.com/Noi1r/powerpoint-skill | MIT | 125 stars | clone; TeX, pandoc, Graphviz, LibreOffice | no | heavy dependencies |
| kos2001/ppt-generator | S | github.com/kos2001/ppt-generator | MIT | 0 stars, 25 commits | clone into skills | yes | unproven |
| mermaid-cli (mmdc) | C | github.com/mermaid-js/mermaid-cli | MIT | 5.1k stars | `npm i -g @mermaid-js/mermaid-cli` | yes | Chromium binary needs review |
| Google Slides API | SV | developers.google.com/workspace/slides/api/guides/overview | Proprietary | GA | `pip install google-api-python-client google-auth-oauthlib` | no | Google project, network; client data in Drive |
| google-slides-mcp (matteoantoci) | M | github.com/matteoantoci/google-slides-mcp | GPL-3.0 | 189 stars | per README | no | copyleft; thin wrapper |
| Office-PowerPoint-MCP-Server | M | github.com/GongRzhe/Office-PowerPoint-MCP-Server | MIT | 1.9k stars, ARCHIVED 2026-03-03 | `pip install -r requirements.txt` | yes | reference only; no render check |
| Gamma API | SV | developers.gamma.app/docs/getting-started | Proprietary; data terms unread | documented | HTTP + `X-API-KEY` | no | paid key; set `noImages`; benchmark only |
| Canva MCP | M | canva.dev/docs/mcp/ | Proprietary | official | `mcp.canva.com/mcp` | no | account; Canva picks images |
| v0 Platform API | SV | v0.app/docs/api/platform/overview | Proprietary | documented | API key | no | irrelevant to pptx |
| Tome | SV | chatslide.ai/articles/tome-ai-shut-down-what-happened | n/a | discontinued | n/a | no | product is gone |
| Lucide | L | github.com/lucide-icons/lucide | ISC (+MIT Feather) | very active | `npm i lucide-static` | yes | ADR 0027 question |
| Tabler Icons | L | github.com/tabler/tabler-icons | MIT | active | `npm i @tabler/icons` | yes | same |
| Phosphor Icons | L | github.com/phosphor-icons/core | MIT | active | `npm i @phosphor-icons/core` | yes | same |
| Material Symbols | L | github.com/google/material-design-icons | Apache-2.0 (font files unclear) | mature | vendor SVGs | yes | NOTICE terms; npm packages unvetted |
| Font Awesome Free 6 | L | github.com/FortAwesome/Font-Awesome | icons CC BY 4.0; fonts OFL; code MIT | mature | `npm i @fortawesome/fontawesome-free` | yes | attribution needed |
| Pictogrammers MDI | L | github.com/Templarian/MaterialDesign | Apache-2.0, some icons own licence | mature | `npm i @mdi/svg` | yes | per-icon check |
| Mermaid + mmdc | C | github.com/mermaid-js/mermaid-cli | Mermaid MIT; CLI line not shown in this fetch | widely used | as above | yes | Node and browser weight |
| Graphviz | C | graphviz.org/license/ | EPL-2.0 | very mature | `brew install graphviz` | yes | weak copyleft; system binary |
| Excalidraw | L | github.com/excalidraw/excalidraw | MIT | popular | not verified | no | headless export unverified; wrong style |
| matplotlib | L | github.com/matplotlib/matplotlib | PSF-based BSD-style | very mature | `pip install matplotlib` | yes | plain look |
| plotly + Kaleido | L | github.com/plotly/Kaleido | MIT / MIT | Kaleido 1.5.0 | `pip install plotly kaleido; kaleido_get_chrome` | yes | Chrome binary |
| vl-convert / Altair | L | github.com/vega/vl-convert | BSD-3 / BSD-3 | v2 RC | `pip install altair vl-convert-python` | yes | font handling untested |
| python-pptx | L | github.com/scanny/python-pptx | MIT | mature | already in use | yes | baseline |
| pptx-from-layouts-skill | S | github.com/tristan-mcinnis/pptx-from-layouts-skill | MIT | 36 stars | copy folder; `pip install python-pptx pydantic` | yes | needs a template; ADR 0027 |
| python-pptx-templater | L | pypi.org/project/python-pptx-templater/ | MIT | last release 2019 | `pip install` | no | stale |
| IBM Plex | L | github.com/IBM/plex | OFL 1.1, RFN "Plex" | mature | GitHub release | yes | none |
| Source Serif | L | github.com/adobe-fonts/source-serif | OFL 1.1, RFN "Source" | mature | GitHub release | yes | none |
| Inter | L | github.com/rsms/inter | OFL 1.1 (README claims RFN) | very mature | release or `pip install fonts-inter` | yes | record RFN caveat |
| D2 | C | github.com/terrastruct/d2 | MPL-2.0 | active | install script or `go install` | yes | Chromium for PNG/PDF; version check; TALA unconfirmed |
| PPTAgent / DeepPresenter | S | github.com/icip-cas/PPTAgent | MIT | 5.1k stars | clone; uv venv; playwright chromium | yes | keys in text mode; image creation off |
| PPTAgent paper (PPTEval) | L | arxiv.org/abs/2501.03936 | paper | published | reading | yes | running PPTEval needs an LLM |
| JetBrains/skills slides | S | github.com/JetBrains/skills/tree/main/slides | UNKNOWN | 370 stars | not verified | no | scripts unread; do not vendor |
| tfriedel/claude-office-skills | S | github.com/tfriedel/claude-office-skills | UNKNOWN; likely Anthropic text | 839 stars | not recommended | no | avoid |
| AutoPresent / SlidesBench | L | github.com/para-lost/AutoPresent | MIT | 181 stars | conda, pip, unoconv | no | needs paid OpenAI key |
| wcag-contrast-ratio | L | pypi.org/project/wcag-contrast-ratio/ | MIT | v0.9, 2015 | `pip install` | yes | unmaintained |
| axe-playwright-python + axe-core | L | pypi.org/project/axe-playwright-python/ | package licence null; axe-core MPL-2.0 | 0.1.8 | `pip install axe-playwright-python` | yes | web deck only; MPL question |
| pixelmatch | L | github.com/mapbox/pixelmatch | ISC | JS 7.0k stars; port 0.4.0 | `pip install pixelmatch` | yes | none |
| anthropic-skills:pptx (built in) | S | github.com/anthropics/skills | proprietary per terms; not opened here | unknown | already available | yes | reference only |
| slide-recipes (CacinieP/ppt-skills) | S | github.com/CacinieP/ppt-skills | MIT | 9 stars | clone; LibreOffice, poppler | yes | AI image option off |
| danny0926/ppt-skills | S | github.com/danny0926/ppt-skills | README says MIT; no LICENSE file, API shows null | 9 stars | `pip install jinja2 playwright python-pptx lxml` | yes | licence unverified; hand-drawn style |
| Figma MCP (write to Slides) | M | developers.figma.com/docs/figma-mcp-server/ | Proprietary; training only if admin enables | beta | `claude mcp add --transport http figma <url>` | no | seat and account; `generate_image` must not be used; no pptx export |
| Canva Connect API | SV | www.canva.dev/docs/connect/ | Proprietary | mixed GA/preview | OAuth 2.0 PKCE | no | paid plan; template imagery |
| Beautiful.ai API | SV | support.beautiful.ai/hc/en-us/articles/43654071102605-Beautiful-ai-API | Proprietary; terms unread | early access | request from vendor | no | generates its own content |

## 3. Dropped by the skeptics

The skeptics dropped nothing (DROPPED list empty). Verified entries that should not be pursued, from their own findings:

- Streamline Icons, StarryKit, Presenton, Gamma, Canva MCP and Connect, Beautiful.ai, Figma MCP, Google Slides API, v0: hosted, account or paid key needed, client material leaves our boundary, or non-open licence. Gamma could still serve as a look benchmark with `noImages`, but only on non-confidential content.
- CoDesign: proprietary engine, no PPTX export.
- google-slides-mcp: GPL-3.0.
- guizang-ppt-skill: AGPL-3.0; ideas only.
- slide-revive, JetBrains slides, tfriedel office skills: unknown licence.
- Tome: discontinued.
- AutoPresent: needs a paid OpenAI key.
- python-pptx-templater: last release 2019.
- Excalidraw: headless export unverified.
- Anthropic pptx skill: proprietary, pattern only.

## 4. What each source could not find

**Local directory (plugin cache)**
- Last-commit dates for every repo; maturity is by stars and commit counts.
- anthropics/financial-services deck-QC skills: only folder names seen, no contents or licence.
- Licences of Playwright MCP and anthropic-skills:pptx.
- Cached but not fetched: Slop Patterns, StyleSeed, Templafy, Templify, SuperCool Sites & Decks, Superdesign, Canva, Image Deep Research (would conflict with ADR 0023), Slidely, Ploxs, ArcDeck.
- No Python-native slide-design library or MCP beyond Tweenkit; no install counts for third-party plugins.

**Skill marketplaces**
- skillsmp.com returned no listings (JavaScript); smithery.ai and the official plugin directory not opened.
- No last-commit dates. Awesome lists seen only through search summaries; neither lists a presentation or diagram skill.
- MiniMax-AI/skills pptx-generator: directory only, no licence or description.
- No icon skill or MCP (e.g. Iconify) found. Excalidraw MCP (headless tools return not_implemented) not opened.
- mcp.so slide servers (Twistly, SlideSpeak, SlidesGPT, 2slides, Deckforge) seen only in a listing.
- No dedicated screenshot-based design review skill found.

**MCP and services**
- Pitch (pitch.com): no official developer API page; unverified, not listed.
- Beautiful.ai terms (403). Gamma data handling and rate limits (privacy page 403).
- Canva MCP tools list, limits, plans, data handling (help page 403); autofill field types not documented on the page read.
- Figma MCP: whether content goes to third-party model providers; no documented headless or token access; Figma Slides layout and master tool detail not found.
- Google Slides API: no auth details on the overview page; image-by-URL requirement unverified.
- No open-source presentation MCP with design or render checks beyond thin wrappers; samos123/pptx-mcp and charleslukowski/ppt_mcp licences unverified, not listed.

**Visual assets and charts**
- Datawrapper not fetched; no terms claimed.
- svgwrite, CairoSVG, resvg, svglib: no licences reported (CairoSVG URL 404).
- mermaid-cli licence line and Chromium requirement not shown in the fetch.
- D2 TALA engine licence unconfirmed; Material Symbols font licence unclear; Pictogrammers licence read from Templarian/MaterialDesign after a 404.
- Excalidraw headless export unconfirmed.

**QA and critique**
- No python-pptx text-overflow checker found; python-pptx does not expose rendered text height, so overflow needs font metrics (e.g. Pillow, licence not verified) or the LibreOffice render.
- JetBrains slides script bodies unread (raw URLs 404).
- PyPI HTML pages failed; facts from PyPI JSON.
- Not opened: Playwright and Puppeteer screenshot skills, Percy, Chromatic, Applitools, pa11y, odiff, the DeepPresenter paper. PPTAgent's SKILL.md and review prompt not opened.
- JetBrains/skills star counts disagree between mirrors.

## 5. Bake-off: what to authenticate or install

No paid model call is needed for the testable set. Suggested scratch-directory order:

1. **Python only, no accounts:** `pip install altair vl-convert-python pixelmatch wcag-contrast-ratio` (plus matplotlib if wanted); clone kos2001/ppt-generator and run its python-pptx render. Cost: disk and time.
2. **System tools:** LibreOffice (`soffice`) and poppler (`pdftoppm`) for the render-to-PNG loop; this is also the base of every pptx QA pattern. Free; LibreOffice substitutes fonts, so install Inter, IBM Plex or Source Serif first if comparing looks.
3. **Node and Chromium:** Node, then `npx playwright install chromium` (large download) for siril9/presentation-skill, impeccable (`npx impeccable detect`), htmldeck's checker (local Chrome/Edge), CacinieP render-qa and mermaid-cli. Free, but network at install time, and the browser binary needs the gate's binary review before adoption.
4. **Claude plugins (free, network at install):** htmldeck, dataink, Adds Up, Tweenkit via `/plugin marketplace add ...`. frontend-design is already installed.
5. **Optional, needs keys:** PPTAgent text mode needs ATRIA_API_KEY and VISUAL_API_KEY; use multimodal host mode to avoid them. Gamma needs a Pro plan API key (benchmark only, `noImages`, non-confidential content). Figma, Canva, Google Slides need accounts and OAuth (Figma Slides writing needs a Full seat; free during beta, usage-based later). None of these is a pipeline candidate.

Before adopting anything: run the licence gate on its dependency tree, record OFL fonts and ISC/MIT icon notices, and keep every image-generating option (PPTAgent asset creation, pdf-forge, slide-recipes, taste-skill imagegen, HyperFrames media-use, Figma `generate_image`, Gamma default images) switched off while ADR 0023 stands and ADR 0027 is unaccepted.
