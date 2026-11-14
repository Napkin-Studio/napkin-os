# Phase 3 acceptance: the proposed test list

Status: proposed, not approved. Feature record: `features/j001-phase3-suite.clan`.

The Phase 3 gate is "J001 has a scored still, film, radio spot, poster and format pack" (v3.1 section 9). That is one
sentence nobody can run, so this list is written first. It carries on from the 55 Phase 2 tests in
`docs/design/phase2-acceptance.md` (19 to 73) and runs from 74 to 111, 38 tests.

Every test is an observable fact, run at 390 and 1440 px on fixtures only. No test calls a paid provider or a model: the
mock provider and the stand-in middleware answer from files, and the paid-call switch stays off (cap 0). Each test names the
feature record that turns it on and the gate line it serves. Until that record lands, the test is written in full in
`app/e2e/j001-p3-<record>.spec.ts` and marked `test.fixme`. One spec file per record, so no two records edit one file.
`node app/e2e/phase3-fixme.mjs` prints the live and fixme counts (the same shape as `phase2-fixme.mjs`), and the
records read the list through `app/e2e/phase3/tests.mjs`. Numbers are never reused: a dropped test stays in the list marked
withdrawn with the reason.

Gate lines. The six of the gate sentence are `still`, `film`, `radio`, `poster`, `pack` and `scored`. Two more are named
here because the build needs them and the sentence does not: `rules` (spend, ledger, labels, provenance, walls and rights)
and `business` (client pieces, scope, traffic, library and doors). Test 111 and tests 94 to 99 are the `scored` line.

The seed gains J001's media, made in the repo and owned by Napkin (`app/e2e/seed/j001/media/`, listed in its
`SOURCES.md`, hash-proved by `node app/e2e/seed/j001/media/verify.mjs`): one product photo (a drawn bottle on a plain
ground), one scamp, a 30 second radio script and a 10 second TV script with beat ids, one approved layout, and five site
placeholders with known corners. None comes from `client_briefs/`.

## Production on the merged line, the platform rules and the money

| No. | Record | Gate line | The fact |
| --- | --- | --- | --- |
| 74 | production-line-merge | still | A signed-in producer opens Production inside the shell at /production and sees J001's Production document. An account with no agency gets 401. |
| 75 | production-platform-rules | rules | Every entry in the chain of J001's Production document names an agent and an action, for people and for the crew. |
| 76 | spend-guard-unified | rules | With the cap at 0 every paid op and every model call is refused. The person reads one plain line, 'Paid runs are off here. Nothing was sent.', and the mock transport records nothing. |
| 77 | spend-ledger | rules | A mock run writes one ledger line that names its tier, and one run_cost decision when the run closes. The figure shows in the Decisions drawer and nowhere else. |
| 78 | job-budget-override | rules | At 80 percent of the job's budget one need, 'J001 has used most of its budget', reaches the Money group with no figure. A run past the budget is refused. A named person's override lets that one run through, and the chain shows it. |
| 79 | production-platform-rules | rules | Refusals show no figure: the limit and spend-stop messages hold no digit and no currency word. |
| 80 | media-router | still | The three tier words hold no price. The job's history shows the tier, the providers tried and the one used. |
| 81 | result-cache | rules | The same run twice calls the provider once. The second is marked reused, reserves nothing and writes a ledger line of 0 with the reason cache_hit. |
| 82 | asset-provenance | rules | J001's still, film and radio spot each carry provenance with every field: provider, model, tier, seed, prompt hash, inputs, parents, job, ledger lines, who made it and its AI state. |
| 83 | ai-labels-marks | rules | Every exported still, film and spot carries a visible AI label and a machine-readable mark that reads back from the file. An export with no label is refused. |
| 84 | media-rules-gate | rules | For a restricted client, a UGC or real-face job is refused without a legal sign-off and a consent record, allowed with both, and refused again once the consent has expired. Words to be drawn never go to an image model. |
| 85 | media-providers-adr | rules | A job holding client material is refused for a provider the agency has not cleared, with 'This provider is not cleared for client material.' Marking a provider allowed is a person's decision. |

