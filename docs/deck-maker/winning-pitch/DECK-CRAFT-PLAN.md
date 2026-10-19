# How a good deck is made: craft, process and roadmap for the Deck Maker

Date: 2026-10-18. Written for Sai from a read of the research in this folder, the engine in
`napkin-deck-handoff/engine/deck`, the ADRs, and the five live decks of the winning-pitch test.
No code was written and no model was called.

Evidence tags. `[R: file Lnn]` a research file in this folder (its own P/S/O/X source tags
are kept where it matters). `[E: path Lnn]` the engine or a repo document. `[T: path]` a test
output under `engine/outputs/`. `[J]` my own judgement, from how planners, creative directors,
bid teams and seed investors work; not sourced here. Paths are relative to
`napkin-deck-handoff/` for engine files and to this folder for research files.

## Executive summary

1. **The thinking stages, not the checks, are where the next points are.** The engine has 28
   code checks and a renderer that beat the old look 15 of 15 times, yet judges still say the
   agency decks are not client-ready and the insight is "a statistic" [R: TEST-RESULTS L148,
   PILOT-RESULTS L183-186]. Twenty-eight integrity checks did not move insight (14 points),
   idea_chain (14) or problem_objective (12), and validator error counts did not track quality
   [R: TEST-RESULTS L153]. The craft gap is in stage b and in what the person sees at Gate 1.
2. **Three verified defects sabotage the inputs before any craft can show.** (a) `intake.apply_a0`
   dropped Fernley's entire `budget_scope` field because the ordinary word "limited" matched the
   legal-line regex, so the investment slide printed "Budget given: not given" [T: agency/B/out/
   report.json `intake.dropped`; E: intake.py L35, L62-78, L241+]. (b) The fit judge is told only
   `[brief:insight] brief field (intake)`, never the field's text, so it rules "partly" on claims
   the client's own data note states [E: refs.py L214-216; T: agency/C/stages/fit.json]. (c) Research
   findings carry a `so_what` and the engine never sends it to any stage [T: agency/inputs/
   research.clan; E: stages.py L92; `grep so_what engine/deck` = 0]. Fix these first; they are
   each a day or less and they are why "brief and research added little" looks true.
3. **The insight is weak partly because of the slide's shape, not only the model's writing.** The
   human truth is rendered as a quote with "Illustrative line, not a verbatim" under it, beside
   four hero statistics [E: assemble.py L162-170; spec.py L150; T: pilot/agency_C/new_png/s-04.png].
   The judges read a text dump in which the line is tagged `(basis: creative)` [T: judge/D-23.md
   L63-80]. Section 3 gives a method (candidates with a stated tension, a blind judge, a shape
   check, a swap test) and a chain check from problem to proof.
4. **The objective is buried by a default.** In pitch format the brief read-back goes to the
   appendix [E: spec.py L189; ADR 0024 L16-19], so the number that must move (11% to 25% by
   30 Sep 2027) is not in the first three presented slides; judges marked problem_objective
   down for exactly that [R: TEST-RESULTS L135, L137]. Add a 50-word presented `objective` slide
   at position 2.
5. **Evaluate like a sceptic.** Everything so far is n=2 invented clients, one run per arm, Sonnet
   judges of Opus/Sonnet writers, no human [R: TEST-RESULTS L141, L172-179]. A trustworthy
   "pipeline makes it better" claim needs about 12 clients (real or realistic), 3 arms, 2 seeds,
   a cross-family panel in both orders, and a 12-deck human gold set with rank correlation
   reported (section 4). The engine's Claude-only rule (ADR 0006) blocks cross-family judges
   unless the owner allows them in the offline bench.
6. **Three things we have wrong:** (i) the human-only rule is over-applied: it stops the deck
   filling team, credentials and fee from the person's own attached documents, which ADR 0023
   and 0028 explicitly allow as inputs; (ii) one deck shape for every input size: a 184-character
   prompt produced 29 slides that "read as a different client's pitch" [T: agency/inputs/prompt_A.txt;
   R: TEST-RESULTS L45, L108]; (iii) the rubric scores evidence_trace at 14% and compliance at
   12% although both are gates we check in code, while team (10%) and commercials (6%) are
   under-weighted against what clients say loses pitches [R: GUIDE L42-43, L37].
7. **Roadmap** (section 6): 1 fix the three defects and add the objective slide (S); 2 a real
   insight step (M); 3 size the deck to the evidence and respect stated limits everywhere (S);
   4 headline narrowing after the fit judge (S); 5 supply cards at Gate 1 for team, budget split
   and decision date (M); 6 a red-team critique with one bounded revision (M); 7 the evaluation
   bench (M); 8 chain and single-idea checks (S); 9 tender: per-criterion answers with weight
   share (M); 10 agency measurement, risks and competition slides (M); 11 investor "why now
   and what we know" (S); 12 cost and transport hygiene (S). Not yet: icons and brand kits,
   model-based visual critique, a2 vision, HyperFrames polish, auto-launched research.

## 1. What a good pitch deck is, by type

A deck is an argument that one buyer group can retell without us in the room. It is won on
whether they believe the diagnosis, trust the people, and can repeat the idea [R: GUIDE L7,
L9-10, L15]. Everything below is organised around what the audience decides and in what
order they need to believe things.

### 1.1 Agency pitch (a marketer chooses an agency for a brief)

**What they decide.** Which agency understood us best, will be good to work with, and has an
idea we can sell internally. Thinking first, then people, then the idea [R: GUIDE L9 (S), L10 (S),
L13 (P/S: only about 25% of winning ideas run)].

**What they must believe, in order.** (1) You read the brief and saw something we did not (a
reframe or a challenge we had not named) [R: GUIDE L10]. (2) The number we have to move is
understood, with its baseline [R: GUIDE L79 (P, Effie)]. (3) There is a human truth about our
buyers that explains why the number is stuck [R: GUIDE L78 (P)]. (4) One idea follows from it
and we can picture it in our world [R: GUIDE L93 (O), rubric idea_chain]. (5) The plan reaches
the number and we will know if it did [R: GUIDE L99-101 (P)]. (6) These are the people, and we
can afford them [R: GUIDE L42 (S), L45 (O)].

**What separates a winner from a competent deck** (3-5 things):
- A diagnosis the client recognises as truer than their own brief: 75% of winning agencies "showed
  true understanding"; raising new challenges featured in about half of wins [R: GUIDE L10 (S)].
  [J]: planners call this "the brief behind the brief"; a competent deck restates the brief, a
  winning one corrects it politely and with evidence.
