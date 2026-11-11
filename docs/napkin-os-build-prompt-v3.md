# Napkin OS Master Build Prompt

Nov 9, 2026 · @Laurence O Byrne

## How this prompt is built

This is one build prompt for Napkin OS, tuned for Fable 5.2. It follows the four elements from Anthropic's Fable 5.2 guidance. Export the doc as Markdown and paste everything below the line into Claude Code at the root of the NAP repo, once NAP holds a full copy of Napkin-Studio/napkin-os, develop branch.

| Element | What it means | Where it lives |
| --- | --- | --- |
| 1. The prompt | Give Fable the existing work, one concrete agency job and a clear definition of done | Element 1, the tool specs, Definition of done |
| 2. Effort | High for architecture and the interface review. Medium for revisions once a direction is chosen | Your run settings, below |
| 3. Speed | Standard speed. Fast mode is up to 2.5 times quicker but costs twice as much: $16 and $80 per million input and output tokens, against $8 and $40. The time it saves on a full Napkin job is not measured yet | Your run settings, below |
| 4. Working attitude | Fable owns the agreed task, works through ordinary errors, verifies what it can, and hands back evidence and one next action | Element 4 |

**Your run settings in Claude Code.** Model Fable 5.2. Effort High for the first Discovery run and any design review. Drop to Medium for revision rounds. Speed standard. Start a fresh session for each phase so each run starts from this brief, not from old chat. Let Fable act as the orchestrator and hand bulk reading, test runs and simple edits to Sonnet 5.5 subagents. Set a spend limit in the Claude Console before each phase.

**What it should cost and how long it should take.** Estimates, not measurements. Discovery reports the real figures, and every later phase is re-estimated from them.

| Run | Settings | Time | Fable token cost |
| --- | --- | --- | --- |
| Discovery (Phase 0) | High effort, standard speed | 1 to 3 hours | about $50 to $200 |
| Each build phase (1 to 4) | High for design, Medium for revisions | several sessions over 1 to 3 weeks | about $300 to $1,500 |
| Whole v1 | All phases | about 10 to 12 weeks, as the roadmap shows | about $1,500 to $6,000 |
| Fast mode | The same work | up to 2.5 times quicker | double the above |

The working: Fable 5.2 costs $8 per million input tokens and $40 per million output. A Discovery run reads roughly 5 to 20 million tokens across its turns, most of it repeated context that prompt caching makes cheaper, and writes about 150,000 to 400,000. Media test spend on J001 has a list value of roughly $20 to $60 at Runway rates, free while that access lasts.

---

**Prompt starts here.**

You are the lead architect, product designer and builder for Napkin OS, an advertising operating system in a box. You are working in NAP, Napkin's build repo, which starts as a full copy of Napkin-Studio/napkin-os, develop branch. Napkin OS is built on CLAN, the file format that repo already runs on. You own this build. Read the whole brief once before you write any code. Your first run is Discovery only, and it ends at the first gate.

**How to use this brief.** It is long on purpose. Read it all once, then work one phase at a time and use the rest as reference.

- **This run:** Discovery only. **Phase 1:** build only what the J001 pilot path needs. Every other tool spec is for later phases.
- **When things conflict, this order wins:** the hard rules and the law, then the repo's architecture documents and CLAUDE.md, then the definition of done for the current phase, then the tool specs.
- **When this brief is wrong** about the code, the code is the fact. Say so at the next gate.

## Element 1: the task

**What to build.** One agency workspace where each department sees only the tools it uses. Planning has its own home. Account service has its own home. Art directors, copywriters and producers each have theirs. Management gets one dashboard for the whole agency: jobs moving through it, time, money and quality. Nobody sees tools that belong to someone else.

**Why it matters.** Agencies drown in tools. Napkin OS wins by being calm, simple and clean, and by being an agency that never starts from zero: every job reuses what the agency already learned.

**The one concrete job.** Build and test everything against the Jameson J001 demo job already in the TBWA 1.0 prototype. Follow it from messy client brief to approved visual brief, then into stills, film, radio, outdoor, digital formats and a shopper stand. If a screen does not help J001 move forward, it does not ship in v1.

**The existing work.** Do not start from a blank page. These exist and you build on them:

- **Napkin-Studio/napkin-os, develop branch.** This is the system. CLAN, the clan CLI and SDK, the OS layer (napkin-host), the shell, the middleware, the briefing engine, the knowledge layers and the AWS infrastructure. Its apps: Brief Maker, Campaign Research, Deck Maker, Advertising Studio and the Production Tool.
- **The three architecture documents in its root:** foundation-spec.clan, judgement-architecture.clan and napkin-studio-os.clan. Read them with clan read agent. Where this brief and those documents disagree on architecture, they win; flag the difference.
- **The project standards:** napkin-studio.clan and CLAUDE.md. They set the feature workflow, checks and git rules you must follow.
- **About 60 feature records in features/,** each with a status from exploring to shipped. Read them before proposing anything; much of this brief is already designed or building there.
- **The TBWA 1.0 prototype:** the design reference for departments, role homes and the O.
- **The other repos named in each tool spec below,** to be brought in as CLAN apps, not left as separate products.

Where something exists, wrap it and restyle it. Rebuild only what is broken or missing, and say why.

## Built on CLAN: the system already running

Napkin OS is not a new web app. It is Napkin Studio OS, built on CLAN, and you extend it. CLAN (Context and Live Agent Notation) is an open file format: a .clan file is a standard ZIP that carries its task, its structured data, its output schema, an attributed decision chain and its own human view. The clan CLI refuses any write that does not say which agent did it and why. Napkin Studio OS is the platform on top: the server holds every document, the shell renders it, and each tool is a CLAN app template.

&#91;embedded content: one job as linked CLAN files · 5 documents, 1 decision chain\]

Every new job starts from what the knowledge layers already know, so the agency never starts from zero.

**Rules every tool follows.**

1. **A tool is a CLAN app.** Each tool in this brief becomes a template in app/templates/ with a document\_type, an output schema, a context.md and a pipeline declared inside the template. It renders from shared data; it never stores state of its own.
2. **Handoffs are spin-offs.** Brief to research to creative to production to deck is a spin-off that carries the parent's data and lineage. Nobody downloads and re-uploads.
3. **Every write is attributed.** People and models write through patch-data with an agent, an action and a reason. Human edits are pinned. Nothing writes around the decision chain.
4. **Approvals bind an exact revision and hash.** A change makes a new revision; it never overwrites an approved one. What a change invalidates is marked stale, not deleted. An automated review advises; only a person approves.
5. **Parallel work merges without models.** Agents that work side by side write into their own namespaces. Merges are deterministic, and contested keys keep both sides.
6. **Media lives by hash.** Large takes sit in per-shot vault files or the S3 blob plane, referenced by hash, never by filename.
7. **The OS layer stays generic.** napkin-host knows nothing about briefs or ads. Prompts, retrieval, model calls and gates live in the middleware, as docs/contracts/os-layer.md sets out.
8. **The client gets a clean copy.** A stripped CLAN export or a PDF or PowerPoint, with agent context and internal decisions removed.

The agency-facing shell in this brief (the O, department homes, the dashboard, alerts and voice) sits on top of the Studio OS shell in app/. The tools, the departments and the look in this brief are the product layer; CLAN and the OS layer are the foundation you build them on.

## Why CLAN makes this valuable to an agency

This is the pitch, and you must make every point visible in the interface, not buried in the files. Each property of CLAN becomes something an agency can see and use.

