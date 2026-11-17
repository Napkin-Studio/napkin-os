# Open questions

Every open question from the three prompts, with the finding or the default taken.
Each default is also a decision in the feature record it touches, and the main ones
are in `open_decisions` in napkin-studio.clan.

## ADR-004 in five lines, for Laurence to sign

1. Each agency has its own database and its own search store. Nothing is shared between agencies but a read-only house store.
2. Inside an agency, each client's brand is walled off by a rule the database enforces on every query.
3. Client text is processed in the EU only.
4. Only scores, with the client's content stripped out, may leave a client's vault to teach the system.
5. Judge and the Compliance night watch read client work, so they run inside that client's vault.

**What is still open in it.**

- **It is not written down.** No file in the repo is ADR-004. Lines 1 and 2 are decided in foundation-spec.clan (decisions S3 and S8). Lines 4 and 5 appear only in the build prompts. The record `client-wall` writes it as docs/adr/0004-client-wall.md.
- **Line 3 is not true today.** The default model route can run outside the EU, by a decision of 30 Sep 2026. Web search falls back to a US region. See question 3.
- **Line 1 is not deployed.** The modules exist. The middleware runs as one fixed test tenant.
- **Line 2 is weaker in search than in the database.** Brands inside an agency are split by a filter in the search store, not by a separate store. Whether client learnings need their own store is undecided.
- **No data processing agreement is recorded** for any model provider.

## Questions that need an answer before Phase 1

| # | Question | Finding | Default taken | Who |
| --- | --- | --- | --- | --- |
| 1 | ADR-004 sign-off | Not written in the repo. See above | Build to the strictest reading | Laurence |
| 2 | Which comes first: the agency signs the brief, or the client confirms it? | v2 says client first. The contract only takes a client's answer on a locked brief | Sign first, then the client confirms | Laurence |
| 3 | May client text use a model route outside the EU? | The default route is a Bedrock `global.` profile. EU-only costs about 10% more | EU-pinned for client work | Laurence, Shrey |
| 4 | Who runs the Cannes removal, and when? | 497 chunks in the index, a pack the Brief Maker asks for, an S3 corpus | The filter lands first (harness). A person runs each deletion | Laurence |
| 5 | Does the award workbook hold Cannes cases or archive text? | Not determined. A model may not open it. 541 cases are from Effie-family shows | The library stays off | Laurence |
| 6 | Who owns each new record? | The repo names Shrey as project owner. Sai owns the brief records | Laurence for product and look, Shrey for platform | Laurence, Shrey |
| 7 | Can the build's login open the 11 closed repos? | Not Found for shopper, experiential, timesheets, the canon, three deck repos and others | They are unaudited | Laurence |

## Questions the prompt listed, with the default taken