- One idea that is obviously theirs and survives the lift: most pitches are remembered for one
  thing [R: GUIDE L93 (O)]; committees under-repeat what only one member holds [R: GUIDE L15 (X)].
  [J]: the CD's test is "say it in one line, show it in one picture, and could the incumbent have
  said it?" Fernley A lost because the idea "could belong to any drink" [R: TEST-RESULTS L108].
- The working team in the room, not the seniors: 15% of losses never met the day-to-day team;
  28% of rejections after chemistry calls were a senior overwhelming the call [R: GUIDE L42 (S)].
- A plan that visibly reaches the number: baseline, target, measurement and confounders [R:
  GUIDE L79, L101 (P)]. [J]: the client's CFO reads the measurement slide first.
- Price that reinforces a case already made, with 2-3 options differing in scope [R: GUIDE L45
  (O), L106 (O, X)]. 42% of marketers call value for cost influential against 13% of agencies
  who think so [R: GUIDE L43 (S, vendor survey)].

**Where the research is thin.** No study links any deck feature to a pitch win; client-side
drivers come from vendor and network surveys; award criteria are retrospective and judged on
results, not targets [R: GUIDE L83, L131; SOURCES L111-119]. The 18-slide and two-minute
defaults are unsourced [R: GUIDE L89].

### 1.2 Tender response (a public or large buyer scores against published criteria)

**What they decide.** A panel of tired evaluators awards marks per criterion, often individually
then by consensus, with pass/fail gates first [R: GUIDE L21-23 (P), RUBRIC L80]. The decision
is the score sheet plus a moderation discussion; chemistry matters less and compliance decides
before quality is read [R: GUIDE L21-25 (P)].

**What they must believe, in order.** (1) Nothing is missing, over the limit or out of scope [R:
GUIDE L21-24]. (2) Each criterion is answered where they expect it, in their words, with evidence
that lets them award "full confidence and no concerns" [R: GUIDE L54 (P, Brent)]. (3) The heavier
criteria got the most substance [R: GUIDE L55 (P)]. (4) The delivery team and governance are
specific [R: GUIDE L37 (P: team 23% vs concept 15%)]. (5) Price and social value are answered the
way they are scored [R: GUIDE L53 (P)].

