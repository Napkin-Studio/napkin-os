# Napkin after Brief Maker: what happens next, and how to plan with thin or no client info

*Prepared for Sai, 2 Nov 2026 (revised after critic review). The agency-practice material is partly research-backed, from web research with skeptic checks. The data counts come from reading docs and feature records in the repo. Claims that failed or only half passed a skeptic check are marked **[weak]** or **[unverified]**. Rows and steps that are Napkin's own invention are marked **[design bet]**.*

**Short version**
- Trade sources describe roughly this sequence after a brief: creative brief, ideation, an internal cull to about 3-5 routes, an optional rough "tissue" session, then a formal client choice.
- The Territory tool maps onto the early ideation and culling stages as those sources describe them. Fit is a design judgement, not evidence.
- **The cans file (about 327 films, as described in the task) was not found.** It is not in the repo, `~/Downloads`, `~/Desktop` or `~/Documents`. The awardlib workbook, the raw Cannes and D&AD exports and the roughly 91k award boards were not found either. Every count below is as documented in docs and feature records, not from files I could open.
- None of the three designs proves its output beats one good prompt. The first build must include a blind comparison against a plain prompt, judged by Laurence or a creative director (CD).
- Recommended build: the Originality Engine's generation logic, plus the Territory Tool design's honesty and assumption mechanics, plus the Corpus-First design's measurement discipline. Section 7 gives the first slice.

---

## 1. What really happens after a good brief

This is assembled from trade explainers and one academic study. No primary process document was found from IPA, APG, WARC, BBH, W+K, adam&eveDDB, Ogilvy, TBWA or Mother, and many sources were paywalled. Treat it as a credible outline, not an industry standard.

| # | Stage | Who | Deliverable | Gate | Basis |
|---|---|---|---|---|---|
| 1 | **Re-brief and immersion.** The planner turns the marcom brief into a creative brief (proposition, audience, insight) after category, competitor and audience research. | Planner, account team | Creative brief | Client sign-off of the strategic interpretation | Source (Advantage Magazine) |
| 2 | **Creative team briefing and ideation.** CD and planner brief the creative pairs, who generate many rough directions. | CD, copywriter/art director pairs, planner | Many rough ideas grouped into directions | None stated | Source (trade explainer, Turnbull & Wheeler abstract) |
| 3 | **Internal review and narrowing.** Weak ideas are killed and about 3-5 concepts or territories go forward. | CD, planner | Shortlist | Not sourced | Source for the 3-5 figure, inference for roles |
| 4 | **Tissue session (optional).** An informal early show of rough work, often midway through a pitch. | Agency leads, client | Client reaction and steer | None stated | Source (Wikipedia, The Drum) |
| 5 | **Formal presentation and selection.** | Agency leads, client | Selected route | Client approval | Source (generic), inference for detail |
| 6 | **Development, pre-testing, media planning in parallel.** | Creative, media, research | Developed concepts, media plan | Not sourced | Inference from one explainer |
| 7 | **Production, QA, trafficking, reporting.** | Production, ops | Live campaign, report | Not sourced | Inference from one explainer |

