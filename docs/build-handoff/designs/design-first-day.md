# Design: first-day

Record `features/first-day.clan` in `/home/napkin/napkin/napkin-fabletest`, branch `feat/first-day`, status `exploring`, not approved. Owner: Laurence O Byrne (product and look); Shreyansh Soni for the sign-in and store questions.

This is a design only. No code was written, no record was patched and nothing in any git repo was changed. Read on `spike/fabletest` at `7b614b99` and on the worktrees of `feat/align-landing-look` (`3fb91b4b`) and `feat/align-confidential-prices` (`c4340d7d`).

**The record's existing design is out of date and should be replaced by this one.** It was written on 12 Nov, before the owner's rule of 13 Nov (develop is the model). Five things it stands on are gone or going:

| The record assumes | What is true now |
|---|---|
| The newcomer lands on a role home (`app/src/shell/home/Home.tsx`) | Deleted on `feat/align-landing-look`. Everyone lands on the desk (`app/src/shell/nui/Desk.tsx`, `#agency`) with a "Your pages" row (`home/YourPages.tsx`). |
| A pointer at the one bar's field (`one-bar-search`) | The approval of 13 Nov keeps Cmd K and drops the field. The bar is develop's OS bar (`app/src/components/Toolbar.tsx`, `data-testid="os-bar"`). |
| A per-person Needs you list owned by `needs-you-full` | `align-needs-lock-people` (approved) keeps one Needs you: develop's `decisions/needs.ts needsOf`, the desk's Me rows, the Decisions drawer. |
| The invite calls agency-setup's route and `directory.rs` | `align-needs-lock-people` removes `/t/{tenant}/agency/people/invite` and `directory.rs`. The one store is `crates/napkin-web/src/people.rs`, the one screen is `app/src/shell/people/PeoplePage.tsx`. |
| It must add a Mailer and `Provider::lookup` | `crates/napkin-web/src/mail.rs` exists (built by `client-review-full`) and already has `Message::Invite {to, agency, url}` with fixed words. The People store answers "does this person exist" (`People::active`). |

## 1. Problem

A new person cannot be brought in by the product in a way that gets them to work. An admin can add a person on the People page (`POST /api/admin/people`, `crates/napkin-web/src/admin.rs`), but then nothing happens: nothing is handed to the admin to send, the sign-in screen (`app/src/shell/SignIn.tsx`) reads nothing from the address, the newcomer lands on a desk nobody has explained, and their Needs you is empty because they are on no job. v2 section 4 ("First day for new staff") asks for four steps and one measure: an invite, a sign-in, their own first screen, three pointers shown once, a first Needs you item that is a real task on a live job, and a real task opened within two minutes with no training call. Phase 2 test 28 (`app/e2e/j001-p2-first-day.spec.ts`) is `test.fixme` waiting on this record.

## 2. done_when

Each line is an observable fact with the test that proves it. "Test 28" is Phase 2 test 28 in `app/e2e/j001-p2-first-day.spec.ts`, turned on in place at 390 and 1440 px, light and dark. S17, S18 and S19 are this design's own shell tests in the same file (the numbers are free in `app/e2e/*.spec.ts` today).