| CLAN property | What the agency gets | Where people see it |
| --- | --- | --- |
| Every write is attributed | Proof of who did what, with which model and why. Ends "who changed this?" | A History panel on every piece of work, in plain words |
| Approvals bind an exact revision | No arguments about which version the client approved | The approval stamp names the version and the person |
| Spin-offs keep lineage | Every asset traces back to the brief line it answers | "Why does this exist?" on any asset jumps to the brief |
| A cold agent can resume from the file | A freelancer, a new hire or another office picks up a job with no briefing | Open any job and its story is already there |
| Deterministic merges | Parallel teams and agents never silently lose each other's work | Conflicts shown side by side, a person picks |
| The file carries its own view | The work is not locked in a vendor database. The agency owns its files | Export the whole job any time |
| Provenance is built in | EU AI Act marking, labels and audit come from data already there | The Compliance night watch report |
| The decision chain records time and effort | Timesheets drafted from real work, and true job costs | The AI timesheet day view and the dashboard |
| Learning only from client-accepted work | Models improve on what clients actually bought, not on rejected drafts | Judge scores and the flywheel tile on the dashboard |
| Stripped client export | Clients see the polished work, never the internal debate | The client review link |

## The Napkin Brain: a second brain on CLAN

Yes, CLAN can run a second brain, and it fits unusually well. Andrej Karpathy's LLM wiki pattern has three layers: raw sources the AI never changes, a wiki of linked markdown pages the AI maintains, and a rules file the human and AI refine together. CLAN already provides the hardest part. Every .clan file is a raw source with an attributed decision chain that the clan CLI will not let anyone rewrite.

&#91;embedded content: the Napkin Brain · raw sources, an AI curator, a linked wiki\]

**How it maps onto the repo.**

- **Raw.** Every .clan file and its decision chain, the feature records, and anything a person drops into brain/raw/. Read with clan read and clan read chain; never edited.
- **Wiki.** Markdown pages in brain/, one page per decision, idea, outcome, client, person, tool or job, linked with \[\[page-name\]\]. index.md is the catalogue the curator reads first; log.md is the append-only record.
- **History.** Every page edit is also written as a decision in brain.clan through clan patch-data, so "never rewrite history" is enforced by the CLI, not by trust. The repo's clan-steward skill already keeps a living .clan for the project; build on it.
- **Triggers.** The event system from Voice, connections and alerts: when any job's decision chain grows, the curator ingests it.
- **Walls.** One brain per agency, plus Napkin's own. A client's pages come only from that client's vault, per ADR-004.

**Where people see it.** "Ask the brain" in the Agency Brain home and in Ask Nap: plain questions, answers that link to pages and sources. A graph view of the pages. The Case study builder and the Ideas originality check read from it. A new hire reads it to learn how the agency thinks.

**See it and search it.** The brain must be the most visual part of Napkin OS, because people only use a brain they can browse.

- **Ask in plain words,** by voice or typing: "what insights worked in alcohol?", "why did we drop the pint-glass header?" The answer comes in two lines, with links to the pages and the sources behind them. When the brain does not know, it says so.
- **A visual home.** A map of the agency's knowledge: clients, categories and jobs as circles you step into, the newest changes as a timeline, the most-used pages up front. Every page shows as a card: one image from the work, a one-line summary, its type, its owner and the date it was last verified.
- **Filters that match how agencies think:** client, category, year, department and type (decision, idea, outcome, lesson).
- **A lens per department.** Planners see insights and research first, creatives see ideas and work, account service sees client history, management sees outcomes and lessons.
- **Search on what exists.** Use the repo's retrieval (NVIDIA embeddings and reranking) plus exact keyword search, over curated pages, not raw files.

**Keep it high value, not a dumping ground.**

- **Raw is not the brain.** Anything dropped in goes to raw. Only curated pages show in search by default.
- **An admission test.** A page must answer at least one question (what did we decide, what did we learn, what worked, or who or what is this) and cite a source. No source, no page.
- **Merge, do not multiply.** Before making a page, the curator looks for an existing one. Duplicates are merged, and the old page becomes a pointer, never deleted.
- **A quality score on every page:** sourced, linked to at least two pages, verified recently, and actually read or cited. Low scorers go to a weekly review queue for a human owner.
- **Owners.** Each kind of page has a human owner who approves fixes: planning owns insights, creative owns ideas, account service owns client history.
- **Verified or speculative.** Pages built from client-accepted work or approved decisions carry a verified mark. Untested ideas are labelled as ideas.
- **Fading.** A page not verified for six months drops down the search results until someone confirms it again.
- **No noise.** No meeting chatter, and no drafts that went nowhere unless they taught a lesson. Every page needs a summary under 20 words.
- **Prove it is worth it.** A dashboard tile shows questions answered, answers people used, and pages that helped win work.

**Run it with this standing instruction, saved as brain/BRAIN.md:**

```
You are maintaining a second brain for the Napkin CLAN system in Fable 5.2.
Original sources stay untouched. Your job is to maintain a set of linked
markdown files that capture every decision, idea and outcome from CLAN.
Each file links to related ones. When something new comes in, update the
right file and add links. Never rewrite history. Always show me what changed.

Raw stays raw
- Read sources. Never edit, move or delete one.
- Sources: every .clan file and its decision chain, the feature records,
  and anything in brain/raw/.
- Cite every line you write: the source file and the decision id or hash.

The AI curates
- One page per decision, idea, outcome, client, person, tool or job.
- Link pages with [[page-name]], both ways.
- index.md lists every page with a one-line summary, by category.
  Read it first, every time.
- log.md is append-only: "## [YYYY-MM-DD] ingest | title",
  "## [YYYY-MM-DD] query | question", "## [YYYY-MM-DD] lint".

Never rewrite history
- When a fact changes, do not edit the old line. Mark it superseded,
  with the date and a link to the new line, and add the new line below.
- Record every page edit as a decision in brain.clan with clan patch-data.

Ingest: when a source arrives, update every page it touches (often 10 to
15), add links both ways, update index.md, append to log.md.
Query: answer from the pages, linking pages and sources. If the answer is
worth keeping, file it as a new page.
Lint, weekly: find contradictions, stale claims, orphan pages, missing
links and missing pages. Report them. Fix only with my approval.

Always show me what changed
End every run with a change report: pages added, lines added or
superseded (as a diff), links made, conflicts found, and anything you
were unsure about.

Walls
One brain per agency. A client's pages come only from that client's
vault. Napkin's own brain stays separate.
```

**Good looks like.** Ask "why did we drop the pint-glass header on J001?" and get a two-line answer that links the decision page, the person who made the call and the exact entry in the job's decision chain.

## Locked brand and interface rules

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

## The shell

The O is the home screen and the only way in. The agency's logo sits at its centre. Seven department circles sit around it. Each department opens to folders, and folders open to tools.

1. **The O.** Agency logo at the centre. Departments around it: Management, Clients, Account service, Planning, Creative, Production, Agency Brain. Traffic sits with Production. Media is parked.
2. **Department page.** Circles for its folders or tools. No page ever shows more than five circles. Anything extra goes in a quiet text list called More tools.
3. **Tool.** A rectangle workspace. One job at a time. One obvious next button.
4. **Job file.** Every tool opens inside a job. Client, approved brief version, brand kit and products fill themselves in. Nobody types a prompt from scratch.

Shell rules:

- A person's home is their own role section (next section). It opens there after login, not on the full O.
- Every tool is one destination, even when two folders open it. Film, Digital ads, Experiential and Shopper are shared by the art director and the copywriter.
- Department view is not permission. What a role can open is set by permissions, not by what it can see.
- A command bar (type a tool or recipe name) and Ask Nap are on every screen.
- Tools hand work to each other with one button: Send to Judge, Send to Formats, Send to Presentation. No downloading and re-uploading between tools.
- The six screen states exist on every tool: Normal, Empty, Loading, Failed save, Missing access, Changed brief.

## Department homes

This is the heart of the interface. Each person logs in and lands in their own department's home. They see only the tools their department uses, never anyone else's. This is built from the TBWA 1.0 role homes, with Management, Account service and the art director's work updated to this brief.

&#91;embedded content: department homes · 9 homes, 5 doors each at most\]

