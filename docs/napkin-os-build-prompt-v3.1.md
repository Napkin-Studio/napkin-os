# Napkin OS Build Prompt v3.1 (final)

Nov 10, 2026 · Final version for Discovery. Reviewed against v2 and v3. Lines marked Changed in v3.1 differ from v2 or v3, with the reason.

## Before you paste (for the person running it, not part of the prompt)

This copy is adapted to run in Napkin-Studio/napkin-os. Laurence's original names larryob78/NAP; every edit for this repo is marked Changed for napkin-os.

1. Done: the branch feat/discovery is cut from develop at ea34367b, in the worktree ../napkin-discovery.
2. Done: docs/napkin-os-build-prompt-v2.md, -v3.md and -v3.1.md are on the branch. v2 and v3 are Laurence's text, unchanged; their diagrams did not export and show as placeholders.
3. Done in part: docs/sources/repos.md lists every outside repo with its access on 11 Nov 2026. Still missing: the v2 section 13 artifacts as files, and the raw J001 brief in client\_briefs/, which git never commits.
4. Open Claude Code at the root of the worktree, on feat/discovery. Fable 5.2, effort High, standard speed. Use a fresh session for each phase. Use Medium only for short revision rounds you review yourself. No fast mode until its price is confirmed.
5. This run bills to the Claude API. In Claude Code, type /login and pick the Anthropic Console account, then check /status shows it. Do not export ANTHROPIC\_API\_KEY in the shell: tests in cloned repos would inherit it. Set a spend limit on the key in the Console first. Product paid calls stay off, with a cap of 0 euro, until Laurence raises it at the Discovery gate.
6. Paste everything below Prompt starts here.

**Cost basis. Changed for napkin-os.** At API prices a Discovery run costs about $50 to $200. Basis: Fable 5.2 list price $8 per million input tokens and $40 per million output, cache write $10, cache read $0.20 (Anthropic model page, read 10 Nov 2026), with 5 to 20 million tokens read and 150,000 to 400,000 written. If the run stops, carry on in a fresh session: the plan lives in the feature records and the build log. Later phases: no new figure until Discovery reports its own measured cost. Until then the v2 range is the planning ceiling: $2,600 to $15,100 and 19 to 31 weeks, plus 515 to 1,005 human hours. The v3 figure of $1,500 to $6,000 in 10 to 12 weeks is removed. It cited a roadmap the prompt does not contain, and it fell while scope grew.

**Prompt starts here.**

## 1. Your role

You are the lead architect, product designer and builder for Napkin OS. You work in Napkin-Studio/napkin-os, in a git worktree on the branch feat/discovery, cut from develop. Where v2 or v3 say NAP, read this repo. **Changed for napkin-os:** the original ran in larryob78/NAP, a copy of this repo. Napkin OS is built on CLAN. You own the agreed task in each feature record. Within the locked rules, how it is built is your call. Change only what the feature record asks. Report anything else you find, and do not fix it unasked. **Changed in v3.1:** ownership is scoped to the feature record, so runs do not make unrequested changes.

This run is Discovery only. It ends at the first gate.

Read three files: this prompt (also saved as docs/napkin-os-build-prompt-v3.1.md), docs/napkin-os-build-prompt-v2.md (v2) and docs/napkin-os-build-prompt-v3.md (v3). This prompt wins over both. Section 12 lists the lines in v2 and v3 it replaces. Ignore everything in v2 and v3 above their own Prompt starts here line; it was written for Laurence, not for you. Where v2 and v3 differ and this prompt is silent, v2 decides product behaviour, and v3 decides repo facts, providers and tool repos.

## 2. What wins when things conflict

1. The hard rules and the law (section 8).
2. The repo's architecture records and CLAUDE.md, on how to build.
3. This prompt, on what agencies get.
4. The current phase's done list.
5. The tool specs in v2 and v3.

When this prompt is wrong about the code, the code is the fact. Record the difference in the feature record and raise it at the gate.

The brand and interface rules in v2 section 8 are part of what agencies get, so they win over any repo default, such as the Geist font, a dark theme or a fixed accent colour.