1. **An admin invites from the People page.** On a person's row an admin presses "Invite", may pick one document of a live job as the first thing to open, and gets a link to copy. Test: S17 (the admin adds `newcomer@wk` as a copywriter, picks the J001 script, copies the link); Rust `crates/napkin-web/tests/first_day.rs` (201 for an admin, 403 for a planner, 404 where the server keeps no people store, 400 for a document that is not on a live job of that agency).
2. **The link needs no outside account.** It is copied. Where mail is on and the admin typed an address, `Message::Invite` is also sent and the address is not kept. Test: Rust, with `mail::Memory` the outbox holds one Invite whose body is the fixed words and the link, with no client name, job number or document title; with `mail::Off` the route still answers the link.
3. **The link opens the sign-in screen with the name filled in, and one press signs the person in on the desk.** Not a password, not the People page, not a tour. Test 28 and S17: a fresh browser context opens the link, `signin` shows the name, one press, `data-testid="desk"` is visible and `GET /api/session` names the newcomer.
4. **Three pointers show once, one at a time, each beside the real thing:** the person's pages or clients, the OS bar, Needs you. "Next" moves on, "Got it" ends, Esc ends. Test 28 and S18: three in order, each naming its anchor; after a reload and in a second browser context signed in as the same person, none; vitest `app/tests/firstDay.test.tsx` for order, keyboard and a missing anchor (two show, not three, nothing throws).
5. **The mark is the server's, per person, on every device.** Test: Rust (GET answers `show_pointers: true` once, false after the POST; a second person cannot read or set the first person's mark); S18's second context.
6. **Only an invited person who has not seen them gets pointers.** Everyone who exists today reads as seen. Test: Rust (a person with no first-day record gets `show_pointers: false`); `j001-pilot.spec.ts`, `roles-homes.spec.ts` and `landing.spec.ts` run unchanged.
7. **The first row of the newcomer's Needs you is the document named on the invite, on a live job, with its button, and it opens.** Test 28 and S19: the first row holds the job number J001, its button opens that document (`[data-where="document"]`).
8. **A real task opens within two minutes of opening the link.** Test S19 measures from opening the link to the document on screen and asserts under 120 seconds. A test cannot prove a real person doing it cold: at the gate Laurence invites a real new person and times it by hand.
9. **The first-task row leaves when its button is pressed and does not come back.** Test: S19 reloads and the row is gone; Rust on the mark.
10. **Nothing about how long a person took is kept or shown.** The store holds the date an invite was made and two booleans. No route lists people by it. Test: Rust reads every field the store writes and every field the admin list answers; none is a duration or a time of first use.
11. **The pointers follow develop's look and the alignment rules:** no veil, no modal, no right-hand panel, no chat box, nothing over the timesheet consent item, shell tokens only, 44 px buttons at 390 px, no motion with Reduce motion, no price, cost or credit word, no em dash. Each pointer is named for feedback by pointing (kind `control`). Test: axe in light and dark with a pointer open (S18); vitest for reduced motion and for the pointer's feedback name; the existing `app/tests/shellRules.test.ts` passes untouched.

## 3. Prior art