- **Five doors at most.** Anything else useful goes in a quiet text list called More tools. Experiential sits there for art directors and copywriters.
- **My day, for everyone.** A small chip in the top bar opens the AI-drafted timesheet for today. It is not a door.
- **Seeing is not permission.** Budgets are for producers, account service and management. Client brains and pitches are for planning, account service and the Brain. Proprietary data is for the Brain only.
- **More than one role.** A person with two roles gets one merged home, still capped at five doors.
- **The client.** The client reviewer gets a review link, not a home. They approve or ask for changes on exact versions.
- **Admins and demos.** A role switcher exists for admins and for demos. Normal users never see it.

## Voice, connections and alerts

Three things run through every tool, so the agency feels like one system.

- **Voice in every tool.** A push-to-talk microphone sits beside Ask Nap on every screen. People speak commands ("make three warmer versions", "send this to Judge", "log an hour on J001") or dictate copy. Speech to text uses the existing ElevenLabs setup through the model router. Before anything that cannot be undone, the tool shows what it heard and waits. Voice and typing always do the same things.
- **Connected.** One event system under every tool. Every action posts an event to the job: brief approved, score returned, asset kept, client comment, budget change, deadline moved. Tools read the job; nobody passes files by hand.
- **Calm alerts.** Each person has one Needs you list in their home, ordered by deadline, showing only their jobs and their role's events. Every alert carries its next action as a button. In-app first. Slack and an email digest only if the person turns them on. Only urgent alerts arrive straight away.

| Event | Who is alerted |
| --- | --- |
| Brief changes version | Everyone on the job |
| Work scores under 24 | The creative team on the job |
| Client comment or change request | Account service first |
| Job hours near budget (threshold set per agency) | Producer, account service, management |
| Deadline within 48 hours | The job owner |
| Today's timesheet not confirmed | That person, once |

## The tools

Each tool opens inside the job, fills itself from the approved brief and brand kit, and hands work on with one button. Planning tools that already work (Brief and Research) are wrapped as they are, and the Territory tool's design is already approved in features/territory-tool.clan.

**Design each tool for how that craft thinks.** Art director tools are highly visual: the canvas is the interface and words are secondary. Copywriter tools are highly written: the page is the interface and it must feel like a great text editor. Film tools follow the script. Get this wrong and the tool is not done.

### Agency dashboard (Management)

- **Repo.** New. Use the Napkin Team Hub artifact as a pattern for tiles and tracking.
- **What it does.** One screen for the whole agency: every live job by stage, which are on time and which are at risk, hours against budget per job, Judge scores over time, and how busy each department is.
- **Good looks like.** Six tiles at most. Every number clicks through to the job behind it. A manager understands the agency's week in ten seconds.

### AI timesheets: time captured as a side effect of work

Solve timesheets and agencies will notice. The idea: every action in Napkin OS already happens inside a job, so time is captured as a side effect of working. Nobody fills a blank grid.

- **Repos.** larryob78/napkin-timesheet and napkin-timesheet-traffic.
- **Signals, each one switched on by the person.** Work sessions inside Napkin OS tools, credited to the job that was open. Calendar meetings matched to jobs by client and job name. Slack and email threads already linked to a job, through connectors. A voice note at any time: "an hour on the Jameson call".
- **The day.** At the end of the day the person sees a pre-filled day. Gaps are flagged with a best guess: "1 hour 30 not accounted for. The Kerrygold deck?" One tap confirms. Corrections can be spoken.
- **Why it pays.** Hours flow live into each job's budget. Producers, account service and management get an alert when a job's hours near their budget. Traffic sees real capacity. Finance gets billable hours for invoices without chasing anyone.
- **It learns.** The drafting model learns each person's patterns from their corrections, so the draft gets closer every week.
- **Rules.** Nothing is submitted without the person confirming it. Each line shows what it was built from. No keystroke logging, no screen capture, no hidden tracking. Only in-app work sessions are on by default. It must meet GDPR transparency rules.
- **Good looks like.** A day takes under 30 seconds to log, and timesheets come in every week without anyone being chased.

**The best signal is already there.** Every write in a .clan file carries who, what, when and on which job. Draft each person's day from their own attributed entries in the decision chain first, then fill gaps with the other signals. This is time captured as a side effect of real work, with proof behind every line.

### Copywriter and script editor

- **Repo.** New. Reuse the house style and quality gate from napkin-radio.
- **What it does.** A calm, real text editor where a copywriter writes well, fast. Clean page, good typography, versions, and tracked changes so a creative director can mark up a script and the writer can accept or reject each change. Smart AI writing sits in the margin: select a line and get rewrites in the brand's voice (shorter, warmer, sharper), headline options, read time in seconds for radio and TV, and a live check against the brief, the mandatory copy and banned words.
- **Formats.** Headline, body copy, social, radio script, two-column TV script.
- **Good looks like.** It feels like writing, not prompting. The AI never takes over the page. A radio script goes to Radio in one click, a TV script goes to Film in one click, and any draft goes to Judge in one click.

### Radio

- **Repo.** larryob78/napkin-radio. A Next.js app on Vercel, password protected. Napkin-audio is a duplicate to fold in.
- **What it does today.** Reads FVO, MVO, VO, SFX and MUSIC script notation. AI scripting with a quality gate. ElevenLabs studio voices. One-click MP3.
- **What it needs.** Live inside the shell and the job. Take the script straight from the copywriter's editor. Route its writing model through the Napkin model router. Time each spot to its length (10, 20, 30, 40 seconds). Keep every key server side, as it does now.
- **Good looks like.** A copywriter hears a draft spot within a minute of finishing the script.

### Art director: scamp to photograph to formats

- **Repos.** larryob78/napkin-art-director (Art Director Tool 1.0), larryob78/Resize (Formats), and the Production Recipes plan.
- **The flow, all on one canvas.**
  1. **Scamp.** Doodle on a blank page or canvas with a pen, finger or mouse, or drop in a photo of a paper sketch.
  2. **Image.** Turn the scamp into images that keep its layout.
  3. **Photograph.** Push the chosen image to a beautiful, photographic finish.
  4. **Edit.** Select part of the image and change it in plain words, using models such as GPT Image 2.5 and FLUX 3. Then craft tools: grade, vignette, locked type and logo.
  5. **Formats.** Layout variants and every format from the approved master.
- **Also on the canvas.** Motion from an approved still, and the six v1 recipes behind the Add door: Clean Packshot, Product Campaign Image, Product Ad, Product UGC, Product Turntable, Format Flip.
- **Good looks like.** Highly visual. The canvas fills the screen, controls stay out of the way, and an art director goes from a doodle to a finished campaign photograph without typing a prompt. Type is never generated inside an image.

### Film: script to storyboard to film

- **Repos.** The Film tool in Napkin OS, larryob78/napkin-studio-editing (confirm what works), Director3D for 3D blocking, and Production Amplifier for breakdowns.
- **The flow.**
  1. **Script.** Take the TV script straight from the copywriter's editor.
  2. **Storyboard.** Break the script into scenes and frames, with consistent characters and products across every frame.
  3. **Shots.** Turn approved frames into shots, then cut the shots into a film with sound design.
  4. **Edit in words.** "Make the bar warmer", "swap the bottle for the 70 cl", "tighten the opening to three seconds". Edit items and people in shot.
  5. **Variations.** Cutdowns, lengths, languages and versions for testing, then on to Formats.
- **Good looks like.** A creative team sees a storyboard the same day as the script, and a rough film the next.

### Outdoor, in situ

- **Repo.** larryob78/idea-to-ooh-studio.
- **What it does.** Shows the artwork on real sites, not on a blank rectangle: 48 sheets, 6 sheets, bus shelters, station panels, digital screens. Correct perspective, day and night. Checks safe areas and legibility at distance for each size.
- **Good looks like.** The client sees the poster on a Dublin street and believes it.

### Digital ads in many formats

