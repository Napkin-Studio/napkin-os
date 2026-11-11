# Design proposal: checks

Open `index.html` in a browser. Thirteen pages, each drawn for 390 and 1440 px.
Screenshots at both widths are in `shots/` (26 files). Rebuild with `python3 docs/design/build.py`.

These are static pages. They show layout, hierarchy and words. Nothing in them works.
Laurence judges the look. The checks below prove only the rules that can be measured.

## What is on each page

| Page | Shows |
| --- | --- |
| o.html | The O as a map: the agency logo at the centre, five department circles, the person's own marked, two more as text |
| home-planning, home-creative-director, home-account-service, home-management | Needs you first, then five doors, then More tools. The doors follow the table in v2 section 4 |
| brief-gate.html | Six gate items, one question for the client, and a dashed Sign button with its reason |
| visual-brief.html | The one-page visual brief. The creative director approves one exact version |
| client-confirm.html | The link a client opens on a phone, with no account |
| dashboard.html | Six tiles as plain numbers. J001 only |
| timesheet-day.html, timesheet-consent.html | A drafted day with one gap, and the consent question shown before anything is captured |
| home-planning-black.html | The one Black mode sample |

## The Count check: passes

Measured in Chrome at both widths by a script (`docs/design/shots.mjs`).

| Rule | Result |
| --- | --- |
| One primary button per screen | 10 pages have exactly one. The O, the dashboard and the index have none: their links are the actions |
| Four type sizes or fewer, plus 12 for labels | Every page uses 13, 21, 34 or 55 px, and 12 px for uppercase labels. No page uses more than three of the four |
| No card inside a card | None. One rectangle exists, around the visual brief |
| Tap targets 44 px or more | No button, door, chip or text link is under 44 px, at either width |
| No sideways scroll | 0 px overflow on all 26 screenshots |
| Nothing moves | The pages have no animation or transition |
| No em dashes | The build script refuses to write a page that contains one |

## The Squint check: passes, by my eye

Checked on the screenshots at reduced size. Laurence should repeat it.

- **Homes.** The Needs you list reads first, then the one solid button, then the doors.
- **Brief gate.** The six gate rows read first. The word Missing is the only bold in the list. The dashed Sign button reads as not yet available.
- **Visual brief.** The territory name reads first, then the reference frame, then Approve.
- **Client link.** The proposition and the measure read first. Confirm is the one solid button and stays at the bottom of the phone.
- **Accent.** It marks only where you are (the last crumb, the person's own circle on the O) and counts (3 things, 5 of 6). An earlier draft also used it for Missing and for the question's side rule. I removed both: they were emphasis, not one of the four allowed uses.

## Contrast

| Mode | Accent on paper | Grey text on paper |
| --- | --- | --- |
| White | 6.4 to 1 | 5.3 to 1 |
| Grey | 6.0 to 1 | 6.3 to 1 |
| Black | 10.0 to 1 | 8.3 to 1 |

All pass 4.5 to 1. One sampled colour cannot pass on both white and black, so the accent's
lightness is set per mode. That is what v2 section 5 asks for ("adjust its lightness").

## Not checked, and why

- **Speed and Keyboard only.** Both need a working screen. They belong to Phase 1.
- **axe.** Not run on these pages. It is Phase 1 test 7.
- **Grey mode.** The tokens exist. No Grey sample is drawn, since the prompt asks for White plus one Black sample.
- **Newsreader.** The pages name Newsreader for display and fall back to Georgia, since no web font is loaded. The headings in the screenshots are Georgia. How Newsreader ships without web-font loading is a question in the typography record.

## Choices Laurence should look at

1. **Needs you sits above the doors.** v2 lists doors first. I put the work first, because a home's job is to say what is waiting. Swap it back if the doors should lead.
2. **The dashboard has no chart and no large coloured tile.** v2's Never list rules out big number tiles with decorative charts. The six tiles are a label, one number in display type, and one line naming the job.
3. **The brief is signed before the client confirms it.** The repo's contract only allows a client's answer on a locked document. v2 has the client confirm first. See open question 4 in docs/discovery/open-questions.md.
4. **The O has no primary button.** The circles are the actions.
5. **J001 is shown as Client A**, and the agency is a placeholder. The repo never commits client material.
