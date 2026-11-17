# Audit: the shell and the agency layer

Area: `app/` (not templates, not src-tauri), `app/e2e/`, `crates/napkin-web/src/auth.rs`.
Read at d64e0899 by a read-only subagent. No test was run for this area; each line is from reading code.

**The headline.** Almost none of the agency-facing layer in the prompt exists. The shell is a
client desk, with no roles, no permissions, no O map, two modes, and no timesheet. Phase 1 is
mostly new work, not a restyle.

| Phase 1 line | What exists | Record and status | Missing |
| --- | --- | --- | --- |
| The O | No map. `#agency` renders a client desk: one circle per client, a four-way dial, Pick up where you left off (`app/src/shell/nui/Desk.tsx`). The Deep O is a studio mark, not navigation. First page shows 8 client circles, not 5 | landing-circles (building), new-ui-shell (verifying) | The O as a map, the agency logo at the centre, department circles, the five-circle cap |
| Role homes, doors, More tools | No role or department anywhere. `Account` holds username, agency, name (`crates/napkin-web/src/auth.rs:46`). The dial has four fixed quadrants: Brief, Research, Deck, Production (`Dial.tsx:33`). No More tools list | new-ui-shell | Roles, homes, doors per role, More tools |
| Needs you | One count per document, tool-neutral, in the desk and the Decisions drawer. Not per person or role | landing-circles | A per-person list with a next action per item |
| Role access (403 on Scope) | The only 403s are tenant mismatch, a bad sandbox token and dogfood export (`tenant.rs:167`, `sandbox.rs:62`). Everyone in an agency sees everything in it. No Scope route | none | The whole permission layer |
| Three modes | Two: light and dark (`app/src/theme.ts:14`). No Grey | new-ui-shell | Grey mode, and the white, black, mid-grey palette. Today's palette is warm paper or cool ink |
| Type | Geist first, Helvetica Neue as a fallback, Newsreader for serif. Loaded from Google Fonts at runtime (`app/index.html:14`) | open decision in napkin-studio.clan | Helvetica Neue as the face, and no web-font loading |
| Accent | Fixed `#FF4F2E`, or a hand-set colour per agency from a table of nine (`shell/agency/palette.ts:73`) | new-ui-shell | Sampling from a logo |
| Logo upload and contrast | No upload. Logos are checked in. `contrast()` picks black or white ink at 4.5 to 1 (`palette.ts:158`); it never adjusts the accent | new-ui-shell | Upload, sampling, lightness adjustment |
| Agency dashboard | No tiles. The server gives `needs_you` and run state per document (`crates/napkin-host/src/library.rs:82`); the browser adds them up (`shell/landing/model.ts:178`) | landing-circles | Six tiles and a server-side index |
| Undo and versions | None in the shell. Undo exists only in the Production Tool (`production-tool/web/src/ui/useUndo.ts`). Lock and reopen exist for a document | system-undo (building, Production Tool only) | Shell undo, a version list, compare, restore |
| Sign-in | Cognito, a local password file, and a no-password roster for staging (`auth.rs`). Seven-day signed cookie | no-password-sign-in (verifying) | A one-time email link |
| Client review link | None. "Client review" is a mode where agency staff record what the client said (`ClientReviewPanel.tsx`, os-layer.md 7.5). Share copies a link that asks for sign-in | spinoff-and-links | A link a client opens with no account |
| The one bar | One toolbar on every screen, filled by apps through `clan:bar` (`components/Toolbar.tsx`). No Cmd K, no search, no Ask Nap, no voice | app-bar-actions (verifying) | Cmd K, search, Ask Nap, voice |
| Nine screen states | None as shared components. Ad hoc: a loading mark, a Changed brief notice (`Toolbar.tsx:541`), a saved-ago line, coming-soon cards | launcher-coming-soon | All nine as shared components. The shell is not told when a write fails |
| Timesheet | None. The nearest thing is dogfood telemetry, which records clicks and requests after an Agree notice | dogfood-telemetry (verifying) | Everything |
| e2e harness | `cd app && npm run e2e`, or `scripts/check.sh --only e2e`. Starts the real shell and napkin-web on 127.0.0.1:18080. Specs already use 390 and 1440. Placeholder clients only (Client A, Client B). Not in `--all`, not in CI | landing-circles | A J001 seed. None exists anywhere in the repo |

## Where the prompt is wrong about the code

1. It says to wrap `landing-circles` and `project-home`. `project-home` is a Production Tool feature, not the shell. `landing-circles` still describes an older design that `new-ui-shell` replaced. The record to wrap is `new-ui-shell`.
2. `system-undo` is undo inside the Production Tool only. There is no system-wide undo to build on.
3. `new-ui-shell` says the dial has a More tools petal. The code has none.
4. The "client_review decision" exists, but its actor is agency staff. A client actor is a contract change.
5. Tests 13 to 16 assume a Failed save state. The shell cannot show one today: it is not told of a failed write.