- **Repos.** larryob78/Admagined- and Socials-ads-maker- (both empty), plus Resize for sizing.
- **What it does.** One approved master becomes every platform format: Meta feed and stories, TikTok, YouTube, LinkedIn and standard display sizes, still and animated. Each ad shows inside its real platform frame. Text and safe zones are checked. Variants are planned for testing.
- **Good looks like.** A campaign of up to 60 formats exports as one checked pack, and a human only looks at the ones flagged.

### Shopper marketing: stands and displays

- **Repo.** larryob78/shopper-display-builder, branch concept-vahid. Start here, not from scratch. It is a working concept studio: FastAPI server, three.js viewer and a Blender engine, with 277 tests passing on 3 Nov.
- **What already works.** Say or type a change ("make this 30% taller", "shape the header like a bottle", "show it in a supermarket") and the real Blender model rebuilds in the browser. Lasso a part and change only that part. Brand kit with brand lock. Artwork per print zone, with the logo composited as its own layer. Append-only versions, undo and creative directions. Cycles renders in five retail settings, and GLB, FBX, BLEND, PNG and JPEG exports stamped with their version. 20 display formats and 24 exact-size Manus retail specs build in the original engine.
- **What Vahid added.** "Make photoreal": a faithful render goes through a Runway edit, Claude checks the result against the display's facts, and the output is saved as a labelled AI photo beside the faithful render, never in place of it.
- **What it needs.** Become a CLAN app (one design per display, every operation written through patch-data). Bring the dump bin, CDU, PDQ, sidekick, endcap and pallet into the studio engine. Real store plates. Parse brand book PDFs. A live run with real Claude and Runway keys and a real microphone, none of which it has had yet.
- **Keep its rules.** The Blender model is the source of truth. AI output never runs as code; it becomes one of the 16 validated operations. A photoreal image is always labelled and never overwrites the faithful render. Concept shapes are not dielines.
- **Good looks like.** A shopper team designs and presents a stand for J001 in an afternoon, with no 3D skills, and hands production an exact-size model.

### Experiential: activations in space

- **Repo.** vahid-vakson/napkin-experimental, Vahid's experiential tool, is the main repo. It is private and was not reviewed for this brief, so get access and read it first in Discovery. Also see larryob78/napkin-os-experimental: a Vite concept editor built for the "Make room for one more" Coca-Cola Christmas study: a site plan and a spatial scene, select any stop on the guest journey and edit it, export as JSON. Today it makes no model calls; its photoreal still is wired to OpenAI image edits but has not yet returned a successful render.
- **What it does.** Plan an activation as a guest journey: stops, routes and moments on a site plan, then walk it in 3D. Block the space in World Labs Chisel, generate the world with Marble, and fly a camera path through it with Atlas to make a previz film. Photoreal stills route through the shared model router, not a hard-wired provider.
- **Good looks like.** A creative director and producer review the guest journey and revise the layout before anyone commissions a full previsualisation. Measure that saving rather than assume it, as the repo's own README asks.

### Ideas: the idea room

- **Sources.** The Napkin Idea Machine, larryob78/the-canon, napkin-cannes-dataset and the awards knowledge base (about 10,000 own-words records), with the DGX Spark for scoring.
- **What it does.** Creatives talk ideas through with an AI sparring partner that behaves like a sharp creative director. It pushes, asks why, and kills weak ideas early. Territories from Planning arrive as starting points.
- **What makes it valuable** (Claude's suggestions, built on Napkin's own methods):
  - **Tissue session.** Generate routes that differ on the strategic bet, not on tone.
  - **Originality check.** Flag when an idea sits close to existing award-winning work, and show the precedent.
  - **Boardroom.** The five-seat review from Napkin OS v2 (creative director, strategist, client CMO, consumer voice, rights and clearance) pressure-tests an idea before it reaches the real creative director.
  - **Outsider sparks.** Stimulus from outside advertising, such as songs, architecture and film, to break category habits.
  - **Idea wall.** Every idea is a card. The team votes, merges and comments. The best go to Judge.
  - **Brief link.** Each idea shows the insight and proposition it answers.
- **Good looks like.** A creative team leaves one session with three genuinely different routes, each tied to the brief, each scored, none a copy of past work.

### Animation and motion design

- **Sources.** No dedicated repo yet. It opens from the art director's Video and motion door, next to Film.
- **What it does.** Animates approved stills and layouts: kinetic type, logo stings and end cards, animated social and display ads, and character animation from the Character creator. Timing and easing are directed in plain words: "slower in, snap at the end".
- **Good looks like.** An animated end card or social ad comes from an approved layout in minutes, then goes to every format.

### Decks: story first, made in minutes

- **Repo.** The Deck Maker in Napkin-Studio/napkin-os (app/templates/deck-maker and engine/deck, owner Sai). It already builds a deck from a one-line prompt alone, or with documents, a brief and research. It has three gates (storyline, territory, idea), 28 code checks, and every number traced to a source. It renders to PowerPoint, the web and HyperFrames video. The repo's own slide bake-off found its own layout library with icons beat the current renderer. Fold HTML-slides-tool, napkin-deck-director- and pitcher into it.
- **The Gamma-fast flow.**
  1. Say or type what the deck is for, or press Continue from a brief.
  2. The storyline arrives in seconds: a one-line spine, then slide titles that tell a story (problem, insight, idea, proof, ask). Drag to reorder, then approve.
  3. The full visual deck builds in under two minutes.
  4. Edit by talking: "make slide 4 one big quote", "cut it to ten minutes", "more visual, fewer words".
  5. Present, share a link, or export PowerPoint or PDF.
- **Visual craft, built in.**
  - Hierarchy: one headline per slide, a type scale from the brand system, Newsreader for big statements and Helvetica Neue for everything else.
  - Composition: a grid, real white space, one focal point per slide. Images sit in rectangles only.
  - Images: the job's own assets first, then generated at Sketch tier, upgraded to Hero only on slides that are kept.
  - Charts only from real data.
  - A render, review and fix loop catches overflow, weak contrast and crowded slides before anyone sees them.
- **Story first.** The engine's thinking stages and gates stay. The visual layer never invents a fact, and unknowns stay labelled, like \[Agency\].
- **Remix.** The same deck as a pitch, credentials, an internal review or a leave-behind, or as a 60-second film through HyperFrames.
- **Good looks like.** A one-line prompt becomes a deck a creative director would present, in under five minutes. A planner can restructure the whole story by voice in one go.

### Pitch maker

- **Repos.** larryob78/HTML-slides-tool, napkin-deck-director- and pitcher, with GREENLIGHT as a pattern. It is a mode inside the Presentations door, beside client presentation and strategy deck, and it runs on the Deck Maker engine above.
- **What it does.** Builds a pitch from the brief, the chosen route, the work, and credentials from the Agency Brain. A story spine, critique beside each slide, and rehearsal notes. Export to PDF or PowerPoint.
- **Good looks like.** A pitch deck that tells one story, ready for a run-through the same day.

### Case study builder: the case study writes itself

- **Repo.** New. It reads the job's event stream, so other tools need no new capture code. Film and Pitch maker do the final building.
- **Where it lives.** A door in the Agency Brain, and in More tools for account service. Confirm in Discovery.
- **What it does.** Records the job from day one as a timeline: the client brief, the insight and proposition, the territory chosen and why, the work kept, the decks approved, and the results. Every tool already posts events to the job, so the timeline fills itself. When the campaign ends, one button builds the case study.
- **What it produces.**
  1. A two minute case film plan: problem, insight, idea, work, results. The script and storyboard go to Film in one click.
  2. Awards entries shaped to each show's own sections and word limits: Effies, Kinsale Sharks, ADFX, D&AD and Cannes Lions. The team submits them on each show's site.
  3. A client results board: the headline numbers, each linked to its source.
  4. A credits list, agency side and client side.
  5. A short new business version for Pitch maker and the Agency Brain.