**Winner vs competent.** [J], drawing on how bid managers work (Shipley-style compliance
matrices, win themes, storyboards, colour-team reviews): the competent response is compliant and
generic; the winner is answer-first per criterion ("we will do X; evidence: Y; benefit to you:
Z"), proves every claim with a name, a number or a date, ghosts the rivals' weaknesses without
naming them, and makes the mark easy to award. Generic company history earns nothing [R: GUIDE
L25 (P)]. Scope fidelity: if only strategy was asked, finished creative is a liability [R: GUIDE
L24 (P)].

**Where I disagree with our current build.** The deck is the presentation; the written response
boxes are what is scored (the Lumen Water TRD per [E: docs/deck-maker/kickoff-prompt.md §3]).
Our tender profile reorders a pitch deck [E: profiles/tender_response.yaml]; it does not write
the response. For a tender the product should produce the written answers per criterion (one
call per scored criterion, word budget from its weight) and derive the presentation from them,
not the other way round. See section 2 and roadmap item 9.

### 1.3 Investor seed deck

**What they decide.** Whether to take a meeting, in about three minutes of reading [R: GUIDE L63
(S, DocSend)], then whether this team can make something big in a market that is opening now.

**What they must believe, in order.** (1) What you do, in one sentence, with no jargon [R: GUIDE
L67 (P, YC)]. (2) Why now [R: GUIDE L62 (P, Sequoia)]. (3) It works: traction [R: GUIDE L64 (S)].
(4) Why you: the team and what you know that others do not [J; R: GUIDE L62 "plan to win"]. (5)
How big and how you win against alternatives [R: GUIDE L62, L65]. (6) The ask and what it buys
[R: GUIDE L66 (S), L109 (P)].

**Winner vs competent.** [J], from how seed investors read: the competent deck is complete
(Dockhand B and C were called "complete, well-sourced and honest" [R: TEST-RESULTS L130-137]);
the winner adds a non-obvious truth about the market that the founders learned by doing ("the
earned secret"), states the objective of the round as milestones, and discloses the scary number
early (judges credited D-29 for stating the 14% concentration earlier and marked D-06 down for
disclosing at slide 13 [R: TEST-RESULTS L110, L135]). Successful decks lead with purpose and keep
product light [R: GUIDE L64 (S)].

**Our build.** Stage i has no concept of insight or why-we-know; it writes 13-16 sections in a
fixed list [E: prompts/i_investor.md]. The profile lowers the insight weight to 8 [E: profiles/
investor_seed.yaml], which is defensible, but the judges still wanted "a sharper human-truth
insight" [R: TEST-RESULTS L136]. Roadmap item 11.

### 1.4 Credentials deck (chemistry meeting)

**What they decide.** Do we want to spend three months with these people, and do they have a
point of view on our business. Keep it very short and show the team who will do the work [R:
GUIDE L47 (P, WFA/EACA)]; asking questions and raising challenges featured in about half of wins
[R: GUIDE L10 (S)].

**Winner vs competent.** [J]: the competent credentials deck is a showreel; the winner picks the
two or three cases closest to this client's problem, states one challenge the client has not
named, asks three good questions, and stops talking. No idea, no price [R: GUIDE L24, L47]. The
profile already does this [E: profiles/credentials.yaml]; its separator is case relevance, which
only a person can supply, so the supply cards (item 5) matter most here.

### 1.5 Where I disagree with the rubric

- `evidence_trace` 14% and `compliance_gate` 12% score things we enforce in code as gates
  [R: RUBRIC L9-20, L22]. A buyer does not award marks for citation density; it is hygiene. Make
  both pass/fail gates reported before the score (as RUBRIC L73 already says) and move about 8
  of those 26 points to `team_proof` (10 to 14) and `commercials_ask` (6 to 10) for the agency
  pitch, in line with the loss reasons clients report [R: GUIDE L42-43, L37]. [J]
- The insight anchor's "method and source stated" for a 5 [R: RUBRIC L39] is an award-entry
  convention (Effie) [R: GUIDE L78]. In a pitch room the client needs to recognise the truth, not
  audit the method. Keep method as evidence on the slide notes, not as a condition of the top band
  for agency pitches; keep it for tenders. [J]
- The "no table of contents" and "differentiator repeated in the last three slides" rules rest on
  DocSend correlations and an extrapolated memory study [R: GUIDE L65, L15, L94]. Keep them as
  warnings, not as scored anchors.
- Keep the weights explicitly "default, not validated" until the gold set exists (section 4);
  profiles.py already labels them so [E: profiles.py L45-48].

## 2. The production process: how a senior team does it, and what our pipeline does

### 2.1 The ideal, step by step, mapped to today

| # | Senior team step | What today's pipeline does | Human-in-the-loop (CLAN) | Gap |
|---|---|---|---|---|
| 0 | Qualify: what is the decision, who decides, how it is scored, what they fear | Stage a reads requirements, scoring, rules [E: stages.py L195-218; prompts/a_requirements.md]; a0 fills brief fields and asks up to 5 questions [E: stages.py L164-192; intake.py L28] | Question cards (a0 questions; profile questions) [E: profiles/*.yaml `questions`] | No read of who decides or what they fear; a0's questions were generic and asked things the attached documents answered [T: agency/B/stages/a0_intake.json questions] |
| 1 | Compliance matrix and win themes | `CRITERIA_HOME`, `criteria_coverage`, `requirement_map`, `message_carried` [E: spec.py L120-136; validate.py L1-44] | None | No win themes (the 3-4 reasons to choose us, repeated); criterion weight not used to allocate words [R: NAPKIN-EDGE L28] |
| 2 | Diagnose: the number, its baseline, what is hard, the reframe | Stage b writes reframe and barrier in one call [E: prompts/b_storyline.md] | Gate 1 (storyline) proposed, not built [E: features/deck-maker-server.clan open_questions; ADR 0016 L31-35] | The objective slide is in the appendix in pitch format [E: spec.py L189]; nothing checks a baseline and target in the first three slides [R: NAPKIN-EDGE L29] |
| 3 | Immersion and research: category, people, competitors | Research Tool output and documents; the engine never launches research [E: README L12-18; ADR 0028 L26-30] | The "strengthen" rung: the app offers research on the person's yes [E: README L83-84] | `so_what` never sent [E: stages.py L92]; brief fields shown to the fit judge without their text [E: refs.py L214-216] |
| 4 | Insight: the human truth with tension | One slot in stage b, 30 words, no tension required, no judge [E: prompts/b_storyline.md L4, L9] | None | Section 3 |
| 5 | Strategy: proposition, from/to, reasons to believe | Stage b `proposition`, `from_to`, `objection` [E: prompts/b_storyline.md] | Gate 1 | Fine as a draft; it is the right place for the person to intervene |
| 6 | Tissue session: territories, pick one | Stage c, three territories, blind rank on Sonnet [E: stages.py L232-241; prompts/c_judge.md] | Gate 2 (territory pick), default the judge's choice, flagged [E: ADR 0016 L33-34] | The pick UI is not built; the person's pick is the cheapest big human lever and should carry the "why" into stage d |
| 7 | One idea and executions | Stage d [E: prompts/d_idea.md] | None | Single idea is enforced only by structure; no chain check from insight to idea [R: NAPKIN-EDGE L26] |
| 8 | Plan: channel roles with reasons against alternatives, phasing | `channel_roles`, `timeline` from d | None | No `why_not` per channel [R: NAPKIN-EDGE L46]; budget split is a placeholder |
| 9 | Proof: measurement with baselines, risks and confounders, cases | `measurement` from d; risks only in investor kind; credentials human-only [E: spec.py L95] | Supply (human writes) proposed | No agency `risks`, `competition` or confounders slide [R: NAPKIN-EDGE L30, L68-72] |
| 10 | Commercials: options, fee, value | Investment placeholders; budget line from brief [E: assemble.py; T: s-17.png] | Supply | Intake dropped the budget field (section 0 item 2a) |
| 11 | Team | Placeholder [E: spec.py L95-97] | Supply | Cannot be filled from the agency's own attached bios |
| 12 | Red team: "would we buy this?", the rival's and the CFO's objections | Fit judge checks headlines only [E: prompts/fit_judge.md; stages.py L47-49] | Gate 3 (final review) | No whole-argument critique before the person sees the draft |
| 13 | Write the opening last: the one-line "why us", the summary | Title slide is a placeholder; no summary slide; differentiator repeat unchecked [E: assemble.py L112-116] | None | [R: GUIDE L77 (P, IPA): write the opening last] |
| 14 | Craft: copy, design, QA | Stage e tightens over-budget slides [E: stages.py L269-287]; native layouts; stage h [E: qa_render.py] | Ask-for-a-change (words only) [E: deck-maker.md L30 on feat/deck-maker-ui] | e only cuts words; it does not fix a headline the evidence does not support |
| 15 | Rehearsal: talk track, timing | Speaker notes hold the evidence list; 2 min/slide default [E: spec.py L180-183] | None | No talk track; fine to leave |
| 16 | Leave-behind and written response | `--format full` [E: ADR 0024] | None | The tender's scored written answers are not produced (section 1.2) |

### 2.2 Verdicts

**Where the pipeline skips the step that matters most.** Steps 2, 4 and 12: the diagnosis is
not shown as a diagnosis (the objective slide is hidden), the insight is a slot rather than a
step, and nobody argues against the draft before a person does. These three are also where the
senior team spends its best people. [J]

**Where it does work that does not pay.** (a) Four requirement-trace slides and a sources slide
in every deck [T: agency/C deck order slides 31-35]: right for a tender, noise for an investor
deck; keep them, but only render them for types that score them. (b) Three renderers and a
HyperFrames build [E: ADR 0026] before the argument is client-ready: judges rate the new look
3.9/5 and still "not yet ready to send" [R: PILOT-RESULTS L183-186]. Freeze renderer work after
the known layout fixes. (c) The intake's 5-question cap is spent on generic questions; two sharp
type-specific ones (the profiles have them) are worth more than five. (d) Stage c for a strategy-
only tender or a credentials deck: already skipped by profile; keep that.

**Should the order change?** Mostly no. One change: run the fit judge on the storyline (stage b
output: reframe, barrier, insight, proposition) before stage c, not only on the assembled deck.
A storyline whose headlines the evidence does not support should not reach the tissue session,
and the person at Gate 1 should see the verdicts beside the beats. The assembled-deck fit run
stays for the executions and measurement. Cost: one more Sonnet-medium call on a short input
(about $0.05) [J, costs from E: README L49 and PLAN.md L92-102].

**One call or several?** Keep stage b as one Opus call for coherence (reframe, barrier,
proposition belong together), but make it return three insight candidates, and add one cheap
judge call that picks and critiques (like `c_judge`). Split stage d only for tenders (one call
per scored criterion). Keep a0 per document chunk as it is. Do not split stage e. Projected cost
of the whole plan: about $0.25-0.45 on top of today's $0.65-1.25 [E: README L49], mostly the
insight judge, the storyline fit and the red team. Quality first, then time, then cost: the extra
calls are short and can run in parallel with the person answering supply cards.

## 3. The insight problem

### 3.1 Why ours reads as a statistic

The Fernley C human truth was not bad: "By three o'clock you don't want a treat or a tonic. You
want ten minutes that feel like yours." [T: agency/C/stages/b_storyline.json `insight.human_truth`].
It scored 3.0 because of how it was made and shown:

1. **It is written in the same breath as everything else.** The prompt asks for `insight{title,
   human_truth, human_truth_refs?, evidence[]}` among eight other objects, each text under 30
   words [E: prompts/b_storyline.md L4, L9]. No tension is asked for, no "what the brief did not
   say", no candidates, no judge.
2. **The slide demotes it.** The human truth becomes a `quote` block with basis `creative`, so the
   renderer prints "Illustrative line, not a verbatim." under it [E: assemble.py L162-166; spec.py
   L138-150]; the brief's own insight sentence follows; four statistics take the right two thirds
   of the slide as hero numbers [T: pilot/agency_C/new_png/s-04.png]. The judges' text dump shows
   the line as `(basis: creative)` and four claims [T: judge/D-23.md L63-80]. A reader sees a
   consumer quote we made up and four numbers; the strategic claim is the title only.
3. **The best raw material is thrown away.** The research findings carry a `so_what` ("Position
   Fernley against sweet and against worthy at the same time, not against one competitor") [T:
   agency/inputs/research.clan fi_2]; `_facts_block` sends only status and statement [E: stages.py
   L92]. The brief's insight field (with its figures) reaches the fit judge as `[brief:insight]
   brief field (intake)` with no text [E: refs.py L214-216], so the judge rules "partly" and the
   slide carries a warning [T: agency/C/stages/fit.json].
4. **The investor kind has no insight concept at all** [E: prompts/i_investor.md]; judges still
   look for one [R: TEST-RESULTS L130-137].

So the first fix is structural (shape, inputs, judge), and only then prompt craft. [J]

### 3.2 What a real insight is, operationally

[J], from planning practice (the JWT/BBH tradition of "what the data means", Effie's definition
[R: GUIDE L78 (P)]): an insight is an observation about people that contains a tension, is
specific to this client's situation, and implies what to do. Four tests, all answerable yes/no:

- **Tension.** It has a "but" or a "yet": what people want against what they do, what they say
  against what they feel, what the category promises against what people experience.
- **Specificity (the swap test).** Replace the brand with "[brand]" and the category with
  "[category]"; if the sentence still reads true, it is a category convention, not an insight.
- **Actionability.** Reading it, a creative can name the direction of the idea without being told.
- **Evidence.** The observation half is in the inputs (a finding, a verbatim, a figure); the
  interpretation half is labelled as ours.

A statistic fails tension and actionability. A category truth fails the swap test. A brief
restated fails all four.

### 3.3 The method (stage b, amended)

**Inputs to the insight work.** The diagnosis (objective with baseline and target, barrier,
reframe), the audience evidence, every finding with its `statement` and `so_what`, every verbatim
quote in the documents and research, the brief's `insight` field as one candidate among others
(never the answer), the `how_to_win` field when the brief has one, and the person's answers.

**Output shape** (returned by stage b inside the one storyline call, three candidates):

```
insight_candidates: [
  {id, observation (what people do or say; refs required),
   tension (one sentence containing but/yet/while/even though),
   implication (so the brand should ...; one sentence),
   not_in_brief (what this says that the brief did not),
   from (which finding so_what, verbatim or figure it grew from; refs),
   swap_test (why a rival in another category could not say this),
   confidence (high/medium/low and why)}
]
insight: {chosen_candidate_id, title (full-sentence takeaway), truth (the three-line form), evidence[]}
```

**The three-line form on the slide.** "People [observation]. But [tension]. So [implication]."
The truth is the hero of the slide, set as the agency's claim, not as a quote. Evidence figures
move to small supporting tiles with refs; the brief's own insight sentence is not reprinted.
Numbers do not appear in the truth lines (they belong in the evidence). Word budget stays at 70
[E: spec.py L15]. This changes `assemble.py` L162-170 (block kinds: `statement` for the truth,
`small` for evidence) and the insight layout in `render_pptx.choose_layout`.

**The judge** (Sonnet, low effort, never the writer's model, as `c_judge`): reads the diagnosis
and the three candidates blind (no ids that reveal which came from the brief) and returns, per
candidate, the four yes/no tests with a quoted reason, a one-sentence paraphrase, and an order.
A candidate whose paraphrase contains a number or reads as "X% of people do Y" fails. If every
candidate fails, stage b is re-run once with the judge's reasons appended (bounded retry, logged
as a decision); if it fails again the slide is marked `needs_human` with the judge's reasons as
the "to confirm" text, and Gate 1 shows all three candidates for the person to pick or rewrite.

**For investors.** Stage i gains `why_now` as a required section with a stated change in the
world, and `what_we_know` (the non-obvious truth learned from customers, with a verbatim or a
figure) placed after traction. The same four tests apply to `what_we_know`.

**Prompt structure for the insight part of stage b** (plain text, to be appended to
`prompts/b_storyline.md` or carried by `prompt_guidance.b` in the profiles):

- Write three insight candidates that are different in kind: one from behaviour (what people do
  at the moment of choice), one from feeling (what they say against what they do), one from the
  category (what the category promises and people no longer believe).
- Each has an observation with refs, a tension sentence that contains "but" or "yet", and an
  implication that starts with "so".
- Say what each candidate adds that the brief did not say. Say which finding's "so what",
  verbatim or figure it grew from.
- Apply the swap test yourself and write the result; a candidate that fails it is still returned
  but marked.
- No number in the observation, tension or implication sentences; numbers go in evidence.
- Pick one and say why in one sentence; the judge may overrule you.

### 3.4 Checks that catch a fake insight

Code (`validate.py`, new check `insight_shape`, a warning for agency and tender types, info for
investor):
- the insight slide has a `statement` block of three sentences;
- the second sentence contains one of: but, yet, while, even though, and still, instead;
- the third starts with "so" or "which means";
- no number in the three sentences; at least one evidence item with a resolving ref;
- the truth cites at least one finding, verbatim or document passage (`refs` not empty), so it is
  never rendered with the illustrative-quote label;
- the `insight` slide's `claims` include the chosen candidate's refs.

Judge (the insight judge above, recorded in `b_storyline.json` as `insight_judge`): the four tests
and the paraphrase. `evaluate.py` reports the test results per deck, so insight quality has a
number before any rubric run [R: NAPKIN-EDGE L26].

Person (Gate 1): sees the three candidates with the judge's verdicts and the chosen one; can pick
another, edit (attributed write), or ask for a retry. Their pick is recorded as the decision the
later stages cite [E: deck-maker.md L36-38 on feat/deck-maker-ui].

### 3.5 The single idea and the chain

**Single idea.** Stage d already writes one `idea` sentence and one line [E: prompts/d_idea.md];
the assembler presents one idea slide [T: agency/C order]. Add `idea_single` in code: exactly one
presented `idea` slide unless `routes_asked` > 1 [E: assemble.py `routes_asked`]; the idea
statement is at most 60 words [E: spec.py L20]; it does not read as a channel list (no more than
one channel word from `FRAMES` [E: spec.py L155-158]).

**The chain, written not inferred.** Ask stage d to return `chain: {insight_phrase, strategy_phrase,
idea_phrase}` where each phrase is quoted verbatim from the chosen insight and proposition and
from its own idea, and a one-line `because` for each link. Code check `chain_links`: each quoted
phrase exists in the named slide's text (norm_text match, [E: spec.py L201-204]); the idea slide's
`refs` include the insight slide id; every presented execution names which half of the insight it
dramatises (`answers` field, already present as `answer` per execution [E: prompts/d_idea.md]);
measurement KPIs include the objective's metric. The judge side of `idea_chain` stays as in the
rubric [R: rubric.json L76-94], with the chain phrases quoted on the slide notes so a judge can
cite them.

**The relay test** [J, from GUIDE L15]: a cheap judge reads only the titles and the idea slide and
writes the three sentences a client would say to their boss. If the idea line or the insight
implication is not in them, the deck fails the skim test. Report, do not block.

## 4. Quality gates and evaluation

### 4.1 Who checks what

| Check | Code | Model judge | Person only |
|---|---|---|---|
| Numbers trace, rejected findings, unknown refs, internal leaks, banned phrases, limits, requirement and criteria map, word budgets, action titles | yes (today's 28) [E: validate.py L1-44] | | |
| Objective in first three slides with baseline and target; insight shape; single idea; chain links; options count; social value present when scored; stated limit respected; differentiator repeat | yes (new) | | |
| Rendered geometry, overlap, contrast, font floors, placeholders on screen | yes (stage h) [E: qa_render.py] | | |
| Headline supported by its evidence | | fit judge (today) [E: prompts/fit_judge.md] | |
| Insight tests, territory rank, skim and relay test, red-team critique | | yes, never on the writer's model [E: stages.py L5-6] | |
| Is this true to the client; is the idea good; voice; chemistry | | | yes (Gate 1, Gate 2) |
| Team, cases, price, decision date; legal and category sign-off | | | yes (supply cards, Gate 3) |
| Would we send this | | | yes (confirm before export) |

### 4.2 What the engine should self-critique and revise before a person sees a draft

- **Headline narrowing.** After the fit judge, every `not` or `partly` headline on a presented
  slide gets one rewrite that narrows the claim to what the evidence supports, with no new fact
  (an extension of stage e [E: stages.py L269-287]). Today a `not` stays on the slide as CHECK
  FAILED [E: edge-cases.md DREQ-05 L29]; narrowing is the obvious cheap repair.
- **Insight retry** as in 3.3, once.
- **Red team** (one Sonnet call on the assembled storyline and idea, before Gate 1 for the
  storyline part and before Gate 3 for the whole): writes the three strongest objections a rival
  agency, the client's CFO and the client's procurement lead would raise, each with the slide it
  targets, and a suggested change. The engine applies at most one change per objection that
  touches wording or order only, logs it as a decision, and shows the objections to the person.
  Facts never change in this pass.
- **Never:** invent a fact to close a gap; remove a requirement or a mandated message to fit a
  limit; rewrite a human-owned write; rewrite the client's quoted wording; loop more than once;
  change a decision the person made; launch research. Each is already a rule somewhere [E: ADR
  0023 L15-26; ADR 0028 L26-30; README L12-18]; the revision passes must say so in their prompts.

### 4.3 Not fooling ourselves

The controls in RUBRIC L73-82 are right; what is missing is the harness and the gold set.

- **Judges.** Three judges, at least two model families, both orders for every A/B, flips as ties,
  length reported and regressed, evidence quoted before the score [R: GUIDE L135-141 (P)]. The
  engine's Claude-only rule (ADR 0006, cited in stages.py L23-24) makes a cross-family panel
  impossible inside the product. Owner question: allow non-Claude judges in the offline bench
  (not in the product), or accept a Claude-only panel with the self-preference caveat.
- **Judges read a rendered deck as well as the text.** The test's judges read a markdown dump
  [T: judge/D-23.md]. Score the text deck for argument (as RUBRIC L94 says) and the PNGs for
  presentability separately; never mix the two in one score.
- **Gold set.** Twelve decks (4 agency, 4 tender, 4 investor; credentials excluded as not
  comparable), one per client, mixed arms, scored blind on the nine criteria by two or three
  practitioners (a planner, a bid manager, an investor or founder). Report Spearman rank
  correlation between the human mean and the panel mean per criterion; trust a criterion's
  judge only when rho is at least 0.6 on 12 decks [J: with n=12, rho 0.6 is about p=0.04]. Below
  that, the criterion is "judged by people only" until the prompt improves.
- **Sample size for "the pipeline makes it better".** [J] With 1-5 criterion scores and a judge
  SD of about 0.8 observed in the test (criterion means moved 0.3-1.3 between arms), detecting a
  0.5-point criterion gain at 80% power in a paired design needs about 20-25 paired decks; a
  3-point total gain needs about 12. So: 12 clients, 3 arms, 2 seeds each = 72 decks, judged by 3
  judges in 2 orders = about 430 judge calls. At today's prices about $70-90 of decks and $40-60
  of judging [costs extrapolated from E: README L49; PLAN.md L92-102]. Anything smaller is a
  smoke test, and should be reported as one.
- **Real inputs.** The test's documents were written alongside the ground truth, so they matched
  it by construction [R: TEST-RESULTS L172]. The brief used had `how_to_win` and `open_questions`
  null [T: agency/inputs/brief_object.json], so "brief plus research added little" tested a brief
  with no reviewed judgement in it. Use real briefs (Lumen Water, the short brief, the 7-deck eval set)
  under the confidentiality rule: internal panel, nothing committed [E: CLAUDE.md "Never commit"].
- **Report the weakest criterion and every 1**, never only the total [R: RUBRIC L81]; record
  `weights_source`, judge families, orders, flip rate and length adjustment in the run's meta
  [R: NAPKIN-EDGE L63], and have `evaluate.py` load `rubric.json` instead of hard-coding
  (today it does not load it: `grep rubric evaluate.py` = 0).

## 5. Honesty when evidence is thin

A deck from a one-line prompt must still be a deck, and must not look finished. Today the
engine marks the deck DRAFT with a count of slides needing a person [T: s-04.png top right],
labels placeholders "Proposed (not given by the client): ... To confirm: ..." [E: spec.py L97;
T: s-17.png], warns `thin_evidence` past 50% uncited presented slides [E: spec.py L71-73] and
records `built_from` [E: README L74-76]. Good. What is missing:

1. **Size the deck to the evidence.** Fernley A: 184 characters in, 29 slides out, 17 presented
   [T: agency/inputs/prompt_A.txt; R: TEST-RESULTS L45]. For the thin tiers (`prompt`,
   `prompt+documents` without figures), build a **sketch**: at most 10 presented slides (objective
   as a question, what we would need to know, three insight hypotheses labelled hypothesis, one
   idea direction labelled proposal, plan outline, what research would add, the questions), the
   cover line "Sketch from a one-line prompt: for discussion", and no execution mockups. The full
   shape returns when documents or research supply figures. This is a profile `length` rule per
   tier, not a new type.
2. **Placeholders carry the specific question, not a generic one.** "To confirm: the split, from
   the agency's rate card" [T: s-17.png] should read "To supply: how EUR 450,000 splits across
   social video, Irish-language, in-store and two out-of-home formats, and the EUR 55,000 fee
   shown separately". The intake's gap report already knows what is missing [E: intake.py
   `gap_report`]; write the placeholder text from it.
3. **Ask fewer, sharper questions, and never one a document answers.** a0 asked "Is there any
   consumer insight from Fernley's data note that the idea should build on?" with the note
   attached [T: agency/B/stages/a0_intake.json]. Rule in code: a question is dropped when its key
   nouns appear in a document chunk the stage read (coarse, but it kills the worst case), and the
   profile's type questions come first. Three questions beat five.
4. **Launch research only for a named gap.** The strengthen rung [E: README L83-84] should say
   exactly what research would fetch, from `gap_report.slide_types` ("no audience evidence to
   ground an insight; no figure to measure against"), and estimate the quota. Offer it at a0,
   again at Gate 1 if the insight judge failed every candidate, never after Gate 2.
5. **Labelled proposals stay labelled through export.** A `proposal` basis line and a `needs_human`
   slide must survive the client render as visibly provisional or be removed by a person's
   decision; the confirm step before export lists every presented slide that is `needs_human` or
   `proposal`-based and requires one attributed confirm per slide (or a bulk confirm with the list
   in the decision's rationale). The client render already fails on internal leaks [E: validate.py
   `internal_leak`]; it should also refuse export while a presented placeholder is unconfirmed.
6. **Say what the deck was built from on the deck.** `built_from` on the cover's small line and in
   the report, as ADR 0028 L37 asks.
7. **Fill from the person's own documents, never from nowhere.** When the person attaches the
   agency's credentials or team bios, team and credentials slides may be filled with `doc:` refs
   and status `from_source` (ADR 0023 L19-20 and ADR 0028 L20-25 count attached documents as
   inputs). `HUMAN_ONLY_TYPES` should mean "never invented", not "never filled" [E: spec.py L94-95].
   Owner question 2.

## 6. Prioritised roadmap

Effort: S under 2 days, M a week, L more. Each item names what to measure. "Not yet" is at the end.

**1. Fix the three input defects and add the objective slide.** (S, low risk)
- `intake.apply_a0`: never drop a field for one untraced token; strip or flag the token, keep the
  field, and raise a question card naming the token [E: intake.py L35, L62-78, L241+]. Add the
  Fernley "limited" and "RRP" cases to `tests/test_intake.py`.
- `refs.Resolver.describe`: for a `brief:` ref return the field's text (first 140 characters) and
  its underlying refs, so the fit judge and the notes see what the brief says [E: refs.py L214-216].
- `stages._facts_block`: send each finding's `so_what` beside its statement [E: stages.py L92].
- New slide type `objective` (50 words) at presented position 2: metric, baseline, target, date,
  what is hard, assumptions; built from `brief.objectives`, `req` kind objective and answers;
  `brief_restated` stays in the appendix. New check `objective_quant` [R: NAPKIN-EDGE L53].
- Measure: Fernley B investment slide shows EUR 450,000 and EUR 55,000; `claim_fit` warnings on
  Fernley C fall from 7 to at most 3; problem_objective and commercials_ask on a re-run of the
  five decks (same judges, same prompts) rise by at least 1 point each.
- Why first: they are verified bugs with known mechanisms, and until they are fixed no change to
  the thinking stages can be measured fairly.

**2. A real insight step.** (M, medium risk: a prompt change to stage b touches every agency deck)
- Section 3.3 and 3.4: three candidates in stage b, the insight judge, the three-line slide form,
  `insight_shape`, Gate 1 shows the candidates. Stage i gains `why_now` and `what_we_know`.
- Measure: `insight_shape` passes on all live decks; the judge's four tests pass on the chosen
  candidate in at least 4 of 5 decks; rubric insight on the five-deck re-run rises from 3.0 to at
  least 4.0 on Fernley C and from 3.0 to at least 3.5 on Dockhand C.
- Risk: the swap test and tension rule can be gamed by the writer ("but" in every sentence).
  The judge's paraphrase test and the person at Gate 1 are the guard.

**3. Size to the evidence; respect stated limits everywhere.** (S)
- `respect_stated_limit` on every profile, not only tender [E: assemble.py L534-547; profiles/
  tender_response.yaml]; Dockhand said 14 and got 18-19 [R: TEST-RESULTS L62].
- The thin-tier sketch (section 5.1).
- Measure: no deck presents more than the stated limit; a prompt-only build presents at most 10
  slides and its cover says so.

**4. Headline narrowing after the fit judge.** (S)
- Extend stage e: for each `not`/`partly` verdict on a presented slide, one rewrite that narrows
  the headline to the evidence, no new facts, keep numbers; recorded in `e_copy.json`.
- Measure: share of supported headlines on the five decks (today 0 of 8 supported on Fernley C
  [T: agency/C/stages/fit.json]) reaches at least 60% after narrowing; no `numbers_trace` error
  introduced.

**5. Supply cards at Gate 1.** (M; app and middleware work, engine small)
- The question cards the app already shows for a0 [E: README L77-82] gain a second kind: supply
  cards for team, credentials cases, budget split, options, decision date, generated from
  `gap_report` and `HUMAN_ONLY_TYPES`, answered as attributed human writes (`clan patch-data`
  with agent and action [E: docs/contracts/os-layer.md L149-156]). Answers are cited as
  `answer:<qid>` and the slide becomes `from_source` with the person as the source.
- Allow `doc:` fills for human-only types when the person attached the material (owner question 2).
- Measure: a deck whose owner answered the cards has zero placeholders on presented slides;
  team_proof and commercials_ask on such a deck score at least 4.

**6. Red team with one bounded revision.** (M)
- Section 4.2. One Sonnet call; objections shown at Gate 1 (storyline) and Gate 3 (deck); at most
  one wording or order change per objection; a decision per change.
- Measure: judges' one-line verdicts on the re-run stop naming "ignores the client's asks" and
  "objective arrives late"; cost per deck stays under $1.75.

**7. The evaluation bench.** (M)
- `deck/bench/`: loads `rubric.json` and the profile weights; blind labels; both orders; length
  reported and regressed; judge families recorded; a `bench.json` per run with `scoring_run_meta`
  [R: NAPKIN-EDGE L63]; a 12-deck human gold set with rank correlation per criterion.
- Measure: the first full run (12 clients, 3 arms, 2 seeds) exists with a noise line; "pipeline
  makes it better" is stated with its confidence interval, or not stated.

**8. Chain and single-idea checks.** (S)
- Section 3.5: `chain` in stage d, `idea_single`, `chain_links`, the relay test as a report.
- Measure: every live agency deck passes `chain_links`; idea_chain rises on the re-run.

**9. Tender: per-criterion written answers with weight share.** (M)
- Stage d for `tender_response` runs one call per scored criterion with a word budget from its
  weight; the deck is derived from the answers; `weight_share` check [R: NAPKIN-EDGE L54];
  response map shows weight and page share.
- Measure: on Lumen Water, every scored criterion has an answer within its page limit and the
  heaviest criterion holds the most words.

**10. Agency measurement, risks and competition slides.** (M)
- `risks` (presented, not last), `competition` (named alternatives and the plan to win), and a
  `measurement_plan` with KPI, baseline, target, lag and confounders [R: NAPKIN-EDGE L68-72;
  GUIDE L101]. Fernley's ground truth asks for named risks with mitigations [T: agency/inputs/
  ground_truth/requirements.md item 16] and the deck had none presented [R: TEST-RESULTS L127].
- Measure: headline_fit_limits on Fernley rises past 3.5; judges stop listing "risks missing".

**11. Investor: why now, what we know, ask early.** (S)
- The i prompt: `why_now` required, `what_we_know` after traction, the round's objective
  (milestones the money buys) on slide 2 with the ask, the scariest number disclosed before slide
  8. [R: GUIDE L62-64; TEST-RESULTS L135]
- Measure: Dockhand C problem_objective and insight rise by at least 0.5 each.

**12. Cost and transport hygiene.** (S)
- Record USD per stage under the CLI transport (today `usd_total` is 0 [R: TEST-RESULTS L22]);
  a repair prompt for stage i's JSON failure [R: TEST-RESULTS L155]; dangling `brief:` refs a
  warning when there is no brief [R: TEST-RESULTS L166].
- Measure: every run reports a non-zero cost; investor level A builds.

**Not yet** (and why): icons, charts as PNGs and brand kits (ADR 0027 is not accepted and the
bakeoff found icons marginal [R: SLIDE-BAKEOFF L104]); a paid model-based visual critique
(stage h finds the mechanical defects; the look is not the bottleneck [R: PILOT-RESULTS L183]);
a2 vision figures (real for Lumen Water, DK-001, but second to the thinking stages); HyperFrames
and animation polish; auto-launched research (ADR 0028 forbids it and quota is shared); a fourth
renderer or any skill package (SLIDE-SKILLS L103-111); presenting two territories by default
(DK-008/024 is the owner's call); web-checked words (DK-025: a model check would cost more than
it catches; the red team and the person are the guard for now).

**Three things we have wrong or are overbuilding** (expanded from the summary):

1. **Human-only means never filled.** `HUMAN_ONLY_TYPES` [E: spec.py L94-95] blocks the model from
   writing team, credentials, investment and next step even when the person attached the
   agency's own bios, cases or rate card, which the input rule counts as the person's own
   material [E: ADR 0023 L19-20; ADR 0028 L20-25]. The result is every deck ending in placeholders
   and team_proof flat at 2.0-3.0 whatever the inputs [R: TEST-RESULTS L149]. Keep "never
   invented"; drop "never filled".
2. **One shape for every input.** PITCH_MAX 18 and the full spine run whether the input is one
   line or a tender pack. The thin-tier sketch and stated limits fix this cheaply.
3. **Checks and renderers before thinking.** Twenty-eight checks, three renderers, a native layout
   library and a QA stage exist; there is no insight step, no objective slide, no red team and no
   bench. The next effort should go to stages b and d and to the evaluation, not to more checks
   of the same kind or more renderer work. Also: `evaluate.py` measures none of insight, idea or
   chain [E: evaluate.py L1-17], so the engine cannot see its own weakest criterion.

Also wrong, smaller: the rubric weights (section 1.5); the a0 five-question cap spent on generic
questions; four requirement-trace slides on an investor deck; "27 checks" in deck.clan against 28
in `validate.py` and `spec.CHECKS` [E: validate.py L1-44; spec.py L229-232].

## 7. Questions only the owner can answer, and what I could not verify

**Owner questions**
1. May non-Claude judges run in the offline evaluation bench (not in the product), given the
   Claude-only rule (ADR 0006)? Without them the panel is same-family and the self-preference
   caveat stands [R: GUIDE L139].
2. May team, credentials, investment and next step be filled from the person's own attached
   documents with `doc:` refs, keeping "never invented"? (Changes the reading of `HUMAN_ONLY_TYPES`.)
3. Should a prompt-only build produce a 10-slide sketch by default (section 5.1), with the full
   shape only when figures exist?
4. Does an `objective` slide at presented position 2 (brief read-back stays in the appendix) amend
   ADR 0024 acceptably?
5. Three gates (storyline, territory, final review) as proposed in `features/deck-maker-server.clan`
   `open_questions`, with supply cards at Gate 1? Or fewer?
6. Budget for the bench: about $150-200 of model spend for 72 decks plus judging, and two or three
   practitioners' time to score 12 decks blind. Which real briefs may be used internally?
7. Rubric weights for the agency pitch: move 8 points from the two code-gated criteria to team and
   commercials (section 1.5), or keep the default until the gold set says otherwise?
8. Two directions when the brief asks (DK-008, DK-024): both presented, or one plus an alternative?
9. For tenders, should the product write the scored response boxes (one call per criterion) and
   derive the presentation from them?
10. Is ADR 0029 (deck types as data) written anywhere? `profiles.py` L1 cites it; no file matches
    `0029*` in either repo.

**What I could not verify**
- The judge prompts and the scoring instructions used in the winning-pitch test; only the deck
  dumps (`judge/D-xx.md`) are in the outputs. The per-criterion rationales are summarised in
  TEST-RESULTS only.
- Actual model spend of the test runs (`usd_total` 0 everywhere) [R: TEST-RESULTS L22].
- Whether `respect_stated_limit` and the profiles existed when the test ran; TEST-RESULTS (2026-10-16)
  reports the cap miss and `profiles.py` cites the same day's research, so the order is unclear.
- The cause of the investor level A failures (unusable JSON, then `NoClaudeAvailable`) [R:
  TEST-RESULTS L155].
- Whether any question card was ever answered in a run: Fernley B's intake shows `answered: []`
  [T: agency/B/out/report.json], so the ask rung of the ladder is untested end to end.
- `features/deck-maker-handoff.clan` (named in ADR 0028) is on no local branch I could read; the
  confirm step and the exact supply flow are known to me only from the task brief and the draft
  contract on `feat/deck-maker-ui` (`docs/contracts/deck-maker.md` L32-47).
- Rendering in real PowerPoint or Keynote (LibreOffice only) [R: PILOT-RESULTS L208-210].
- The 7-deck eval of 2026-10-05 (`engine/outputs/deck_runs/eval`) beyond what `deck.clan` records.

## Appendix: evidence index

Research (this folder): GUIDE.md L7-15 (purpose, recall, relay), L21-27 (gate first), L34-47
(agency weights, wins and losses, credentials), L51-58 (tender), L62-69 (investor), L75-79
(order, chain, insight definition), L83-89 (length), L93-95 (idea), L99-101 (plan and proof),
L105-109 (team, price, ask), L113-123 (how pitches lose), L131 (award caveat), L135-142 (judges).
RUBRIC.md L5, L9-22, L36-44, L73-82, L98. rubric.json L57-94. NAPKIN-EDGE.md L3, L24-37, L43-49,
L53-64, L68-80. TEST-RESULTS.md L3, L17-24, L43-62, L66-94, L100-110, L114-137, L141-156, L160-166,
L170-179. PILOT-RESULTS.md L77-97, L179-201, L203-231. SLIDE-BAKEOFF.md L98-127. SLIDE-SKILLS.md
L8-18, L103-111. SOURCES.md L111-120.

Engine (`napkin-deck-handoff/`): engine/deck/README.md L12-18, L49, L69-105, L146-161. spec.py
L9-53, L55-59, L68-97, L120-136, L138-150, L180-198, L229-237. stages.py L1-25, L40-49, L85-95,
L164-300. prompts/*.md. assemble.py L100-170, L450, L534-547. validate.py L1-44, L276-277,
L332-334. intake.py L1-15, L28, L35, L62-78, L241+. refs.py L202-220. profiles.py L1-48 and
profiles/*.yaml. evaluate.py L1-26. run_deck.py L106-211. docs/deck-maker/PLAN.md L54-61, L71-102,
L149-157. docs/deck-maker/edge-cases.md L21-31, L44, L51, L60-65. docs/deck-maker/kickoff-prompt.md
§3. engine/rag/docs/adr/0016 L31-35; 0023 L15-33; 0024 L15-27; 0025 L15-31; 0026; 0027 L1-30;
0028 L20-39.

Test outputs (`napkin-deck-handoff/engine/outputs/winning_pitch_test/`): agency/inputs/prompt_A.txt,
prompt_B.txt, brief_object.json, research.clan (findings `so_what`, fi_5 rejected);
agency/B/out/report.json (`intake.dropped`: budget_scope "limited", background "RRP");
agency/B/stages/a0_intake.json (questions); agency/C/stages/b_storyline.json, d_idea.json,
fit.json (7 partly, 1 not); agency/C/out/deck.json (order: objective read-back at slide 19, in the
appendix); judge/D-23.md L63-80 (insight slide as judged); agency/inputs/ground_truth/requirements.md.
Rendered: `engine/outputs/pilot/agency_C/new_png/s-04.png` (insight), `s-07.png` (idea),
`s-17.png` (investment placeholders), `pilot/investor_C/new_png/s-02.png` (problem).

Studio OS (`napkin-studio-os/`): features/deck-maker-server.clan (gates, done_when, open
questions); `git show feat/deck-maker-ui:docs/contracts/deck-maker.md` L32-52 (gates, approve/
edit/retry, change requests, placeholders as "To supply"); docs/contracts/os-layer.md L133-156
(decision kinds, attributed writes with targets and cites).