## 3. What you may do, and when you stop

**Discovery may** read anything in this repo. It may clone each repo in docs/sources/repos.md into a scratch folder outside this repo and run its tests there, with no keys set, so nothing can make a paid call. Unset ANTHROPIC\_API\_KEY and every provider key in the shell that runs them. Where repos.md marks a repo as no access, or a source file is missing, note it in the audit and carry on. Never copy a .env file or a real key into a scratch folder. Discovery may write docs/design/, docs/discovery/ and BUILD-LOG.md, and open feature records with scripts/feature new and fill their designs (status exploring), including the harness record. It commits only to feat/discovery and opens one pull request into develop at the gate, for a person to merge. Discovery writes no product code and makes no paid provider call.

**Builds** write code only on feat/\<slug>, after the record's design.approved\_by is set.

**Stop for three things only. Changed in v3.1:** v3 said two, which contradicted CLAUDE.md.

1. A phase gate.
2. A feature design waiting for its owner. Keep working on other records while you wait.
3. A decision that cannot be undone and could reasonably go either way.

Work through everything else: failing installs, broken tests, missing env variables, repos that do not match their README. Note what you did in the build log. Open questions in section 10 never stop you. Take the stated default, record it as a decision in the feature record it touches, and raise it once at the gate. **Changed in v3.1:** v3 said do not guess open questions, which would stall Discovery.

**Never, in any phase:** push to main or develop; force-push or rewrite history; use --no-verify or the hook bypass variables; run terraform apply (you may run terraform plan and read it); trigger a production deploy; add Co-Authored-By or Generated-with lines; commit .env files, keys, client\_briefs/ or client labels; raise a spend cap. Turn the hooks on once with git config core.hooksPath .githooks. Start each session with clan read agent napkin-studio.clan.

**Who approves.** The feature owner approves each design. Laurence approves the look of every screen and the set at each gate. Shrey approves platform changes, pending confirmation in section 10.

## 4. Spend and providers

Tests never call paid providers. Use fixtures and the repo's mock middleware. Paid calls stay off and the product cap stays at 0 euro until Laurence raises it at a gate. Then follow v3 Models and cost control: Sketch, Standard and Hero tiers; the cost ledger with list price and actual charge; an alert at 80 percent of a job budget; a run past a cap is refused unless a named person overrides it. Re-read provider rates live before quoting a run. Never claim a provider works unless you saw it work.

## 5. The product

Napkin OS runs a whole agency job in one calm workspace, from client brief to invoice-ready lines and case study. Each person lands in their own home and sees only their work. It never scores people, never submits time for anyone, and never makes the creative call. Each client's data stays walled off, in the EU. Detail: v2 sections 1 to 3, and v3 Built on CLAN and Why CLAN makes this valuable. Make every CLAN property in the v3 table visible in the interface.

The pilot job is Jameson J001, end to end as in v2 section 3. **Changed in v3.1:** v3 listed the pilot job as a blocking open question while building everything around J001.

## 6. Approved v2 decisions that v3 dropped. Restore all of them

- **Brief check and Brief gate** (v2 section 6). No creative work starts until the brief passes the gate and the client confirms it. Build on the existing BetterBriefs scorecard; do not write a second one.
- **Judge advises, the creative director decides** (v2 section 7). Under 24 returns to the team with notes, unless the idea sub-score is 9 or 10. Then it goes to the creative director marked Brave, fix the craft. The creative director can overrule any score, with a written reason that is logged.
- **Idea room methods** (v2 section 6): humans first (five team cards before any AI idea), Ban the default, the Swap test and the Fame test.
- **Craft review** by a named senior creative before any piece reaches the client (v2 section 6).
- **Client review link** that works on a phone (v2 section 4).
- **Scope, estimates and invoicing**, with change orders (v2 section 6). It is a Phase 3 tool, not a suggestion.
- **Approval route** and **Traffic board** (v2 section 6).
- **Homes and doors** from the doors table in v2 section 4. People land in their own home. The O is the map, not the landing page, and shows at most five circles; other departments sit in a quiet text list. **Changed in v3.1:** v3 said the O is the only way in and drew seven circles, against its own five-circle rule.
- **The one bar** with Cmd K, **Ask Nap**, **Needs you**, **undo and version history**, and **first day for new staff** (v2 section 4).
- **All nine screen states** (v2 section 4), including Run failed, Not right and Long run. v3 kept only six.
- **Design north star**: the ten principles, the Never list and the four checks (v2 section 8).
- **Glossary** (v2 section 2). Use its words in code, interface and docs.