| Path | What it is | Reuse |
|---|---|---|
| `crates/napkin-web/src/people.rs` (`People`, `PersonRec`, `active`, `add`, `changes.jsonl`), `admin.rs` (`/admin/people`, `admin()`, `store()`), `app/src/shell/people/PeoplePage.tsx`, `api.ts` | The one store and screen of who may sign in | The invite is an action on a person who is already there. `admin()` is the permission check. The store itself is not edited. |
| `crates/napkin-web/src/mail.rs` (`Mailer`, `Mail::send`, `Message::Invite`, `render`, `Memory`, `Outbox`, `Off`) | The one place mail leaves, with the invite's words already fixed | Used as it is. Not edited. |
| `crates/napkin-web/src/auth.rs` (`Provider::Roster`, `Roster::sign_in`, `uses_passwords`) | Sign-in. Under the roster a typed name signs in; there is no password | Not edited. This fact decides the approach (section 4). |
| `crates/napkin-web/src/needs.rs` (`items_of`, the caller's own timesheet reminder at lines 165 to 181, `DoneStore`, `FileDone`) and `napkin_host::jobindex::Need` (`Audience::Person`, `can_done`) | A need built by the web layer from its own facts and added to one person's list | The first task is built the same way, from the first-day record, for one person. Its Done mark is the existing one. |
| `crates/napkin-web/src/timesheet.rs` (`Store`, `FileStore`, the clock a test sets) | A per-person file store behind a trait | The pattern for the first-day store. |
| `app/src/shell/SignIn.tsx` (`SignInGate`, `useState('')` for the name, line 101) | The sign-in form | One line: the name starts from the address. |
| `feat/align-landing-look`: `app/src/shell/nui/Desk.tsx` (`desk`, `#cl-row`, `needs-you-section`, `pick-up`, `pick-row`), `home/YourPages.tsx` (`your-pages`), `home/NeedsYou.tsx` (`needs-you`, `need`); `app/src/components/Toolbar.tsx` (`os-bar`, `medallion`, `decisions`) | The anchors the pointers stand beside | Found by test id. None is restructured. |
| `app/src/dogfood/FeedbackPoint.tsx`, `pointer.ts`, `Dogfood.css` (`fbp-outline`, `fbp-tag`, `fbp-card`) | Develop's own way of pointing at a thing: an outline with a name tag and a small card | The visual model for a pointer, and the means by which the pointer itself is named for feedback. Not imported: it loads only on a recording build. |
| `app/src/shell/nui/Pop.tsx`, `popKit.ts` | The shell's popover | Its placement rule (8 px below, kept on screen) is copied. Pop itself is a menu that closes on scroll and outside click, which a pointer must not. |
| `app/src/timesheet/Ask.tsx`, `consent.ts` | The consent question, the first item of Worth a look after `align-landing-look` | Left alone; pointers are placed so they never cover it. |
| `crates/napkin-web/src/links.rs` (`key_from`, `sign`, `verify`, `Limiter`, the `/c` router mounted outside the session layer in `lib.rs`) | The client's signed link | Used only by approach B. |
| `app/e2e/j001-p2-first-day.spec.ts`, `seed/j001/p2/first-day.mjs` (`INVITED`, `POINTERS`) | The acceptance test and its fixtures, written ahead | Turned on in place. |
| `docs/napkin-os-build-prompt-v2.md` section 4; `docs/napkin-os-build-prompt-v3.1.md` line 78 | The spec; v3.1 keeps first day in Phase 2 | The four steps and the measure. |

## 4. Approaches

Costs are agent hours, as in the Phase 3 records.

**A (recommended): the invite is a first-day record on a person; the link carries the name, not a credential.**
`POST /api/admin/people/{id}/first-day` stores `{person, agency, made_by, made_on, first: {job, path}?, seen: false, opened: false}` and answers `https://<host>/?welcome=<name@agency>`. The sign-in form starts with that name. Everything after sign-in is keyed on the person, not on how they arrived: `GET /api/t/{tenant}/me/first-day` tells the desk whether to show the pointers, the needs handler adds the first task for that person, and each is marked once.
Build: 4 agent hours, in two sittings because of the 3 hour limit (web 1.5: store, four routes, the need, Rust tests; shell and e2e 2.5: the invite row, the name from the address, the pointers, vitest, test 28 and S17 to S19). Run: one small file per agency, no model, no mail until a sender exists.
Why: under the roster, which is the only provider that has a People store (`admin.rs store()` answers 404 otherwise), a typed name already signs a person in. A signed one-time link would guard a door that is open. Keying first day on the person means single sign-on later changes nothing here, and test 28 is met in full.

**B: A plus a signed, single-use link that signs the person in** (the record's earlier choice). `GET /i/{token}` beside `/c`, token `{v, id, agency, username, exp}` under its own key label, seven days, used once, rate limited, then `Sessions::issue`.
Build: 6.5 agent hours (A plus 2.5 for the token, the route outside the session layer, replay, expiry, withdrawal and wrong-agency tests, and a POST step so a mail scanner's GET does not use the link up). Run: none.
Why not now: it adds no protection while the roster signs in by name; it puts a URL that mints a seven-day session into mail, browser history and load balancer logs; under passwords the record already said it would not sign in; and `sso` replaces exactly this step. It matches v2's words "one-time sign-in link" more closely, and it can be added later without touching A's store, pointers or first task (question 1).

**C: Cognito's own invite** (`AdminCreateUser`, temporary password). Build: 2 agent hours. Run: Cognito mail limits. Loses: staging and UAT run the roster, it brings back the temporary password `no-password-sign-in` removed, it carries no first task, and it cannot be tested offline.

**D: a tour library and no invite.** Build: 2 agent hours. Run: none. Loses: skips steps 1 and 4 of v2, and a tour package brings a veil, arrows and motion that develop's shell does not have.

## 5. Rework risks

| Risk | Avoided by |
|---|---|
| `sso` lands and the invite's sign-in step is thrown away | Under A there is no sign-in step to throw away. First day hangs on the person. |
| `align-needs-lock-people` reshapes `GET /t/{tenant}/needs` and moves the per-person list to the desk's Me rows | The first task is added in the same function as the timesheet reminder and goes wherever that goes. The pointers find their anchor through one table, `app/src/shell/firstday/anchors.ts`, which lists candidates in order (`need`, then `pick-row`, then `decisions`), so the move is a table edit. Build after that record (section 10). |
| The desk's layout changes and a pointer breaks | A missing anchor skips its pointer. A vitest renders the desk and fails if no candidate for a pointer exists. |
| The first task becomes a second assignment system | It is one notice for one person, gone when pressed. It puts nobody on a job; that stays with `approval-route`. |
| Two invite routes (this one and a bulk import) | The CSV import of `align-needs-lock-people` adds people; inviting stays this one route, called once per person. Said in contracts. |
| A second mail sender | None is added. `mail.rs` is used as built. |
| The mark kept in the browser | It is the server's. Local storage is not used. |
| B is wanted later | The link's shape is one function (`firstday::link_for`). B replaces what it returns and adds a route; nothing else moves. |

## 6. Reach and contracts

Touches: `napkin-web`, `app-shell`, `docs`. No host crate, no template, no infra, no middleware.

New files:
- `crates/napkin-web/src/firstday.rs`: `FirstDay`, `trait FirstDayStore`, `FileFirstDay` (one file per agency, `<data>/_people/firstday/<agency>.json`, written whole with tmp and rename as `people.rs` does), `router()`, `link_for`, `first_task(ctx, user) -> Option<Need>`.
- `crates/napkin-web/tests/first_day.rs`.
- `app/src/shell/firstday/`: `Pointers.tsx`, `anchors.ts`, `words.ts`, `useFirstDay.ts`, `InviteRow.tsx`, `firstday.css`.
- `app/tests/firstDay.test.tsx`.

Shared files edited, one or two lines each:
- `crates/napkin-web/src/lib.rs` (`pub mod firstday;`), `api.rs` (one `.merge(crate::firstday::router())` beside `admin::router()` at line 126), `state.rs` (`first_days` on `AppCtx` and `with_first_day_dir`), `main.rs` (the directory), `needs.rs` (one call beside the timesheet reminder).
- `app/src/shell/SignIn.tsx` (the name's first value), `app/src/shell/landing/LandingHome.tsx` (mount `<Pointers/>` beside the desk), `app/src/shell/people/PeoplePage.tsx` (mount `<InviteRow/>` on a person's row).
- `app/e2e/j001-p2-first-day.spec.ts` and `seed/j001/p2/first-day.mjs` (its own).
- `docs/contracts/os-layer.md` section 13 (one paragraph for the routes).

Not edited: `auth.rs`, `people.rs`, `mail.rs`, `links.rs`, `roles.rs`, `App.tsx`, `route.ts`, `Desk.tsx`, `Toolbar.tsx`, `barMenus.ts`, `j001-pilot.spec.ts`, `app/e2e/phase2/tests.mjs`, `app/tests/shellRules.test.ts`, any `crates/napkin-host` file.

Contracts:
1. `POST /api/admin/people/{id}/first-day` `{first?: {path}, email?}`: new. Admin only, by `admin.rs admin()` (so whoever `align-needs-lock-people` lets manage people may invite, scoped the same way). Answers 201 `{person, link, first?: {job, path}, mailed: bool}`. `DELETE` on the same path withdraws it. Read by `InviteRow` only.
2. `GET /api/admin/first-days`: `[{person, made_on, signed_in: bool}]`. Read by the People page only. No other field.
3. `GET /api/t/{tenant}/me/first-day`: `{show_pointers: bool}`. `POST` with `{seen: true}`. The caller's own record only. Read by `useFirstDay.ts`.
4. `GET /api/t/{tenant}/needs` gains one kind, `first-task`, for the invited person: id `first:<person>`, text from the allow list (job number, client name, document title), action "Open", `can_done: true`. The route's shape is unchanged and stays owned by `needs-you-full` and then `align-needs-lock-people`.
5. The link: `/?welcome=<name@agency>`. Read by `SignIn.tsx`. It names a person and grants nothing.
6. Mail: `Message::Invite` as it is. Setting `NAPKIN_MAIL`, default off.

Interface words (drafts, for Laurence): pointer 1 "Your pages and your clients. Open one to start."; pointer 2 "This bar is on every screen. Press Cmd K to find anything."; pointer 3 "Needs you. What is waiting for you, soonest first." Buttons "Next", "Got it". People page: "Invite", "Copy the link", "First thing to open".

## 7. Breakage and guards

| Risk | Guard |
|---|---|
| The client wall: the first-task picker or the admin list shows another agency's documents or people | The agency comes from the session in `admin()`; the document must be in that agency's job index. Rust tests call each route as agency B's admin with agency A's person and path. |
| The mail quotes a client or a job | `mail::render` has fixed words; the first task is never passed to it. Rust reads the `Memory` outbox for marker strings. |
| People who exist today get pointers, or the e2e people do and Phase 1 tests click into one | No record means seen. Pilot, landing and roles specs run unchanged. |
| A pointer covers the consent item, traps focus or blocks the page | No veil and no focus trap; `role="dialog"` without `aria-modal`; placement avoids `worth-a-look`'s first item. axe with a pointer open; vitest on placement. |
| A person removed after the invite still gets in | Sign-in is the ordinary one, which reads `People::active` at each request (`Provider::still_allowed`). Removing a person withdraws their first-day record; Rust test. |
| The link shows a sign-in name to whoever sees the mail | A sign-in name is not a secret under the roster. Said to Shrey in question 6. |
| The count of live acceptance tests falls | Test 28 goes from fixme to live; none is removed. `node app/e2e/phase2-fixme.mjs --slug first-day` reads 0 after. |
| wasm, desktop bundle, CLI conformance | Not reached: no `clan-sdk`, `napkin-host` or template change. `scripts/check.sh --only rust,frontend` covers it. |

## 8. Test plan

- Rust, `crates/napkin-web/tests/first_day.rs`: the routes per role and per agency; the store's fields (no duration); the mark per person; the `first-task` need for the invited person only, first in the list, gone when marked; the outbox; removal withdraws.
- Vitest, `app/tests/firstDay.test.tsx`: three pointers in order; a missing anchor; keyboard (Next, Got it, Esc); reduced motion; never over the consent item; the feedback name; `SignIn` reading `welcome`; `InviteRow` with a fake API.
- e2e, `app/e2e/j001-p2-first-day.spec.ts` on the roster stack (`NAPKIN_E2E_ROSTER=1`), 390 and 1440 px: **test 28** (same number, fixme removed, `home` becomes `desk`), **S17** an admin invites and the link opens sign-in with the name, **S18** three pointers once and never again, with axe in light and dark, **S19** the first row is the J001 task and it opens inside 120 seconds, then is gone.
- Unchanged and green: `j001-pilot.spec.ts`, `landing.spec.ts`, `roles-homes.spec.ts`, `j001-p2-needs-you-full.spec.ts`.
- No model, no paid call, no mail leaves the machine.

## 9. Rollout

`napkin-web` and the shell; a merge and a deploy carry it. No terraform apply: the store is on the data volume every web task already mounts, beside `people.json`. With `NAPKIN_MAIL` unset the admin copies the link, so say "invites by copied link", not "by email". Mail needs what `client-review-full` already lists (an SES sender identity, production access, `ses:SendEmail` on the web task's role, a terraform apply before the deploy) and `NAPKIN_MAIL=ses` is refused at start-up until that sender is built; none of it is this record's. Roll back by redeploying the previous image; the store's files are ignored by the older server.

## 10. Build order and collisions

Build after `align-landing-look` and `align-needs-lock-people` have merged. The second is the hard dependency: it decides who may call the People routes (today only `engineer@napkin`, who is not on the e2e roster), where the per-person rows are drawn, and the shape of `/needs`.

| Shared file this record edits | `feat/align-landing-look` | `feat/align-confidential-prices` | `production-line-merge` (wave 0) |
|---|---|---|---|
| `crates/napkin-web/src/api.rs` (1 line) | no | **yes** (+116 lines) | **yes** (both sides' routes joined) |
| `crates/napkin-web/src/lib.rs` (1 line) | no | no | **yes** |
| `app/src/shell/SignIn.tsx` (1 line) | no | no | **yes** (takes this build's side, re-adds the production flag) |
| `app/src/shell/landing/LandingHome.tsx` (1 line) | **yes** (87 lines changed) | no | no |
| `app/e2e/j001-p2-first-day.spec.ts` | **yes** (2 lines, the open helper) | no | no |
| `docs/contracts/os-layer.md` (1 paragraph) | no | **yes** (+36 lines) | no |
| `app/tests/shellRules.test.ts` | read only by this record; both branches add checks to it that this record's words must pass | same | no |
| `crates/napkin-web/src/state.rs`, `main.rs`, `needs.rs`, `shell/people/PeoplePage.tsx` | no | no | not in its listed rule; `align-needs-lock-people` edits `needs.rs` and `shell/people/*` |

So: `align-confidential-prices` and `align-landing-look` first (both are built on their branches), then `production-line-merge` alone, then `align-needs-lock-people`, then `first-day`. It may run beside any Phase 3 record that does not edit `api.rs`, `lib.rs` or `SignIn.tsx`; `sso` edits `SignIn.tsx` and goes after it.

## 11. Non-goals

- Single sign-on (record `sso`).
- A signed one-time link that signs in (approach B), unless question 1 is answered b.
- Adding a person, roles, CSV import, per-agency admins: `align-needs-lock-people`.
- A real mail sender: `client-review-full`.
- A tour, videos, a checklist, a chat helper, a help panel.
- Any measure of a person's first day shown to anyone.
- Putting a person on a job or its approval route.

## 12. Questions for the owner

1. **Laurence and Shrey, a or b:** the link carries the name and the person presses Sign in (a), or a signed one-time link signs them in with no press (b, 2.5 more agent hours)? **Pick: a.** v2 says "one-time sign-in link"; under the roster it would protect nothing.
2. **Laurence, a or b:** pointer 1 stands beside "Your pages" when the person has that row and beside the client circles otherwise (a), or always beside the client circles (b)? **Pick: a.**
3. **Laurence, a or b:** pointer 2 stands on the OS bar and names Cmd K (a), or is dropped now that the bar has no field, leaving two pointers (b)? **Pick: a.** Test 28 counts three.
4. **Laurence, yes or no:** must every invite name a first thing to open? **Pick: no.** Offered, with the admin's own live jobs first; without one the desk's own empty line stands.
5. **Laurence:** the three pointer lines and the People page words in section 6. **Pick: as drafted.**
6. **Shrey, yes or no:** may the link show the sign-in name in the address? **Pick: yes.**
7. **Shrey, a or b:** the first task is a web-level need like the timesheet reminder (a), or a host attention item written as a decision on the document (b, which edits `crates/napkin-host/src/ops/decisions.rs` and `crates/clan-sdk/src/decision.rs`, both taken by other records)? **Pick: a.**
8. **Laurence, yes or no:** may the People page show that an invited person has signed in (a yes or no, no date)? **Pick: yes.**

## 13. What I could not verify

- How a web-level need (the timesheet reminder, and so the first task) reaches the desk's Me rows and the Decisions drawer after `align-needs-lock-people`. Its record does not say, and it is not built. Done_when 7 depends on it.
- Who may call the People routes after `align-needs-lock-people`. Today it is `PEOPLE_ADMINS = ["engineer@napkin"]`, and the e2e roster (`app/e2e/stack.mjs`) has `ann@napkin`, not that name, so S17 cannot run before that record or a roster edit.
- Whether the shell's need row needs a case for the kind `first-task` (`app/src/shell/home/model.ts` reads `action` and `path` from the server; I read the row builder, not every caller).
- How the shell names its own rows for feedback by pointing. I read the header of `app/src/dogfood/pointer.ts` only.
- Cognito and Local: `admin.rs store()` answers 404 without the roster, so on a password stack there is no People page and no invite. I did not check which provider production runs today.
- Nothing was run: no build, no test, no merge trial. Conflict notes come from `git diff --stat` against the two branches and from the text of the `production-line-merge` record, not from a merge.
- No `.env` file, no Cannes, Effie or WARC material was read; no model or paid call was made.
