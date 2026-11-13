# Phase 2 design brief (Napkin OS)

You are designing feature records for Phase 2 of Napkin OS. You write designs only: no product
code. Repo: Napkin-Studio/napkin-os. Phase 1 is built on the integration branch `spike/fabletest`.

## Where you work
Your own git worktree, named in your task. Create it yourself:
`cd /Users/saieeshwar/Projects/Work/work/napkin/napkin-fabletest && git worktree add -b <branch> ../<folder> spike/fabletest`
Work only there. Commit on your branch only. No push, no pull request. Never touch another folder
under `~/Projects/Work/work/napkin/` except to read.

## Read first
1. `CLAUDE.md` (the workflow: design before code), `features/README.md`, `features/feature.schema.json`.
2. `docs/napkin-os-build-prompt-v3.1.md` in full. It wins over v2 and v3; section 12 lists the v2 and
   v3 lines it replaces. Then the parts of `docs/napkin-os-build-prompt-v2.md` and `-v3.md` your
   records cover (read below each file's own "Prompt starts here" line). Use v2 section 2's glossary words.
3. `BUILD-LOG.md`, the entry "2026-11-11 · Phase 1 · session 2": what Phase 1 built and what is weak.
4. Two finished Phase 1 records as the model for depth and tone:
   `unzip -p features/brief-gate.clan shared/data.yaml` and `unzip -p features/client-wall.clan shared/data.yaml`
   (never Read a .clan zip directly).
5. The code your records build on. Read it; cite paths and names, not impressions.

## For each record
1. `FEATURE_AGENT=claude scripts/feature new <slug> "<title>"` (it sets `branch: feat/<slug>`, status exploring).
2. Fill every part of the design with `clan patch-data features/<slug>.clan '<json>' --agent claude --action "design: ..."`:
   `problem`; `done_when` (observable facts, each with the test that proves it, and naming the Phase 2
   pilot test number where one applies); `non_goals`; `owner` (default: Laurence O Byrne for product and
   look, Shreyansh Soni (batunii) for platform); and under `design`: `prior_art` (path, what, reuse),
   `approaches` (two or more, each with name, summary, build and run cost, why, and exactly one
   `chosen: true`), `rework_risks` (risk, avoided_by), `contracts`, `touches`, `breakage` (risk, guard),
   `test_plan`, `rollout`. Also `open_questions` and `next_step`.
3. Leave `status: exploring` and `design.approved_by` unset. The owner approves; you do not.
4. `scripts/feature verify` must pass for your records. Commit each record:
   `features: design <slug>` (subject 72 chars or fewer, no Co-Authored-By, no "Generated with").

## Rules every design must hold
- **Scaffold nothing new where something exists.** Wrap and extend; name what is reused.
- **No paid call in any test.** Fixtures and the repo's mock middleware. The spend guard
  (`server/napkin/spend.py`, `allow(amount, env, run)`) stands in front of every paid call; a design that
  adds a paid call says where it calls the guard and how the screen shows the price before the run.
  Say plainly which `done_when` lines cannot be proven without a real provider, and design the record so
  everything else is provable offline (a deterministic core first, the model part behind a seam).
- **Cannes Lions, Effie and WARC material stays out** of every model and retrieval. Own-words records
  only. `larryob78/the-canon` holds one Cannes data file and nothing usable: design without it.
- **Client wall (docs/adr/0004-client-wall.md):** scope from the signed-in person's agency on every
  request; client text only on EU-pinned model routes; anything that reads client work runs inside the
  client's vault; only scores with the content stripped leave it. Every write names an agent and an action.
- **Napkin never scores people, never submits time for anyone, never makes the creative call.**
  Timesheet signals are consent first.
- **Keys** live server side (Secrets Manager or the OS keychain), never in a .clan, the browser, a log or the repo.
- **Look:** every screen takes its visual language from the shell on this branch (`app/src/theme.ts`,
  `index.css`, `brand/`, the agency skins, the three modes, `app/src/components/states/`). Geist, warm
  paper and ink, the pill buttons. v2 and the Discovery proposal decide content, wording and behaviour;
  where their styling differs, the existing shell wins. On a phone screen primary buttons are 44 px tall.
  All nine screen states apply to every new tool. No em dashes in interface text.
- **Roles:** doors and server-side checks go through `crates/napkin-web/src/roles.rs`; a home is a set of
  doors (`app/src/shell/home/`, `app/src/components/states/doors.ts`).
- **Anything that needs a person or an outside account** (a Terraform apply, an OAuth app, an SES
  sender, an identity provider) is named in `rollout` and `open_questions`, and the record is designed so
  the code is testable against a fake provider before that exists.
- Lessons from Phase 1 to design around: parallel records collided in shared files (`App.tsx`,
  `j001-pilot.spec.ts`, the seed, `roles.rs`, `session.rs`), so say in `touches` and `breakage` which
  shared files a record edits and keep each record's surface narrow; a deny list leaked client-facing
  data (use allow lists); tests seeded with minimal data missed real leaks (seed with every field).

## What the Phase 2 audits found (11 Nov 2026)
**Judge.** Nothing scores creative work. `engine/rag/judge*.py` is retrieval passage checking;
`server/napkin/brief/capture.py` is the brief scorecard. `judgement-architecture.clan` has two ports
(generation, judgement), four backends (code, llm-judge, nv-rerank-vl, jev) and invariants: a backend
that scores cannot explain; a threshold is only compared against a calibrated score; the judge never
shares a prompt with the drafter. `jev` is still planned, so no calibrated score exists and an LLM judge
cannot back the hard "under 24" threshold by the clan's own rule. `crates/napkin-host/src/ops/review.rs`
and `decisions.rs` hold verdicts and the reasoned-overrule pattern. `jobindex.rs` has `scores: Option<()>`.
Spec: v3.1 section 6; v2 section 7 (out of 30: idea, craft, effect; each sub-score names its evidence;
each score is a verdict decision with reason codes and Judge version; one scoring API for every tool).
**Napkin Brain.** No `brain/` and no code. `layers-service/` (Postgres layer store) and
`server/napkin/layers` exist; the route that feeds layers from client-accepted work is not built
(`features/review-in-document.clan`). Spec: v3 "The Napkin Brain" (raw, wiki and rules layers; pages
and `brain.clan`; verified mark for client-accepted work); v3.1 puts it in Phase 2.
**The one bar, Cmd K, search, Ask Nap, voice.** None exists in code. `app/src/components/Toolbar.tsx`,
`barMenus.ts`, `shell/appBar.ts` are tool actions and menus. No search index across documents, no
directory of people. Spec: v2 section 4 (one bar on every screen, Cmd K, `?` for shortcuts, the mic
inside the bar; Ask Nap gives three suggestions for the screen, previews a change with Keep and Discard,
shows the cost before a run, names its source; voice is push to talk and shows what it heard before
anything that cannot be undone).
**Needs you.** Real but thin: `/t/{tenant}/needs`, `useJobNeeds.ts`, `Home.tsx`. No per-person
assignment, no deadlines, no five-second undo, the alerts table (v2 section 4) is not wired. No screen
opens a job and there is no job page (`POST /jobs` only; routes `/jobs`, `/jobs/{n}`, `/jobs/{n}/stage`).
**Homes.** `roles.rs` marks four homes live and five not: Art director, Copywriter, Producer, Agency
Brain, Traffic. `doors.ts` covers the four only and its type is limited to them. Doors table: v2 section 4.
**First day.** Sign-in exists; no invite flow, no three pointers (v2 section 4).
**Idea room, Script editor.** Doors with no app. Swap test exists only in Deck Maker
(`engine/deck/prompts/`). Spec: v2 section 6 (five team cards before any AI idea, or the creative
director opens early; Ban the default; Swap test; Fame test; originality check from own-words records;
routes are forks merged with no model. Script editor: house style and quality gate from napkin-radio,
revisions and beat ids from the Advertising Studio template `app/templates/advertising-studio`, tracked
changes as human patches, live check against brief, mandatory copy and banned words, one click to
Radio, Film and Judge). `features/territory-tool.clan` is designed, not built.
**Sign-on.** `crates/napkin-web/src/auth.rs` has Cognito (passwords), Local and Roster (no password;
staging and UAT use it). No OIDC or SAML. `infra/modules/identity/` has a user pool and web client only.
**Agency setup.** An agency is the `@suffix` of a username; agencies are made by hand in Terraform
(`var.agencies`) plus `provision-databases.sh`. `crates/napkin-web/src/look.rs` and
`app/src/shell/agency/` are real. No invites, people or role editing, CSV import, clients, brand kits.
Spec: v2 section 4 ("Setup is a flow, not code"; a 120-person agency in a day).
**Approval route.** Only the approve and unapprove lock and `client_review` exist. No stage owner,
deadline, reminder or "who holds it". Spec: v2 section 6.
**Client review link.** Phase 1 link is real (`crates/napkin-web/src/links.rs`, `clean.rs`,
`crates/napkin-host/src/ops/client_link.rs`): signed, single use, 30 days, briefs only, allow-listed
clean copy. Missing: optional email code (needs an SES sender), per-piece view for images and films,
comments in place, several reviewers, rounds. Spec: v2 section 4.
**Timesheet signals.** `crates/napkin-web/src/timesheet.rs` and `app/src/timesheet/` cover consent,
in-app sessions, one-tap confirm. No calendar, Slack or email code anywhere, including Laurence's two
timesheet repos. Each needs a registered OAuth app; Google and Microsoft verification takes weeks.

## Report back (under 350 words)
The records you opened (slug, title, owner, the chosen approach in one line, build estimate), the order
you recommend and which can run in parallel, every decision that needs the owner, anything a person
must set up outside the repo, and the commit hashes. Say what you could not verify.
