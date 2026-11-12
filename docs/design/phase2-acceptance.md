# Phase 2 acceptance: the proposed test list

Status: proposed, not approved. Feature record: `features/j001-phase2-suite.clan`.

The Phase 2 gate is "Laurence reviews J001 from brief to chosen route" (v3.1 section 9).
v2 and v3.1 give no numbered tests for Phase 2, so this list is written here. It carries on
from the 18 Phase 1 tests in `app/e2e/j001-pilot.spec.ts`.

Every test is an observable fact, run at 390 and 1440 px, on fixtures only. No test calls a
model or a paid provider: the stand-in middleware answers each task from a fixture file. Each
test names the feature record that turns it on. Until that record lands, the test is written
in full and marked `test.fixme`.

The tests prove the measurable rules. Laurence still judges the look and the path by hand at
the gate.

## Homes, the job and Needs you

| No. | Record | The fact |
| --- | --- | --- |
| 19 | remaining-homes | Art director, Copywriter, Producer, Agency Brain and Traffic each see their own five doors and More tools, as in the v2 doors table. |
| 20 | remaining-homes | A copywriter opening the Proprietary data address gets 403. A person with a Phase 1 role and a Phase 2 role gets one merged home of five doors. |
| 21 | job-page | Open J001 from Live jobs. One job page shows its stage, its documents, who holds it and its deadline. Each tool opens inside the job. |
| 22 | job-page | The brief gets a new version after work has started. The job page shows Changed brief with two lines and one button, Update to brief vN. |
| 23 | needs-you-full | Needs you shows only that person's items, soonest deadline first, five and then Show all. An empty list names the next deadline. |
| 24 | needs-you-full | A done item leaves with five seconds to undo. Undo brings it back. After five seconds it is still gone after a reload. |
| 25 | needs-you-full | Each event in the v2 alerts table lands in the named person's Needs you and in nobody else's. |

## The bar, first day, Ask Nap and voice

| No. | Record | The fact |
| --- | --- | --- |
| 26 | one-bar-search | From any screen: open the bar (Cmd K at 1440, the bar button at 390), type "J001 brief", Enter. The brief opens. The ? key lists the shortcuts. |
| 27 | one-bar-search | Search keeps the walls. A person in a second agency finds nothing of J001. A role that cannot open money gets no Scope result. |
| 28 | first-day | An invited copywriter signs in, lands in their own home, and sees three pointers once. Their first Needs you item is a real J001 task and it opens. On the second visit the pointers do not show. |
| 29 | ask-nap | Ask Nap opens with three suggestions for the screen. Its answer names its source. A proposed change shows as a preview with Keep and Discard, and Discard leaves the decision chain as it was. |
| 30 | ask-nap | A run shows its price before it starts. With the cap at 0 the run is refused with one plain line and nothing is sent. |
| 31 | voice | A spoken command (a fixture transcript) does what the typed command does. Before sending work to a client, the bar shows what it heard and waits. Cancel does nothing. |
| 32 | voice | The microphone is refused, or the speech provider fails. One plain line shows and the bar still takes typing. |

## Approvals and the client

| No. | Record | The fact |
| --- | --- | --- |
| 33 | approval-route | Account service names who approves each stage and by when. The job shows who holds it and for how long. |
| 34 | approval-route | An approval two days late shows in the approver's Needs you and on the dashboard, then in account service's. |
| 35 | approval-route | An approval is withdrawn. The stage returns to its holder and the earlier approval stays in the history. |
| 36 | client-review-full | At 390 px the client opens one piece with no account, sees its version and AI label, and presses Approve. One client_review decision lands on that exact version with the reviewer's name. |
| 37 | client-review-full | The client asks for changes: a comment pinned to a spot, tagged to a brief point. Two reviewers' comments show as one list, with the contradiction flagged. The round number shows against the rounds in scope. |
| 38 | client-review-full | The client wall. The seed holds every field, and the link's responses hold only the allowed ones: no Judge score, no note, no idea card, no Banned list. A used or expired link shows one plain line. The email code works against a fake sender. |

## Setup, sign-on and time

| No. | Record | The fact |
| --- | --- | --- |
| 39 | agency-setup | An admin sets up an agency in the flow: logo, 120 people from a CSV file, roles, clients. No code. An imported person signs in to the right home. |
| 40 | agency-setup | A bad CSV row is listed with its reason and the rest import. A role change takes effect on the next request. A second agency's admin sees none of the first's people. |
| 41 | sso | A person signs in through a fake identity provider and lands in their own home with their roles. A person from an unknown domain is refused with one line. |
| 42 | sso | The identity provider fails. One plain line shows, no half session is left, and Try again works. |
| 43 | timesheet-signals | With no consent for calendar, no calendar signal is captured. With consent, a fixture meeting becomes a draft line. Only the person confirms it, and nothing is submitted for them. |
| 44 | timesheet-signals | Consent is withdrawn. Capture stops and unconfirmed signals are deleted. No manager's screen shows a person's correction pattern. |

## The Idea room

