# Discovery audit

11 November 2026. Branch feat/discovery, cut from develop at ea34367b.
The prompt is docs/napkin-os-build-prompt-v3.1.md.

## Key points

1. **The brief is strong. The agency around it does not exist.** Messy brief to agency brief works, with a real Judge. Roles, permissions, homes, the O, the dashboard, timesheets, undo, the client link and the visual brief are all new work.
2. **Phase 1 is a build, not a restyle.** Of 18 acceptance tests, none can pass today. Thirteen feature records are open to cover them.
3. **ADR-004 is not written anywhere in the repo.** The wall is partly built. Client text can leave the EU on the default model route.
4. **Cannes material is in the retrieval index now**, and the Brief Maker asks for it in two loops. Nothing filters it.
5. **The outside repos are thinner than the prompt says.** Of the seven I could open, one is empty, one is a different product, and none is ready to wrap. Eleven could not be opened.
6. **`scripts/check.sh --all` is green on the branch**, all ten suites, with a current uv.

## How it was done

Nine read-only subagents on Sonnet 5.5: five on this repo, four on the outside repos. Each
got the hard rules and the replaced lines. Outside repos were cloned to a scratch folder
and tested with every provider key unset. No paid call was made. No Cannes data file was
opened. The detail is in the files beside this one:

| File | Covers |
| --- | --- |
| audit-shell.md | The shell, homes, the O, modes, sign-in, e2e |
| audit-brief.md | Brief, Brief check, Brief gate, Research, Territories, Judge |
| audit-platform.md | ADR-004, tenancy, the meter, runs, providers, infra, export |
| audit-production.md | Production Tool, Advertising Studio, Deck Maker, the stand-ins |
| cannes-map.md | Every place Cannes, Effie and WARC material sits |
| outside-repos.md | The seven outside repos that could be opened |
| open-questions.md | Every open question, with the finding or the default taken |

## Phase 1, test by test

| # | Test | Passes today | What it needs | Record |
| --- | --- | --- | --- | --- |
| 1 | Doors per role | No. No roles exist | Roles on the server, homes | roles-and-homes |
| 2 | 403 on Scope for Planning | No. No permission layer | A route check by role | roles-and-homes |
| 3 | Signing writes one approve decision | Partly. /approve does this for one signer | A second signer | brief-gate |
| 4 | New version after approval, with an alert | Partly. Reopen then approve again works. No alert on the brief itself | A Changed brief alert | brief-gate |
| 5 | Dashboard within 10 seconds | No. No dashboard | A job record, an index, six tiles | job-index-dashboard |
| 6 | Logo accent and contrast | No. Hand-set colours | Upload, sampling, lightness per mode | agency-look |
| 7 | axe in three modes | No. Two modes | Grey mode, the locked palette | agency-look |
| 8 | Canary key never in the browser | Not tested | The test | client-wall |
| 9 | Timesheet lines link to sessions | No. No timesheet | Consent, sessions, the day view | timesheet-sessions |
| 10 | Gate and client confirmation before Territories | No. No gate, no client, no Territories | All three | brief-gate, client-confirm-link, visual-brief |
| 11 | Every write attributed | No. A write can skip the chain | The host refuses a write with no agent | client-wall |
| 12 | No source=cannes hit | No. Cannes is served, and the trace has no source | A default filter, source in the trace | harness, cannes-removal |
| 13 | Failed save keeps the text | No. The shell is not told of a failed write | A save queue | screen-states |
| 14 | Restore v2, v3 stays | No. No version list | Versions from the chain | brief-versions-undo |
| 15 | Provider error on a run | No shared state | Run failed | screen-states |
| 16 | Cmd Z | No. Undo is Production Tool only | Shell undo | brief-versions-undo |
| 17 | Client confirms on a phone, no account | No. No link | A client actor and a signed link | client-confirm-link |
| 18 | No consent, no sessions | No timesheet | Consent first | timesheet-sessions |

The suite itself is the first record: j001-pilot-suite.

## Every tool in v2 section 6 and v3 The tools

