# Napkin OS Master Build Prompt v2

Nov 10, 2026 · @Laurence O Byrne

**In one minute.** Napkin OS runs a whole agency job in one place: brief, ideas, production, decks, client approval, time and invoice lines. Each person sees only their own work. Time fills itself in, and each person confirms it. Out-of-scope work is caught before it is done. It never scores people, never submits time for anyone, and never makes the creative call. Each client's data stays walled off, in the EU.

## For Laurence: before you paste

This tab is v2 of the build prompt. Export it as Markdown and paste everything below the line into Claude Code, at the root of a clone of Napkin-Studio/napkin-os, on the develop branch.

Before you paste, export each claude.ai source in section 13 into docs/sources/. Keep the raw J001 client brief in client\_briefs/j001/, which git never commits. List every other repo as owner/name in docs/sources/repos.md.

| Setting | Use |
| --- | --- |
| Model | Fable 5.2 |
| Effort | High for Discovery and every phase build |
| Try xhigh | On one phase only. Keep it only if the gate results improve |
| Medium | Only for short revision rounds you review yourself |
| Speed | Standard |
| Sessions | A fresh session for each phase |

### What changed from v1

- **One job, end to end.** J001 now runs from client brief to timesheets, invoice-ready lines and case study, in one system.
- **Brief check and Brief gate.** No creative work starts until the brief passes and the client confirms it.
- **The business end.** Scope, estimates and invoicing, an approval route and a traffic board join the tools.
- **Judge advises, the creative director decides.** A brave idea with weak craft still reaches the creative director. Every overrule is logged.
- **Better ideas.** Humans first in the idea room, Ban the default, a Fame test and a named craft review.
- **Easier to use.** People land in their own home. The O is the map. One bar on every screen. Doors are named in one table.
- **Clients and mistakes.** A phone review link for clients, undo and version history, and nine screen states.
- **A tighter Phase 1.** The J001 brief path only, with four live homes. Four phases replace the old roadmap.
- **Done means tests pass.** Each Phase 1 done line is an end-to-end test. A harness blocks keys and em dashes.
- **Built on CLAN and the real repo.** Every job, brief, script and asset is one .clan file that records who changed what and why. The builder works in Napkin-Studio/napkin-os by its own rules, on its AWS stack. ADR-004 and the Cannes question block.
- **Design north star.** Ten principles, a Never list and four one-minute checks keep every screen calm and modern.
- **Ready for an agency, tested by a dry run.** A cost and time estimate. Rate card lines, client AI switches and no training on client data. Discovery hands back sources, repos and open questions. Phase 1 tests are exact.

### How to test it

Run Discovery once this week and check what it hands back before any build starts.

1. Do the exports above: the section 13 sources and repos.md in docs/sources/, and the raw J001 brief in client\_briefs/ only.
2. Clone Napkin-Studio/napkin-os, switch to develop, and run `git config core.hooksPath .githooks`. Open a fresh Claude Code session at its root. Choose Fable 5.2, effort High, speed Standard. Paste everything below the line.
3. Check that it starts with the clan-steward status check on napkin-studio.clan, and runs `scripts/feature list` before anything else.
4. When Discovery stops, check the hand-back has its five items: the repo audit, design proposal, Phase 1 feature records, harness record and In Discovery list.
5. Check the rules held. Nothing pushed to main or develop, no `terraform apply`, no Co-Authored-By trailer. `scripts/feature verify` passes and `scripts/check.sh --all` is green on the branch.
6. Test the harness once its record is built. Push a fake key on a scratch branch and check the pre-push hook blocks it. Check the spend cap is 0 euro with paid calls off.
7. Open the static design HTML in docs/design/ at phone and desktop width. Run the Squint and Count checks from section 8.
8. Read the In Discovery list. Answer the open questions in section 12, starting with the Cannes question, then ADR-004 sign-off.
9. Decide at the gate. The feature owners approve each Phase 1 design. You approve the set or send it back with notes. Raise the spend cap only after you approve.

### Cost and time to run this prompt

**Napkin OS v2 costs about $2,600 to $15,100 in model spend and takes 19 to 31 weeks.** These are estimates, not quotes. Prices are list prices in USD, before EU tax, checked 10 Nov 2026.

| Phase | Fable sessions | Tokens | API cost | Plan alternative | Human hours | Calendar |
| --- | --- | --- | --- | --- | --- | --- |
| Discovery | 2 to 4, plus 15 repo subagents | 50M to 280M | $100 to $450 | $100 | 20 to 35 | 1 week |
| Phase 1 | 15 to 30 | 200M to 1.5B | $420 to $2,700 | $400 to $500 | 90 to 180 | 3 to 5 weeks |
| Phase 2 | 25 to 45 | 300M to 2.3B | $620 to $3,880 | $500 to $800 | 135 to 265 | 5 to 8 weeks |
| Phase 3 | 30 to 50 | 350M to 2.5B | $900 to $4,900 | $600 to $1,000 | 160 to 310 | 6 to 10 weeks |
| Phase 4 | 20 to 35 | 250M to 1.8B | $550 to $3,200 | $400 to $700 | 110 to 215 | 4 to 7 weeks |
| Total | 92 to 164 | 1.1B to 8.4B | $2,600 to $15,100 | $2,000 to $3,100, plus overflow | 515 to 1,005 | 19 to 31 weeks |

API cost includes live demo generation. Plan alternative is two Ultra seats at $200 a month each.

The repo already holds CLAN, the shell, Brief Maker, Research, Deck Maker, Advertising Studio, the Production Tool, sign-in, export and the AWS stack. That should bring Phase 1 and parts of Phases 3 and 4 under this table. Discovery's audit says by how much. No new figures until then.

One session is 120 to 300 calls at 80k to 150k context. That is about $25 to $85 a session, most of it cache writes. One live J001 demo run (20 stills, 60 seconds of video, a voiced radio spot) costs about $30 with retakes. Tests use fixtures, so they cost nothing.

**The Enterprise Ireland date.** Full Phase 1 by the end of November is unlikely. It lands around 8 to 22 December if Discovery closes by 17 November. A fixture-based demo of the J001 brief path is realistic for the end of November if Discovery closes this week and timesheets wait. These dates do not allow for Christmas.

**Key assumptions**

- Fable 5.2 list prices per million tokens: $8 input, $40 output, $10 cache write, $0.20 cache read. Standard speed.
- A session is half to one working day on one feature record.
- Laurence gives 4 to 25 hours a phase, the CTO 6 to 45, developers the rest.
- Plan capacity is a guess. Anthropic publishes no Fable weekly limit in tokens.
- Anthropic's pages disagree on Fable for Pro and Team standard seats. This estimate follows claude.com/pricing: Team needs a premium seat.

**Two ways to cut cost**

1. Keep Fable for Discovery, design and gates. Build on Opus 5.5 at half the price. This saves 40 to 60 percent.
2. One feature record per session, compacted early, since cache writes cost most. Or use Ultra seats and pay API rates only for overflow.