| Question | Finding | Default |
| --- | --- | --- |
| Cannes Lions content | Decided on 10 Nov 2026: play safe. The map of where it sits is cannes-map.md | Out, until a signed licence allows AI use |
| Pilot job | No J001 or Jameson seed exists in the repo | J001, seeded de-identified as Client A |
| Napkin Brain phase | The clan-steward skill is the nearest thing | Phase 2 |
| Typography | The shell uses Geist from Google Fonts | Section 8 of v2 wins. The switch is proposed in `agency-look` |
| The O and the current landing | The landing is a client desk (`new-ui-shell`). `landing-circles` is the older design. `project-home` is a Production Tool record | Wrap `new-ui-shell`. The prompt named the wrong two records |
| Departments | No department or role exists in code | Seven, five on the O, Media parked |
| Unplaced tools | None exists in the repo | As in v2 section 12 |
| Accent swap | Accents are hand-set today | No swap in v1 |
| Art Director Tool 1.0 | Tested. A prototype that partly runs: 77 of 80 tests pass, its own notes say not production-ready, no provenance. It does not use Hanken Grotesk or a fixed blue | Do not wrap. Rebuild the Stills canvas in Phase 3 on the Production Tool |
| Type and colour in older tools | The prompt's claim about Art Director Tool is wrong (above). Production Recipes was not on disk | They follow section 8 when brought in |
| Presentation base | Deck Maker's engine works. Its app cannot run it. The three other deck repos could not be opened | Deck Maker |
| Recipe runner | **The Production Tool harness is not a runner.** It runs one job per click. It has no saved recipe and no step graph | Recommend: Napkin's own runner, built on the harness's job queue, capability sheets and lineage. It is new work, about 3 weeks, in Phase 3 |
| Credits | No credit unit exists. The relay holds a US dollar estimate per job | Billed at cost per job. Each run shows its price first |
| FLUX | No capability sheet exists for Black Forest Labs | On its own key, through the router. Not before Phase 3 |
| New video model, dictated as Elorna | Not in the repo | Not added until its name, provider and terms are confirmed |
| vahid-vakson/napkin-experimental | No access. Nor to larryob78/napkin-os-experimental | Noted. Experiential is unaudited |
| NVIDIA services | Live in `engine/`: embeddings, rerank, vision and backstop generation, on a prototyping key. Whether that key may carry production traffic is an open vendor question (N1) in judgement-architecture.clan | Cloud APIs first |
| EU AI Act legal view | No AI-generated label exists in export. The provenance appendix is off by default and holds no model, seed or prompt | Build both label styles. No pilot goes live without the legal view |
| Omni | Not in the repo | No dependency |
| BrandSplats twins | Not in the repo | Later |
| J001 client material | client_briefs/ is git-ignored and empty in this clone | Seed from a de-identified J001 |
| Run states | The middleware already has a cancelled state. One sentence in middleware-api.md is stale | Use the code's states |
| Backups | Aurora 7 days, RAG snapshots 14 days. The prompt asks for 30 | Keep the repo's, until a record changes them and a person applies it |
| Key storage wording | Keys are in Secrets Manager and task roles. v2's "Vercel" line is replaced by v3.1 | Secrets Manager |
| Phase 1 login | Cognito, a local file, and a no-password roster on staging. No production environment exists | Keep the roster for Phase 1. The email link is its own record later |
| Client vaults inside one agency | Forced row-level security in Postgres. A scope filter only, in the search store | Strictest reading. Stated in `client-wall` |
| Case study builder's home | Not in the repo | Agency Brain, and More tools for account service |

## Things the prompt gets wrong about the code

These are facts to fix in the next version of the prompt. Each is sourced in the audit files.

1. "Wrap features/landing-circles and project-home." Wrong records. See above.
2. "Build on the system-undo feature record." It covers the Production Tool only.
3. "Build on the existing BetterBriefs scorecard; do not write a second one." There are already two in the live path, and the one the prompt names is a third.
4. "The Production Tool harness, with each recipe as a template." It is not a runner.
5. "Extend the per-tenant meter to a daily cap per environment and a cap per run." The meter counts calls. It has no money, environment or run. The cap is new code.
6. "An index the server builds from the chains." No index exists.
7. "Claude on Amazon Bedrock in the EU." Only one route is EU-pinned.
8. "clan-sdk bound in through PyO3." There is no PyO3 in the repo.
9. "The layers schema is not yet ported to Aurora." It is.
10. "Napkin-audio is a duplicate to fold in." It is a separate app.
11. "Radio: 10, 20, 30, 40 seconds." The code offers 15, 30, 45, 60 and 90.
12. "idea-to-ooh-studio" as the Outdoor base. It is a film previz app.
13. "Art Director Tool 1.0 still uses Hanken Grotesk and a fixed Napkin blue." It uses Georgia and greens.
14. "A write without an agent and an action is refused." The host records a decision only when the body names an agent; otherwise the write goes through with none.

## What Discovery cost

Recorded in BUILD-LOG.md, with the re-estimate of each phase.