| Tool | Phase | In this repo | Outside repo | Verdict |
| --- | --- | --- | --- | --- |
| Brief, Brief check, Brief gate | 1 | Brief Maker works. Scorecard and Judge exist. No gate, no client questions from the scorecard | | Extend. See audit-brief.md |
| Research | 1 | Campaign Research works and opens from a brief | | Wrap |
| Territories | 1 | A design only. It uses Cannes data | | Build, after its source changes |
| Visual brief | 1 | Nothing | | Build |
| Agency dashboard | 1 | Nothing. Per-document facts exist | | Build |
| AI timesheets | 1 | Nothing | napkin-timesheet, napkin-timesheet-traffic: no access | Build. Read the repos if access comes |
| Approval route | 2 | approve and client_review decisions exist | | Build on them |
| Idea room | 2 | Nothing | the-canon: no access | Build |
| Script editor | 2 | Nothing | napkin-radio's house style and quality gate are reusable logic | Build, reuse the logic |
| Judge (score out of 30) | 2 | A brief Judge and a judgement architecture with two ports and ten gates | | A new gate on the existing port |
| Napkin Brain | 2 | The clan-steward skill is the nearest thing | | Build |
| Stills canvas | 3 | The Production Tool canvas is the pattern | napkin-art-director: a prototype that partly runs, no provenance, not built | Rebuild on the Production Tool. Do not wrap |
| Film | 3 | Advertising Studio is a screen and a contract with no backend. Production Tool makes character, storyboard and video on Runway | napkin-studio-editing: no access | Build the backend |
| Animation | 3 | Nothing | None | Build |
| Radio | 3 | Nothing | napkin-radio partly runs: parser, quality gate, MP3 stitch. On Gemini and Groq, not the router. napkin-audio is a separate app, not a duplicate | New template. Reuse the plain logic from both |
| Outdoor in situ | 3 | Nothing | idea-to-ooh-studio is a 3D previz app. Nothing in it is outdoor | Build from nothing |
| Formats | 3 | The formats stage of Advertising Studio, with no backend | Resize runs: four generic ratios, no platform formats. Socials-ads-maker- is empty. Admagined-: no access | Build. Resize's safe-margin and crop checks are reusable |
| Scope, estimates, invoicing | 3 | Nothing. No rate card, no job | | Build |
| Traffic board | 3 | Nothing | napkin-timesheet-traffic: no access | Build |
| Craft review | 3 | verdict decisions exist | | Build on them |
| Shopper stands | 4 | Nothing | shopper-display-builder: no access. The prompt's "277 tests passing" could not be checked | Not audited |
| Experiential | 4 | Nothing | Both repos: no access | Not audited |
| Presentations, Pitch maker | 4 | Deck Maker: the engine works and exports from the command line. The app cannot run it | HTML-slides-tool, napkin-deck-director-, pitcher: no access | Finish the server side |
| Case study builder | 4 | Nothing | | Build |
| Awards studio | 4 | The award case library, gated and off | awards-board-maker partly runs. Its retrieval reads a Cannes image corpus | Reuse layout and export only |
| Compliance night watch | 4 | Nothing. No AI-generated label exists in export | | Build |

## Suggested tools: which J001 needs

| Tool | Does J001 need it | Size |
| --- | --- | --- |
| Results and effectiveness | Yes, at the end: the case study and the dashboard's results tile read it | Medium. Phase 4, with the Case study builder |
| Asset library | Yes, from Phase 3: every approved still and film must be findable | Small, if it is a view over approved decisions |
| Meeting notes to actions | No | Skip for v1 |
| New business tracker | No. J001 is a live job, not a pitch | Skip for v1 |

## Could not verify, and why

- **Eleven outside repos.** GitHub answers Not Found for this login (docs/sources/repos.md). Shopper, experiential, timesheets, the canon and three deck repos are unaudited.
- **Anything that needs a paid call.** Radio's script writing and voices, the Production Tool's live Runway paths.
- **What the Cannes and award data files hold.** A model may not open them.
- **The live state of AWS and the hosted Qdrant cluster.** No network call was made to either.
- **The v2 section 13 artifacts and the raw J001 brief.** Neither is on disk. The design proposal is drawn from the prompt's words, not from the TBWA 1.0 prototype.
- **The shell audit ran no tests.** It is from reading code. The checks that did run are named in each file.