Sources: [Fable and Mythos 5.2 release](https://www.anthropic.com/claude-fable-and-mythos-5-2), [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Claude plans](https://claude.com/pricing), [Fable usage limits](https://support.claude.com/en/articles/11145838), [Runway API pricing](https://docs.dev.runwayml.com/guides/pricing), [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)

---

**Prompt starts here.**

## 1. What Napkin OS is

Napkin OS is an agency's whole workflow in one calm workspace, from the first brief to invoice-ready lines. Each person logs in and sees only the tools their job needs. Planners, writers, art directors, producers and managers each get their own home. Every tool opens inside a live job, already filled with the client, the brief and the brand. Work moves between tools with one button. Every piece is scored, and the agency learns what it keeps. Each client's data stays walled off. Nobody starts from zero again.

It is an advertising operating system for agencies. TBWA 1.0 is the first instance. If a screen does not help an agency move a job forward, it does not ship.

You are the lead architect, product designer and builder for Napkin OS. This codebase is yours. Within the locked rules, you decide what it is for and how it is built, and you keep building on it. Read the whole brief once before you write any code. Your first run is Discovery only, and it ends at the first gate.

### Built on CLAN

Napkin OS is built on CLAN, an open file format, and on Napkin Studio OS, the platform the team has already built on it. Every job, brief, script and asset is one portable .clan file. The file remembers who changed what and why. Any agent or person can pick it up cold, from the file alone.

- **What a .clan file is.** A ZIP that holds the facts (shared/data.yaml), the task for the next agent, the output schema, the decision chain, one workspace per agent, and a human view. A person's edits go in as human patches, marked edited\_by: human.
- **Who changed what.** Every write names its agent and its action, or it is refused. This is enforced when the file is written, not left to habit.
- **Parallel work.** Agents and creative routes fork the file and work side by side. The merge is deterministic and uses no model. Any clash is listed with both sides.
- **How tools run.** Napkin Studio OS is a thin, stateless shell. Each tool is a .clan template that renders from its own data and calls the shell through the clan:// API: patch-data, fork, upload-asset, assets and api-proxy. The server holds every document and packs the .clan file on demand, for export, handover and the offline presenter.

Why it matters to an agency:

- **Provenance for the EU AI Act.** Which model made each piece, from which inputs, and who approved it, travels inside the file.
- **No lost handovers.** A new person or a new agent opens the job and carries on.
- **Parallel work merges safely.** Two routes or two agents never overwrite each other.
- **The job remembers.** The Case study builder, Job memory and Learn read the decision chain, so nobody types up what happened.

One rule for the builder: never build a second provenance store. Runs, provenance, scores and approvals are attributed decisions in the file. Where this prompt names a record that CLAN already holds, use CLAN.

## 2. Glossary

Use these words the same way in code, interface and docs.

| Term | Meaning |
| --- | --- |
| The O | The map of the agency: the logo at the centre, with department circles around it. |
| Home | The page a person lands on after login, with their own doors and their Needs you list. |
| Door | A round button on a home that opens one tool or a small set of tools. |
| More tools | A quiet text list under the doors, for useful tools beyond the five. |
| Needs you | Each person's short list of what is waiting on them, each with its next action as a button. |
| Ask Nap | The help on every screen, which explains a tool, a cost or a failure and can suggest changes. |
| Job file | Everything about one job in one place: its .clan documents (campaign, brief, production, deck), linked by lineage, holding client, brief versions, scope, runs, assets, decisions and time. |
| Judge | The scoring service that rates work out of 30 against the approved brief and advises the creative director. |
| Learn | The record of every run and decision, read from the decision chains, that teaches the system what this agency keeps. |
| Agency Brain | The agency's own memory of clients, pitches, awards, case studies and proprietary data. |
| Client vault | The walled-off store for one client's data, which no other client's work can read. |
| ADR-004 | The decision record that keeps client vaults isolated, so only scored telemetry leaves a vault. |
| Telemetry | Scores, choices and outcomes with the client content stripped out. |
| Recipe | A saved, tested way to make one kind of asset, such as a Clean Packshot. |
| Recipe runner | The engine that runs a recipe step by step and records each step. |
| Run | One execution of a tool, recipe or agent: a middleware job with its inputs, model, cost, state and outputs, recorded as attributed decisions. |
| Provenance | The record of how an asset was made: model, seed, prompt, inputs, credits and who approved it. It lives in the file's decision chain. |
| Credits | The unit a run costs, priced before it starts and shown on its button. |
| Scamp | A rough layout sketch, drawn or photographed, that an art director starts from. |
| Discovery | The first run of this prompt: an audit of the repo against it, a design proposal, the Phase 1 feature records and the harness record, with no product code. |
| Gate | A stop at the end of a phase where Laurence checks the evidence before the next phase starts. |
| CLAN | The open file format Napkin OS is built on. One .clan file holds a piece of work: its data, its decision chain and its human view. |
| Napkin Studio OS | The platform built on CLAN: a thin, stateless shell that runs each tool from a .clan template. |
| .clan template | A tool, written as a .clan file in app/templates. Starting a document copies the template, and the view renders from the document's data. |
| clan:// API | How a tool talks to the shell: patch-data, fork, upload-asset, assets and api-proxy. A tool never calls a model or a server directly. |
| Decision chain | The attributed history inside every .clan file: who did what and why, with which handler and model. A write without an agent and an action is refused. |
| Fork and merge | Split a file so agents or routes work in parallel, then join the branches with no model. Clashes are listed with both sides. |
| Human patch | A person's edit, written into the file as edited\_by: human and kept in the decision chain. |

## 3. The pilot job: Jameson J001

Build and test everything against the Jameson J001 demo job already in the TBWA 1.0 prototype. If a screen does not help J001 move forward, it does not ship in v1.

- **Phase 1** takes J001 from a messy client brief, through the Brief gate and client confirmation, to an approved visual brief.
- **Later phases** take it into stills, film, radio, outdoor, digital formats and a shopper stand. Then come decks, approvals, delivery, invoice-ready lines and a case study.
- **Seeded.** J001 is seeded so every screen has real content from the first day.
- **An alcohol client.** The Irish alcohol rules and the consent rule apply to J001 from the start.

### One job, end to end

One job lives in one system, from the client's first brief to the invoice and the case study. Every step reads and writes the same job file. Nobody downloads a file and uploads it again.

&#91;embedded content: the job lifecycle · 11 stages, 1 gate, time under all of them\]

| Step | What happens on J001 | Who | Tool |
| --- | --- | --- | --- |
| 1. Client brief | The client's brief arrives as notes, an email or a PDF. The planner pastes it in. | Planning | Brief |
| 2. Brief check | Gaps become questions for the client. The brief passes the gate, the client confirms it, the planner and creative director sign it. | Planning, creative director, client | Brief, client review link |
| 3. Scope and estimate | Deliverables, formats, rounds and hours are set. The estimate follows from them. | Account service, producer | Scope, estimates and invoicing |
| 4. Ideas | The team posts its own ideas first. The idea room pushes, Judge scores, the creative director picks the route. | Creative team, creative director | Ideas, Judge |
| 5. Production | Stills, film, radio, outdoor, digital formats and the shopper stand are made from the approved route. | Art director, copywriter, producer | The production tools |
| 6. Decks and presentation | The client deck builds itself from the brief, the route and the approved work. | Account service, planning | Presentations |
| 7. Client approval | A named senior creative checks the craft. The client approves on a phone, on exact versions. | Creative director, client | Craft review, client review link |
| 8. Delivery | The night watch checks labels, rights and rules. Only passed work ships. | Account service, producer | Compliance night watch |
| 9. Timesheets | Time is captured in every step above. Each person confirms their day in one tap. | Everyone | AI timesheets |
| 10. Invoice-ready lines | Confirmed hours, costs and approved change orders become lines for the bookkeeper. | Account service, management | Scope, estimates and invoicing |
| 11. Case study | The case study drafts itself from the job's events. A human checks the facts and signs it off. | Account service, Agency Brain | Case study builder |

What the team keeps and rejects teaches Judge and the Agency Brain, so the next brief starts smarter.

## 4. How people use it

People land on their own home, not on the O. A home holds their doors, More tools and Needs you. The O is the map of the agency, opened when someone wants to go elsewhere.

### The O, homes and doors

- **The O.** The agency logo sits at the centre. Around it sit at most five department circles, the person's own first. Any other department this person can open is in a quiet text list called Other departments.
- **Departments.** There are seven: Management, Clients, Account service, Planning, Creative, Production and Agency Brain. Traffic sits with Production. Media is parked. The O never shows more than five circles.
- **Doors.** A door is a round button on a home. It opens one tool or a small set of tools. No home has more than five doors. Anything else useful goes in More tools.
- **One destination.** Every tool is one destination, even when two doors open it. Every tool opens inside a job file.
- **Seeing is not permission.** Permissions decide what a role can open, not what it can see. Money (scope, estimates, invoices) is for producers, account service and management. Client brains and pitches are for planning, account service and the Agency Brain. Proprietary data is for the Agency Brain only.
- **Edge cases.** A person with two roles gets one merged home, still five doors. The client reviewer gets a review link, not a home. A role switcher exists for admins and demos only. A chip in the top bar opens today's timesheet. It is not a door. A door whose tool comes in a later phase shows its Empty state.

| Role | Department | Five doors | More tools | Live from |
| --- | --- | --- | --- | --- |
| Planning | Planning | Brief, Research, Territories, Client brains, Presentations | Ideas (read only), Case study builder (read only) | Phase 1 |
| Creative director | Creative | Ideas, Ready for review, Judge scores, Approved work, Direction notes | Brief (read and sign), Presentations, Traffic board (read only) | Phase 1 |
| Account service | Account service | Clients, Live jobs, Approvals, Scope and estimates, Presentations | Case study builder, Job memory, Compliance night watch | Phase 1 |
| Management | Management | Agency dashboard, Live jobs, Time and money, Clients, Traffic board | Presentations, Agency Brain (read only) | Phase 1 |
| Art director | Creative | Ideas, Stills, Video and motion, Formats and in situ, Shopper stands | Experiential, Presentations, Craft review | Phase 2 |
| Copywriter | Creative | Ideas, Script editor, Radio, Video and motion, Formats and in situ | Shopper stands, Experiential, Presentations, Craft review | Phase 2 |
| Producer | Production | Live jobs, Video and motion, Radio, Scope and estimates, Timetables | Formats and in situ, Shopper stands, Traffic board | Phase 2 |
| Agency Brain | Agency Brain | Client brains, Pitches, Awards, Case studies, Proprietary data | Judge scores (read only), Job memory | Phase 2 |
| Traffic | Production | Traffic board, Timesheets, Resources, Live jobs, Timetables | Scope and estimates (read only) | Phase 2 |

One door sits inside a tool: Add, on the Stills canvas, opens the six recipes. In Phase 1 the other homes exist as seeded placeholders.

### First day for new staff

1. An admin sends an invite. The person signs in with single sign-on, or, in Phase 1, a one-time sign-in link sent by email.
2. They land in their own home, not on the O.
3. Three pointers show once: the doors, the one bar and Needs you.
4. Their first Needs you item is a real task on a live job.

**Good looks like.** A new copywriter is invited, signs in and opens a real task within two minutes, with no training call.

### The one bar

One bar sits on every screen. Type or speak into it. It finds any job, brief, asset, script or person: "the Jameson radio spot from March". It opens a tool, runs a command or asks Ask Nap a question.

- Cmd K or Ctrl K opens it.
- The microphone sits inside the bar.
- Press ? to see the shortcuts.

**Good looks like.** From any screen: Cmd K, type "J001 brief", Enter. The brief opens.

### Ask Nap

- It opens with three suggestions for the current screen.
- It previews any change it proposes, with Keep and Discard.
- It shows the cost of a run before the run starts.
- It names its source for every answer.

### Undo and version history

- Cmd Z works everywhere.
- Every brief, script, layout and deck keeps its versions. Compare any two side by side. Versions are the document's own CLAN versions. Build on the system-undo feature record.
- Restore makes a new version. It never deletes the newer one.
- Approved versions are locked and marked.

**Good looks like.** Restore v2 of the J001 brief. v3 is still in the history.

### Screen states

Every tool has all nine.

| State | What the person sees |
| --- | --- |
| Normal | The work and one obvious next button |
| Empty | One line on what goes here, and the button to start |
| Loading | What is loading, in place |
| Failed save | Their work kept, one plain line, Try again |
| Missing access | Who can grant it, and one button to ask |
| Changed brief | Two lines on what changed, and one button: Update to brief vN |
| Run failed | One plain line. Credits returned. Inputs kept. Try again |
| Not right | It asks what is wrong and offers three quick fixes |
| Long run | Time left. Needs you tells them when it is done |

**Good looks like.** Force a provider error on a still. One line shows, the credits come back, the inputs stay, and Try again works.

### Needs you

- One list in each home, ordered by deadline, showing only that person's jobs and their role's events.
- Five items, then Show all. One line each, with its next action as a button.
- A done item leaves, with five seconds to undo.
- An empty list names the next deadline.

### The client review link

The client never gets a home. They get a link that works on a phone.

- **No account.** An optional email code. Links expire after 30 days.
- **One piece at a time.** Full width, with its version and AI label shown.
- **One primary button.** Approve. Ask for changes sits beside it.
- **Comments in place.** Pin a comment to a spot on an image or a moment in a film.
- **Tied to the brief.** Each comment is tagged to a brief point, or marked as a preference.
- **Several reviewers.** Their comments merge into one list, with contradictions flagged.
- **Rounds.** The round number shows against the rounds in scope.
- **On record.** The reviewer's name is recorded on the exact version they approved, as a client\_review decision in the file. Today the repo records that decision from agency staff (os-layer.md section 7.5). A link the client approves through is a contract change, with its own feature record.

**Good looks like.** A client opens the J001 brief link on a phone and approves it in under a minute. One Decision lands on that version.

### Voice, connections and alerts

Three things run through every tool, so the agency feels like one system.

- **Voice in every tool.** Push to talk inside the bar. People speak commands ("make three warmer versions", "send this to Judge", "log an hour on J001") or dictate copy. Speech goes through the model router, like every other model call. Before anything that cannot be undone, the tool shows what it heard and waits. Voice and typing always do the same things.
- **Connected.** Every action is an attributed decision in the job's .clan files: brief approved, score returned, asset kept, client comment, budget change, deadline moved. The server sends each change to every open view. Tools read the job. Nobody passes files by hand.
- **Calm alerts.** Every alert lands in Needs you with its next action as a button. In-app first. Slack and an email digest only if the person turns them on. Only urgent alerts arrive straight away.

| Event | Who is alerted |
| --- | --- |
| Brief changes version | Everyone on the job |
| Work scores under 24 | The creative team on the job, or the creative director if the idea is marked Brave |
| Client comment or change request | Account service first |
| Request out of scope | Account service |
| Approval overdue | The approver, then account service |
| Job hours near budget (threshold set per agency) | Producer, account service, management |
| Deadline within 48 hours | The job owner |
| Today's timesheet not confirmed | That person, once |

## 5. Agency setup: their logo, their colours

This is the first thing a new agency touches, so it must be the best moment in the product. They drop in their logo and watch Napkin OS become theirs. Setup is a flow, not code: the logo first, then people and roles, clients, brand kits and product libraries. TBWA 1.0 is the first instance. The logo step takes a minute. People, clients and live jobs import from a CSV. A 120-person agency is set up in a day.

1. **One screen, one job.** A large rectangle drop zone and one line: Drop your logo here. Drag and drop on desktop, tap to choose on a phone, or paste. SVG, PNG and PDF accepted.
2. **Instant payoff.** Within a second the logo sits at the centre of the O and the accent is sampled. The whole interface repaints live behind it. Show the O in White, Grey and Black modes side by side so they see all three at once.
3. **The system does the fiddly work.** It trims empty space, removes a flat background and makes a one-colour version for small sizes. It warns only if the file's resolution is too low. It asks for a reversed logo only if the logo fails on the Black mode.
4. **Colour, sampled not picked.** It ignores black, white and grey in the logo and takes the strongest remaining colour as the one accent. If the logo is black and white only, there is no accent: the ink does the job, and Ask Nap says so.
5. **Readable by default.** If the sampled colour fails contrast, the system adjusts its lightness and says it plainly: We darkened your colour slightly so text stays readable.
6. **Logo first, forms after.** Name, people, roles, clients, brand kits and product libraries come next, one short step each. Nobody fills a form before they see their own Napkin OS.
7. **Change it any time.** Replacing the logo later repaints everything, with no code change. One undo puts the last version back.

**To confirm with Laurence:** whether the agency may swap to another colour sampled from their own logo. That keeps the accent sampled. But it is a choice, so it bends the "never hand-picked" rule. Until he decides, build no swap.

**Good looks like.** A new agency drops its logo and sees the whole interface in its own colour in under 10 seconds. It reads well in all three modes, with no help.

## 6. The tools

Each tool opens inside the job and fills itself from the approved brief and brand kit. It hands work on with one button: Send to Judge, Send to Formats, Send to Presentations. Each tool is a .clan template in app/templates, rendered by the shell. Brief, Research and Presentations already exist there as templates. Film builds on the Advertising Studio template and the Production Tool. Every other tool is a new template. The tools below run in the order a job uses them.

**Design each tool for how that craft thinks.** Art director tools are highly visual: the canvas is the interface and words are secondary. Copywriter tools are highly written: the page is the interface and it must feel like a great text editor. Film tools follow the script. Get this wrong and the tool is not done.

| Tool | Door | Built from | In napkin-os today | Phase |
| --- | --- | --- | --- | --- |
| Brief, Brief check and Brief gate | Brief | Brief Maker | Template brief-maker, on the briefing engine and server/napkin/brief | 1 |
| Research, Territories and visual brief | Research, Territories | Campaign Research, territory-tool | Research: template campaign-research. Territories: feature territory-tool, designed, no code. Visual brief: new | 1 |
| Scope, estimates and invoicing | Scope and estimates, Time and money | New, on AI timesheets | New template | 3 |
| Approval route | Approvals | New | New template, on the OS layer's lock and client\_review decisions | 2 |
| Traffic board | Traffic board | napkin-timesheet-traffic | New template | 3 |
| Idea room | Ideas | Napkin Idea Machine, larryob78/the-canon, awards knowledge base | New template | 2 |
| Script editor | Script editor | New, napkin-radio house style | New template | 2 |
| Craft review | Ready for review | New | New template | 3 |
| Stills canvas | Stills, with Add inside | larryob78/napkin-art-director, larryob78/Resize, Production Recipes | New template. The Production Tool canvas is the pattern | 3 |
| Film | Video and motion | Napkin OS Film tool, larryob78/napkin-studio-editing, Director3D, Production Amplifier | Template advertising-studio, and the Production Tool (production-tool/) | 3 |
| Animation and motion design | Video and motion | No repo yet | New template | 3 |
| Radio | Radio | larryob78/napkin-radio, napkin-audio folds in | New template | 3 |
| Outdoor in situ | Formats and in situ | larryob78/idea-to-ooh-studio | New template | 3 |
| Formats | Formats and in situ | larryob78/Resize, Admagined- and Socials-ads-maker- (both empty) | Film formats: the formats stage of advertising-studio. Stills formats: new template | 3 |
| Shopper stands | Shopper stands | larryob78/shopper-display-builder, Shopper Studio build | New template | 4 |
| Experiential | More tools | New | New template | 4 |
| Presentations | Presentations | larryob78/HTML-slides-tool, napkin-deck-director-, pitcher, GREENLIGHT as a pattern | Template deck-maker, on engine/deck | 4 |
| Compliance night watch | Needs you, More tools | New | New, reads each file's decision chain | 4 |
| Agency dashboard | Agency dashboard | New, Napkin Team Hub as the pattern | Feature landing-circles (building): the agency and client circles | 1 for J001 |
| AI timesheets | Top bar chip, Timesheets | larryob78/napkin-timesheet, napkin-timesheet-traffic | New template | 1 for in-app sessions |
| Case study builder | Case studies | New, reads the decision chains | New template | 4 |

### Brief, Brief check and Brief gate

No creative work starts on a brief the client has not confirmed. Marketers and agencies disagree on what a good brief is: 80% of marketers rate their briefs good, and 10% of agencies agree ([IPA BetterBriefs](https://ipa.co.uk/news/betterbriefs)).

- **Built from.** Brief Maker in Napkin-Studio/napkin-os, the flagship Planning tool: the template app/templates/brief-maker, on the briefing engine (engine/) and the middleware's brief handlers (server/napkin/brief).
- **What it does.** A planner pastes a messy client brief and gets an agency brief, with no prompt typing.
- **Brief check.** It lists the gaps as questions for the client: the business problem, one measure of success, budget, mandatories, deadline, and who signs off. Build on what exists. The engine already grades the client brief with a BetterBriefs scorecard: seven dimensions (objectives, audience, single-minded message, evaluation criteria, budget fit, strategic clarity, language), each pass, vague or missing with quoted evidence, plus a single-mindedness check (score\_betterbriefs in engine/parse\_brief.py). Brief check extends it. Do not write a second scorecard.
- **Brief gate.** The brief passes only with these:
  - one single-minded proposition, in one sentence
  - one insight that is a human truth, not a category fact
  - one measurable objective
  - what people should feel or do
  - what would make this famous
- **Effectiveness plan.** The gate also sets what proves it worked, how it is measured, and the baseline. The Case study builder reads this plan later.
- **Sign-off.** The client confirms the brief on the review link. The planner and creative director sign the passed version. Signing is an approve decision on that version, which locks it. The client's confirmation is a client\_review decision. The gate's tests extend the middleware's existing proposition and insight checks (server/napkin/brief/rubric.py, checks.py and golden\_brief.schema.json) and its Judge (middleware-api.md section 10.8).
- **Rules.** Creative cannot start on an unconfirmed brief. A later change makes a new version. Before it is saved, it shows its cost in hours and days.
- **Good looks like.** Paste the J001 brief with no objective. One question for the client appears, and Territories stay closed until the brief passes and the client confirms it.

### Research, Territories and visual brief

- **Built from.** Research is the Campaign Research template (app/templates/campaign-research), with pinned facts and findings. Territories is the territory-tool feature record, designed with no code yet; Deck Maker's territory stage is its pattern. The visual brief is new. A brief spun off from research carries the research with it (os-layer.md section 5).
- **What it does.** Research and Territories open from the confirmed brief and fill themselves from the job. The chosen territory becomes a one-page visual brief. The creative director approves one exact version, and that approval is locked.
- **Good looks like.** Open Territories on J001. The client, the proposition and the brand are already there.

### Scope, estimates and invoicing

- **Built from.** New, on AI timesheets and budgets. It promotes Estimates and job costing from v1's list of tools an agency will miss. It is a new .clan template, so every change order is an attributed decision.
- **Scope.** Every job has a scope: deliverables, formats, rounds and hours.
- **Change orders.** Each new request is checked against the scope. An out-of-scope request drafts a change order with hours, cost and new dates. One button sends it. Nothing out of scope starts until it is approved.
- **Estimates.** Quotes, purchase orders and budget burn, built from the scope and approved change orders.
- **Invoicing.** Hours from confirmed timesheets become invoice-ready lines for the bookkeeper. Each line links to its source. Lines use the agency's rate card and export as CSV to its finance system.
- **Good looks like.** Ask for a fourth round on a three-round job. A change order is drafted, and the work waits for approval.

### Approval route

- **Built from.** New.
- **What it does.** At job start, account service names who approves each stage and by when. It builds on the OS layer's lock and client\_review decisions, so who approved which exact version is in the file. Reminders go out automatically. Each job shows who holds it and for how long. The dashboard shows days waiting on the client.
- **Why.** Getting a project approved takes about five revision rounds on average ([WFA and IPA BetterIdeas](https://wfanet.org/knowledge/item/2025/04/18/what-s-holding-back-brilliant-ideas)). Clear owners and comments tied to the brief cut that down.
- **Good looks like.** An approval two days late shows in the approver's Needs you and on the dashboard.

### Traffic board

- **Built from.** napkin-timesheet-traffic.
- **What it does.** Who is on what this week. Capacity comes from confirmed hours and calendars. At-risk deadlines show first. Drag a name to reassign work.
- **Rules.** It makes suggestions only. A person decides. It never scores people.
- **Good looks like.** A traffic manager staffs a new job from the board in under a minute.

### Idea room

- **Sources.** The Napkin Idea Machine, larryob78/the-canon and the awards knowledge base (about 10,000 own-words records), with Judge for scoring. The idea room reads only own-words records from the awards knowledge base. napkin-cannes-dataset is never loaded into any model. In Discovery, report what that repo holds.
- **What it does.** Creatives talk ideas through with an AI sparring partner that behaves like a sharp creative director. It pushes, asks why, and kills weak ideas early. Territories from Planning arrive as starting points. Each route is a fork of the idea document, so routes are worked in parallel and merged with no model. Judge scores and the creative director's pick are attributed decisions.
- **Humans first.** The AI shows no ideas until the team has posted five cards, or the creative director opens it early. Idea time is protected on the job plan.
- **Ban the default.** The AI writes the three ideas any agency would have, and the category's habits. It posts them as Banned. Judge marks down any idea that matches. Swap test: if a competitor's logo fits the idea, it is flagged.
- **Fame test.** Each idea shows the headline a journalist would give it, and the line a person would say to a friend.
- **What makes it valuable** (Claude's suggestions, built on Napkin's own methods):
  - **Tissue session.** Generate routes that differ on the strategic bet, not on tone.
  - **Originality check.** Flag when an idea sits close to existing award-winning work, and show the precedent.
  - **Boardroom.** The five-seat review from Napkin OS v2 pressure-tests an idea before it reaches the real creative director. The seats: creative director, strategist, client CMO, consumer voice, rights and clearance.
  - **Outsider sparks.** Stimulus from outside advertising, such as songs, architecture and film, to break category habits.
  - **Idea wall.** Every idea is a card. The team votes, merges and comments. The best go to Judge.
  - **Brief link.** Each idea shows the insight and proposition it answers.
- **Good looks like.** A creative team leaves one session with three genuinely different routes. Each is tied to the brief and scored. None is on the Banned list or a copy of past work.

### Script editor

- **Built from.** A new template. Reuse the house style and quality gate from napkin-radio, and the script revisions and beat ids from the Advertising Studio template.
- **What it does.** A calm, real text editor where a copywriter writes well, fast. Clean page, good typography, versions, and tracked changes. A creative director marks up a script, and the writer accepts or rejects each change. Each change is a human patch (edited\_by: human), so the mark-up and each answer stay on the record.
- **AI in the margin.** Select a line and get rewrites in the brand's voice: shorter, warmer, sharper. Each set of rewrites includes at least one different thought, not only a shorter line. Also headline options, read time in seconds for radio and TV, and a live check against the brief, the mandatory copy and banned words.
- **Writes.** Headline, body copy, social, radio script, two-column TV script.
- **Good looks like.** It feels like writing, not prompting. The AI never takes over the page. A radio script goes to Radio in one click. A TV script goes to Film, and any draft goes to Judge, each in one click.

### Craft review

- **Built from.** New. It opens from the creative director's Ready for review door.
- **What it does.** From Phase 3, before any piece reaches the client review link, a named senior art director or writer marks it up.
- **Craft notes.** Each note names the exact fault: "the bottle is 4 mm off the baseline", not "tighten the layout". Each note is an attributed verdict decision on the exact version.
- **Good looks like.** Every piece on the client link shows the name of its craft reviewer.

### Stills canvas: scamp to photograph to formats

- **Repos.** larryob78/napkin-art-director (Art Director Tool 1.0), larryob78/Resize (Formats), and the Production Recipes plan. In napkin-os, the Production Tool canvas (production-tool/, Runway behind one Provider interface) is the pattern. Stills is a new template.
- **The flow, all on one canvas.**
  1. **Scamp.** Doodle on a blank page or canvas with a pen, finger or mouse, or drop in a photo of a paper sketch.
  2. **Image.** Turn the scamp into images that keep its layout.
  3. **Photograph.** Push the chosen image to a photographic finish.
  4. **Edit.** Select part of the image and change it in plain words, using models such as GPT Image 2.5 through the model router. Then craft tools: grade, vignette, locked type and logo.
  5. **Formats.** Layout variants and every format from the approved master.
- **Also on the canvas.** Motion from an approved still. The Add door opens the six v1 recipes: Clean Packshot, Product Campaign Image, Product Ad, Product UGC, Product Turntable, Format Flip.
- **Good looks like.** Highly visual. The canvas fills the screen and controls stay out of the way. An art director goes from a doodle to a finished campaign photograph without typing a prompt. Type is never generated inside an image.

### Film: script to storyboard to film

- **Repos.** In napkin-os: the Advertising Studio template (app/templates/advertising-studio: script, storyboard, blocking, takes, sound, edit, formats and export, with each approval bound to an exact revision) and the Production Tool (production-tool/: character, storyboard and video on a canvas, on Runway). Outside it: larryob78/napkin-studio-editing (confirm what works), Director3D for 3D blocking, and Production Amplifier for breakdowns.
- **The flow.**
  1. **Script.** Take the TV script straight from the Script editor.
  2. **Storyboard.** Break the script into scenes and frames, with consistent characters and products across every frame.
  3. **Shots.** Turn approved frames into shots, then cut the shots into a film with sound design.
  4. **Edit in words.** "Make the bar warmer", "swap the bottle for the 70 cl", "tighten the opening to three seconds". Edit items and people in shot.
  5. **Variations.** Cutdowns, lengths, languages and versions for testing, then on to Formats.
- **Good looks like.** A creative team sees a storyboard the same day as the script, and a rough film the next.

### Animation and motion design

- **Sources.** No dedicated repo yet. A new template. It opens from the Video and motion door, next to Film.
- **What it does.** Animates approved stills and layouts: kinetic type, logo stings and end cards, animated social and display ads, and character animation from the Character creator. Timing and easing are directed in plain words: "slower in, snap at the end".
- **Good looks like.** An animated end card or social ad comes from an approved layout in minutes, then goes to Formats.

### Radio

- **Repo.** larryob78/napkin-radio. A Next.js app on Vercel, password protected. Napkin-audio is a duplicate to fold in.
- **What it does today.** Reads FVO, MVO, VO, SFX and MUSIC script notation. AI scripting with a quality gate. ElevenLabs studio voices. One-click MP3.
- **What it needs.** Live inside the shell and the job. Take the script straight from the Script editor. Route its writing model and its voices through the model router. Time each spot to its length (10, 20, 30, 40 seconds). Keep every key server side, as it does now. It becomes a new template in app/templates.
- **Good looks like.** A copywriter hears a draft spot within a minute of finishing the script.

### Outdoor in situ

- **Repo.** larryob78/idea-to-ooh-studio.
- **What it does.** A new template. Shows the artwork on real sites, not on a blank rectangle: 48 sheets, 6 sheets, bus shelters, station panels, digital screens. Correct perspective, day and night. Checks safe areas and legibility at distance for each size.
- **Good looks like.** The client sees the poster on a real Dublin site, labelled as a mock-up.

### Formats: digital ads in many sizes

- **Repos.** larryob78/Admagined- and Socials-ads-maker- (both empty), plus larryob78/Resize for sizing. Film versions use the formats stage of the Advertising Studio template. Stills formats are a new template.
- **What it does.** One approved master becomes platform formats: Meta feed and stories, TikTok, YouTube, LinkedIn and standard display sizes, still and animated. Each ad shows inside its real platform frame. Text and safe zones are checked. Variants are planned for testing.
- **Cap.** 12 formats in v1, because both ad repos are empty. The design must allow up to 60 later.
- **Good looks like.** J001's 12 formats export as one checked pack, and a human only looks at the ones flagged.

### Shopper stands

- **Repo.** larryob78/shopper-display-builder (Python and Blender), plus the Shopper Studio overnight build. A new template.
- **What it does.** Pick a unit: floor stand, gondola end, shelf strip, pallet wrap. Apply the artwork to each face. See the stand in a 3D store aisle. Review each face. Export the face artwork at print size and a render for the client deck.
- **Good looks like.** A shopper team designs and presents a stand in an afternoon, with no 3D skills.

### Experiential

- **Built from.** A new template. It lives in More tools for art directors and copywriters.
- **What it does.** Lay out an activation in a simple spatial view and share it. Keep it light in v1.
- **Good looks like.** Place three elements and share a link in under a minute.

### Presentations

- **Repos.** In napkin-os: Deck Maker (app/templates/deck-maker, on engine/deck), with gates, intake and a spin-off from a brief and its research. Outside it: larryob78/HTML-slides-tool, napkin-deck-director- and pitcher, with GREENLIGHT as a pattern.
- **What it does.** One tool with three modes: client presentation, strategy deck and Pitch maker. It builds from the brief, the chosen route, the approved work, and credentials from the Agency Brain. A story spine, critique beside each slide, and rehearsal notes. Export to PDF or PowerPoint.
- **Go or no-go card.** Before a pitch starts, one card scores fit, odds and cost, from the agency's past pitches. A pitch costs an agency about 43,800 euro on average ([EACA cost of pitching](https://eaca.eu/eaca-cost-of-pitching-2025/)). Management decides go or no-go.
- **Each pitch is a job.** Time and costs are captured like any job, so the true cost shows.
- **Good looks like.** A deck that tells one story, ready for a run-through the same day.

### Compliance night watch

- **Repo.** New. It builds on the Rights and Clearance seat from Napkin OS v2 and the Auditor cards. It reads AI attribution from each file's decision chain: which model made each asset, with which handler, and who approved it. Every flag and override is an attributed decision.
- **What it does.** Every night it checks every asset on every live job. It runs overnight in the EU cloud, inside each client's vault, so nobody waits for it during the day.
- **What it checks.**
  1. EU AI Act marks and labels. Machine-readable marks are present, and the disclosure style fits realistic or evidently creative work. Every asset records whether it is AI-generated or AI-assisted.
  2. Irish ad standards and alcohol advertising rules, for jobs like J001.
  3. The brand kit: mandatory copy present, banned words absent, locked logo and type untouched.
  4. Rights: talent, music and stock usage, with expiry dates.
  5. Consent: no real face or UGC recipe on an alcohol client without legal sign-off and a consent record.
- **What people see.** In the morning, each person's Needs you list shows a clean bill or a short fix list. Each issue is one Auditor card: evidence first, the rule it breaks, and the fix as one button.
- **Rule packs.** Rules live in packs per market and per category, each versioned, dated and signed off by legal. A pack is never edited by the model itself. Confirm the first packs with Napkin's legal view in Discovery.
- **Rules.** It flags, it never edits approved work. Nothing goes to the client review link while a high-severity flag is open, unless a named person overrides it and the override is logged. It never scores or judges people.
- **Good looks like.** On J001, every asset reaches the client with a passed check attached. The agency can show an auditor exactly when and how each piece was checked.

### Agency dashboard

- **Repo.** New. Use the Napkin Team Hub artifact as a pattern for tiles and tracking. Build on the landing-circles feature record: the agency circle, the client circles, and Needs you and Running computed by the server.
- **What it does.** One screen for the whole agency, for Management. Six tiles:
  1. Live jobs by stage
  2. At risk
  3. Hours against budget
  4. Days waiting on client
  5. Share of work scoring 27 or more
  6. Results against objectives
- **Rules.** Every number clicks through to the job behind it. In Phase 1, the tiles show J001 only.
- **Good looks like.** A manager understands the agency's week in ten seconds.

### AI timesheets: time captured as a side effect of work

Every action in Napkin OS already happens inside a job, so time is captured as a side effect of working. Nobody fills a blank grid.

- **Repos.** larryob78/napkin-timesheet and napkin-timesheet-traffic. A new template. Work sessions are what the shell records while a person has a job's document open, matched to the decisions they wrote there. Entries live in the agency database, private to the person until confirmed.
- **Consent first.** At first login, each person is asked whether to turn on in-app work sessions. Nothing is captured until they say yes. A person who says no confirms their day by hand. Nobody is penalised.
- **Signals, each one switched on by the person.** Phase 1 uses work sessions inside Napkin OS tools, credited to the job that was open. Phase 2 adds calendar meetings, matched to jobs by client and job name. It also adds Slack and email threads already linked to a job, and voice notes: "an hour on the Jameson call".
- **The day.** At the end of the day the person sees a pre-filled day. Gaps are flagged with a best guess: "1 hour 30 not accounted for. The Kerrygold deck?" One tap confirms. Corrections can be spoken.
- **Why it pays.** Hours flow live into each job's budget, the traffic board and the invoice-ready lines. Producers, account service and management get an alert when a job's hours near their budget.
- **It learns.** Drafts improve from each person's own corrections. That pattern is private and never shown to managers.
- **Rules.** Nothing is submitted without the person confirming it. Each line shows what it was built from. No keystroke logging, no screen capture, no hidden tracking. It must meet GDPR transparency rules.
- **Good looks like.** A day takes under 30 seconds to confirm, and timesheets come in every week without anyone being chased.

### Case study builder: the case study writes itself

- **Repo.** New. It reads the job's decision chains, so other tools need no new capture code. Film and Pitch maker do the final building.
- **Where it lives.** A Case studies door in the Agency Brain, and in More tools for account service.
- **What it does.** It records the job from day one as a timeline. It holds the client brief, the insight and proposition, the territory chosen and why, the work kept, the decks approved and the results. It reads the brief's effectiveness plan, so results are judged against what the job set out to prove. When the campaign ends, one button builds the case study.
- **What it produces.**
  1. A two-minute case film plan: problem, insight, idea, work, results. The script and storyboard go to Film in one click.
  2. Awards entries shaped to each show's own sections and word limits: Effies, Kinsale Sharks, ADFX, D&AD and Cannes Lions. The team submits them on each show's site.
  3. A client results board: the headline numbers, each linked to its source.
  4. A credits list, agency side and client side.
  5. A short new business version for Pitch maker and the Agency Brain.
- **Results input.** Account service adds reach, sales, earned media and effectiveness numbers, each with its source.
- **Rules.** Never invent results. A number without a source shows as unverified and cannot go into a final entry. Results need a named client sign-off before export. A case study is built only from its own client's vault, per ADR-004. It follows each show's public entry format and never ingests award archives. Every output carries the job's AI labels, so entries disclose AI use correctly.
- **Good looks like.** The day the J001 campaign ends, the case film plan, the awards entries and the results board are already drafted. A human checks the facts and signs off, nothing more.

## 7. The loop: Judge, Learn and client vaults

The loop is the product. Build it into the shell, not into one tool.

1. A confirmed brief starts the job.
2. The creative team makes the work.
3. Judge scores it and advises.
4. The creative director decides.
5. Approved work scales into formats.
6. Every result is recorded and feeds the next brief.

The client vault sits under every step. Only scored telemetry leaves it.

- **Judge.** Any piece of work can be sent to Judge from any tool. It returns a score out of 30 with sub-scores (idea, craft, effect) and the reason for each. Show why it is a 22 and not a 26, not only the number. Judge scores against the approved brief and the client's category, never general taste. Each sub-score names its evidence. Under 24 returns to the creative team with notes, unless the idea sub-score is 9 or 10 out of 10. Then it goes to the creative director marked Brave, fix the craft. The creative director can overrule any score. The reason is logged and Judge learns from it. Each score is a verdict decision in the work's file, with its reason codes and Judge version. An overrule is the creative director's own verdict that answers it, with a written reason. Judge extends the brief Judge already in the middleware. Judge never makes the final call.
- **Learn.** Every run is recorded: brief version, tool, model, prompt, inputs, score, what was kept and what was rejected. These are the attributed decisions already in each file's chain, with handler and version. Learn reads them. It adds no provenance table. The system learns what each agency keeps.
- **Agency Brain.** The agency's own memory: clients, pitches, awards, proprietary data. It writes back after every job.
- **Client vaults.** Each client's data is walled off. Judges learn from governed, scored telemetry only. Vault content never leaks between clients. This is ADR-004.
- **Auditor cards.** Calm cards that flag stale knowledge, creative fatigue or brand drift, with evidence first. One click to approve or dismiss.
- **Job memory and handover.** Each job keeps a one-page summary, built from its decision chains: decisions, the reasons for them, and what the client liked and rejected. A Handover pack button builds it when someone joins or leaves the job. Client preferences go to that client's brain only, per ADR-004.

### The agency flywheel, on the NVIDIA stack

Napkin is an NVIDIA Inception member, so the learning loop runs on the NVIDIA stack. The agency must learn: every job should make the next one faster, cheaper and better.

&#91;embedded content\]

- **What it learns from.** First from in-market results and the creative director's picks. Keep rate comes second.
- **Serve.** Run open models through NVIDIA NIM microservices wherever they meet the quality bar, Nemotron first for high-volume agent steps. Keep Claude for prompt building, hard reasoning and review.
- **Tune and evaluate.** Use NeMo to tune, evaluate and guard agency models on scored telemetry. A tuned model replaces the current one only if it scores better on held-out jobs. Its routes must also differ from each other at least as much as before.
- **Compute.** The DGX Spark runs research and tuning on telemetry only. Judge and the Compliance night watch read client work. So they run in the EU cloud, inside the vault, until the Spark meets the same rules.
- **Walls.** The flywheel learns from governed, scored telemetry only, never raw vault content, per ADR-004. Each agency's taste stays its own. One agency's data never trains another agency's models. An agency can export all its data at any time. On exit, Napkin deletes it within 30 days.
- **Show it.** Track whether the flywheel is turning: keep rate, Judge score, time to approval and cost per asset, job over job. The dashboard's quality tiles click through to it.
- **Check first.** In Discovery, confirm which NVIDIA services and Inception credits Napkin can use today before you design around them.

## 8. Locked brand and interface rules

These rules are locked. Do not invent new tokens, colours, fonts or components. Where the TBWA 1.0 prototype already has a pattern, reuse it.

| Rule | What it means in the build |
| --- | --- |
| Colour | White, black and mid-grey only. One accent, sampled from the active agency's logo. Never hand-picked, never fixed to Napkin |
| Accent use | Focus, the selected item, where you are, and counts (3 of 4 kept). Never decoration |
| Napkin's own mark | Plain white Napkin wordmark on black. No secondary colour, no alternate lockups |
| Interface type | Helvetica Neue, Arial fallback. No web-font loading for the interface |
| Display type | Newsreader, only for large reading and display headings |
| Circles | Portals only: navigation, doors, buttons, the Napkin mark. A circle never crops a photo or video |
| Rectangles | Hold all other content. The only shape that frames a photo or video. 2 px corners |
| Spacing | Fibonacci scale: 5, 8, 13, 21, 34, 55, 89 |
| Type floor | 13 px for reading. 12 px only for uppercase labels |
| Tap targets | 44 px minimum |
| Buttons | One primary per screen, solid ink. A primary that cannot run yet is dashed, with the reason under it |
| Depth | Shadow only on doors. Cards stay flat |
| Modes | Every screen reads in White, Grey and Black modes |
| Help | Ask Nap is the help on every screen. It explains a tool, a cost, or why something failed |
| Copy voice | Short sentences. Plain words. No em dashes anywhere. No words like magic, stunning or effortless. Say what it does |

The interface should feel calm, modern and simple. Controls appear when they are needed. Nothing should look like generic AI tooling.

### Design north star: modern, calm, contemporary

Napkin OS should feel as quick and quiet as the best tools people already love. The work is the loudest thing on every screen, and the system stays out of the way.

**Principles.**

1. Less, but better. Every element earns its place or goes. The locked rules are the style, not a limit (Dieter Rams, Teenage Engineering).
2. Respond within 100 ms. Show each change at once. Save in the background. If a save fails, the work stays with Try again (Linear).
3. Let the work lead. Navigation and labels recede. Controls appear beside the work when it is selected (Figma, Frame.io).
4. Let structure be felt, not seen. Separate with Fibonacci space before adding a line. Never box a rectangle just to group it (Linear).
5. Keep type quiet. At most four sizes a screen: 13, 21, 34 and 55, plus 12 for uppercase labels. Reading lines run 45 to 90 characters (Linear).
6. Move only to explain. 89 ms for feedback, 144 ms for menus, 233 ms for panels, easing out. Keyboard actions never animate. Respect Reduce motion (Apple, Things 3).
7. Keyboard first, mouse welcome. Every action is reachable from the one bar. Menus show their shortcuts (Raycast).
8. Empty states show, not tell. A finished J001 example and one starting verb, never a blank box (Notion).
9. AI proposes, people decide. Ask Nap edits appear inline: additions in ink, removals struck through in grey. Cmd Enter keeps, Esc discards, and people can keep part (Cursor, Claude).
10. Put the source beside the claim. Every answer cites in place and says why it suggested what it did (Perplexity).

**Never.**

- Sparkle icons, AI badges or a robot face.
- Gradients, glow, glass or blur.
- A chat window as the main screen. Chat sits beside the work.
- Cards around everything, or cards inside cards.
- Spinners for anything under a second. Fake typing effects.
- Bounce, elastic easing, or animation people must wait for.
- Big number tiles with decorative charts.
- Modals where an inline panel would do.

**Four checks, under a minute each.**

1. Speed. Press five common actions. Each one shows a change within 100 ms. Loads over 300 ms show grey rectangles in the final layout.
2. Squint. Blur your eyes. You see the work first, then the one primary button. The accent marks only focus, selection, location or counts.
3. Keyboard only. Without the mouse, open the J001 brief, edit a line, keep it and undo it.
4. Count. One primary button. Four type sizes or fewer. No card inside a card. Nothing slides with Reduce motion on.

## 9. Rules that never bend

### Hard rules

- No API key ever reaches the browser, a log, a page source, the repo or chat. Keys live in Vercel environment settings only.
- No type in generated images. Headlines, prices and mandatory copy are set in layout, with the locked font.
- Every asset keeps its model, seed, prompt, inputs and credits. Exports carry an AI-generated label.
- Client data never crosses vaults. Only scored telemetry leaves, per ADR-004.
- Award source material is stored as own-words records only. Never reproduce the original expression. Cannes Lions terms prohibit AI ingestion.
- People and alcohol: no UGC or real face recipe ships for an alcohol client without legal sign-off and a consent record.
- No em dashes in any generated copy or interface text.
- No model provider may train on client data.
- Each client has an AI switch. It stays off until the client's written yes is recorded.
- Only models whose terms allow commercial use make client work.

### EU AI Act and GDPR

Napkin OS is built for the EU, so the AI Act shapes the product now. Article 50 transparency rules have applied since 2 August 2026. Under the AI Omnibus agreement, generative systems already on the market before that date get until 2 December 2026 to add machine-readable marking; confirm the Omnibus is in force. Get Napkin's legal view on each point before pilots go live. Checked 9 Nov 2026.

- **Napkin is a provider.** Napkin OS generates images, video, audio and text, so its outputs must carry machine-readable marks that detection tools can read: watermarks or provenance metadata. Check that every model vendor marks its outputs, and add Napkin's own provenance on export.
- **Agencies are deployers.** Realistic content that resembles real people, places, products or events and could pass as authentic needs a clear AI disclosure, at first exposure at the latest. Evidently creative or fictional work gets a lighter disclosure that does not spoil the work. Build both label styles into Export.
- **Label by medium.** A persistent label on images and video, an opening disclaimer on video, an audible line on audio. Record on every asset whether it is fully AI-generated or AI-assisted. Follow the Commission's Code of Practice on marking and labelling.
- **Text.** Record who reviewed and approved each piece of copy, so human editorial responsibility can always be shown.
- **People at work.** AI that monitors or evaluates workers can count as high-risk under the Act, and those rules now start on 2 December 2027. So the timesheet AI drafts time and nothing else. It never scores, ranks or judges people, and never reads emotions.
- **GDPR.** Client data stays in its vault and in the EU. Every timesheet signal needs the person's consent. Delete on request.

### EU residency and backups

- **EU only.** Pin every function, the database and all storage to EU regions.
- **Providers.** List each model provider that receives client data. For each one, record where it processes data and whether a DPA is signed. Discovery hands this list back.
- **Backups.** Daily backups, kept for 30 days. Today the repo runs in eu-west-1 and keeps Aurora 7 days point in time and RAG disk snapshots 14 days. Raising both is an infra change that a person applies.
- **Restore.** Test one full restore before the pilot goes live.

## 10. Phases and definition of done

Discovery comes first, then four phases. Each phase runs in fresh sessions, with one feature record and one feat/ branch per tool or change, and PRs into develop. Each phase ends at a gate.

| Phase | What ships | Gate |
| --- | --- | --- |
| Discovery | An audit of the repo against this prompt, design proposal, Phase 1 feature records with their designs, the harness record, the In Discovery list. No product code | The feature owners approve each design, then Laurence approves the set |
| Phase 1: the J001 brief path | Four live homes (Planning, Creative director, Account service, Management); the others are seeded placeholders. The O, role access, three modes, logo accent. J001 seeded as .clan documents in its agency's workspace, the agency database with row-level security on brand\_id, Needs you and the dashboard read from the decision chains. Messy brief to agency brief, Brief check and Brief gate, client-confirmed brief, Research and Territories prefilled, locked visual brief approval. Agency dashboard for J001. Timesheet from in-app sessions only, one-tap confirm. Run records, fixture tests, key scan, browser tests at two widths. Ask Nap and the bar are stubs | The J001 pilot suite passes at 390 and 1440 px |
| Phase 2: the agency works in it | Voice, single sign-on, search, full agency setup, the remaining homes. Calendar, Slack and email timesheet signals. Script editor, Idea room, Judge, Approval route, client review link | Laurence reviews J001 from brief to chosen route |
| Phase 3: production and the business end | Stills canvas, Film, Radio, Outdoor in situ, Formats (12 formats in v1, as both ad repos are empty), Animation and motion design. Scope, estimates and invoicing, Traffic board, Craft review | J001 has a scored still, film, radio spot, poster and format pack |
| Phase 4: finish and learn | Shopper stands, Presentations with Pitch maker, Case study builder, Compliance night watch, Job memory, Experiential, the flywheel on NVIDIA | v1 is done (below) |

Phase 1 is for planners, creative directors, account service and management. Everyone else keeps today's tools until their phase.

In Phase 1 the client confirms the brief through a simple signed link to one brief version. The full client review link comes in Phase 2.

### Discovery hand-back

Hand back five things, then stop at the gate.

1. **An audit of what exists against this prompt.** For each tool in section 6 and each Phase 1 line, say whether a template, feature record or code exists, how far it is (feature status, tests, last check), and what is missing. Read napkin-os with read-only subagents, one per area. For each other repo in docs/sources/repos.md, use one subagent. Each clones into a scratch folder outside the home repo. It may install and run tests there. It never pushes. For napkin-cannes-dataset, list file names and sizes only. Open no records. Each returns ten lines: what runs, what breaks, and the command that proved it. Check the Phase 1 repos in depth. Triage the rest in 15 minutes each.
2. **A design proposal** as static HTML in docs/design/. It shows the O, the four Phase 1 homes, the Brief gate, the Agency dashboard and the timesheet day view. Each is drawn at 390 and 1440 px in White mode. One Black mode sample. The other homes as door lists only.
3. **The Phase 1 feature records.** Open one per Phase 1 tool or change with scripts/feature new, fill its design (status exploring), and give each done\_when line an acceptance test. Name the existing records each one builds on, such as landing-circles, the brief records, territory-tool, system-undo and no-password-sign-in, and say what each still needs.
4. **The harness record.** The repo already has the hooks, scripts/check.sh, CI, offline tests and a per-tenant meter. Open one feature record, harness, designed but not built, for what is missing:
   - a deny rule on reading .env files, in .claude/settings.json
   - a secret scan that blocks any push containing a key, in .githooks/pre-push and in CI
   - an em dash check on interface strings, as a scripts/check.sh step
   - a spend cap per environment and per run, on the existing meter

   Scaffold nothing new. Show scripts/check.sh --all green on develop with the hooks turned on. The spend cap is 0 euro with paid calls off. Laurence raises it at the gate.
5. **One list of every In Discovery item in this prompt,** each with your finding or the question Laurence must answer. Do not wait on any of them.

### Phase 1 definition of done

Write each line below as an end-to-end test in app/e2e/j001-pilot.spec.ts, on the repo's Playwright harness, as the first Phase 1 feature, before any screen. Phase 1 is done when scripts/check.sh --only e2e passes it at 390 px and 1440 px wide, and scripts/check.sh --all is green. Show the command and its output at the gate. The e2e suite uses no client material, so J001 is seeded from a de-identified copy until Laurence says otherwise.

Doors with no Phase 1 tool show their Empty state. Live jobs lists J001.

1. A browser test logs in as each live role, and the visible doors match the doors table in section 4.
2. A Planning user opening the J001 Scope and estimates URL gets 403.
3. The creative director signing the brief writes one approve decision on that version in the brief's decision chain.
4. Editing after approval makes a new version, recorded in the chain, and a Changed brief alert. The signed version stays as it was.
5. The dashboard shows a J001 stage change within 10 seconds.
6. Five fixture logos, one black and white, repaint the accent. Accent text passes 4.5 to 1 on all three mode backgrounds. The black and white logo gives no accent.
7. axe finds no serious or critical issues on every Phase 1 page, in all three modes.
8. A fake canary key set on the server never appears in network traffic or the bundle.
9. Each confirmed timesheet line links to its sessions.
10. The J001 brief passes the Brief gate, and the client confirms it before Territories open.
11. Every write in the J001 documents is attributed. clan read chain shows no write without an agent and an action, and every human edit is marked edited\_by: human.
12. The J001 brief's retrieval trace has no hit from source=cannes.

### v1 is done

**v1 is done when J001 runs end to end.** One product photo becomes a campaign still, a 10-second film and a full digital format pack. The copywriter's radio script becomes a voiced MP3. The poster is shown in situ on a real site. The shopper stand is rendered in an aisle. All of it is scored by Judge and shown on the dashboard.

This stays the end goal across every phase. By the end of Phase 4, J001 also runs the full life in section 3, from client brief to invoice-ready lines and case study.

## 11. For the builder

### Work the repo's way

The repo's CLAUDE.md is the workflow, and it wins on how to build. This prompt decides what agencies get, and its locked rules stand.

1. Start each session with napkin-studio.clan: give the clan-steward status check (`clan read agent napkin-studio.clan`). End each task by proposing its update.
2. One feature record per Napkin OS tool or change. Run `scripts/feature list`, then `scripts/feature new <slug> "<title>"`. Work on `feat/<slug>` with `FEATURE_AGENT=claude`.
3. Design before code. Answer the record's design questions with `clan patch-data`. Stop and show the feature's owner. Write code only after `design.approved_by` is set and `scripts/feature status <slug> designed` passes.
4. Log as you go with `scripts/feature log`. Keep open\_questions and next\_step current. If the design proves wrong, record a decision with `clan patch-decision` and tell the owner first.
5. Run `scripts/check.sh` for the suites the change reaches and record it with `scripts/feature checked`. Push the branch and open a PR into develop with the PR template. It is squash-merged. Releases go from develop to main by merge commit. Never push to main.
6. Turn the hooks on once with `git config core.hooksPath .githooks`. Never use `--no-verify` or set the bypass variables.
7. Commit subjects are `<area>: <summary>`, 72 characters or fewer. No Co-Authored-By trailers and no Generated-with lines. A commit belongs to the feature's owner.
8. An agent may run `terraform plan` and read it. Only a person runs `terraform apply`.
9. Never commit .env files, signing keys, client\_briefs/ or client labels.

**Where this prompt lives.** Save it as docs/napkin-os-build-prompt-v2.md, as the repo keeps plans in docs/ (for example docs/deck-maker/PLAN.md), and add it to the docs index in napkin-studio.clan through clan-steward. The architecture .clan files at the root are decision records with their own chains, so this prompt does not become one. Each feature record cites the sections it builds. Decisions go in the feature records' decision chains, and open questions in the open\_decisions of napkin-studio.clan.

### Sources

Every source goes in docs/sources/. If one is missing, say so in the Discovery hand-back and carry on.

### Existing work

Do not start from a blank page. These exist and you build on them:

- The TBWA 1.0 prototype: departments, roles, role homes, the O, every tool's purpose. This is the design reference for the shell.
- The napkin-os repo (Napkin-Studio/napkin-os, develop): CLAN, the OS layer, the shell, Brief Maker, Research, Deck Maker, Advertising Studio, the Production Tool, the briefing engine, the middleware and the AWS stack. Read napkin-studio.clan, foundation-spec.clan, judgement-architecture.clan and napkin-studio-os.clan with clan read agent, and the contracts in docs/contracts/.
- The repos named in each tool spec in section 6. Read their READMEs and run their tests before you decide anything.
- The Production Recipes plan and Napkin Brand System, linked in Sources.

Where something exists, wrap it and restyle it. Rebuild only what is broken or missing, and say why.

### Stack

- **Format.** CLAN: crates/clan-sdk and crates/clan-cli, specified in spec/CLAN-SPEC.md. Every tool's document is a .clan file.
- **OS layer and shell.** crates/napkin-host is the OS layer and stays wasm32-clean. crates/napkin-web is the HTTP shell and crates/napkin-wasm the browser host. The shell is app/ (React and Vite), browser first, so agencies open Napkin OS in a browser. The Tauri desktop app (app/src-tauri) is a connected shell and an offline presenter.
- **Tools.** Each tool is a template in app/templates. Its app/pipeline.yaml declares a handler by name and major version. The middleware holds the logic, never the template.
- **Middleware and engine.** server/ is the FastAPI middleware (uv), with clan-sdk bound in through PyO3. engine/ is the briefing engine. layers-service/ holds the knowledge layers.
- **AWS in eu-west-1, by Terraform (infra/).** ECS Fargate runs web and middleware. Aurora PostgreSQL holds napkin\_category and one napkin\_agency database per agency. A RAG host runs Qdrant: a shared, read-only house store and one store per agency. S3 holds corpus, blobs and backups. Secrets Manager holds keys. Cognito holds sign-in.
- **Models.** Claude on Amazon Bedrock in the EU, routed per purpose by NAPKIN\_MODEL\_ROUTES. NVIDIA NIM for embeddings, rerank and vision.
- **Keys.** Keys stay server side, in Secrets Manager and in IAM roles that Terraform sets. The hard rule in section 9 names Vercel environment settings. Until Laurence updates its wording, read it as the server's secret store.
- **Login.** Production signs in through Cognito. Staging uses a roster sign-in by name and agency, with no password. The Phase 1 one-time email link and the client reviewer link are new: build each through a feature record, and record the choice in its decision chain.
- **Generation.** Runway Dev for generation, with ElevenLabs inside Runway for voice and music, through the Production Tool's Provider interface and capability sheets. Built to scale on NVIDIA infrastructure, with the DGX Spark used for research and tuning on telemetry only.
- **Voice routing.** All speech and voice, including Radio's voices and the push-to-talk microphone, go through the model router.
- **Infrastructure changes.** An agent may run terraform plan and read it. Only a person runs terraform apply. A merged change is not live until the apply and the deploy are both done and checked in AWS.

### Events

- No separate event table. The decision chain in each .clan file is the append-only record. A write without an agent and an action is refused, and nothing edits or deletes a decision.
- The server applies each change and its decision in one transaction, then sends it to every open view (os-layer.md section 2).
- Needs you, alerts, the dashboard and the traffic board read an index the server builds from the chains. They never write to it.
- Phase 1 screens may poll every 5 seconds where the live feed is not wired yet.

### Runs

- A run is a middleware job (napkin.middleware/1). Its states are queued, running, needs\_input, failed and done. A cancelled state needs a contract change, through a feature record.
- The middleware runs it, and the host applies its change. A job belongs to its tenant and its document.
- Each provider call has a timeout, two retries with backoff, and an idempotency key. Never retry a moderated job. The Production Tool harness already classifies provider errors.
- A failure stores the provider's error. Every run writes a trace id to the run log (server/napkin/runlog.py), and its decisions name their handler and version.

### Cost

- Tests never call paid providers. Engine tests run offline, the middleware has its stand-in (mock-middleware) and the mock backend, and the e2e suite calls no model. In fixture mode the router replays recorded responses. If no key exists to record a fixture, hand-write it and record that as a decision in the feature record.
- Extend the per-tenant meter (crates/napkin-web/src/meter.rs) to a daily cap per environment and a cap per run.
- One switch pauses all paid calls.
- A queue per key, to stay inside rate limits. The AWS budgets in infra/ stay as the account-wide alarm.

### Shared data model

Three stores, each with one job. CLAN documents hold the work. Aurora holds the knowledge layers and each agency's own records. Qdrant holds retrieval. Tools never keep their own copy of a client, a brief or a product. Extend the Production Recipes data model inside this split; do not start a second one.

Isolation follows the repo's foundation spec: one database per agency with forced row-level security on brand\_id, one RAG store per agency, and a shared, read-only house store. This is how ADR-004's client vaults are enforced. On the server, a document's facts, decisions and blobs live in its agency's database and S3, and the .clan file is packed on demand (foundation decision S1). Today napkin-web still keeps workspaces as files on EFS, and the layers schema is not yet ported to Aurora.

| Record | Where it lives | Notes |
| --- | --- | --- |
| Agency | A control-plane org row. Its own database, RAG store and KMS key, from the agencies map in infra/ | Name, logo, accent and monthly credit cap are agency settings in its database. New |
| Person | Cognito, or the staging roster. Roles and permissions in the agency database | Orgs, users, memberships and roles, per the foundation spec |
| Client | The client registry: one CLAN document per tenant (crates/napkin-host/src/clients.rs) | Each document names its client in manifest.client. Vault and client brain per ADR-004 |
| Rate card | Agency database | Hourly rate per role, client rates, currency, VAT. New |
| Brand | Brand row and brand layer facts in the agency database, with row-level security on brand\_id | Brand kit files in the S3 blobs bucket |
| Product | Brand layer, agency database | Range, clean photos, variants, must show, never show. New |
| Job | The job's .clan documents, linked by lineage and manifest.client. Job number, owner, stage, dates and budget in the agency database | The job record is new |
| Brief | A Brief Maker .clan document | Versions are document versions. Signed is an approve decision, which locks it. Client confirmed is a client\_review decision |
| Scope | A Scope .clan document | Every change order is an attributed decision. New template |
| Run | A middleware job, and the decisions it writes | The run log holds its trace |
| Asset | Inside the .clan (human/assets), or a vault .clan referenced by sha256 when large. Blobs in S3 by hash | Kept flag and provenance in the decision chain |
| Score | A verdict decision in the work's .clan | Reason codes and taxonomy version. Reviewed verdicts feed the agency's own RAG store |
| Decision | The document's decision chain. Fact decisions in the agency database | One type for every mark (os-layer.md section 3) |
| Timesheet entry | Agency database | Private to the person until confirmed. Links to its work sessions. New |
| Idea | Entries in an Idea room .clan | Routes are forks, merged with no model |
| Event | No table. The decision chains, sent to open views | The server indexes them for Needs you and the dashboard |
| Alert | Agency database | Built from decisions and job states. New |
| Case study | A .clan document spun off from the job's chain | Results with sources and client sign-off |

### Shared engines

Every tool calls these:

1. **Prompt builder.** The middleware's handlers build every prompt from the template's declarations (app/pipeline.yaml), the approved brief, brand rules and the product card. Logic lives in the middleware, never in the template. The exact prompt is kept with the run, under the run log's rules for client material (middleware-api.md section 10.16).
2. **Model router.** The model port (peripherals.md section 1) picks the model per purpose from NAPKIN\_MODEL\_ROUTES. Generation goes through the Production Tool's Provider interface, with Runway Dev as the default route for image, video, voice and music. Cheapest capable model for previews.
3. **Cost engine.** Prices every run before it starts. Shows the credits on the button. Refuses a run that passes the agency's monthly cap. It extends the per-tenant meter.
4. **Judge service.** One scoring API used by every tool. It extends the brief Judge (middleware-api.md section 10.8) and writes each score as a verdict decision.
5. **Storage.** Every input and output is kept on success, inside the client's scope: in the .clan file, or in the S3 blobs bucket by hash.
6. **Export.** clan export and the shell's Export use clan\_sdk::export\_html: HTML and PDF with the attributed provenance appendix and the AI-generated label. PowerPoint, images and video carry the same record. A client gets an export, never the raw .clan file with its agent context.

### Model delegation

Fable for architecture and hard reasoning. Sonnet-class for runtime generation. Cheaper models for component work. Open models on NVIDIA NIM for high-volume agent steps, as the flywheel section sets out. Use the cheapest capable model for each task. Runtime routes live in NAPKIN\_MODEL\_ROUTES (server/model-routes.example.json, peripherals.md section 1.9).

### Build quality

The parts nobody asks for but every agency notices.

- **Where the code lives.** The home repo is Napkin-Studio/napkin-os, branch develop. The shell is app/, each tool is a template in app/templates, and tool logic is a middleware handler in server/. Existing repos come in as templates and handlers, not as copies of their stacks. Laurence lists every other repo as owner/name in docs/sources/repos.md. A repo not on that list, or one that will not clone, is noted in the Discovery hand-back and skipped.
- **The accent must stay readable.** Sample the colour from the logo. Then adjust its lightness until text and controls meet contrast rules in all three modes. Never ship an accent that fails.
- **Accessibility.** Meet WCAG 2.2 AA. Every screen works with a keyboard and with VoiceOver. Voice and typing reach every action.
- **Search everything.** The one bar finds any job, brief, asset, script or person: "the Jameson radio spot from March".
- **Security.** Single sign-on for agencies from Phase 2. Permissions by role. An audit log of every approval, export and permission change, read from the decision chains and the sign-in log.
- **Testing.** Seed the J001 demo job so every screen has real content. Unit tests for every shared engine, in the scripts/check.sh suite it belongs to. End-to-end browser tests for the pilot path in app/e2e, at desktop and phone width.

### Working attitude

You own the agreed task. Act like a senior builder who has been trusted with it.

- **Work through ordinary errors.** For example a failing install, a broken test, a missing env variable, or a repo that does not match its README. Fix it or route around it, then note what you did in the feature record's build log. Do not stop to ask.
- **Verify what you can.** Run the tests. Open every page you build. Check it at desktop and phone width, and in all three modes. Run real provider calls only where keys are configured, and never claim a provider works if you did not see it work.
- **Stop only for three things.** A phase gate, a design waiting for its owner's approval, or a decision that cannot be undone and could reasonably go either way. Then set out the options and your recommendation.
- **Review before each gate.** A fresh reviewer subagent checks the diff against the feature record's design and this prompt. It reports gaps that affect correctness and skips style.
- **Hand back evidence and one next action.** At each gate: screenshots, test results, what you could not verify and why, and the single next thing you recommend. No long recap of your steps.
- **Close each gate with a short recap that stands alone:** found, done, next, the PR link into develop, changed files.
- **Taste matters.** If a screen looks like generic AI tooling, it is not done. Simpler beats cleverer. Fewer buttons beat more features.

## 12. Not yet decided

Two questions block. The Cannes question blocks any use of Cannes material, and ADR-004 sign-off blocks Phase 1. Until ADR-004 is signed, build to its strictest reading. Until Laurence decides the Cannes question, the builder must not run engine/ingest\_cannes.py or query source=cannes. For every other question, take the default, record it as a decision in the feature record it touches, add it to open\_decisions in napkin-studio.clan, and raise it in your Discovery hand-back.

| Question | What is open | Default until decided |
| --- | --- | --- |
| **Cannes Lions content. Blocking** | The hard rules say Cannes Lions terms prohibit AI ingestion. The repo's RAG house store lists a licensed Cannes corpus, and engine/ingest\_cannes.py turns Cannes exports into RAG documents tagged source=cannes. On 21 Sep 2026 the live index held 497 Cannes chunks (foundation-spec.clan). Option A: remove Cannes from the house store and stop the ingest. Option B: confirm a licence that permits AI use, then Laurence updates the locked rule. | Blocks any use of Cannes material. Until Laurence decides, the builder must not run ingest\_cannes.py or query source=cannes. Neither the rule nor the repo changes until then. |
| ADR-004 sign-off | Still open. It also blocks the corpus licence legal review and the OpenShell spike | Blocks Phase 1. Build to its strictest reading |
| Art Director Tool 1.0 status | The tracker on 9 Nov says Built. The Design Brief on 28 Oct said on hold, in repair in another thread | Test it in Discovery. Wrap it if it runs, rebuild the Stills canvas in Phase 3 if not |
| Type and colour in older tools | Production Recipes and Art Director Tool 1.0 still use Hanken Grotesk and a fixed Napkin blue | They switch to the locked rules in section 8 |
| Departments | Six rings in the prototype versus the manifest list. Where Management sits. When Media comes back | Seven departments as in section 4. The O shows at most five. Media stays parked |
| Unplaced tools | Where Agency MRI, Production Amplifier and the Shopper Display Builder live | Production Amplifier inside Film. Shopper Display Builder behind Shopper stands. Agency MRI in the Agency Brain's More tools |
| Presentation base | Which of the three deck repos becomes the one tool | Deck Maker in app/templates/deck-maker, which already exists, made to export PDF and PowerPoint. The three repos become patterns |
| Recipe runner | Napkin's own runner or Runway Workflows | Napkin's own runner behind the model router, so Runway Workflows can swap in later. Recommend one in Discovery |
| Credits | Pass Runway credits through to agencies at cost, or bundle them into the 7,000 euro pilot fee | Credits are billed at cost, per job, on top of the 7,000 euro pilot fee. Each run shows its price first. The agency sets a monthly cap. A default for Laurence to confirm |
| TBWA pitch | How Napkin OS sits beside Omnicom's own Omni platform | Napkin OS does not depend on Omni. Exports and links only |
| The agent runtime | The system that runs Napkin's agents, dictated as "Claws system", most likely NemoClaw and OpenClaw | Phase 1 does not depend on it |
| FLUX 3 routing | Runway does not carry FLUX 3 | Runway models in v1. No separate FLUX 3 key |
| EU AI Act legal view | Provider marking, deployer labels, and the timesheet AI's limits | Build both label styles and machine-readable marks. No pilot goes live without the legal view |
| Accent swap | Whether an agency may pick another colour sampled from its logo | No swap in v1 (section 5) |
| NVIDIA services | Which NIM services and Inception credits Napkin can use today | Everything runs on cloud APIs first. NIM is added where it is confirmed |
| J001 brief and client material | The repo never commits client material (client\_briefs/ is excluded) and its e2e tests use placeholder clients. J001 is a real brand | Keep the raw J001 brief in client\_briefs/. Seed tests from a de-identified J001 until Laurence says the demo brief holds no client material |
| Who approves designs | In the repo, each feature's owner approves its design (design.approved\_by). In this prompt, Laurence approves at each gate | Feature owners approve designs. Laurence approves the set at each phase gate |
| Phase 1 login | The repo signs in with Cognito passwords in production and a name and agency roster on staging. This prompt asks for a one-time email link | Keep the repo's sign-in until the email link is built on Cognito through its own feature record |
| Client confirmation link | The repo records a client's answer as agency staff, with no client actor (os-layer.md section 7.5). This prompt has the client confirm on a signed link | Build the Phase 1 signed link as a client\_review contract change in its own feature record, approved by the OS layer's owner |
| Typography and colour in the repo | The shell loads Geist from Google Fonts, typography is an open decision in napkin-studio.clan, and the CLAN agent context asks for a dark theme with a fixed accent | Section 8 wins. Close the repo's typography decision through clan-steward |
| Key storage wording | The hard rule says keys live in Vercel environment settings. The repo keeps them in AWS Secrets Manager and IAM roles | Keys stay server side in Secrets Manager. Laurence updates the rule's wording |
| Client vaults inside one agency | Agencies are split by database and store. Brands inside one agency are split by forced row-level security in Postgres, but only by a scope filter in the agency's RAG store | Build to ADR-004's strictest reading. In Discovery, say whether client learnings need their own store |
| Run states and backups | Repo jobs have no cancelled state. The repo keeps 7 and 14 days of backups, where section 9 asks for 30 | Use the repo's states and retention until a feature record changes them and a person applies the infra |

### Suggested tools, not yet decided

These are Claude's suggestions, not decisions. In Discovery, say which ones J001 actually needs and size each one.

| Tool | Why an agency needs it | Builds on |
| --- | --- | --- |
| Results and effectiveness | Pulls live campaign results back into Learn, so Judge learns from what worked in market, not only from awards | The flywheel, the dashboard, the effectiveness plan |
| Meeting notes to actions | Records client calls and turns them into contact reports, brief changes and tasks on the job | The audio transcription MVP |
| Asset library | Every approved asset, findable by client, product, format and date, with usage rights and expiry dates | Approved work, the brand kit |
| New business tracker | One list of every pitch, its stage and its true cost | Pitch maker, the go or no-go card |

Media planning stays parked until the team agrees its job.

## 13. Sources

- [TBWA 1.0 prototype](https://claude.ai/code/artifact/dba8be6e-a316-4795-9aa0-2591d0da7d30): departments, roles, role homes, tools
- [Napkin Team Hub](https://claude.ai/code/artifact/faf2b790-7e92-4900-b687-806a601491bd): tool tracker and status, 9 Nov
- [Napkin OS Design Brief](https://claude.ai/artifact/VVuJ1VEsmSPtcw91aQjeMT): system map, repos, tool cards, 28 Oct
- [Production Recipes: Team Brief and Build Plan](https://claude.ai/artifact/6KiQy9gCuMA3kEH1ZGkAyQ): recipes, data model, runner, 3 Nov
- [Napkin Brand System](https://claude.ai/code/artifact/40a36b0f-13a9-4819-a2bc-637045becfab)
- [Anthropic's Fable 5.2 prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2) and [release and pricing](https://www.anthropic.com/claude-fable-and-mythos-5-2), as Laurence linked them
- Napkin OS project notes, including the locked brand rules of early November
- [larryob78/napkin-radio](https://github.com/larryob78/napkin-radio): the radio tool's README, read 9 Nov
- [larryob78 Repo Map](https://claude.ai/code/artifact/dbb835c5-a688-4ee0-9bcc-3954589c67ab): where each repo belongs
- [EU AI Act Article 50 guide](https://artificialintelligenceact.eu/transparency-rules-article-50/) and [the AI Omnibus agreement](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines/), read 9 Nov
- [IPA BetterBriefs](https://ipa.co.uk/news/betterbriefs): 80% of marketers rate their briefs good, 10% of agencies agree. Read 10 Nov
- [EACA cost of pitching 2025](https://eaca.eu/eaca-cost-of-pitching-2025/): about 43,800 euro per new business pitch. Read 10 Nov
- [WFA and IPA BetterIdeas](https://wfanet.org/knowledge/item/2025/04/18/what-s-holding-back-brilliant-ideas): about five revision rounds to get a project approved. Read 10 Nov
- Design north star in section 8, read 10 Nov 2026:
  - [Linear: behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh)
  - [Linear: how we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)
  - [How Linear feels instant](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown.md)
  - [Nielsen Norman Group: response time limits](https://www.nngroup.com/alertbox/response-times.html)
  - [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines)
  - [Apple Human Interface Guidelines: Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
  - [Figma: designing UI3](https://www.figma.com/blog/our-approach-to-designing-ui3/)
  - [Frame.io V4 player and commenting](https://blog.frame.io/2024/05/28/frame-io-v4-features-player-and-commenting/)
  - [Raycast: a fresh look and feel](https://raycast.com/blog/a-fresh-look-and-feel)
  - [Vitsoe: Dieter Rams' ten principles](https://www.vitsoe.com/gb/about/good-design)
  - [The death of the empty state in AI products](https://uxdesign.cc/the-death-of-the-empty-state-in-ai-products-2026-e11439fbb688)
  - [Cursor Tab docs](https://docs.cursor.com/tab/overview)
  - [Microsoft: guidelines for human-AI interaction](https://www.microsoft.com/en-us/research/blog/guidelines-for-human-ai-interaction-design)
  - [Practical Typography: line length](https://practicaltypography.com/line-length.html)
  - [Nielsen Norman Group: squint test](https://www.nngroup.com/videos/squint-test/)

The home repo, Napkin-Studio/napkin-os, branch develop at commit cb61991 (9 Nov 2026), read 10 Nov 2026:

- [README.md](https://github.com/Napkin-Studio/napkin-os/blob/develop/README.md): CLAN and Napkin Studio OS
- [CLAUDE.md](https://github.com/Napkin-Studio/napkin-os/blob/develop/CLAUDE.md): the workflow, checks, git rules and infra rule
- [spec/CLAN-SPEC.md](https://github.com/Napkin-Studio/napkin-os/blob/develop/spec/CLAN-SPEC.md): the CLAN format
- [features/README.md](https://github.com/Napkin-Studio/napkin-os/blob/develop/features/README.md): feature records
- [napkin-studio.clan](https://github.com/Napkin-Studio/napkin-os/blob/develop/napkin-studio.clan), [foundation-spec.clan](https://github.com/Napkin-Studio/napkin-os/blob/develop/foundation-spec.clan), [judgement-architecture.clan](https://github.com/Napkin-Studio/napkin-os/blob/develop/judgement-architecture.clan) and [napkin-studio-os.clan](https://github.com/Napkin-Studio/napkin-os/blob/develop/napkin-studio-os.clan): project and architecture records
- [docs/contracts/os-layer.md](https://github.com/Napkin-Studio/napkin-os/blob/develop/docs/contracts/os-layer.md), [middleware-api.md](https://github.com/Napkin-Studio/napkin-os/blob/develop/docs/contracts/middleware-api.md), [peripherals.md](https://github.com/Napkin-Studio/napkin-os/blob/develop/docs/contracts/peripherals.md), [clan-fields.md](https://github.com/Napkin-Studio/napkin-os/blob/develop/docs/contracts/clan-fields.md) and [campaign-clan.md](https://github.com/Napkin-Studio/napkin-os/blob/develop/docs/contracts/campaign-clan.md): the contracts
- [app/templates/EXPORT-CONTRACT.md](https://github.com/Napkin-Studio/napkin-os/blob/develop/app/templates/EXPORT-CONTRACT.md) and the templates [brief-maker](https://github.com/Napkin-Studio/napkin-os/blob/develop/app/templates/brief-maker/context.md), [campaign-research](https://github.com/Napkin-Studio/napkin-os/blob/develop/app/templates/campaign-research/context.md), [deck-maker](https://github.com/Napkin-Studio/napkin-os/blob/develop/app/templates/deck-maker/context.md) and [advertising-studio](https://github.com/Napkin-Studio/napkin-os/blob/develop/app/templates/advertising-studio/context.md)
- [engine/README.md](https://github.com/Napkin-Studio/napkin-os/blob/develop/engine/README.md), [engine/parse\_brief.py](https://github.com/Napkin-Studio/napkin-os/blob/develop/engine/parse_brief.py) (the BetterBriefs scorecard) and [engine/ingest\_cannes.py](https://github.com/Napkin-Studio/napkin-os/blob/develop/engine/ingest_cannes.py)
- [server/model-routes.example.json](https://github.com/Napkin-Studio/napkin-os/blob/develop/server/model-routes.example.json) and [infra/README.md](https://github.com/Napkin-Studio/napkin-os/blob/develop/infra/README.md)
- [scripts/check.sh](https://github.com/Napkin-Studio/napkin-os/blob/develop/scripts/check.sh) and [app/e2e/README.md](https://github.com/Napkin-Studio/napkin-os/blob/develop/app/e2e/README.md)