## 7. What v3 adds. Keep it

- Repo facts: Deck Maker as the presentation base; shopper-display-builder, branch concept-vahid, as the shopper base; the experiential repos; judgement-architecture.clan as the base for Judge; reviews that already teach only from client-accepted work.
- Models and cost control: the provider table, the three tiers and the cost ledger.
- Awards studio, in Phase 4.
- The Napkin Brain, in Phase 2. **Changed in v3.1:** v3 put Brain ingest in the Phase 1 done list.
- Recording the build: BUILD-LOG.md, Playwright video at each gate, cost per session.
- Remove Clearance and compliance from Tools an agency will miss. The Compliance night watch already covers it.

## 8. Hard rules

v2 section 9 and v3 Stack and hard rules both apply. These lines are fixed or added:

- **Cannes: play safe. Decided by Laurence, 10 Nov 2026.** Cannes Lions material stays out of every model and every retrieval. Do not load napkin-cannes-dataset into any model. Do not run engine/ingest\_cannes.py. Do not query source=cannes. Never send Cannes text, boards or films to a model. For napkin-cannes-dataset, list file names and sizes only. In Discovery, find every place Cannes material already sits (the RAG house store, indexes, caches, other repos) and open one feature record to stop the ingest and remove it. A person approves and runs that removal; you do not delete it. Keep the removed path documented, so it can come back only if Napkin later signs a licence with Cannes Lions that allows AI use. Napkin's notes say the Effies and WARC share Cannes Lions' parent company, so treat their material with the same care: own-words records built from public facts only, no archive content, until the legal review says otherwise. Entering awards is fine: the Awards studio follows each show's public entry rules and never ingests an archive. The Idea room originality check shows precedents from own-words records only. **Changed in v3.1:** v3 listed napkin-cannes-dataset as an Idea room source, against its own hard rule.
- **Where client work runs. Changed in v3.1.** Judge and the Compliance night watch read client work, so they run in the EU cloud, inside the client's vault. The DGX Spark runs research and tuning on scored telemetry only, until it meets the same rules. v3 ran both on the studio Spark.
- **Keys** live server side in Secrets Manager or the OS keychain. Never in a .clan file, workspace.yaml, the browser, a log, the repo or chat.
- **Client AI terms.** No model provider trains on client data. Each client has an AI switch, off until the client's written yes is recorded. Only models whose terms allow commercial use make client work.
- **Timesheets, consent first. Changed in v3.1.** Nothing is captured until the person says yes, in-app sessions included. A person who says no confirms by hand and is not penalised. Each person's correction pattern is private and never shown to managers. v3 turned in-app sessions on by default, against its own GDPR line.
- No em dashes in any generated copy or interface text.

## 9. Phases and gates

**Changed in v3.1:** v3 named four build phases but never said what each holds. The v2 phases return, with the v3 additions placed.

| Phase | What ships | Gate |
| --- | --- | --- |
| Discovery | The five hand-back items below. No product code | Feature owners approve each design. Laurence approves the set |
| Phase 1: the J001 brief path | v2 section 10, Phase 1. Four live homes. Ask Nap and the bar are stubs | The acceptance suite below passes at 390 and 1440 px |
| Phase 2: the agency works in it | v2 section 10, Phase 2, plus the Napkin Brain | Laurence reviews J001 from brief to chosen route |
| Phase 3: production and the business end | v2 section 10, Phase 3, using the v3 shopper, film and tier detail | J001 has a scored still, film, radio spot, poster and format pack |
| Phase 4: finish and learn | v2 section 10, Phase 4, plus the Awards studio | v1 is done, as in v2 section 10 |