| No. | Record | The fact |
| --- | --- | --- |
| 45 | idea-room | Humans first. With four team cards the AI shows no ideas and says one card to go. The fifth card opens it. |
| 46 | idea-room | The creative director opens the AI early: one decision in their name. A copywriter trying the same gets 403. |
| 47 | idea-room | Ban the default posts three ideas as Banned. A team card that matches one is flagged. A card shows its Swap test flag and its two Fame test lines. |
| 48 | idea-room | Three routes are three forks. Merging them calls no model. The merged file holds all three, a clash is listed with both sides, and the chain shows the merge. |
| 49 | idea-room | Originality. With no own-words records the check says it is off. With fixture own-words records a close idea shows its precedent and source. A record from Cannes, Effie or WARC, or one not marked own words, never shows. |
| 50 | idea-room | The creative director picks the route: one decision, in their name, on that exact route version. A copywriter's pick is refused. No AI task can write the pick. |
| 51 | idea-room | Cut the network while writing a card. Failed save shows, the text stays, Try again saves it. Later the creative director reopens the choice with a reason, and the first pick stays in the history. |
| 52 | idea-room | The brief gets a new version after routes exist. The Idea room shows Changed brief and Update to brief vN. |

## The Script editor

| No. | Record | The fact |
| --- | --- | --- |
| 53 | script-editor | A copywriter writes a radio script. Read time shows in seconds. The live check lists a missing mandatory line and a banned word, with no model call. |
| 54 | script-editor | The creative director marks up the script. The writer accepts one change and rejects one. Each mark and each answer is a human patch in the chain, under the right name. |
| 55 | script-editor | Restore v1 makes a new version and v2 stays. An approved version is locked. At desktop width Cmd Z undoes the last edit and it can be brought back. |
| 56 | script-editor | One click each: the radio script goes to Radio, the TV script goes to Film with its beat ids, and a draft goes to Judge and comes back with its score. |
| 57 | script-editor | A rewrite run fails. One plain line shows, the credits come back, the selection and the page are as they were. No rewrite reaches the page without Keep. |

## Judge

| No. | Record | The fact |
| --- | --- | --- |
| 58 | judge | A fixture score of 22 with idea 7 returns to the team with notes. Each sub-score names its evidence. The verdict in the file carries its reason codes and the Judge version. |
| 59 | judge | A fixture score of 22 with idea 9 goes to the creative director marked "Brave, fix the craft". A score of 24 or more goes to the creative director. |
| 60 | judge | The creative director overrules a score. With no written reason it is refused. With one, their own verdict answers Judge's, and Judge's stays. A copywriter cannot overrule. |
| 61 | judge | The dashboard's Judge tile shows the J001 numbers within 10 seconds. No screen and no response scores a person. |
| 62 | judge | The client wall. What leaves the vault holds numbers, codes and ids only: a canary sentence in the work is in no telemetry row. Judge refuses when the client's AI switch is off, and on a route that is not EU-pinned. |
| 63 | judge | Judge fails. One plain line shows, the credits come back, and the creative director can still decide. A score from a rubric that is not yet trusted says so. |
| 64 | judge | A new version gets a new score. The old score stays on the old version. A new brief version marks the old score as out of date. |

## The Napkin Brain

| No. | Record | The fact |
| --- | --- | --- |
| 65 | napkin-brain | After the J001 brief is approved and the route chosen, the ingest writes pages that each cite an entry in a decision chain. The index lists them, the log has grown, and brain.clan holds one decision per page edit. |
| 66 | napkin-brain | Only a page built from client-accepted work carries the verified mark. The chosen route, not yet accepted by the client, is labelled an idea. |
| 67 | napkin-brain | The walls. Client A's pages are not in Client B's brain, nor in a second agency's. A role with no right to client brains gets 403. The agency's own brain holds no client text. |
| 68 | napkin-brain | A fact changes. The old line is marked superseded with a link, and both remain. Running the ingest twice adds nothing. |
| 69 | napkin-brain | Ask the brain answers in two lines that link the page and the chain entry. When it does not know, it says so. A keyword search finds the page with no model. |

## The whole path, and the rules across it

| No. | Record | The fact |
| --- | --- | --- |
| 70 | idea-room | J001 from brief to chosen route, in one run: signed and confirmed brief, five team cards, three routes, three scores, one pick by the creative director. The job page shows the chosen route. |
| 71 | j001-phase2-suite | Every write in every Phase 2 J001 document names an agent and an action, and every human edit is marked as a person's. |
| 72 | j001-phase2-suite | axe finds nothing serious on every Phase 2 page in all three modes. At 390 px each primary button is 44 px tall. No interface text holds an em dash. |
| 73 | j001-phase2-suite | A canary key set on the server reaches no Phase 2 response. No retrieval trace holds a hit from Cannes, Effie or WARC. The run log shows no model event. |

## What these tests cannot prove

- That a real model writes a good Banned list, a fair score or a useful rewrite. Fixtures
  stand in for every model answer.
- That Judge's score agrees with a creative director. That is earned on real work, as
  `features/judge.clan` describes.
- That sign-on works with a real identity provider, that an email code arrives, or that a
  calendar, Slack or email signal arrives from the real service. Each runs against a fake.
- That the client can approve a piece in under a minute on a real phone. Laurence checks
  that by hand at the gate, as in Phase 1.
- The look. Laurence judges it.