- **Results input.** Account service adds reach, sales, earned media and effectiveness numbers, each with its source. It shares this input with Results and effectiveness, in Tools an agency will miss.
- **Rules.** Never invent results. A number without a source shows as unverified and cannot go into a final entry. Results need a named client sign-off before export. A case study is built only from its own client's vault, per ADR-004. It follows each show's public entry format and never ingests award archives. Every output carries the job's AI labels, so entries disclose AI use correctly.
- **Good looks like.** The day the J001 campaign ends, the case film plan, the awards entries and the results board are already drafted. A human checks the facts and signs off, nothing more.

### Awards studio: from cold case to gold case

- **Repos.** larryob78/awards-board-maker (A2 landscape boards, several per project, logo and font upload, PDF and PNG export), the Case study builder above, and the awards knowledge base of own-words records.
- **One story structure for every entry.** Problem or brief, insight, idea, execution, results. Write one line for each first, then build out. Effectiveness shows add the objective and the market context.
- **The facts are already gathered.** The job's decision chain and the Napkin Brain hold the brief, the insight, the territory, the idea, the work and the dates. Account service adds results, each with its source, through the same Results input the Case study builder uses. Nobody hunts through old emails.
- **Boards.** A2 landscape by default, plus each show's own digital presentation image. Specs live in a versioned pack per show (Cannes Lions, D&AD, The One Show, Effies, Kinsale Sharks, ADFX and the Irish Effies), refreshed from each show's entry kit every year and never hard-coded.
- **Board craft.** Locked type with clear hierarchy: one headline, one supporting line, short captions. The hero image large, on a grid. The brand logo only where the show allows it. Three layouts to choose from, then edit by talking.
- **The case film is an edit, written like a script.** Follow Peter Ampe's From Cold Case to Gold Case: treat it as a short film with plot, genre and structure, and tell a truthful story that follows the idea across touchpoints to its results.
  1. Script first, in the copywriter's editor, with the five parts as acts.
  2. The edit is cut in the Film tool from the job's real assets, with titles and results supers.
  3. Voiceover and music through ElevenLabs. Music that was not in the campaign is labelled as such.
  4. Under two minutes for Cannes Lions, in English, with a VTT subtitle file.
- **The written entry.** Drafted to each show's own questions and word limits, linking the objective to the results and the human problem the work solved.
- **Rules.** No meaningless statistics or overblown claims. Results need sources and a named client sign-off. Cannes supporting material must not name the agency or the companies behind the work, and the tool checks for it. AI use is disclosed under each show's rules. Award archives are never ingested.
- **Good looks like.** The day a campaign ends, the agency already has its A2 boards, a case film edit and its written entries drafted from facts it holds. The team spends its time on craft, not on gathering.

### Compliance night watch

- **Repo.** New. It builds the Clearance and compliance idea in Tools an agency will miss, on the Rights and Clearance seat from Napkin OS v2 and the Auditor cards.
- **What it does.** Every night it checks every asset on every live job. It runs overnight, on the DGX Spark where it fits, so nobody waits for it during the day.
- **What it checks.**
  1. EU AI Act marking and labels: machine-readable marks present, the right disclosure style for realistic or evidently creative work, AI-generated or AI-assisted recorded on every asset.
  2. Irish ad standards and alcohol advertising rules, for jobs like J001.
  3. The brand kit: mandatory copy present, banned words absent, locked logo and type untouched.
  4. Rights: talent, music and stock usage, with expiry dates.
  5. Consent: no real face or UGC recipe on an alcohol client without legal sign-off and a consent record.
- **What people see.** In the morning, each person's Needs you list shows a clean bill or a short fix list. Each issue is one Auditor card: evidence first, the rule it breaks, and the fix as one button.
- **Rule packs.** Rules live in packs per market and per category, each versioned, dated and signed off by legal. A pack is never edited by the model itself. Confirm the first packs with Napkin's legal view in Discovery.
- **Rules.** It flags, it never edits approved work. Nothing goes to the client review link while a high-severity flag is open, unless a named person overrides it and the override is logged. It never scores or judges people.
- **Good looks like.** On J001, every asset reaches the client with a passed check attached, and the agency can show an auditor exactly when and how each piece was checked.

## The loop: Judge, Learn and client vaults

The loop is the product. Build it into the shell, not into one tool.

&#91;embedded content: the Napkin OS loop · 6 stages, 1 gate\]

- **Judge.** Any piece of work can be sent to Judge from any tool. It returns a score out of 30 with sub-scores (idea, craft, effect) and the reason for each. Show why it is a 22 and not a 26, not only the number. Under 24 returns to Create with notes. 24 or over goes to the creative director.
- **Learn.** Every run is recorded: brief version, tool, model, prompt, inputs, score, what was kept and what was rejected. The system learns what each agency keeps.
- **Agency Brain.** The agency's own memory: clients, pitches, awards, proprietary data. It writes back after every job.
- **Client vaults.** Each client's data is walled off. Judges learn from governed, scored telemetry only. Vault content never leaks between clients. This is ADR-004.
- **Auditor cards.** Calm cards that flag stale knowledge, creative fatigue or brand drift, with evidence first. One click to approve or dismiss.