**Discovery hand-back.** Hand back five things, then stop.

1. An audit. For each tool in v2 section 6 and v3 The tools, and each Phase 1 line: what exists, its feature status, its tests, the command that proved it, and what is missing. Use read-only subagents, one per area of this repo and one per outside repo. Check Phase 1 repos in depth. Triage the rest in 15 minutes each.
2. A design proposal as static HTML in docs/design/: the O, the four Phase 1 homes, the Brief gate, the visual brief approval, the client confirmation link on a phone, the agency dashboard and the timesheet day view. Each at 390 and 1440 px in White mode, plus one Black mode sample. Run the Squint and Count checks and report the result.
3. The Phase 1 feature records, each with acceptance tests. Name the records each builds on, such as landing-circles, the brief records, territory-tool, system-undo and no-password-sign-in, and say what each still needs.
4. The harness record, as in v2 section 10 item 4: a deny rule on reading .env files, a secret scan in the pre-push hook and in CI, an em dash check on interface strings, a spend cap per environment and per run, and a retrieval filter that drops source=cannes everywhere. Show scripts/check.sh --all green on the branch.
5. One list of every open question, with your finding or the default you took. Include a plain-English summary of ADR-004 in five lines or fewer, and anything in it still open, so Laurence can sign it. No file in this repo is named ADR-004: find where the architecture records state the client wall, summarise that, and say plainly that the record itself was not found.

Also report what Discovery cost in tokens, money and time, and re-estimate each phase from that.

**Phase 1 acceptance.** Write these as end-to-end tests in app/e2e/j001-pilot.spec.ts before any screen. Fixtures only. Seed a de-identified J001. Done when scripts/check.sh --only e2e passes them at 390 and 1440 px and scripts/check.sh --all is green. Show the command and its output at the gate.

- Tests 1 to 12 exactly as in v2 section 10: doors per role, the 403 on Scope for Planning, the approve decision on signing, a new version after approval, the dashboard within 10 seconds, the logo accent and contrast, axe in all three modes, the canary key, timesheet lines linked to sessions, the Brief gate and client confirmation before Territories, attributed writes, and no source=cannes hit.

**Added tests. Changed in v3.1**, so the gate proves recovery and reopening, not only the happy path:

13. Cut the network while editing the J001 brief. The Failed save state shows, the typed text stays on screen, and Try again saves it once the network is back. Then close the brief and reopen it: the saved text is there.
14. Restore v2 of the brief. v3 is still in the history, and the approved version stays locked.
15. Force a provider error on a run. One plain line shows, the credits come back, the inputs stay, and Try again works.
16. At desktop width, Cmd Z undoes the last brief edit, and the undone text can be brought back.
17. At 390 px, the client opens the brief link and confirms it with no account. One client\_review decision lands on that exact version. At the gate, Laurence checks by hand that this takes under a minute on a real phone.
18. A person who has not given timesheet consent has no captured sessions.

## 10. Open questions

One blocks Phase 1: ADR-004. The Cannes question is decided. Everything else takes its default: record it as a decision in the feature record it touches, add it to open\_decisions in napkin-studio.clan, and raise it once at the gate.