## Still, film, radio, poster and the format pack

| No. | Record | Gate line | The fact |
| --- | --- | --- | --- |
| 86 | stills-pipeline | still | From J001's scamp and product photo: scamp to image to photograph to still, three jobs with lineage. The still has its provenance and its label. Send to Judge records one request and Send to Formats makes a set of 12 sizes. |
| 87 | film-pipeline | film | Send to Film from the J001 TV script lands a script node with the same beat ids. The rough film is 10.000 seconds long with an audio stream. |
| 88 | motion-engine | film | An end card is rendered in code from the approved layout. The same layout and preset give the same frames, and no model is called. |
| 89 | radio-tool | radio | Send to Radio from the J001 30 second script opens the cue sheet. Voice it makes a 30.0 second spot a person can play in place, in under five seconds on the mock. |
| 90 | radio-core | radio | A 34 second read in a 30 second slot is flagged with the over-run per line, and Voice it is not offered. |
| 91 | outdoor-in-situ | poster | The J001 poster is placed on a site placeholder with known corners: its corners land within 1 pixel, the word Mock-up is on the output, and no model is called. |
| 92 | format-pack | pack | J001's 12 formats make one checked pack with no paid call. 2 of 12 are flagged, each needs a look by a person, and the pack is ready only when both are decided. |
| 93 | six-recipes | still | Add lists the six recipes. Clean Packshot runs on the mock from J001's product photo and makes its steps in order. |

## Judge scores the five pieces

| No. | Record | Gate line | The fact |
| --- | --- | --- | --- |
| 94 | judge-media-rubrics | scored | A fixture verdict scores J001's still out of 30. The verdict names the piece by its hash, carries work_kind still, and its total is the sum of the tests. |
| 95 | judge-media-rubrics | scored | A fixture verdict scores J001's film out of 30. The verdict names the piece by its hash, carries work_kind film, and its total is the sum of the tests. |
| 96 | judge-media-rubrics | scored | A fixture verdict scores J001's radio spot out of 30. The verdict names the piece by its hash, carries work_kind radio_spot, and its total is the sum of the tests. |
| 97 | judge-media-rubrics | scored | A fixture verdict scores J001's poster out of 30. The verdict names the piece by its hash, carries work_kind poster, and its total is the sum of the tests. |
| 98 | judge-media-rubrics | scored | A fixture verdict scores J001's format pack out of 30. The verdict names the piece by its hash, carries work_kind format_pack, and its total is the sum of the tests. |
| 99 | judge-media-evidence | scored | A confidential part of a piece is left out of what Judge reads and the verdict records not_read. The prompt, the seed and the maker's name are in no evidence. |

## The business end: client pieces, scope, traffic, library and doors

| No. | Record | Gate line | The fact |
| --- | --- | --- | --- |
| 100 | craft-review | business | A media piece with no passing craft review of its exact version cannot reach a client link: 'This piece has not had its craft review.' With a pass, the client's page shows the reviewer's name beside the piece at 390 px. |
| 101 | client-pieces-media | business | At 390 px the client sees one piece at a time, an image, a film with its poster frame and an audio player, each with its label text and its craft reviewer's name, and can comment on that piece. |
| 102 | scope-document | business | The fourth round on a three round job: a change order is drafted, the round is refused with 'This round is outside the scope. A change order is waiting.', and a need reaches the producer. Approving the change order in the Booth lets the round go ahead. |
| 103 | scope-document | business | Invoice lines are drawn from confirmed timesheet days only, each with its source ids. The CSV download holds the same lines. |
| 104 | scope-document | business | Only the Money group opens the scope. A producer reads the figures in the sheet and none in the shell around it. A planner gets 403 or the Empty state, and no search result shows the scope. |
| 105 | traffic-board | business | A traffic manager staffs an open role on a new job from the board within 60 seconds, with a fixture of 12 people: up to five suggestions with their reasons, one decision, and the board updates. |
| 106 | asset-library | business | A still, a film and a spot approved on J001 are findable by client, product, format, kind and date. A second agency finds none of them. |
| 107 | phase3-doors | business | Each Phase 3 door (stills, video and motion, radio, formats and in situ, scope and estimates, traffic board, craft review) opens its tool for each role that has it, and a role without the door gets 403 or the Empty state. |