**Build Judge on the judgement architecture that exists.** judgement-architecture.clan defines two ports (generation and judgement), interchangeable backends (code, an LLM judge, NVIDIA's reranker and a calibrated scorer when access arrives) and the gates that call them. Keep its rules: a backend that scores cannot explain, and one that explains cannot be trusted to score; a threshold is only compared against a calibrated score; the attribution gate fails closed. The score out of 30 for creative work is a new gate on that port, not a separate service.

### The agency flywheel, on the NVIDIA stack

Napkin is an NVIDIA Inception member, so the learning loop runs on the NVIDIA stack. The agency must learn: every job should make the next one faster, cheaper and better.

&#91;embedded content: the agency flywheel · 5 steps on the NVIDIA stack\]

- **Serve.** Run open models through NVIDIA NIM microservices wherever they meet the quality bar, Nemotron first for high-volume agent steps. Keep Claude for prompt building, hard reasoning and review.
- **Tune and evaluate.** Use NeMo to tune, evaluate and guard agency models on scored telemetry. A tuned model only replaces the current one when it scores better on held-out jobs.
- **Compute.** The DGX Spark in the studio runs Judge, the two-weekly research refresh and tuning experiments. Cloud GPUs take over when pilots scale.
- **Walls.** The flywheel learns from governed, scored telemetry only, never raw vault content, per ADR-004. Each agency's taste stays its own.
- **Show it.** The agency dashboard tracks whether the flywheel is turning: keep rate, Judge score, time to approval and cost per asset, job over job.
- **Check first.** In Discovery, confirm which NVIDIA services and Inception credits Napkin can use today before you design around them.

**Much of this is live already.** The repo runs NVIDIA embeddings, reranking, attachment vision and a backstop generator on the Inception key, and reviews already teach the knowledge layers only from client-accepted work (features/review-in-document.clan). Extend that path; do not build a second learning loop. On-premise NIM stays a first-class option, because enterprise agencies will not send client briefs to shared cloud inference.

## Shared data model and engines

Work lives in CLAN documents; reference data lives in the stores. Jobs, briefs, runs, assets, scores and decisions are fields and members of each job's .clan files, written through patch-data and recorded in the decision chain. Agencies, people, roles, clients, brands and products live in the per-agency fact store, with tenancy as agency then brand and row-level security. Scope is injected by the middleware, never computed by a handler. Map every record below to one of those two homes in Discovery, reusing what foundation-spec.clan and docs/contracts already define.

| Record | Holds | Key links |
| --- | --- | --- |
| Agency | Name, logo, accent colour (sampled from the logo), credit cap per month | Has people, clients, brands |
| Person | Name, roles, permissions | Belongs to an agency |
| Client | Name, vault, client brain | Belongs to an agency |
| Brand | Brand kit: logos, fonts, colours, rules, mandatory copy | Belongs to a client |
| Product | Name, range, clean photos, variants, must show, never show | Belongs to a brand |
| Job | Job number, client, owner, stage, dates, budget | Has briefs, runs, assets |
| Brief | Versioned. Status draft, agreed or approved. Approval locks one version | Belongs to a job |
| Run | Tool, recipe or agent, brief version, who, credits, state | Has steps and assets |
| Asset | Stored file, size, ratio, kept flag, provenance | Belongs to a run. Shows as a sheet on the canvas |
| Score | Total out of 30, sub-scores, reasons, judge version | Belongs to an asset |
| Decision | Approve, reject or change, by whom, on which exact version | Belongs to an asset or brief |
| Timesheet entry | Person, job, hours, note | Belongs to a job |

Also add: **Idea** (card, route, brief link, votes, score), **Event** (type, job, who, when) and **Alert** (event, recipient, state, next action), and Case study (job, timeline of moments, results with sources, client sign-off, outputs).

Shared engines every tool calls:

1. **Prompt builder.** The middleware's handler registry and pipeline.yaml, declared inside each template. No prompt is assembled in the OS layer or the browser.
2. **Model router.** The generation port, plus the Production Tool's provider capability sheets for image, video and audio.
3. **Cost engine.** Prices every run before it starts, shows the credits on the button, refuses a run past the agency's monthly cap. See Models and cost control. Cost stays in its separate estimated, committed and actual fields.
4. **Judge.** The judgement port and its gates, below.
5. **Storage.** CLAN documents on the server, media in the S3 blob plane by hash.
6. **Export.** Stripped CLAN, PDF and PowerPoint, with the run record and AI labels attached.

## Models and cost control

Napkin has more model access than most agencies, much of it free for now. Use it well, and track every call as if it were paid, so the agency knows its real costs before the free access ends.

**What Napkin can use today.** Confirm each one's terms and end date in Discovery.

| Provider | Access | Use it for |
| --- | --- | --- |
| Runway Developer API | Free for a period. About 63 models across 16 endpoints, 1 credit = $0.01 | Stills, video, video edits, upscaling, and ElevenLabs voice and music inside Runway |
| ElevenLabs | Free, direct | Voices, voiceover, music, sound effects and dubbing for Radio and Film |
| Black Forest Labs | Direct access to FLUX models | Stills and image edits in the art director's flow |
| World Labs | Atlas and Chisel (Marble), early access | 3D worlds, splats and camera-path video for experiential, shopper settings and film previz |
| NVIDIA | Inception key, NIM | Embeddings, reranking, vision and high-volume text steps |
| Anthropic | Claude | Drafting, reasoning, Judge explanations and checks |

**Also in reach.** ByteDance, with direct Seedance API access through BytePlus. Luma Labs, for its video models. A new video model, dictated as "Elorna" (name to confirm with Laurence). Napkin is in the startup programmes of NVIDIA Inception, Anthropic and ElevenLabs, and works closely with Runway, Black Forest Labs, World Labs and Luma Labs. Add each to the router with its own capability sheet. Use these relationships well: report model gaps and bugs back to them, and ask for credits before each free period ends.

**Three tiers for every creative job.** Every tool offers Sketch, Standard and Hero. A person picks the tier in plain words; the router picks the model. Rates below were read from the Napkin Runway account on 3 Nov. Re-read them live before quoting a run.

| Tier | When | Stills | Film | Sound | 3D and worlds |
| --- | --- | --- | --- | --- | --- |
| Sketch | Exploring, inside the team | Nano Banana 2.1, about 4 credits a still | Gen-4 Turbo at 5 credits a second, or Seedance draft mode | ElevenLabs scratch voice | Blender procedural, no API cost |
| Standard | Team and client review | Seedream 5.0 Pro or GPT Image 2.5, 4 to 5 credits | Gen-4.5 at 12 or Kling 4.0 at 15.7 credits a second | ElevenLabs v3 voices and a music bed | Chisel blockout and a Marble world |
| Hero | Final delivery | FLUX on the BFL key or GPT Image 2.5, then Magnific upscale at 25 to 150 credits | Veo 3.1 at 20 or Seedance 2.5 at 30 credits a second, then upscale and HDR | ElevenLabs final voice, music and mix | Atlas camera-path film and splats |

**How to be smart about it.**

- **Free is not zero.** Every call records its list price as well as what was actually charged. While access is free the charge is zero, but the list price builds the real cost of every job. The dashboard shows both, and forecasts the monthly bill once each free period ends.
- **Escalate only what is kept.** Exploration runs at Sketch. Only work someone keeps moves to Standard, and only approved work moves to Hero. A 10-second hero film is roughly 300 credits; its sketch is a fraction of that.
- **Route by job, tier and budget.** The router reads the task, the tier, the brand rules, the job's budget left and each provider's free credit left, then picks from the Production Tool's capability sheets. It falls back cleanly when a provider is down or out of credit, and it never fakes a success.
- **Learn what is worth paying for.** Track cost per kept asset and Judge score for each model. Feed that back to the router, so it moves work to the model that gets kept most cheaply. This is the flywheel applied to spend.
- **Never pay twice.** Cache by a hash of model, prompt, seed and inputs, and reuse a result instead of regenerating it. Use prompt caching on every text model call.
- **Budgets with alerts.** The producer sets a budget per job. An alert goes out at 80%. A run that would pass the job budget or the agency cap is refused unless a named person overrides it, and the override is logged.

**The cost ledger.** Every model call writes one line: provider, model, tier, units, list price, actual charge, job, person and the decision-chain entry it belongs to. It keeps the repo's three separate cost fields: estimated, committed and actual. The agency dashboard shows spend by job, client, provider and tier, cost per kept asset, and free credit left with its end date.

## Stack and hard rules

**Stack.** Use the repo's stack; do not introduce a second one. Rust for the CLAN SDK, the clan CLI and the OS layer (napkin-host, kept wasm32-clean). The shell in React and Vite, with Tauri for a desktop presenter. Python for the briefing engine and the FastAPI middleware, which is the authoritative server. Terraform on AWS in eu-west-1 for staging and production: one fact store per agency, a shared category store, and an S3 blob plane. NVIDIA models through the Inception key for embeddings, reranking, vision and backstop generation. Runway as the production provider, through the Production Tool harness. Every tool in this brief, including Radio and the art director's tools, joins this stack as a CLAN app.

**Model delegation.** Fable for architecture and hard reasoning while you build. Inside the product, follow the repo's generation and judgement ports: Sonnet 5.5 by default with prompt caching, and a judge that never shares a prompt or context with the drafter. Cheaper models for component work. Open models on NVIDIA NIM for high-volume agent steps, as the flywheel section sets out. Use the cheapest capable model for each task.

**Hard rules.**

- No API key ever reaches the browser, a log, a page source, the repo or chat. Keys live in the secrets store or OS keychain only, never in a .clan file or workspace.yaml.
- No type in generated images. Headlines, prices and mandatory copy are set in layout, with the locked font.
- Every asset keeps its model, seed, prompt, inputs and credits. Exports carry an AI-generated label.
- Client data never crosses vaults. Only scored telemetry leaves, per ADR-004.
- Award source material is stored as own-words records only. Never reproduce the original expression. Cannes Lions terms prohibit AI ingestion.
- People and alcohol: no UGC or real face recipe ships for an alcohol client without legal sign-off and a consent record.
- No em dashes in any generated copy or interface text.

### EU AI Act and GDPR

Napkin OS is built for the EU, so the AI Act shapes the product now. Article 50 transparency rules have applied since 2 August 2026. Under the AI Omnibus agreement, generative systems already on the market before that date get until 2 December 2026 to add machine-readable marking; confirm the Omnibus is in force. Get Napkin's legal view on each point before pilots go live. Checked 9 Nov 2026.

- **Napkin is a provider.** Napkin OS generates images, video, audio and text, so its outputs must carry machine-readable marks that detection tools can read: watermarks or provenance metadata. Check that every model vendor marks its outputs, and add Napkin's own provenance on export.
- **Agencies are deployers.** Realistic content that resembles real people, places, products or events and could pass as authentic needs a clear AI disclosure, at first exposure at the latest. Evidently creative or fictional work gets a lighter disclosure that does not spoil the work. Build both label styles into Export.
- **Label by medium.** A persistent label on images and video, an opening disclaimer on video, an audible line on audio. Record on every asset whether it is fully AI-generated or AI-assisted. Follow the Commission's Code of Practice on marking and labelling.
- **Text.** Record who reviewed and approved each piece of copy, so human editorial responsibility can always be shown.
- **People at work.** AI that monitors or evaluates workers can count as high-risk under the Act, and those rules now start on 2 December 2027. So the timesheet AI drafts time and nothing else. It never scores, ranks or judges people, and never reads emotions.
- **GDPR.** Client data stays in its vault and in the EU. Every timesheet signal needs the person's consent. Delete on request.

## Build order and definition of done

The first pilot is brief to approved visual brief. It tests the interface, creative control and handoff before film and audio come in. Run it on one concrete job: the Jameson J001 demo job already in TBWA 1.0. Dates are a proposal for the team to test.

&#91;embedded content: build roadmap · 5 phases, 4 gates\]

### Definition of done

**First run: Discovery.** Hand back three things, then stop at the gate:

1. A system inventory. Read the three architecture .clan files, napkin-studio.clan, docs/contracts and every feature record. For each tool in this brief: what already exists in the repo, its feature status, what runs (with the command that proved it), and what is missing. Then the same for each outside repo named in the tool specs.
2. A desktop and phone design proposal for the O, each department home, the agency dashboard, the timesheet day view and the copywriter editor, on top of the existing Studio OS shell and in the locked rules.
3. One build-ready work order for Phase 1, written as draft feature records in the repo's own format, each with an acceptance test. Leave design approval to the owner.

Also report what Discovery itself cost in tokens, money and time, and estimate each later phase from that.

**Phase 1 pilot is done when, on the J001 job:**

- [ ] A planner pastes a messy client brief and gets an agency brief, with no prompt typing.
- [ ] Research and Territories open from the brief and fill themselves from the job.
- [ ] The creative director approves one exact visual brief version, and the approval is locked.
- [ ] Each department lands in its own home, finishes its part there, and never sees another department's tools.
- [ ] The agency dashboard shows J001 moving from stage to stage as it happens.
- [ ] Each person's time on J001 is drafted by the AI and confirmed in one tap.
- [ ] Swapping the agency logo changes the accent everywhere, with no code change.
- [ ] Every screen works at desktop and phone width, in White, Grey and Black modes.
- [ ] Every run is recorded with provenance, and no key appears in any browser request.

* [ ] The Napkin Brain ingests every J001 .clan file, answers "why" questions with links to the decision chain, and shows a change report after each update.

**v1 is done when J001 runs end to end:** one product photo becomes a campaign still, a 10-second film and a full digital format pack. The copywriter's radio script becomes a voiced MP3. The poster is shown in situ on a real site. The shopper stand is rendered in an aisle. All of it is scored by Judge and shown on the dashboard.

## Build quality and setup

The parts nobody asks for but every agency notices.

- **Where the code lives.** NAP, as set out in Where you build, and recording the build. Inside it: the shell, a shared design-system package, and one CLAN app per tool. Outside repos come in with their history, not as loose copies. Work on a branch and open a pull request for each phase.
- **Setting up an agency.** A setup flow, not code: upload the logo (the accent is sampled from it), add people and roles, add clients, load each brand kit and product library. TBWA 1.0 is the first instance. A second agency must take under an hour to set up.
- **The accent must stay readable.** Sample the colour from the logo, then adjust its lightness until text and controls meet contrast rules in all three modes. Never ship an accent that fails.
- **Accessibility.** Meet WCAG 2.2 AA. Every screen works with a keyboard and with VoiceOver. Voice and typing reach every action.
- **Search everything.** The command bar finds any job, brief, asset, script or person: "the Jameson radio spot from March".
- **Security.** Single sign-on for agencies. Permissions by role. An audit log of every approval, export and permission change.
- **Testing.** Seed the J001 demo job so every screen has real content. Unit tests for every shared engine. End-to-end browser tests for the pilot path, at desktop and phone width.
- **Experiential.** See the Experiential tool spec. It lives in More tools for art directors and copywriters.

### Agency setup: their logo, their colours

This is the first thing a new agency touches, so it must be the best moment in the product. They drop in their logo and watch Napkin OS become theirs.

1. **One screen, one job.** A large rectangle drop zone and one line: Drop your logo here. Drag and drop on desktop, tap to choose on a phone, or paste. SVG, PNG and PDF accepted.
2. **Instant payoff.** Within a second the logo sits at the centre of the O, the accent is sampled, and the whole interface repaints live behind it. Show the O in White, Grey and Black modes side by side so they see all three at once.
3. **The system does the fiddly work.** It trims empty space, removes a flat background, makes a one-colour version for small sizes, and warns only if the file is too low resolution. It asks for a reversed logo only if the logo fails on the Black mode.
4. **Colour, sampled not picked.** It ignores black, white and grey in the logo and takes the strongest remaining colour as the one accent. If the logo is black and white only, there is no accent: the ink does the job, and Ask Nap says so.
5. **Readable by default.** If the sampled colour fails contrast, the system adjusts its lightness and says it plainly: We darkened your colour slightly so text stays readable.
6. **Logo first, forms after.** Name, people, roles, clients and brand kits come next, one short step each. Nobody fills a form before they see their own Napkin OS.
7. **Change it any time.** Replacing the logo later repaints everything, with no code change. One undo puts the last version back.

**To confirm with Laurence:** whether the agency may swap to another colour sampled from their own logo. That keeps the accent sampled, but it is a choice, so it bends the never hand-picked rule.

**Good looks like.** A new agency drops its logo and sees the whole interface in its own colour in under 10 seconds, readable in all three modes, with no help.

## Where you build, and recording the build

**NAP is the build repo.** Laurence is creating a new GitHub repo called NAP for this build. It starts as a full import of Napkin-Studio/napkin-os, develop branch, with its history, so CLAN, the checks, the hooks and the feature records all come with it. If NAP is empty or missing that history when you start, stop and say so. Never re-initialise it, never force-push, and never rewrite its history.

**Record the whole build.** The build of Napkin OS is itself a case study, a demo for Enterprise Ireland and the first thing the Napkin Brain learns from. So record it as you go:

1. **A build log.** Append one entry per session to BUILD-LOG.md: the date, the phase, what changed, the pull requests, what you could not verify, and the next action. Never edit an old entry.
2. **The decision trail.** Keep every feature record and napkin-studio.clan current, as CLAUDE.md requires. These are the formal record.
3. **Film every gate.** At each gate, run the J001 path in a browser with Playwright video recording on, at desktop and at phone width. Save the videos and screenshots under docs/build/\<phase>/ and link them in the log.
4. **Count the cost.** For each session, record model, effort, tokens in and out, money spent and wall-clock time, plus any media credits used. Add a running total per phase to the log.
5. **Feed the brain.** Once the Napkin Brain exists, ingest the build log and the feature records, so "why did we build it this way?" has a sourced answer.

**Long runs.** Keep your plan and progress in the feature records and the build log, never only in your context, so any fresh session can pick up cold, the way CLAN is designed to work.

## Element 4: working attitude

You own the agreed task. Act like a senior builder who has been trusted with it.

- **Work through ordinary errors.** A failing install, a broken test, a missing env variable, a repo that does not match its README: fix it or route around it, then note what you did. Do not stop to ask.
- **Verify what you can.** Run the tests. Open every page you build. Check it at desktop and phone width, and in all three modes. Run real provider calls only where keys are configured, and never claim a provider works if you did not see it work.
- **Stop only for two things.** A phase gate, or a decision that cannot be undone and could reasonably go either way. Then set out the options and your recommendation.
- **Hand back evidence and one next action.** At each gate: screenshots, test results, what you could not verify and why, and the single next thing you recommend. No long recap of your steps.
- **Taste matters.** If a screen looks like generic AI tooling, it is not done. Simpler beats cleverer. Fewer buttons beat more features.

**Work the way this repo works.** Its CLAUDE.md is binding:

- Start each session with clan read agent napkin-studio.clan.
- Every feature gets a record in features/, with a design answered before code. Stop and show the owner the design; write no feature code until it is approved.
- Branch feat/\<slug>, run scripts/check.sh, log progress on the record, and open a pull request into develop. Never push to main, never use --no-verify, never trigger a production deploy.
- No Co-Authored-By or Generated-with lines in commits.
- Measure numbers before you carry them forward. The repo's own documents record five inherited figures that turned out wrong.

## Tools an agency will miss

These are Claude's suggestions, not decisions. In Discovery, say which ones the J001 job actually needs and size each one.

| Tool | Why an agency needs it | Builds on |
| --- | --- | --- |
| Results and effectiveness | Pulls live campaign results back into Learn, so Judge learns from what worked in market, not only from awards | The flywheel, the dashboard |
| Meeting notes to actions | Records client calls and turns them into contact reports, brief changes and tasks on the job | The audio transcription MVP |
| Estimates and job costing | Quotes, purchase orders, budget burn and billable hours, handed to the bookkeeper as invoice-ready lines | AI timesheets, Budgets |
| Clearance and compliance | Checks ad codes, alcohol rules, talent and music rights, and AI labelling before anything goes to the client | The Rights and Clearance seat in Napkin OS v2 |
| Asset library | Every approved asset, findable by client, product, format and date, with usage rights and expiry dates | Approved work, the brand kit |
| New business | A pitch tracker, and credentials built from past work in the Agency Brain | Agency Brain, Presentations |

Media planning stays parked until the team agrees its job.

Later, the product library can take brand-verified product twins from BrandSplats, Napkin's research with Trinity: an exact 3D twin per pack, checked against the brand's own specs, so recipes and shopper renders start from the real product. Confirm the timing with Laurence.

## Open questions to settle before building

Raise these in your Discovery hand-back. Do not guess them. The first three block Phase 1.

- [ ] **ADR-004 sign-off.** Still open. It also blocks the corpus licence legal review and the OpenShell spike.
- [ ] **Pilot job.** The Jameson J001 demo job, or the speculative Coca-Cola "The City Makes Room" demo built for UK agencies.
- [ ] **Art director tool status.** The tracker on 9 Nov says Built. The Design Brief on 28 Oct said on hold, in repair in another thread. Confirm before wrapping it.
- [ ] **Type and colour in older tools.** Production Recipes and Art Director Tool 1.0 still use Hanken Grotesk and a fixed Napkin blue. This prompt follows the newer locked system. Confirm they switch.
- [ ] **Departments.** Six rings in the prototype versus the manifest list. Where Management sits. When Media comes back.
- [ ] **Unplaced tools.** Where Agency MRI, Production Amplifier and the Shopper Display Builder live in the O.
- [ ] **Presentation base.** Settled: the Deck Maker engine in the repo is the base, and the three older deck repos fold into it.
- [ ] **Recipe runner.** Napkin's own runner or Runway Workflows. Recommend one in Discovery. The Production Tool harness in the repo may already be the runner, with each recipe as a template.
- [ ] **Credits.** Pass Runway credits through to agencies at cost, or bundle them into the €7,000 pilot fee.
- [ ] **TBWA pitch.** How Napkin OS sits beside Omnicom's own Omni platform.

* [ ] **FLUX 3 routing.** The art director flow names GPT Image 2.5 and FLUX 3. The Recipes plan says Runway does not carry FLUX 3. Napkin now has direct Black Forest Labs access, so FLUX runs on its own key through the router. Confirm the terms and how long the free access lasts.
* [ ] **EU AI Act legal view.** Provider marking, deployer labels, and the timesheet AI's limits, before any pilot goes live.

- [ ] **Typography.** The Studio OS shell uses Geist, and the repo lists the OS faces as an open decision. The locked Napkin OS brand is Helvetica Neue with Newsreader for display. Propose the switch in a feature record.
- [ ] **Product shell and Studio OS shell.** Whether the O and department homes replace the current landing (features/landing-circles and project-home) or wrap it.
- [ ] **Owners.** The repo names Shrey as project owner. Confirm who approves designs for each feature: Laurence for product and look, Shrey for the platform.

* [ ] **NAP setup.** Confirm NAP was imported from Napkin-Studio/napkin-os with its full history, and who holds admin on it.
* [ ] **The new video model.** Dictated as "Elorna". Confirm its name, provider and access terms before adding it to the router.
* [ ] **BrandSplats timing.** When brand-verified product twins join the product library.

- [ ] **Vahid's experimental repo.** Give the build access to vahid-vakson/napkin-experimental, and confirm how it relates to larryob78/napkin-os-experimental.

## Sources

- [TBWA 1.0 prototype](https://claude.ai/code/artifact/dba8be6e-a316-4795-9aa0-2591d0da7d30): departments, roles, role homes, tools
- [Napkin Team Hub](https://claude.ai/code/artifact/faf2b790-7e92-4900-b687-806a601491bd): tool tracker and status, 9 Nov
- [Napkin OS Design Brief](https://claude.ai/artifact/VVuJ1VEsmSPtcw91aQjeMT): system map, repos, tool cards, 28 Oct
- [Production Recipes: Team Brief and Build Plan](https://claude.ai/artifact/6KiQy9gCuMA3kEH1ZGkAyQ): recipes, data model, runner, 3 Nov
- [Napkin Brand System](https://claude.ai/code/artifact/40a36b0f-13a9-4819-a2bc-637045becfab)
- [Anthropic's Fable 5.2 prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2) and [release and pricing](https://www.anthropic.com/claude-fable-and-mythos-5-2), as you linked them
- Napkin OS project notes, including the locked brand rules of early November

* [larryob78/napkin-radio](https://github.com/larryob78/napkin-radio): the radio tool's README, read 9 Nov
* [larryob78 Repo Map](https://claude.ai/code/artifact/dbb835c5-a688-4ee0-9bcc-3954589c67ab): where each repo belongs
* [EU AI Act Article 50 guide](https://artificialintelligenceact.eu/transparency-rules-article-50/) and [the AI Omnibus agreement](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines/), read 9 Nov

- [Napkin-Studio/napkin-os](https://github.com/Napkin-Studio/napkin-os), develop branch, read 10 Nov: README, CLAUDE.md, napkin-studio.clan, napkin-studio-os.clan, judgement-architecture.clan, foundation-spec.clan, docs/contracts/os-layer.md, the app templates and the feature records

* [larryob78/shopper-display-builder, concept-vahid](https://github.com/larryob78/shopper-display-builder/tree/concept-vahid): README, docs/concept-studio.md, the audit and build log, read 10 Nov
* [larryob78/napkin-os-experimental](https://github.com/larryob78/napkin-os-experimental): README, read 10 Nov
* [World Labs: Marble and Chisel](https://www.worldlabs.ai/blog/marble-world-model) and [Atlas](https://www.theneuron.ai/news/world-labs-atlas-3d-worlds-what-it-invented/)

- [Andrej Karpathy, LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): raw sources, a maintained wiki and a schema; ingest, query and lint
- .claude/skills/clan-steward/SKILL.md and the clan CLI in crates/clan-cli, Napkin-Studio/napkin-os, read 10 Nov

* [Cannes Lions awards entry guide](https://www.canneslions.com/awards/awards-support/awards-entry-guide): case film under two minutes, English, VTT subtitles, no agency names in supporting material, read 10 Nov
* [LBB on From Cold Case to Gold Case by Peter Ampe](https://www.lbbonline.com/news/could-this-book-mean-the-end-of-terrible-case-study-films)
* Napkin-Studio/napkin-os Deck Maker: docs/contracts/deck-maker.md, app/templates/deck-maker/context.md, docs/deck-maker/winning-pitch, read 10 Nov