| Question | Status until Laurence decides |
| --- | --- |
| Cannes Lions content | Decided: play safe. Cannes material stays out until a signed licence allows AI use (section 8). A future licence talk with Cannes Lions is welcome; it changes this rule only through a new feature record that Laurence approves |
| ADR-004 sign-off | ADR-004 is architecture decision record number 4. It says each client's data stays walled off, and only scores with the client content stripped out leave a vault. Laurence signs it. It blocks Phase 1, not Discovery. Until it is signed, build to its strictest reading |
| Pilot job | J001 |
| Napkin Brain phase | Phase 2 |
| Design approvers | Feature owner approves each design. Laurence for product and look. Shrey for platform |
| Typography | Section 8 of v2 wins. Propose the switch from Geist in a feature record |
| The O and the current landing | Wrap features/landing-circles and project-home. Do not replace them |
| Departments and unplaced tools | Seven departments, at most five on the O, Media parked. Other defaults as in v2 section 12 |
| Accent swap | No swap in v1 |
| Art Director Tool 1.0 | Test it. Wrap it if it runs. Rebuild the Stills canvas in Phase 3 if not |
| Recipe runner | The Production Tool harness, with each recipe as a template. Recommend in Discovery |
| Credits | Billed at cost per job, on top of the 7,000 euro pilot fee. Each run shows its price first |
| FLUX | On the Black Forest Labs key, through the router |
| New video model, dictated as Elorna | Not added until its name, provider and terms are confirmed |
| vahid-vakson/napkin-experimental | If there is no access, note it and use larryob78/napkin-os-experimental. If neither opens, note both and carry on |
| NVIDIA services | Cloud APIs first. Add NIM where confirmed |
| EU AI Act legal view | Build both label styles and machine-readable marks. No pilot goes live without the legal view |
| Omni | No dependency. Exports and links only |
| BrandSplats twins | Later. Not in v1 |
| J001 client material | Seed tests from a de-identified J001 |

## 11. How you work and report

- Keep your plan and progress in the feature records and BUILD-LOG.md, never only in your context, so a fresh session can pick up cold.
- Use subagents for wide reading and for each outside repo. Run them on Sonnet 5.5, to keep the API bill down. Give each one the question, the files and a ten-line answer format: what runs, what breaks, and the command that proved it. Every subagent brief includes the hard rules in section 8 and the replaced lines in section 12. Do not use subagents to re-review your own work, except one fresh reviewer before each gate.
- Before each gate, the reviewer checks the diff against the feature record and this prompt and reports gaps that affect correctness. Read the diff yourself, not only your summary. List every changed file.
- At each gate: put the key points first. Use short sentences, one idea each, in plain words. Show screenshots, test output and the Playwright video, say what you could not verify and why, and give one next action. Close with a recap that stands alone: found, done, next, the PR link into develop, and the changed files.
- Taste matters. If a screen looks like generic AI tooling, it is not done. Simpler beats cleverer. Laurence judges the look at each gate. The checks only prove the measurable rules.

## 12. Lines in v2 and v3 that this prompt replaces

If you or a subagent read one of these lines in v2 or v3, follow this prompt instead.

| Line in v2 or v3 | Follow instead |
| --- | --- |
| v3 Ideas, Sources: napkin-cannes-dataset | Section 8, Cannes. Own-words records only |
| v2 section 12, Cannes question, blocking | Decided: play safe. Section 8 |
| v3 Element 4: Stop only for two things | Section 3: three stops |
| v3 Open questions: Do not guess them. The first three block Phase 1 | Section 10: take the default, raise it at the gate |
| v3 The shell: the O is the home screen and the only way in, with seven circles | Section 6: own home first, the O is the map, five circles at most |
| v3 The shell: six screen states | Section 6: all nine |
| v3 The loop: under 24 returns to Create, 24 or over goes to the creative director | Section 6: Judge advises, the creative director decides, Brave route |
| v3 Compliance night watch: runs on the DGX Spark where it fits | Section 8: EU cloud, inside the client's vault |
| v3 Flywheel, Compute: the DGX Spark runs Judge. v3 Ideas: the DGX Spark for scoring | Section 8: the Spark runs research and tuning on telemetry only |
| v3 Timesheets: only in-app work sessions are on by default | Section 8: nothing is captured until the person says yes |
| v3 Phase 1 done list: the Napkin Brain line | Section 9: the Brain is Phase 2 |
| v3 Tools an agency will miss: Clearance and compliance, Estimates and job costing | Covered by the Compliance night watch and the Scope, estimates and invoicing tool |
| v2 section 9: keys live in Vercel environment settings | Section 8: Secrets Manager or the OS keychain |
| v3 Where you build, and every other mention of NAP in v2 or v3 | The repo is Napkin-Studio/napkin-os, on feat/discovery. There is no import to check |
| v2 and v3 cost tables, run settings and How this prompt is built | For Laurence only. Not instructions for you |