## Providers, the whole suite and the dashboard

| No. | Record | Gate line | The fact |
| --- | --- | --- | --- |
| 108 | j001-phase3-suite | rules | axe finds nothing serious on every Phase 3 page in all three modes. At 390 px each primary button is 44 px tall. No interface text holds an em dash. |
| 109 | flux-provider | still | With the first provider down, a still on Sketch goes to the next candidate, FLUX, and the job records both attempts. With every real provider down the job fails with one plain line and no output of kind mock. |
| 110 | elevenlabs-provider | rules | A canary key set on the server reaches no Phase 3 response, document, log line or export. No retrieval trace holds a hit from Cannes, Effie or WARC. The run log shows no provider call. |
| 111 | j001-phase3-suite | scored | The dashboard's Judge tile counts J001's five scored pieces from fixture verdicts. |

## What these tests cannot prove

- That a real model draws a good still, a good film, a voice a person believes or a poster that passes for a real one.
  The mock provider answers with tones, flat frames and fixtures. They prove plumbing, ids, timings and rules.
- That Judge's score agrees with a creative director. Its trust stays `none` until it is earned on real work.
- That a provider's price, rate or terms are what a sheet says. Rates are re-read live before any quote.
- That a pack of 12 sizes looks right on a real platform. A person looks at the flagged ones, as test 92 says.
- That the label wording satisfies the law. No pilot goes live before the legal view (v3.1).
- The look. Laurence judges it.

## The five manual gate checks (not in the automatic count)

These need a real provider, so they are not tests in `app/e2e` and are counted apart: 38 automatic tests, 5 manual checks.
Nothing in `app/e2e` calls a provider: `scripts/check.sh` runs with every provider key unset, and the suite's own spend guard
(test 76) refuses a paid call at cap 0. A manual check runs only after Laurence raises the cap at the gate. Each is run by
the record named, on the mix stated, with the cap shown (a proposal, set by Laurence, not by a builder), and watched by the
person named. The command is the one the owning record ships as `scripts/gate-g<n>.sh`; until that record lands there is no
script, and the line says so.

| Check | What a person must see | Owning record | Command | Cap needed (proposed) | Who watches |
| --- | --- | --- | --- | --- | --- |
| G1 a real still | One real still made from J001's scamp and product photo at Hero, scored by the real Judge backend, with the type set as layers | stills-pipeline | `scripts/gate-g1.sh` (not written yet) | 5 euro | Laurence O Byrne, with the art director |
| G2 a real 10 second film | One real 10 second film from the J001 TV script, with sound, within the slot | film-pipeline | `scripts/gate-g2.sh` (not written yet) | 15 euro | Laurence O Byrne |
| G3 a real voiced spot | One real 30 second voiced radio spot from the J001 script, with an audible AI line | radio-tool | `scripts/gate-g3.sh` (not written yet) | 5 euro | The copywriter who wrote the script, with Laurence O Byrne |
| G4 a poster a person believes | The J001 poster placed on a real, licensed site photo, labelled Mock-up, that a person who does not work here takes for a plausible outdoor site | outdoor-in-situ | `scripts/gate-g4.sh` (not written yet) | 10 euro | Laurence O Byrne and one person from outside the studio |
| G5 the pack's paid sizes | The pack's sizes that cannot be made by crop or layout, made through the router and checked, with each flagged size looked at | format-pack | `scripts/gate-g5.sh` (not written yet) | 10 euro | Account service, with Laurence O Byrne |

Each check writes its ledger lines and its provenance, and its piece is scored by Judge, so the gate sentence is true of real
output and not only of fixtures. A check that fails is reported as failed; nothing marks it passed.