**What the sources support**
- A study of 21 UK practitioners found a series of "sequentially linked stages", validation during development and varying client involvement ([Turnbull & Wheeler 2015](https://researchportal.port.ac.uk/en/publications/the-advertising-creative-process-a-study-of-uk-agencies/)). Confirmed, but only the abstract was read, so its stage list is not retrieved.
- A trade explainer gives the same shape: marcom brief, planner creative brief, creative development narrowed to about 3-5 concepts, media in parallel, production, QA, trafficking, reporting ([Advantage Magazine](https://advantagemagazine.co.za/how-a-brand-campaign-is-built/)).
- The tissue meeting is credited to Jay Chiat and was brought to London by HHCL in the early 1990s. The name comes from layouts on tracing paper ([Wikipedia](https://en.wikipedia.org/wiki/Tissue_meeting)). Confirmed, but secondary.
- At CP+B, tissue sessions are midway checkpoints after the field narrows to 3-4 agencies, with "10 or 15" very green-shoot ideas ([The Drum, 2023](https://www.thedrum.com/insight/2023/08/25/tissue-sessions-can-help-fend-cheaper-rivals-just-ask-crispin-porter-bogusky)). Confirmed through a paywall plus a search quote.

**Weak or unverified**
- **[weak]** Weigel (ex-W+K) "from-brief beats on-brief" and "let creatives into strategy". The page returned 403 and the wording was not found.
- **[weak]** Campaign's "Scrap the tissues" argument that tissues push toward client-friendly routes. 403, search snippets only. Hegarty's remark that tissue meetings' inventor should be "taken out and shot" is confirmed via secondary extracts, but it is one anecdotal view and I do not use it as evidence of bias.
- **[weak]** Timings. The Malaysian 4As recommend 4-5 weeks of creative development for a full pitch (confirmed, but regional and pitch-specific). A studio blog and an agency table gave other figures, both low confidence and unchecked.
- **[unverified]** "Chemistry session" as a format distinct from tissue. Attendees and standard territory counts were not confirmed.

The **Safe / Stretch / Brave ladder and the /35 score were not found in any source.** They are Napkin's own devices.

### 1b. What a good brief unlocks in the creative process

Open sources are thin here. The points below separate what is sourced from what is inference.

- **Briefing meeting.** Sourced: the CD and planner brief the creative pairs and the planner stays on as a sounding board. Practitioner dissent says creatives should be let into strategy rather than handed a finished document **[weak]**. A tool therefore feeds stimulus alongside the brief, not instead of discussion.
- **Stimulus.** Creatives report that references come from outside advertising (culture, comedy, non-feed sources), but this rests on a 403-blocked LBB piece and is **[weak]**. How award-winning teams find references is under-documented in open sources.
- **How many routes go to the client, and why.** Sourced: roughly 3-5 concepts are narrowed internally. One practitioner view recommends one recommended route plus two supporting routes rather than equal options, to avoid pushing the safest choice. It is one view, not a norm.
- **Between territory choice and concept development.** Sourced only by the generic explainer: the chosen territory is developed into campaign ideas, scripts and storyboards, with pre-testing and a client feedback loop (one source says a feedback memo within about 48 hours). Territory terminology is loose. An agency blog and the ARF place a territory beneath the big idea and campaign, but there is no authoritative definition. Napkin's definition is in Section 4.
- **Not found:** client-side steps, what a typical creative-planner working session looks like, and how feedback loops run after selection.

**Implication for Napkin.** The tissue and territory stage is described as early, rough and many-then-narrow, which a tool that generates wide and narrows to 3-5 can serve. The risk is that rough ideas look finished when polished. Keep output visibly rough. This is a design rule, not a finding.

---

## 2. Ways Napkin can progress after Brief Maker

| Option | What it does | Fit and evidence | Verdict |
|---|---|---|---|
| **Territory tool** (planned) | Stages 2-3: routes, tension, line, proof, score | Maps onto early ideation and culling. `engine/deck` stage c already writes 3 territories, so there is code to reuse. Whether it is the most automatable stage is my judgement. | **Do first** |
| Insight mining | Tensions from category friction | Step 4 inside the Territory pipeline | Fold in |
| Proposition hardening | Test and sharpen the single-minded proposition (SMP) | Brief Maker already drafts the SMP. Reuses existing swap, ownability and "would have to be true" rubrics. | Fold in |
| **Concept starters per territory** | A few idea seeds under a chosen territory | Obvious next step after territory choice (Section 1b). Keep it separate from the Territory tool so territory stays territory level. | **Second slice** |
| Presentation or deck | Stage 5, and the creative-brief-to-pitch narrative bridge | `engine/deck` exists. Territory output can feed its stage d. | Later, via hand-off |
| Media planning | Parallel stage 6 | The research tool has a media_spend lens, nothing else supports it | Not now |
| Concept pre-testing | Stage 6 | No data or evals in the repo | Not now |
| Production, QA, reporting | Stage 7 | I judge automation fit to be low for this team, unsupported by evidence | Out of scope |

**Recommendation.** Build the Territory tool next as a stimulus-and-narrowing tool, not an idea-finisher. Stop at territory level. Hand the chosen territory to the deck-maker using its existing key names, and add concept starters as a separate later slice.

---

## 3. Data inventory

**Headline: the cans file was NOT found.** It was searched to depth 4 by file name and content. Its columns (award, film name, campaign, brand, agency, notes) are known only from the task description. The only "327" hits were unrelated transcript files. Everything said about cans below is a conditional, to be confirmed when the file is profiled.

| Source | Counts (as documented) | Fields | Good for | Bad for |
|---|---|---|---|---|
| **RAG index `_index_v4`** (index not in repo) | About 7,392 chunks: IPA 3,480, D&AD 2,049, playbooks 1,213, Cannes 497, templates 153. About 616 whole cases (543 IPA, 73 Cannes), 16% from 2023 on. | Locked contract v1.4.0: 8 sources, 18 categories, award tier, year, IPA-only `strategic_territory` (8 values) and `effectiveness_type` (8 values) | Effectiveness evidence, playbook frameworks, recall on its own text (held-out recall@5 0.928) | No field for mechanism, tension, medium or idea type. Thin categories: technology 17, fashion 17, healthcare 20, luxury 1, b2b 0. Place on only about 490 chunks. |
| **D&AD** | 2,049 chunks, production-stage | Title, overview, credits | Reference only | Excluded from brief-side search. Not usable for strategy. |
| **Effie** | Ingest exists (193 cases, 57 fields, includes cautionary cases) | | Possible future source | Not in the index breakdown, so probably not indexed |
| **awardlib** (workbook not in repo) | 5,493 cases, 3,918 brands. 4,752 creative-family; the effectiveness-family count is **derived: 5,493 minus 4,752, about 741**. About 58% are from 2023 on, about 10% UK. | case_id, brand, title, year, show, tier, agency, country, problem, audience, insight, proposition, idea, execution, reported results, rights status, two URLs. No image fields. | Recent, broad precedent. Helps most in thin categories. | Insight and proposition are Napkin **reconstructions**. Results are entrant-reported. Rights rule **still open**. Dark by default (`RAG_AWARDLIB=off`). Brand-to-category map covers 1,810 brands, 640 ambiguous, not CD-reviewed. |
| **awardlib slice built** | About 1,190 chunks (24 duplicates, 30 no category, 27 failing rights skipped). Earlier slices of about 1,593 and 2,211 rows were also used. | As above | Gated thin-category fill | See experiments below |
| **cans** | About 327 films (claimed) | award, film name, campaign, brand, agency, notes (as described) | Possibly a light exemplar and stimulus list | **Not found.** Reported to have no year, country, category, insight, results or rights field, to be confirmed on profiling. Rows may be executions of repeated campaigns. |
| **Research Tool** | 109-leaf category taxonomy, 8 lenses, pins and findings model | Facts typed with tier, confidence derived in code, decision chain | Provenance machinery, `category_codes`, consumer_culture, brands_positioning. Needs only a category leaf and a market. | Brand-centred intake. **No populated real category store found**, only a fabricated example. Web-dependent, about 13 minutes on the one measured run. Research quality never evaluated. The cite rule drops claims containing years or euro amounts. **No link to awardlib or RAG.** |
| **Brief Maker clan** | 18 content keys. The Ballymaloe run also writes `job`, `barrier`, `objection`. | Per-value provenance, `review.scorecard`, "To confirm" flags | Direct input. Ballymaloe came from a one-line prompt. | Most drafted content is "To confirm" |
| **Ballymaloe test clan** | 1 real brief | | Thin-brief baseline | Lives in `~/Downloads`, not the repo |
| **Deck-maker stage c** | 3 territories, blind judge, insight judge (4 tests plus swap test) | id, name, thought, why, mood, references, risks, sketch | Pipeline shape, judges, key names | Fixed at 3, no ladder or score. Prompt forbids outside facts, conflicting with award proof. |
| **~91k award boards** | Not found | | Planned stage 2 | Treat as internal-only |

**Measured results on award data (ADR 0033 and the award-data-fit record).** These are separate experiments, all rated by models, not strategists.
1. **Thin-category test, 40 recent briefs (library-derived).** Useful cards per brief 0.35 to 1.43. Briefs with no useful card 28 to 8 of 40. Library set preferred 34-2 and 34-3. Caveat: the briefs came from the library.
2. **Covered UK IPA ground, 40 briefs, ungated.** Library cards scored 0.8 against 1.2 for existing cards. Bulk loading displaced better precedent.
3. **Final gated test, 41 fresh briefs (25 thin).** Useful cards per brief 0.60 to 1.16 in thin categories. Per-category results varied and telecoms fell (0.86 to 0.44).
4. **Drafting test (12 drafters, 2 judge passes).** Library examples had no effect on insight or proposition quality. This is one test. Retest before ruling the approach out. For now do not plan on it.

**Award evidence caveats from the web research**
- Awarded work was about 12x more efficient than non-awarded in 1996-2008 and about 4x in 2006-2018 (confirmed, [Contagious](https://www.contagious.com/news-and-views/the-creative-awards-crisis-is-an-advertising-crisis)). The "advantage has vanished" and Cannes/WARC "no more effective" wording is **[weak]** and may conflate two studies.
- The Effectiveness Code figures were confirmed: about 5,000 entrants, 2011-2019, awarded campaigns more effective at every commitment level ([Campaign Brief](https://campaignbrief.com/?p=189871)).
- **[weak]** Kantar's "1 in 4 of 25 winners" could not be fetched. System1's "half of Grand Prix films scored 1 star" was found in search. The "35% could not recall the brand" figure was not found.
- Winning a Lion is not proof it worked. Every case needs an evidence label.

---

## 4. The worst-case pipeline (minimal or no client info)

The minimum viable input is a **category leaf plus a market**, which the Research Tool needs. Zero-input handling is in 4b. The pipeline merges the three designs. Cost and latency lines are rough estimates and **unmeasured** except where stated. A full no-web run is roughly 20-40 model calls and under 10 minutes, to be measured on the first slice.

**Definition.** A **territory** is a named strategic-creative route: a tension (X, but Y), a territory line that names the area to explore, and a proof case. It is not a proposition (the single thought the brief states), not an idea (a specific creative answer) and not a campaign line (the consumer-facing words).

**Napkin design bets (unproven, not industry practice).** The Safe/Stretch/Brave ladder and its convention-count rule, the /35 score, embed-cluster-keep-one diversity, mid-distance analogy retrieval, the dominant/residual/emergent labels on award data, the random-entry slot and the assumption-dependent marker. Each needs testing.

### Step 0. Cost card and intake  *(0 calls, seconds)*
- Before any paid run, show an estimate of calls, tokens and dollars and wait for a yes. Offer a cheap mode.
- Read the Brief Maker clan with the existing `engine/deck/inputs.brief_from_data`. Count missing and "To confirm" fields into a **thinness score**.

### Step 1. Assumed Brief and assumption register  *(about 3-5 calls, about 1 minute)*
- Tag every field **given / inferred / assumed**, reusing the golden spec's client_stated / inferred / missing enum.
- Draft background, 2-3 audience framings, job hypotheses and a one-line diagnosis in Rumelt form (one specific challenge, not fluff).
- Rank assumptions by importance against evidence and surface the **top 3 client questions**.
- A persistent "built on an assumed brief" banner stays until a person confirms category and audience.

### Step 2. Category understanding  *(owned data: 1 cached tagging batch plus aggregation; web: 6 + S calls, about 13 minutes measured once)*
- *Owned-data dossier, no web:* pull category cases from awardlib, cans (if profiled), IPA and Cannes. Aggregate by category, year, tier and media. Tag each case once, in a cacheable batch, for mechanism, tone, claim type, device and reframe move.
- *Competitor map and execution codes:* list named competitors and what category ads look, sound and say like. Sources are Research Tool `category_codes`, `brands_positioning` and `media_spend` (share of voice) where run, plus tagged cases. If only owned data is used, label the map "from award winners, not the market".
- *Whitespace view:* a simple map of which claims, tones and mechanisms are crowded and which are empty, from the tags. Label it a hypothesis.
- *Cultural tension source:* Research Tool `consumer_culture` facts only. Without the web dossier, cultural opportunities are marked "not researched".
- *Optional web dossier:* lenses market_structure, consumer_culture, category_codes, brands_positioning, media_spend, effectiveness_evidence. Flag regulation_clearance early (alcohol, gambling, healthcare, finance). Label it **unmeasured**.
- Output: facts with tier and coverage (filled, thin, empty). Show "too thin, treat as anecdote" below n=30.

### Step 3. Convention map  *(1-2 calls plus the cached tags)*
- Follow the TBWA Disruption shape (convention, disruption, vision). Dru's 1992 launch and the 1996 book are confirmed, and so is the shape. Whether it works is not established. Conventions fall into marketing, consumer and advertising types.
- Keep three evidence types separate: dossier `category_codes` facts, award-cluster patterns and model inference.
- Every convention cites at least 3 case ids (a design rule).
- Print on every map: **"dominant among winners, not dominant in market."**
- Dominant / residual / emergent labels (Raymond Williams' scheme) use award year where it exists. Commercial semiotics sourcing is weak, so these are **hypotheses [design bet]**. Cans-only conventions stay untimed if cans has no year.
- Invert each dominant convention (drop, reverse, exaggerate, borrow a code) and run an ERRC pass. The ERRC questions are confirmed; their sequencing after a strategy canvas is not.
- Guardrail: does the break still link to a buying situation and stay recognisable? Dru warns disruption for its own sake is self-defeating (Benetton).
- **No evidence was found that breaking conventions raises effectiveness.** The tool says "different", not "better".
- A planner or CD strikes false conventions before anything is inverted.

### Step 4. Opportunity and tension mining  *(1-3 calls)*
- Aim for 6-10 tensions in "X, but Y" form. Sources: gaps between convention and consumer_culture facts, the brief's barrier and objection, job-to-be-done reframes (Christensen, HBR 2016, confirmed) and reframe moves from winning cases.
- Each tension must pass the deck-maker `insight_judge` tests plus the **swap test** (would it work for any brand in the category?). Evidence level: **observed**, **triangulated** or **invented-by-model**. Invented tensions sort last.
- "X, but Y" is practitioner shorthand. Parker et al. 2021 define insight as a human truth with a solvable tension. The link to the sentence format is our inference **[weak]**.
- The most valuable human checkpoint (see 4c).

### Step 5. Territory generation  *(1-3 calls plus embeddings)*
- **[design bet]** Build each seed from a distinct combination of framing x inversion move x analogy source x persona or constraint. Over-generate about 30 seeds, embed and cluster, keep at most one per cluster.
- Diversity metrics: pairwise distance, duplicate rate across runs, how many generators survive.
- Doshi & Hauser 2024 and Si et al. support the homogeneity worry, but they studied fiction and research ideas, not ads. Whether clustering fixes it for territories is a hypothesis to measure.
- Stimulus techniques are in 4d.

### Step 6. References and proof cases  *(retrieval plus 1-2 calls)*
- Abstract the tension to relational form with category words stripped, for example "a trusted thing quietly failing". Retrieve from other categories by mechanism. Show same-category hits separately as convention evidence.
- Mid-distance analogies rest on an engineering-design study of novice designers and a Gentner-style reading. Treat as a design bet **[weak]**.
- Each reference carries the transferable mechanism and a **"borrow the mechanism, not the execution"** note.
- Badges: **evidence level** (creative-only winners are "inspiration", not "proof"), **VERIFIED or UNVERIFIED** (VERIFIED needs a source a person checked) and an advisory **brand-linkage flag**.
- Crowding check: nearest neighbours of each territory line against the library. Absence of a neighbour is not proof of novelty.

### Step 7. Cull and score /35  *(about 1 call per survivor, a different model from the writer)*
- **[design bet]** Seven dimensions at 5 each:
  1. Fit to the assumed brief
  2. Truth of the tension
  3. Ownability
  4. Distinctiveness from conventions
  5. Ability to travel across channels
  6. Emotion and fame potential
  7. Distinctive-asset potential
- The scorer is blind to tier. Every score has a one-line reason. LLM judges are unreliable evaluators (Si et al.), so scores are advisory and a human picks the final 3-5, with overrides logged.
- Spread rule: no two survivors share a mechanism or a broken convention.
- Ladder rule, Napkin's own: **Safe breaks 0 dominant conventions, Stretch breaks 1, Brave breaks 2 or more or reframes the category.** The count depends on model-inferred conventions, which are unvalidated, so treat tiers as a working label and check them with a CD. Always keep one deliberately Safe territory.
- Any score resting on an assumed audience or invented tension carries an **"assumption-dependent"** marker and cannot be marked ready.

### Step 8. Stronger propositions  *(1-2 calls)*
- Tension first, proposition second. Each is one thought, 20 words or fewer, no "and" (house SMP rule).
- Survival tests: swap, "so what", ownability against named competitors (reuse the OWNABLE TENSION rule, "unchecked" if competitors are unknown) and Rumelt's bad-strategy hallmarks.
- Add a **"would have to be true"** list and the **cheapest test** of the riskiest assumption. Offer 2-3 wordings so the CD edits rather than accepts.

### Step 9. Tissue cards and hand-off
- Cards are deliberately rough: line, "X, but Y", ladder tier, why it fits, proof with badge, `assumes` list, a "what we did NOT copy" note and a kill / keep / combine vote.
- Export in deck-maker stage-d key names (id, name, thought, why, mood, references, risks, sketch) plus tension, tier, assumes and proof_cases.
- Client-facing export carries public facts only: film, brand, agency, award, year.

### 4a. Worked example: Ballymaloe (illustrative, not a run)
No real data was run. Built from the Ballymaloe run's content (insight, SMP, objection, competitors Heinz and own-label chutneys). Case ids and conventions are placeholders to be filled by a real run.

- **Assumed brief:** audience under-35s in Ireland *(given)*. Barrier "I never think about the sauce, I just grab the usual" *(inferred, To confirm)*. Commercial target *(assumed, no baseline)*.
- **Conventions (hypotheses, each needs 3 case ids from a real run):** (1) condiment ads show a family table and heritage; (2) the product is a red, glossy hero shot; (3) claims are about taste, not about the meal.
- **Tensions:** (a) "They take trouble over the meal, then reach for whatever sauce is already there" *(from the brief, observed)*. (b) "Everyone says sauce is a side, but it is the part people tell friends about" *(invented-by-model)*. (c) "Ketchup does the job, but nobody chose it" *(inferred from objection, to confirm)*.
- **Territory card (Stretch):**
  - Line: "The last decision at the table".
  - Tension: (a).
  - Why it fits: speaks to the barrier directly.
  - Proof: [case id], UNVERIFIED, mechanism "elevating an overlooked ritual", from a non-food category.
  - Not copied: that case's execution.
  - Assumes: the audience cooks at home at least weekly.
  - Client questions: What is the price gap to Heinz? Is there product proof (awards, taste tests)?
  - Vote: keep / kill / combine.

### 4b. Zero-input decision tree
| Input | Action |
|---|---|
| Clan with a category and market | Proceed. Compute thinness. |
| Brand name or URL only | Infer a category leaf and market, then ask one confirmation question. Nothing runs until confirmed. |
| One-line prompt only | Extract category and market, then confirm (Ballymaloe came from this). |
| No brand, no category | Ask one question for category and market. If still unknown, **produce no territories** and say why. |
| Category known but no audience | Run, with the audience marked assumed and every card marked assumption-dependent. |

The tool will not output "ready" territories on an assumed audience, and will not run on a guessed category. The confidence floor is a confirmed category and market. Thresholds are a design choice to tune.

### 4c. How people interact (design bet)
- At Step 1 the planner edits tags and answers client questions. At Step 3 they strike false conventions. At Step 4 they pin, reject or edit tensions and can regenerate unpinned ones, since this is the highest-leverage checkpoint. At Step 7 they override scores, logged as decisions.
- A stuck creative uses "push further" (more distant analogy) or "make it weirder" with an automatic fit check against the brief, plus a fresh random stimulus. Rejected items are not regenerated.

### 4d. Beyond-advertising stimulus (design bet, unproven)
- **Source lists:** culture, film, art, music, science, nature, sport, history, everyday behaviour. These are Napkin choices, with no cited evidence that they raise originality.
- **Technique menu:** forced connection (random entry, de Bono), SCAMPER, constraint-led prompts, opposite or worst-idea prompts, role-play provocations, Oblique Strategies-style cards. The history of these is confirmed, their effect in ad territories is not.
- Measure first whether random stimulus beats a plain prompt for diversity.

### 4e. Data-to-step wiring
| Source | Step | Query and return |
|---|---|---|
| Brief Maker clan | 0, 1, 4 | `brief_from_data`: all fields, thinness, barrier, objection |
| Research Tool | 2, 3, 4 | Category leaf + market: `category_codes`, `consumer_culture`, `brands_positioning`, `media_spend` facts. Optional and unmeasured. |
| RAG (IPA, Cannes) | 2, 3, 6 | Category filter; use `strategic_territory` and `effectiveness_type` as tags to find reframing and challenger cases. Returns chunks with tier, year. |
| RAG playbooks (1,213) | 3, 4, 8 | Framework text (conventions, positioning) for prompts and rubrics |
| RAG templates | 1, 8 | Brief-writing templates for the instructions bucket |
| awardlib | 2, 3, 6, 7 | Gated: thin categories only. Reconstructed problem, insight, idea. Insight-labelled UNVERIFIED. |
| cans (if profiled) | 2, 6 | Brand, campaign, notes: stimulus and cross-category lookup |
| Effie | none yet | Ingest exists, likely unindexed. A source for cautionary cases if indexed. |

**Prerequisite:** a shared category key. The Research Tool uses a 109-leaf taxonomy and RAG uses 18 categories. No mapping between them was found, so one must be written (leaf to category) before the Research Tool dossier can join award data. Until then, treat the dossier as a separate input.

---

## 5. Using cans and awardlib specifically

**First, when cans arrives.** Profile it before designing around it: row count, format of `award` (probably free text mixing show, category and tier), whether `notes` is long enough to carry a mechanism, whether campaigns repeat across rows, and which brands appear. Everything below is conditional on that profile.

**Concrete analyses**
1. **Winner patterns by category.** Count tagged mechanisms and tones. Per-category n is small, so apply the minimum-n guard.
2. **Convention-challenge gallery.** For a named convention, list winners whose notes describe breaking it, as precedent for Stretch and Brave and as a "this has been done" warning. Award tier is a crude proxy for bravery and must not be presented as one.
3. **Notes mining.** An LLM writes one plain-words line per film (category assumption, what was flipped, mechanism), stored in a side file as machine-generated and unverified. Spot-check a sample before it feeds retrieval.
4. **Brand and agency lookups** for "who did something unexpected in a category like this". Map brands to categories with the `brand_categories.json` approach and queue ambiguous ones (about 35% in awardlib) for CD review.
5. **Join to awardlib** on brand plus campaign or title. If cans has no year, duplicate logic needs looser matching and a human check. Unmatched films are "needs enrichment" and never shown as proof. **Report the match rate first.**
6. **Cross-category analogy and random-entry stimulus.** At about 327 rows, cheap to embed.
7. **Crowding.** Add film names, campaigns and notes to the nearest-neighbour index.
8. **Saturated-mechanism map** (awardlib). Goldenberg's six-template taxonomy is a candidate start. Its "89% of 200 award ads" figure is from the 1999 Marketing Science paper, but secondary coverage muddled the source, so read the paper first **[weak]**.

**Extra fields that would help**
- **cans:** year, country, a normalised tier, a Lions category, a source URL and a rights field (if absent).
- **Both:** a closed-list `mechanism`, the tension or reframe move, medium and format, a long- versus short-term flag, a results-evidence level, brand-linkage and a verified flag with reviewer and date.
- Adding mechanism or tension to the locked RAG contract needs a minor version bump. A sidecar file avoids touching the contract first.

**Handling rules**
- Keep cans a separate gated lookup, like `RAG_AWARDLIB`, not mixed into brief exemplars, because ungated award text displaced better precedent in the IPA test.
- Rights default to the strictest rule: public facts only, no stills, video or verbatim notes in client output.
- Keep a source URL and provenance on every case. The 2025 DM9 withdrawal over AI-manipulated footage in a case study shows why.

---

## 6. How this changes the planned Territory tool

**Add**
- Thinness read, assumed-brief mode, tags and banner. Assumption register and client questions on every card.
- Evidence levels on tensions and proof badges on cases.
- A convention map before any territory. A spread rule and crowding check. A cost card.
- A baseline arm: a plain single-prompt run to compare against.

**Change**
- 3-5 territories, not a fixed 3.
- Ladder placement by a stated rule, not mood (but see the validity caveat in Step 7).
- Award data used for conventions, references and crowding, not as drafting examples for now.

**Cut or defer**
- The live web dossier, 91k board search, verified-badge UI, kill/keep/combine UI and any client-facing export until the rights rule is decided.

**Fatal flaws and rework risks**
- **Nothing proves it beats one good prompt.** The /35 score, ladder and mid-distance rule are Napkin inventions, and a model writes, tags and scores. Only a blind human comparison tests this.
- **Awards are a biased sample.** In thin categories (b2b 0, luxury 1, technology 17, healthcare 20 own RAG cases) the map rests on very few cases, exactly where thin briefs are likeliest.
- **Process weight.** Nine steps and many labels risk a CD skipping the tool. The first slice must produce cards, not reports.
- **Corpus-First's slice 1 ends at a convention report with no territories** and needs a tagging batch over about 5,800 cases first.
- **The Originality Engine never defines "originality".** Spread can reward weirdness over fit.
- **The Territory Tool design's strongest step is its least proven.** The web dossier is brand-centred and unevaluated, and needs a category-only intake path.
- **Retrieval has no no-brief entry point.** With no brief, `plan()` degrades to a generic query. No mechanism field, by-tension retrieval or market filter exists.
- **Missing files.** Every count must be re-measured when the files are found.
- **Weak framework sources.** Pollard's Four Points, Sharp, Kay, Steel, Morgan's credos, the Zag whitespace chapter and the SIS semiotics page are weak or unverified. The sources confirmed to exist are Disruption (Dru), ERRC (the four questions), job-to-be-done, Rumelt, IDEO analogous inspiration and Binet & Field 60:40 as a guideline. Existence of a source does not show the method works. Label everything else as a hypothesis.
- **Cannes jury practice.** The claim that juries cite convention-breaking was not verified. Keep it out of product copy.

---

## 7. First build slice, open questions and risks

**Slice (about 2-3 weeks, text-only, no web spend, no images; the estimate is unvalidated)**

Follow the repo workflow first: open a feature record, get your approval of the design, then write code.

1. **Reader and thinness.** Reuse `inputs.brief_from_data`, including barrier, objection, tone and the scorecard.
2. **Assumed brief, register and top-3 client questions**, with tags and the zero-input tree from 4b.
3. **Convention audit.** awardlib via the existing gate pattern, plus IPA and Cannes chunks. Show coverage warnings, the 3-case rule and the "winners, not market" caveat.
4. **Tensions** (6-10) with evidence levels and the swap test.
5. **About 30 seeds** from the grid, cluster, keep one per cluster, cull to 3-5 with a ladder tier and spread rule. Add one random-entry provocation and one deliberately Safe territory.
6. **Cards** with proof cases (UNVERIFIED), assumes list, client questions and a blind scorer on a second model.
7. **Crowding check** by text embedding against awardlib.
8. **Output** in deck-maker key names.

**How to know it worked:** run Ballymaloe plus one no-brief run (category and market only). Have Laurence or a CD blind-compare against a plain single-prompt 3-territory output and a planner's own set. Record distinctiveness, trust in each proposition, distinct mechanisms and cluster spread.

**Defer:** the cans ingest (profile the day it lands), mechanism tagging at scale, 91k image search, Goldenberg taxonomy, web dossier, concept starters and client export.

**Open questions for you**
1. Where are the cans file and awardlib workbook? Which columns does cans really have, and how long is `notes`?
2. What is the rights rule for award text: verbatim or paraphrase only? You and Laurence own it.
3. Is the 21 Oct awardlib workbook the latest?
4. Will Laurence or a CD blind-compare the output? Who is the grader?
5. For a brand-name or URL-only start, do you accept the confirm-then-run path in 4b?
6. Is a live web dossier worth about 13 minutes and unmeasured quality in v1, or owned data only?
7. Who reviews the 640 ambiguous brand-category mappings, and who writes the 109-leaf to 18-category mapping?
8. Keep Safe / Stretch / Brave with a /35 score, given no industry source backs it?

**Risks**
- **Fabricated confidence:** a model guessing a brief then labelling guesses. Mitigations: tags, banner, assumption-dependent marker, client questions, refusal floor.
- **Over-reading awards:** "won" does not mean "worked".
- **Sameness:** untested for ad territories. Measure on real runs.
- **Rights and confidentiality:** the awardlib rule is open. Boards stay internal and client material never enters a shared corpus.
- **Polish bias:** keep cards rough. This is a design rule, not a finding.
- **Cost and latency:** show cost first, cache audits per category and market.
- **Data availability:** missing files can block dependent slices.

---

## Confidence and gaps

- **Higher confidence:** the existence and shape of Disruption, Binet & Field 60:40, the 12x and 4x efficiency figures, the Effectiveness Code figures, the Turnbull & Wheeler abstract, the tissue-meeting origin and the awardlib experiment results as documented.
- **Medium or low:** the stage table (largely trade explainers and inference), all timings, Raymond Williams-style code labels on award data, Goldenberg's 89%, mid-distance analogy value, Kantar and System1 figures, and every framework marked weak.
- **Not verified at all:** cans contents, any count read from a file (all counts are as documented), Cannes jury practice, chemistry sessions, and whether convention-breaking raises effectiveness.
- **Unmeasured:** cost and latency per step, research-dossier quality, ladder validity, and whether any of this beats a single good prompt.
- **Not researched:** primary agency process documents, client-side steps, how creatives actually use stimulus, and how reference-finding works at award-winning teams.
- **Illustrative only:** the Ballymaloe worked example in 4a was not run.
- **Next steps to close gaps:** find the missing files and re-measure counts, profile cans, run the blind comparison, and read Turnbull & Wheeler and the Goldenberg paper in full.