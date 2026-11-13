# Develop alignment audit (13 Nov 2026)

Read-only audit. Refs: `origin/develop` (tip `34235abb`, "eval: let a UAT round run its files side by side (#228)") and `spike/fabletest`.
Method: `git show` / `git grep` into scratch copies under /tmp (no checkout, no build, no test). Nothing in a repo folder was changed.

## 0. Facts that frame everything

- `spike/fabletest` branched from develop at `02281ec2` ("infra: keep routes added beside a private route table (#165)"). develop has **59 commits** since. The build never saw them.
- Present on develop, absent from the build (the file does not exist on `spike/fabletest`):
  - `app/src/shell/booth.ts`, and the Booth in the two templates (record `booth`)
  - `app/src/shell/people/` (People page, record `people-admin`)
  - `app/src/dogfood/pointer.ts` and `FeedbackPoint.tsx` (feedback by pointing, `feedback-point`)
  - redraft in place (`brief-redraft-in-place`, `aw-sheen`), `redraft-provenance`, `decisions-verdict-words`, `desk-recent-first`
  - the confidential rule (`confidential-means-napkin-never-sees`, #224, commit `bda85942`)
  - `app/templates/brief-maker/index.html` on the build has 0 mentions of `booth`.
- The build touches develop's shell files only lightly (vs the merge base): `App.tsx` (+51), `Toolbar.tsx` (+19), `barMenus.ts` (+9), `AppRuntime.tsx` (+47), `tokens.css` (+9), `nui.css` (10 lines), `theme.ts` (+95), `Desk.tsx` (+11), `LandingHome.tsx` (+113), `route.ts`, `landing/keys.ts`. Expect textual merge conflicts in `AppRuntime.tsx`, `Toolbar.tsx`, `barMenus.ts`, `App.tsx`, `route.ts`, `tokens.css`, `theme.ts`, both templates, `crates/napkin-web/src/{api,auth,lib,main,state}.rs`.
- 98 records exist on the build; 31 are added or changed against develop (list at the end of Part B).
- The build's own shell screens are mostly written on develop's tokens already (checked: every `var(--x)` in the new shell CSS is defined by develop's `tokens.css`/`index.css`/`nui.css` except `--warn-text` (added by the build's `tokens.css`), `--agency-accent` (build's `look.ts`), `--f-body` (judge.css), `--mono` (clientLink.css, ClientReview.css) and the `--cr-*` set in `ClientReview.css`). So most restyle work is small. The large differences are behaviour and ownership of concepts, not colour.

---

## Part A. Develop's rules, from the code

### A1. Tokens, type, modes

- `app/src/shell/nui/tokens.css`: warm paper set `--desk #F6F1E7`, `--paper #FFFDF8`, `--paper-2`, `--card`, `--ink #141413`, `--ink-soft`, `--muted`, `--faint`, `--line`, `--line-strong`, `--accent-line`, `--warn/--warn-soft`, `--ok/--ok-soft`, `--alert/--alert-soft`; agency layer `--ag-base --ag-acc --ag-acc-ink --ag-act --ag-act-ink`; aliases onto `index.css` (`--ink2 = --muted`, `--ink3 = --faint`, `--soft`, `--line-soft`); radii `--r-sm 4 / --r-md 8 / --r-lg 14`; `--shadow-card`, `--shadow-paper`; faces `--font-ui` Geist, `--font-serif` Newsreader, `--font-mono` Geist Mono (`--f-display`, `--f-mono` aliases). Body 15px / 1.55. Tool identities `--bm-manila*`, `--bm-red`, `--rs-hl`.
- Two themes only: `:root[data-theme='light']` and `[data-theme='dark']`. `ThemeToggle.tsx` flips them; `AppRuntime` posts `clan:colorscheme {scheme}` to the frame.
- `.nui` scope: `--accent` is the agency base inside `.nui` only. Rules are written `.x:where(.nui, .nui *)`. Class families in `nui.css`: `tb-*`/`tba-*` (bar), `cl-*` (client circles), `cp-*` (pick-up rows), `dz-*`, `bm-*`, `home-*`, `rs-*`, `dial-*`, `p33-pop`.
- `shell.css` (146 lines): the frame (`.studio`, `.nui-home`, `.nui-page`, `.studio-shell` max-width 1180), the OS-bar guard (`.tb-locked`, `.tb-app`, `.tba-name` truncation), empty/error/refusal states (`.nui-empty`, `.nui-more`).
- Agency layer: `app/src/shell/agency/palette.ts`. Colours are **admin-set per agency** in `AGENCY_COLOURS` (+ `AGENCY_ALIASES`; `registerAgencyLooks` adds agencies the People page created). Fields: `name, accent, base, logo, logoOnDark, icon, accentInk, pill ('accent'|'base'), accentUse ('fill'|'line'), surface ('warm'|'mono')`. `surfaceCss` writes `--agency/--agency-fg/--agency-soft`, `--ag-*`, and tints `--desk/--paper/--card/--line` onto the agency base in a `<style>` on `:root`. Owner rule in the file header: "set by admin; nobody picks their own". Documents get `{agency: coloursOf(...)}` through `clan:me`. `signInLook.ts` / `lastAgency.ts`: sign-in is Napkin-look until an agency name is typed.

### A2. The one OS bar (`app/src/components/Toolbar.tsx`, `barMenus.ts`, `appBar.ts`)

- Left to right: medallion (way home; the one mark that changes when the document you are IN needs you), agency pill (back to the desk), client chip (back to client; switcher on the client page), the document slot (`tba-*`: tool icon, serif name, "saved · valid" line, document menu, "made from", **Continue in**, **Share**), then right side: the app's chips and buttons, Client review, theme toggle, crew in the document (sphere + working line), avatar (account menu), **Decisions** (the bar's one needs-your-call signal, amber with the count).
- No search field, no Cmd K, no state pill in the bar (the pill is in the app's own side tab).
- Account menu (`accountItems`): People (admin only), Offline copies, Feedback (key F), About this beta (recording build only), Sign out last.
- Document menu (`docMenuItems`): the app's bar buttons, Rename, the tool page, Open, Save as, File details, Edit, Present offline, Export, Where it came from. Share ▾ ("Send the client copy" runs the app's own `client` bar action, enabled only on a locked document).
- App-to-bar contract (`appBar.ts`): the page posts the whole list as `clan:bar {v:1, items}`. Kinds: `button` (max 10, 2 shown, rest in More), `chip` (max 4, read-only fact), `status` (1, the document's state in the app's words), `gate` (1, Continue in's first line), `mode` (`ask`|`working`). **An unknown kind is dropped.** `BAR_LIMITS` caps labels (28), titles (140).
- Create's red stays only on the Create department; the agency pill, selected circle and dial hub take the agency colour.

### A3. Messages between a tool page (sandboxed iframe) and the shell (`AppRuntime.tsx`, `appExport.ts`, `structuredEditBridge.js`, `pointer.ts`, `booth.ts`, `openJobs.ts`, `editMode.ts`)

Shell to page: `clan:colorscheme {scheme}`; `clan:edit-mode {active}` (pushed on every change and load); `clan:clientmode {on, answer}`; `clan:insets {top,right,bottom}` (glass chrome); `clan:jobs {jobs[]}`; `clan:booth {open}` (stored choice, every load); `clan:me {actor,id,name,agency{colours}}` (answer to `clan:me?`); `clan:token {origin}` (answer to `clan:token?`); `clan:parts?`; `clan:bar?`; `clan:bar-action {id}`; `clan:can-run?`; `clan:run {task,input}`; `clan:open {ref,path}`; `clan:dataupdated {source:'shell'}`; `clan:export-request {id,kind}`; `clan:feedback-pick {on}`; `clan:rpc-reply` (srcdoc builds only).
Page to shell: `clan:me?`; `clan:token? {held}`; `clan:parts {parts}` (declared parts, for client review); `clan:part-mark {address,marked,words}`; `clan:edit-request` ("Make this change" reopens a part); `clan:bar {v,items}`; `clan:booth {open}`; `clan:chrome {mode:'glass'|'solid', tint}`; `clan:can-run {tasks}`; `clan:export-ack {id,handled}`; `clan:activity` (marks the medallion engaged); `clan:interaction {kind,name}` (dogfood recorder); `clan:feedback-picked {target{kind,id,label}|null, rect, version, title}`; `clan:feedback-key` (F pressed in the page); `clan:rpc {op,path,query,body}` (srcdoc only).
Page-internal only (not for the shell): `clan:viewloaded`, `clan:focus`, `clan:cardgo`, `clan:cardact`, `clan:editpart`, `clan:editmode`, `clan:reviewed`, `clan:opened`.
Only the shell's own frame is heard (`e.source` check). Anything the page needs to remember across loads is kept by the shell, because the frame is sandboxed without `allow-same-origin` (storage throws).

### A4. The landing and the desk

- `App.tsx` mounts `LandingHome` (`shell/landing/LandingHome.tsx`) when the host can list the library; `Launcher` is the fallback. Route (`shell/route.ts`): `#agency` (the desk), `#clients` (folded into the desk), `#client-<id>`, `#tool-<id>-<tool>`; tools `brief research idea deck prod ads`; anything else is `#agency`.
- The desk (`shell/nui/Desk.tsx`, `deskData.ts`, `useDeskFacts.ts`): greeting (`when.ts greeting`), Find a client, Archived, the desk ⋯ menu, **one row of client circles** (colour from `agency/clients.ts` else hashed onto `CLIENT_LOOKS`; `cl-badge` needs count; a line naming the work), the **Dial** a circle opens in place (4 quadrants Brief, Research, Deck, Production; keys 1 to 4; Escape), then "Pick up where you left off" (Everyone / Me, `pickRows`) and "Worth a look" (`worthItems`). Circles are one tab stop.
- `ClientView.tsx` (a client's page): Needs you, work by tool, Brand Clan card, decisions on record.
- **Decisions** (`DecisionsDrawer.tsx`, `DeskDrawer.tsx`, `drawerData.ts`, `decisions/*`): a drawer over the page with a dimmed backdrop. Call card (Looks right / Set aside / Open; Approve all and lock), then views Graph, By part, By time, Lineage. `decisions/needs.ts needsOf()` is "the one needs-your-call selector": the drawer, the bar count and the medallion all read it. `verdictWords(by)` says whose "no" it is ("The Review agent said no, and it is not settled yet" vs "Marked wrong, and not answered yet"). Lines are signed with the agent's sphere and role.
- **People page** (`shell/people/PeoplePage.tsx`, `api.ts`; server `crates/napkin-web/src/people.rs`): a full-screen `role="dialog" aria-modal` over the page, reached from the account menu, **admin only** (`PEOPLE_ADMINS = ["engineer@napkin"]`; others see "Ask an admin", routes 403). Always in the Napkin look. Add a person (Name + Agency, sign-in `firstname@agency`), add an agency with its look, rename, remove (documents and decisions stay). Store seeded once from the roster TSV; takes effect at next sign-in.
- **Client review** is a shell mode on an agency person's session (`shell/clientReview/ClientReviewBand/Panel`, `clan:clientmode`, `+ This part`, `clan:part-mark`), not a client-facing page.

### A5. The Booth (record `booth`, approved Shrey 2026-11-13, mock panel-v3 "B · Full")

- Where: Brief Maker `<aside class="stab" id="stab" aria-label="Booth: the brief's controls">` inside the `.bdesk` grid; Research `<aside class="insp" id="insp">` (header `.booth-hd` inside `.insp-body`). Code is duplicated in both templates (same function names `boothWidth`, `boothSet`, `boothStep`, `boothApply`, `boothPick`, `boothAsk`, `boothCanHide`); it is not in `templates/shared/`. `templates.test.ts` lifts both.
- Markup/CSS: header `.booth-hd` (label BOOTH in `.booth-nm`, a `Hide ›` pill `.booth-hide[data-booth=hide]`), the hidden edge tab `.booth-edge#boothEdge` (38px, vertical "BOOTH" label, count dot `.booth-ct`), `body.booth-folded`, `.bdesk.booth-off` (grid column animates to 0), `--booth-dur 460ms`, `--booth-ease`, `--bw`/`--trk` for the column width.
- Behaviour: `BOOTH = {open, ask, t}`; `]` toggles; hiding slides the panel out and the document recentres, nothing ever floats over or overlaps the document; a click on a part/fact/finding while hidden brings the whole Booth back on that thing (`boothPick`); an agent question while hidden shows the dot, then the Booth comes in after `BOOTH_ASK_MS = 1000`; `prefers-reduced-motion` gets a fade.
- Width rule: `BOOTH_MIN = 1101`; `boothCanHide(w) = w >= 1101`; `@media (max-width:1100px)` hides the Hide pill and the edge tab, so **below 1100 px nothing hides**. Widths: whole brief 420, a part 440 (`boothWidth(sel)`); Research: whole report/finding/fact 440, evidence map 744 (narrower windows keep 380/350).
- Remembered: the page posts `clan:booth {open}` when it changes; the shell (`AppRuntime`, `booth.ts`: key `napkin.booth.v1:<person>:<tool>`, `readBooth`/`writeBooth`) stores it and posts it back on every load. Default open.
- Contents, whole brief (`#briefView`): status pill (`#statusPill`, "Brief" + pill + `#stateLine`), linked-research note, the **Needs you** list (`#lockList`, "Needs you · n"), the Lock button (`#lockBtn`, "Lock the brief", `lockWhy` "Settle n first"), "Locked for handoff", "Record the client's answer" (`#crOpen`), "Reopen a part…", Review fold (Review agent + crew line), brand line, made-from, folds Look and Logos, a hint line. Selected part (`#selPart`): crumb + back, state chips (how sure, how many facts), actions `Keep as is` (`sp-keep`, aria-pressed) and `Confidential` (`sp-conf`), Place on page, Your call, Built from, Why, History. Research: the inspector shows the selected fact, finding, section or evidence map, with "Ask about this section" (`pv-askfocus`).
- The agent at work shows in the Booth's `#sideAgent` (sphere, role, step) with `#sideStop` (Stop, asked once).

### A6. How agents act in place

- Inline: an agent's draft lands on the part. A part a person wrote last is never overwritten (holder rule): the agent's version comes back as a proposal under it ("<Agent> suggests this, you hold this part, so it wasn't changed", `act-accept` **Use this** / `act-dismiss` **Keep mine**).
- Who wrote it: a byline on the field and a chip with the agent's figure (`fig()`), words from `shared/clan-fields.html`: `ORIGIN`, `drafted by <Dara> · you accepted`, `you said`, "from your material", "proposed". Drawer headline "Dara wrote this on <date>; you accepted it on <date>" (`redraft-provenance`). Shell lines are signed with the agent's sphere + role.
- **Keep as is** (`sp-keep`): a part kept when the brief is drafted again. **Why**: the `.prov` button on a row, `refreshWhy()`/`toggleWhy()`; the Look fold has "Why notes: Hide / Show all". The Decisions drawer has the history ("What happened", By time).
- **Ask** (shared): Research's "Ask about this section" / "Ask about this" in the inspector, and the research ask box (`ask_research@1`, `fact-ask-*` records). Brief Maker has no free-text ask box; its only free-text agent exchange is the intake and the in-place redraft. I could not find a component literally named "shared Ask" in code (see "Could not determine").
- **Redraft in place**: "Draft it again" (OS bar only; one press arms, "Click again to redraft", 4 s) keeps the sheet on screen; every unlocked part gets `#fields .row.working` with the `aw-sheen` sweep and dims to .55 opacity; the Booth's `sideAgent` shows the agent and step; locked parts untouched; `prefers-reduced-motion` drops the sweep.
- **Needs you and Lock**: `needsRows()` is the one settle-before-lock list (host lock list plus open questions). Lock waits on all of it (`wait = unknown || !can_lock || n>0 || busy`). The status pill agrees (`briefStatus({locked, reopened, needs, canLock})`, #226). Until the host's list loads, Lock waits.
- **Status pill**: the document's state in the app's words ("Draft", "Ready to lock", "Needs you"), in the Booth header, also sent to the bar as `clan:bar` item `status`.
- **Confidential** (os-layer.md C4, #224, `bda85942`, owner 2026-11-13): "Confidential is for Napkin's systems only; the client sees everything." Napkin never learns from the part (layers, RAG, harvest, evals, goldens, training, long-lived Napkin-side stores). It never hides a part from the client. Brief Maker's Client copy · PDF prints every part, untagged; the agency copy hatches and tags confidential parts; toggle words "Napkin never learns from this part. The client still sees it."; `Keep it private` sends `export true, corpus false`; the run log hides query and question words when bodies are off.
- **Cost**: I found no price, cost or credit shown to a person in the shell, Brief Maker, Research or the shared snippet. The only mention is an example in a comment in `appBar.ts` ("$1.14 so far"). Cost **is** shown in the Production Tool (`production-tool/web/src/jobs/follow.ts planCost/planCostShort` "about $2.01", `canvas/arrowCard.ts costWords`). I found no written owner rule on showing price.
- **Feedback** (`feedback-point`, owner 2026-11-13): `window.ClanFeedbackTarget(el) -> {kind,id,label,el}|null` is defined in Brief Maker (`feedbackTarget`: a part by heading from `#fields .row[data-clan-part]` or a `.tile[data-key]`, kind `part`) and Research; `window.ClanFeedbackDoc()` gives version and title. The shared snippet falls back to `fbControl(el)` (a button, by its label). Kinds: `part | section | fact | finding | control`. The shell side is `dogfood/pointer.ts` + `FeedbackPoint.tsx` (banner "Click what your feedback is about · Esc to cancel", note card Wrong / Unclear / Idea). F starts it, never while typing. Shown only if the build records and the person agreed.

---

## Part B. Every screen the build added or changed (ref `spike/fabletest`)

Legend. Look: **nui** = develop's shell tokens (`tokens.css`/`nui.css`/`.nui`), **own** = own copy. Surface: where it opens. $: shows a price or cost. Chat: anything chat-like. Conf: how it treats Confidential. Named: its parts are named for feedback. Talk: how it talks to the shell.

Common to every shell screen: no `data-clan-part`, no `ClanFeedbackTarget`, no shell-side picking name (the build has no `pointer.ts` at all). None shows a Booth.

### B1. Roles home (`shell/home/Home.tsx`, `useHomeView.ts`, `model.ts`; server `crates/napkin-web/src/roles.rs`). Record roles-and-homes (verifying), remaining-homes (building)
- Look: nui (`home.css`, classes `hm-*`, reuses `.app-head`, `.hero-title`, pick-up row border/radius, client-circle shadow); `.nui nui-page studio-shell`.
- Surface: a full page. Replaces `#agency` for a person with a role (`LandingHome` takes `home={home.view}`); a person with no role keeps the desk.
- $: no. Chat: no. Conf: not touched. Named: no.
- Talk: server-fed (`GET` home view via `host/http`); route in `route.ts`. No `clan:*`.
- Contents: greeting, Needs you rows (see B16), at most five round doors, "More tools" as a text list, an admin-only role switcher (`hm-switch`, `#home-<role>`), timesheet consent card (B27), setup card (B23).

### B2. The O (`home/TheO.tsx`, `#map`)
- nui (`home.css`). Full page. A map: agency logo centre, at most five department circles, the person's own first, the rest as a quiet list. Server decides (`roles.rs map_for`). $: no. Chat: no. Talk: route only.

### B3. Door pages and the nine roles' doors (`home/DoorPage.tsx`, `doorTargets.ts`, `components/states/doors.ts`, `#door-<door>`)
- nui. Full page. One table (`doorTargets.ts`) says per door: an installed app, a shell page or nothing yet; "nothing yet" opens that door's Empty state with its example (from `doors.ts`, de-identified J001, "Client A, an Irish whiskey"). Hosts Dashboard, LiveJobs, ApprovalsPage, JudgeScoresPage, Timesheet by door. $: no. Chat: no. Talk: route only.

### B4. Screen states (`components/states/ScreenStates.tsx`, `StateStrip.tsx`, `Gallery.tsx`, `saveQueue.ts`, `useSaveState.ts`, `words.ts`, `loading.ts`, `states.css`, `src/states/main.tsx`). Record screen-states
- nui tokens only (`states.css`: `--font-ui`, paper/ink). Nine regions: Normal, Empty, Loading, Failed save, Missing access, Changed brief, Run failed, Not right, Long run. Each is flat (no card, icon or motion), one plain line plus at most one primary button.
- Surface: inline regions; `StateStrip` is a strip above the document in `AppHost.tsx` (line ~479), under the OS bar; not in the Booth.
- $: words say credits "returned" (`words.ts`: "No credit unit exists yet … the run's reserved estimate is released and said so"). Chat: no. Conf: no. Named: no.
- Talk: new messages `clan:write` (page to shell, a write's saved/failed state), `clan:retry {id}` (shell to page), a new bar item kind **`state`** (`{kind:'state', state:'run-failed', why}`) and a bar action id `state-retry`. develop's `appBar.ts` drops unknown kinds, so `state` is invisible on develop until `appBar.ts` learns it. Edits to both templates (`retryDraft`, `doRetry`). Also touches `SaveStatus.tsx` (develop's existing save line in the document slot): two save indicators.

### B5. Agency look (`shell/agency/AgencyLookPanel.tsx`, `look.ts`, `accent.ts`, `look.css`, `nui/modes.css`, `theme.ts`, server `crates/napkin-web/src/look.rs`). Record agency-look
- Own mechanism: sampled accent. Admin uploads an SVG or PNG; the browser reads its pixels, takes the strongest non-grey colour, adjusts lightness per mode to 4.5:1 (`accentFor`, target 4.8), saves per mode; a `<style id="napkin-agency-accent">` sets `--agency-accent` (focus ring in `index.css` becomes `var(--agency-accent, var(--accent))`). The record says accent appears only for focus, selected item, where you are, counts.
- **Three modes**: White, Grey, Black (`theme.ts Mode`, `data-mode` on `<html>` with `data-theme` light/dark kept; `modes.css` Grey set; `ThemeToggle` rewritten). develop has two themes and a toggle.
- Fonts: the record says Helvetica Neue and no web font. The code still uses Geist (`tokens.css` unchanged; Helvetica appears only as the fallback stack). The templates still link Google Fonts (idea-room, script-editor, visual-brief: 2 references each), which the record's own test says must fail. Unresolved inside the build.
- Surface: the dialog `ch-dialog al-dialog` over a `ch-scrim` (modal), from the account menu item "Agency look" (`onLook`). $: no. Chat: no. Named: no. Talk: server (`getAgencyLook`), no `clan:*`; the templates are not told the sampled accent.
- Also adds token changes: `--faint` darkened, `--warn-text`, `--on-warn`, `--ink3` in dark.

### B6. Brief gate band and Brief check (`shell/gate/BriefGateBand.tsx`, `useGate.ts`, `words.ts`, `gate.css`; server `server/napkin/brief/gate.py`; schema `review.gate.checks`, `review.draft_scorecard`). Record brief-gate
- Look: nui tokens, legacy `--f-mono`; class `bg-band`. Surface: a **band above the open brief**, in the shell (`AppHost.tsx` ~508, inside `ch-work-main`), hidden in client review mode. A slim row ("n of 6 gate items passed · Territories closed") that opens the six items (one proposition, one insight, one measurable objective, feel or do, what would make this famous, effectiveness plan with baseline), the questions the client is owed ("One question for <client>"), two signers (planner, creative director) and one button ("Sign this version", "Sign and lock this version").
- $: no. Chat: no. Conf: a gate item quotes the brief's words (`because: The brief says "…"`); no confidential check. Named: no.
- Talk: its own host reads (`GET /gate`) and writes (sign = `/approve`-class write). No `clan:*`. It sits beside develop's Lock and Needs you in the Booth: two ways to lock (see C-1 list).

### B7. Client link panel, agency side (`shell/gate/ClientLinkPanel.tsx`; server `crates/napkin-web/src/links.rs`, `clean.rs`). Record client-confirm-link
- Opens inside the gate band. Account service types who it is for, copies a signed link to one exact locked version, sees links already made (`open/expired/withdrawn`), can withdraw one. Phase 1 does not email. Expires 30 days (410). $: no. Chat: no. Talk: host routes. Shell has no `clan:*`.

### B8. The client's confirm page (`src/clientLink/ClientLink.tsx`, `clientLink.css`, `linkToken.ts`; `main.tsx` mounts it when the address is `/c/<token>`; server `clean.rs`, `links.rs`)
- Own entry point: no sign-in, no shell, no service worker, no host, no OS bar. Look: shell tokens (paper/ink, Geist, `--ink2`, `--line-soft`, `--mono` undefined on develop, `--agency` for the mark), primary buttons at least 44px.
- Shows an allow-listed clean copy: four short sections (`clean.rs FIELDS`) and who signed; no agent context; Confirm / Ask for changes.
- **Conf: hides Confidential parts from the client** (`clean.rs confidential()` and `body_of` return nothing for a key in `confidential_fields`; `crates/napkin-host/src/ops/client_pieces.rs point_allowed` refuses a comment tag on a confidential field; `client_review.rs` header says "clients see everything (§7.5, item 6)" while `clean.rs` says "strict reading … the client's own link does not show them"). This contradicts develop's rule (A6).
- $: no. Chat: no. Named: no. Talk: HTTP to `/c/{token}` only.

### B9. Full client review link (`clientLink/ReviewLink.tsx`, `reviewModel.ts`; server `links.rs`, `mail.rs`, `crates/napkin-host` ops `client_pieces`, `client_review`). Record client-review-full
- Same page family as B8. One piece at a time, full width, version and "AI label"; pins a comment to a spot on an image or a moment in a film, tagged to a brief point or "preference"; several named reviewers, one approver; rounds; optional email code (`/c/{token}/code`).
- $: no. Chat: comment pins are not chat, but a pinned-comment box is free text to the agency. Conf: confidential fields cannot be tagged (see B8). Talk: HTTP. No client-side part in the shell.

### B10. Round view, agency side (`shell/clientReview/RoundView.tsx`, `roundWords.ts`; embedded in `JobPage` and `ClientLinkPanel`)
- Agency's merged list of the round: who was sent it and where each stands, comments ordered by piece then position, flags `split` and `same spot`. Surface: inside the job page and the gate band. Duplicates develop's in-shell client review (`ClientReviewBand/Panel`, `clan:clientmode`, "Record the client's answer" in the Booth) with a different data model (decisions `client_comment`, `client_answer` by `client:<email>`).

### B11. Versions, Undo, Redo (`shell/versions/VersionBand.tsx`, `VersionPanel.tsx`, `compare.ts`, `undoStack.ts`, `useBriefUndo.ts`, `versions.css`). Record brief-versions-undo
- Look: nui, legacy `--f-mono`. Surface: `VersionBand` is a slim band above the open **script** (`AppHost.tsx` ~511, script editor only); `VersionPanel` (version list, compare any two side by side, Restore) opens inside the gate band for the brief. Cmd/Ctrl Z and Shift Cmd Z are the shell's, at desktop width, not while a field owns its undo (`keepsItsOwnUndo`).
- $: no. Chat: no. Conf: a compare shows both versions' words. Named: no.
- Talk: new `clan:undo-key {dir:'undo'|'redo'}` (page to shell) for keys pressed inside the frame. Restore writes a new edit; never deletes a newer one; an approved version stays locked. develop already has `features/system-undo.clan` (Production Tool undo chips replaced by one stack); the build's stack is a second, separate mechanism for the brief.

### B12. Visual brief (`app/templates/visual-brief/index.html`, 458 lines; server `crates/napkin-host` spin-off; shell `TerritoriesGate.tsx` in `landing/`). Record visual-brief
- Own copy of tokens in the template's `:root` (`--ag-base`, `--ag-act`, `--desk`, `--paper`, warm paper, Geist, Newsreader, Geist Mono), `prefers-color-scheme` dark, `data-color-scheme`; links Google Fonts. Asks `clan:me?` (so it takes agency colours). All images are plain rectangles (no radius over 2px).
- Surface: its own `<aside class="side" id="side" aria-label="Approval">`: **its own side panel, not a Booth**. $: no. Chat: no. Conf: not handled. Named: no `ClanFeedbackTarget`, no `data-clan-part`.
- Talk: `clan:viewloaded`, `clan:dataupdated`, `clan:me?`. No `clan:bar`, `clan:parts`, `clan:booth`.
- `TerritoriesGate.tsx`: a card on the client's tool page: closed, it lists what stands in the way (brief gate, signed, client confirmed); open, a typed territory spins off a visual brief.

### B13. Agency dashboard (`home/Dashboard.tsx`, `dashboardModel.ts`, `dashboard.css`, `useLiveRead.ts`; server `jobview.rs`). Record job-index-dashboard
- nui. A door page (Management's home). Six tiles (stage counts, live jobs, at risk, hours, waiting on client, Judge), each number a link to the job. Read-only index rebuilt from the documents; a write answers 405. Refreshes inside 10 s. **$: hours and a percentage of budget in hours (`dashboardModel.ts`); Judge tile shows averages.** No chat. Talk: route only.

### B14. Live jobs (`job/LiveJobs.tsx`)
- nui. Door page. Soonest deadline first; Open a job (client, title, deadline) for the Money roles and planners. Empty with one verb "Open a job".

### B15. Job page (`job/JobPage.tsx`, `jobModel.ts`, `job.css`, route `#job-J001`). Record job-page
- nui, `--warn-text`. Full page. Number, title, client, stage "step n of 11", who holds the job and for how long, dates, the approval route strip, round view, every document filed under it. Edit title/owner/deadline (role-gated); **budget in hours shown only to the Money group**. The way back from a document opened from the job lands on the job (`cameFrom` in `App.tsx`). $: hours only. Chat: no. Talk: route; no `clan:*`.

### B16. Needs you, in full (server `crates/napkin-web/src/needs.rs`; shell `home/Home.tsx` rows, `useJobNeeds.ts`, `model.ts`). Record needs-you-full (verifying)
- A per-person list, ordered by each item's own deadline, five shown then "Show all n"; quiet **Done** on a notice with a 5-second Undo; empty state names the next deadline; texts built from an allow list (job number, client name, document title, stage label, date). The changed-brief banner is gone; it is a row.
- Lives on the Home (and as a door), **not** in the Decisions drawer and not read from `decisions/needs.ts`. A different concept from develop's Needs you (see C-1).
- $: no. Chat: no. Talk: `GET /needs`, `markNeedDone`/`undoNeedDone`.

### B17. Approval route and Approvals door (`approvals/ApprovalsPage.tsx`, `RouteEditor.tsx`, `RouteStrip.tsx`, `approvalsModel.ts`, `approvals.css`; server `needs.rs`, `jobview.rs`). Record approval-route
- nui. Door page (Account service, Management). One row per stage: who approves, by when; client step carries contact and rounds. "Approvers are typed as sign-in names until agency-setup provides the directory." Who holds the job and days late appear in Needs you and on the dashboard; reminders are computed from the clock, not stored. Nothing scores a person. $: no. Chat: no. Talk: `PUT /api/t/{tenant}/jobs/J001/route`.

### B18. Judge band (`judge/JudgeBand.tsx`, `useJudge.ts`, `judgeModel.ts`, `judge.css`, `words.ts`; server `server/napkin/judge/*`, `handlers/judge_work.py`, `spend.py`, `client_ai.py`). Record judge
- Look: reuses gate.css (`bg-band jb-band`); legacy `--f-display`, `--f-mono`, `--f-body` (undefined on develop). Surface: **band above an open script, route or visual brief** (`AppHost.tsx` ~513). Score out of 30 (idea, craft, effect, 10 yes/no tests each, evidence per test), failed tests first, advised route, the creative director's overrule with a written reason, "Score again" on a new version, "advice until Judge has earned trust".
- **$: yes.** `judgeModel.ts priceLine`: "Judge reads this version once. A run costs about <n> cents / <x.xx> euros, and the spend cap is checked before it starts." (or "The price of a run is not set yet"). Telemetry rows carry cost.
- Chat: no. Conf: `server/napkin/judge`, `client_ai.py`, `judge_work.py` have no `confidential_fields` / `model:false` check (grep found none): the work is sent to the model. Named: no. Talk: host `/judge`; no `clan:*`.
- Name clash: develop already has an agent called Jude (the brief's Review agent, `server/napkin/brief/judge.py`; "Jude said it is wrong" in `redraft-provenance`). The build's "Judge" is a different thing.

### B19. Judge scores door and Judge tile (`judge/JudgeScoresPage.tsx`; tile in `dashboardModel.ts`)
- nui. Door page. Pieces scored, average, under 24, 27 and over, Brave, overruled, per job; never per person. $: not for people; cost lives in telemetry, not shown here. Talk: `GET /jobs`.

### B20. Idea room (`app/templates/idea-room/*`, 593-line `index.html`; server host ops). Record idea-room
- Own copy of tokens; Geist/Newsreader/Geist Mono from Google Fonts; defaults `--ag-base #515BFF`; **does not ask `clan:me?`**, so it never takes the agency colours. Sections `#brief`, `#gate` ("The team goes first"), `#cards`, `#routes`; no side panel at all.
- Slice 1 only is built (cards, votes, routes as forks, merge, creative director's pick, open early). **Slices 2 and 3 not built**: Ban the default, Swap test, Fame test, precedents (`next_step` in the record). So no price on any button in the template today; the record says each model run shows its price first.
- Chat: no (sparring partner chat is a non-goal). Conf: not handled. Named: none. Talk: `clan:bar`/`clan:bar-action`/`clan:bar?`, `clan:write`, `clan:retry`, `clan:dataupdated`, `clan:viewloaded`. A card has authors and votes "never per person".
- Humans first: the host refuses model tasks until five human team cards exist.

### B21. Script editor (`app/templates/script-editor/*`, 944-line `index.html`, `house-style.json`, `house-style.cases.json`). Record script-editor
- Own token copy and its own `<aside class="side" id="side" aria-label="Check, version and hand-offs">` (cards: The check, Version, Send): its own side panel, not a Booth. Beats with stable ids, five formats, radio notation (FVO, MVO, VO, SFX, MUSIC), read time against a slot, live check in code (mandatories, banned words, house style), tracked changes as human patches ("Keep mine" exists here, a different meaning from develop's Keep mine), accept refused if the line changed. "Send to Radio / Film / Judge" buttons.
- $: no price in the template (the AI-in-the-margin rewrite/headline options with price on the button is in the record, not in the page). Chat: no. Conf: not handled. Named: none. Talk: `clan:undo-key`, `clan:dataupdated`, `clan:viewloaded`; **no `clan:bar`**, so its actions are not in the OS bar. Shell adds `VersionBand` and `JudgeBand` above it.

### B22. The one bar (`shell/bar/BarField.tsx`, `BarMount.tsx`, `BarList.tsx`, `Shortcuts.tsx`, `commands.ts`, `providers.ts`, `barStore.ts`, `keys.ts`, `bar.css`; server `crates/napkin-web/src/search.rs`). Record one-bar-search
- Look: nui tokens (`bar.css`, `--font-ui`, `--warn-text`). **A field inside develop's OS bar** (`Toolbar` gains a `barField` prop, drawn between the place and the tool's buttons) plus a panel mounted once beside the shell's overlays (`BarMount`); full-width sheet at 390px.
- Keys: Cmd/Ctrl K opens from anywhere including inside a tool frame (`BAR_KEY_FORWARDER` injected into the frame's `<head>` by `AppRuntime`; page posts `clan:bar-key`); `?` opens the shortcuts sheet when no text field has focus; Esc closes. The shortcuts sheet reads one table, which has neither develop's `F` (feedback) nor `]` (Booth).
- Search: titles and listed facts only (jobs, documents, assets, scripts, people), permission-filtered through `roles.rs allowed`, tenant-scoped, index rebuilt from documents. Commands: the person's doors, Home, The map, Your timesheet, Undo, Sign out. Provider seams for Ask Nap and the microphone are built **empty** (the field shows nothing in the slot).
- $: no. **Chat: it is the seam Ask Nap and voice plug into; it is a typed-command field and today answers no questions.** Conf: an index entry never holds document words. Named: no. Talk: `clan:bar-key`; also the shell's own key listener.
- develop's desk already has "Find a client" (`Desk.tsx`, `landing/model.ts matches`), and develop's bar has no field. This changes the one-bar rule.

### B23. Agency setup flow (`shell/setup/SetupFlow.tsx`, `SetupCard.tsx`, `CsvImport.tsx`, `setup.css`, `api.ts`, `model.ts`; server `agency.rs`, `directory.rs`, `look.rs`). Record agency-setup
- nui, `--warn-text`. Full page at `#setup`. Starts with the logo; later steps (name, people and roles, clients, jobs, brand kits, product libraries) skippable; progress read from data. CSV import for people, clients, jobs, checked before write, per-line errors. Settings: name, logo, accent, monthly credit cap (cannot be enforced yet). A Napkin admin creates an agency with `POST /api/control/agencies` (state `needs-vault`, fails closed). **$: a monthly credit cap setting.** Chat: no. Talk: HTTP (`/t/{tenant}/agency`, `/setup`, `/setup/import/{kind}`).

### B24. People and roles (`shell/setup/PeoplePage.tsx`; server `directory.rs`, `agency.rs`). Record agency-setup
- nui. Full page at `#people` (not a modal). Lists people with roles (nine roles), invite (`POST …/agency/people/invite`), change roles, remove (last admin cannot be removed). The directory, when an agency has one, is the **only** source of who may sign in and with which roles (`directory.rs` header); role changes take effect within a minute. Only an admin of that agency. Every change is an attributed, append-only decision (`set_roles`). Duplicates develop's People page.

### B25. Audit page (`shell/setup/AuditPage.tsx`, `#audit`; server `audit.rs`)
- nui. Full page, read-only: every approval, export, client link, permission change and sign-in, in a chain that shows tampering; the page can verify. Nothing scores a person. No counterpart on develop (develop has the Decisions drawer per document and `dogfood` recording).

### B26. Timesheet (`timesheet/Timesheet.tsx`, `api.ts`, `beacon.ts`, `useWorkSessions.ts`, `timesheet.css`, `words.ts`; server `crates/napkin-web/src/timesheet.rs`). Records timesheet-sessions (building), timesheet-signals (exploring)
- nui. Full page at `#timesheet`. A drafted day from work sessions and the person's own decisions, gaps flagged with a best guess, one tap to confirm; a person who said no fills it by hand with no warning. Private to the person until confirmed; a manager's request gets 403.
- Sessions: `useWorkSessions` + `Beacon` (30 s heartbeat, 5 s blur grace, `open/focus/blur/close`; sends nothing about keys, clicks or text) while a job's document is open and in focus. Its own mechanism: it does not use `clan:activity`. $: no. Chat: no. Conf: sends no document content.

### B27. Timesheet consent card (`timesheet/Ask.tsx`, `consent.ts`; on Home)
- A card in the Home's flow that "covers nothing": "Should Napkin OS draft your timesheet?" once at first sign-in. Nothing is captured before a yes. Not a chat (the name `Ask` is unrelated to develop's Ask).

### B28. Territories gate and brief to visual brief spin-off (`landing/TerritoriesGate.tsx`)
- Covered in B12; listed separately because it changes develop's tool page for a client.

### B29. Brief Maker and Research template edits (both `index.html`)
- Brief Maker: `draft_scorecard`, gate checks in schema, `state-retry` bar action and the `state` item. Research: `state` item and `doRetry`. No Booth (their Booth does not exist on the build). Develop's Booth, redraft in place and confidential rule are all missing there.

Records added or changed on the build vs develop (31): agency-look, agency-setup, approval-route, ask-nap (exploring), brief-gate, brief-versions-undo, cannes-removal, client-confirm-link, client-review-full, client-wall, first-day (exploring), harness, idea-room, j001-phase2-suite, j001-pilot-suite, job-index-dashboard, job-page, judge, napkin-brain (exploring), needs-you-full, one-bar-search, remaining-homes, roles-and-homes, screen-states, script-editor, sso (exploring), territory-tool (changed), timesheet-sessions, timesheet-signals (exploring), visual-brief, voice (exploring). Screens counted in Part B: B1 to B29 (29 rows; B28 and B29 are the cross-cutting ones). Records with no screen yet (ask-nap, napkin-brain, voice, sso, first-day, timesheet-signals, client-wall, cannes-removal, harness, the two suites) are not rows.

---

## Part C. The differences

Size key: S restyle to tokens, M move into the Booth or onto shell messages, L behaviour must be redesigned. Row numbers match B-numbers.

| # | Screen / panel | develop's rule | what the build does | Size | Files |
|---|---|---|---|---|---|
| 1 | Roles home (B1) | First screen is the desk (`#agency`): greeting, client circles, Dial, Pick up, Worth a look; the person has the whole agency | `#agency` becomes a role home (Needs you, five doors, More tools) for anyone with a role; the desk becomes the "Clients door" | L | `shell/home/Home.tsx`, `model.ts`, `useHomeView.ts`, `landing/LandingHome.tsx`, `App.tsx`, `route.ts`, `roles.rs` |
| 2 | The O (B2) | No department map; circles are clients | A second circle screen whose circles are departments, at `#map` | L | `home/TheO.tsx`, `home.css`, `roles.rs map_for` |
| 3 | Door pages (B3) | Navigation is client then tool (`#client-`, `#tool-`) | A third axis: `#door-<door>` and `#home-<role>`; "later phase" doors open Empty states | L | `home/DoorPage.tsx`, `doorTargets.ts`, `components/states/doors.ts`, `route.ts` |
| 4 | Screen states (B4) | Save line in the doc slot (`SaveStatus.tsx`); errors are plain lines inside each screen; app talks to the bar with `clan:bar` | Nine shared components, a strip above the document (`StateStrip`), `clan:write` / `clan:retry`, new bar kind `state` | M (messages) plus S (words) | `components/states/*`, `AppHost.tsx`, `AppRuntime.tsx`, `SaveStatus.tsx`, `appBar.ts` (must accept `state`), both templates |
| 5 | Agency look (B5) | Colours admin-set in `palette.ts`, tokens `--ag-*`/`--agency*`; two themes; Geist | Colour sampled from an uploaded logo into `--agency-accent`; three modes (White, Grey, Black); templates not told | L | `agency/look.ts`, `accent.ts`, `AgencyLookPanel.tsx`, `nui/modes.css`, `theme.ts`, `ThemeToggle.tsx`, `tokens.css`, `index.css`, `look.rs` |
| 6 | Brief gate band (B6) | Brief status, Needs you and Lock live in the Booth (`#briefView`); the page is the brief | A shell band above the brief with six gate items, two signers, "Sign and lock this version", Territories gate | L | `gate/BriefGateBand.tsx`, `useGate.ts`, `words.ts`, `gate.css`, `AppHost.tsx`, `brief/gate.py` |
| 7 | Client link panel (B7) | "Record the client's answer" in the Booth; Share > Send the client copy runs the app's own `client` bar action on a locked doc | Panel in the gate band that issues a signed link to a clean page | M | `gate/ClientLinkPanel.tsx`, `links.rs`, `barMenus.ts` (Share) |
| 8 | Client confirm page (B8) | Client sees everything; client copy = full sheet; confidential never hides a part from the client | Page at `/c/<token>` that hides every confidential part and shows four allow-listed sections | L | `clientLink/ClientLink.tsx`, `clean.rs`, `crates/napkin-host/src/ops/client_pieces.rs` |
| 9 | Full review link (B9) | Client review is a shell mode (`clan:clientmode`, `+ This part`, `clan:part-mark`) done by an agency person | Client-facing pages, pieces, pinned comments, rounds, reviewers, email code | L (needs owner call, see C-3) | `clientLink/ReviewLink.tsx`, `reviewModel.ts`, `links.rs`, `mail.rs`, `client_review.rs` |
| 10 | Round view (B10) | In-shell `ClientReviewBand` / `ClientReviewPanel` | `RoundView` inside job page and gate band | M | `clientReview/RoundView.tsx`, `roundWords.ts` |
| 11 | Versions and undo (B11) | No brief undo; history is the Decisions drawer (By time, Lineage); Production Tool has its own undo (`system-undo`) | Shell Undo/Redo stack, VersionBand over scripts, VersionPanel in gate band; `clan:undo-key` | M | `versions/*`, `AppHost.tsx`, `AppRuntime.tsx` |
| 12 | Visual brief (B12) | Tool pages: Booth beside the sheet, `clan:bar` for actions, agency colours via `clan:me`, parts named for feedback | Own side panel `#side` "Approval"; own token copy; no `clan:bar` / `clan:parts` / `clan:booth` | M | `templates/visual-brief/index.html` |
| 13 | Dashboard (B13) | None; no hours or budget in the shell | Six tiles incl. hours and budget percentage | L (owner call) | `home/Dashboard.tsx`, `dashboardModel.ts`, `jobview.rs` |
| 14 | Live jobs (B14) | None | Door listing live jobs | S once door model is settled | `job/LiveJobs.tsx` |
| 15 | Job page (B15) | A job is not a unit in develop; documents live under a client | `#job-<n>` page | L (owner call) | `job/JobPage.tsx`, `jobModel.ts`, `App.tsx` cameFrom, `jobview.rs` |
| 16 | Needs you (B16) | One selector `decisions/needs.ts needsOf()`: what blocks lock in the open doc; shown in Decisions drawer, bar count, medallion | A second Needs you: per person, by deadline, across jobs, Done with Undo, on Home | L | `home/Home.tsx`, `home/model.ts`, `useJobNeeds.ts`, `needs.rs` |
| 17 | Approval route (B17) | Signers/approval inside the document (Lock, `/approve`); "Review agent" decisions | Per-job route of stages with approvers and due dates; Approvals door | L | `approvals/*`, `needs.rs`, `jobview.rs` |
| 18 | Judge band (B18) | Agents act in place with sphere + role marks; the Review agent (Jude) says yes/no per part; no price shown to people | Shell band above script/route/visual brief with a /30 score, advice-until-earned, overrule, and a **price line** | L | `judge/JudgeBand.tsx`, `judgeModel.ts`, `useJudge.ts`, `server/napkin/judge/*`, `handlers/judge_work.py` |
| 19 | Judge scores door / tile (B19) | None | Per job scores, counts | S (restyle) plus owner call | `judge/JudgeScoresPage.tsx`, `dashboardModel.ts` |
| 20 | Idea room (B20) | Tool = page + Booth; agency colours via `clan:me`; no model price in UI | Own panel-less layout, own token copy, no `clan:me?`, slice 2/3 unbuilt (price buttons planned) | M | `templates/idea-room/index.html` |
| 21 | Script editor (B21) | Booth beside the sheet; `clan:bar` for actions; Keep as is; Keep mine/Use this on proposals | Own `#side` panel (check, version, send), its own Keep mine, no `clan:bar`, VersionBand and JudgeBand above it | M | `templates/script-editor/index.html`, `versions/VersionBand.tsx` |
| 22 | One bar (B22) | OS bar has no field; Cmd K unused; F = feedback, `]` = Booth; "Find a client" on the desk | Field in the bar, Cmd K, `?` sheet, index search, command table, empty Ask/voice seams | M (bar field) plus L (what the bar is for) | `bar/*`, `Toolbar.tsx`, `AppRuntime.tsx` (`BAR_KEY_FORWARDER`), `structuredEditBridge.js`, `search.rs` |
| 23 | Agency setup (B23) | Setup is the admin's People page (add person, add agency + look) | A guided flow: logo, name, people, CSV, clients, jobs, brand kits; credit cap | L | `setup/SetupFlow.tsx`, `SetupCard.tsx`, `CsvImport.tsx`, `agency.rs` |
| 24 | People and roles (B24) | `PeoplePage` modal, admin = `engineer@napkin` only, Napkin look, roster store `people.rs` | Page `#people`, per-agency admin, nine roles, directory replaces the roster | L | `setup/PeoplePage.tsx`, `directory.rs`, `agency.rs`, `auth.rs` |
| 25 | Audit page (B25) | Per-document Decisions; no agency audit view | Admin audit chain page | M (no rule; owner call) | `setup/AuditPage.tsx`, `audit.rs` |
| 26 | Timesheet (B26) | None | `#timesheet` page and session beacon (own mechanism) | L (owner call) | `timesheet/*`, `timesheet.rs` |
| 27 | Consent card (B27) | None | Card on Home | S | `timesheet/Ask.tsx`, `consent.ts` |
| 28 | Territories gate (B28) | Tool page lists a client's documents | Gate card that blocks Territories until brief passed and client confirmed | M | `landing/TerritoriesGate.tsx`, `gate/words.ts` |
| 29 | Brief Maker / Research (B29) | Booth, redraft in place, confidential rule, redraft provenance, Needs-you status pill | Build predates all of it | M (merge, not redesign) | both `index.html`, `schema.json`, `shared/` |

Cross-cutting items; each row above also carries them:

| Item | develop's rule | what the build does | Size |
|---|---|---|---|
| Parts named for feedback | `ClanFeedbackTarget` in each tool, shared fallback by control label; shell pointer picks | No screen or tool the build added defines `ClanFeedbackTarget` or `data-clan-part` | S per shell screen, M for the new templates (idea-room cards, script beats, visual brief points need `kind`/`id`/`label`) |
| Talks to the shell | `clan:*` messages | Shell screens are React inside the shell (no frame, no messages); the three new templates use their own subset | M for the new templates |
| Price / cost | None shown to people in shell or tools (only Production Tool) | Judge band price line; dashboard hours and budget percentage; job page budget in hours; setup credit cap; "credits returned" in Run failed; record text on idea-room and script-editor buttons (not built) | L (needs the owner's rule) |
| Confidential | Napkin's systems never see it; the client sees all | Hidden from client link and from comment tags; Judge and planned model tasks do not check it | L |
| Modes and fonts | Light/dark; Geist | White/Grey/Black; the record asks for Helvetica Neue and no web font, code keeps Geist, templates still call Google Fonts | L for modes; S for fonts |

### C-1. Places where the build and develop implement the same thing twice

1. **Who can sign in**: develop `shell/people/*` + `crates/napkin-web/src/people.rs` (admin `engineer@napkin`, roster seed, agency look on the page) against `setup/PeoplePage.tsx` + `directory.rs` + `agency.rs` (per-agency admin, nine roles, directory overrides roster and the identity provider's `custom:roles`). Two stores, two routes, one account-menu item each. The build's `barMenus.ts` has no `onPeople` slot (it predates it; it has `onLook` instead).
2. **Needs you**: `decisions/needs.ts needsOf` (one selector for the drawer, bar count and medallion) and the Booth's `#lockList` + Lock against `needs.rs` + Home rows + `useJobNeeds`. Same words, two meanings ("what blocks this lock" vs "what is addressed to me by deadline").
3. **Locking and signing**: Booth "Lock the brief" (`approveLocked`, `/approve`) against the gate band's "Sign this version" / "Sign and lock this version" (planner, creative director) and the approval route's brief-check step.
4. **Client's answer**: shell client review mode (`clientReview/*`, "Record the client's answer", `clan:clientmode`) against the client link pages and `RoundView` (decisions `client_answer` / `client_comment`).
5. **Share the client copy**: `shareItems` > "Send the client copy" (runs `client` bar action, full sheet) against `ClientLinkPanel` (allow-listed clean page, confidential hidden).
6. **Search / navigation**: the desk's "Find a client" and the Client chip switcher against the bar's field and Cmd K.
7. **Judge**: the brief's Review agent "Jude" (`brief/judge.py`, `review.judge`, verdict words) against Judge's /30 verdicts as a second agent with its own band; both write verdict decisions into the chain.
8. **Undo / history**: Decisions drawer By time and Lineage against `VersionPanel`; `system-undo` in the Production Tool against the shell undo stack.
9. **Agency look**: `palette.ts` admin-set colours (and the People page's "add an agency with its look") against the sampled accent in `look.ts` and the AgencyLookPanel; the `--ag-*` set against `--agency-accent`; light/dark against three modes.
10. **Save state**: `SaveStatus.tsx` in the document slot against `StateStrip` and `clan:write`.
11. **Landing**: the desk (`#agency`) against the role home and the O, both served as the first screen.
12. **Doors vs tools**: `landing/tools.ts` (tool ids `brief research idea deck prod ads`) against `home/doorTargets.ts` and the doors table in `roles.rs` (names such as Brief, Research, Ideas, Script editor, Judge scores). Two tool lists.
13. **Part naming**: develop's `ClanFeedbackTarget` against the build's undocumented part ids (beat ids in the script editor, card ids in the idea room, gate item ids).

### C-2. Things develop has that the build's screens ignore entirely

- The Booth: no build template has it; all three new templates have their own side panel or none; no `clan:booth`, no `]` key, no 1100 px rule, no edge tab, no question dot.
- `clan:bar` for tool actions: script-editor posts none; visual-brief posts none; idea-room posts it.
- `clan:parts`, `clan:part-mark`, `clan:edit-request` (client review in the shell): not implemented by the new templates.
- `clan:me?` for agency colours: idea-room and script-editor never ask (they stay `#515BFF`); visual-brief asks.
- `clan:colorscheme`: the shell posts light or dark only, so Grey is not understood inside frames (`schemeOf('grey') = 'light'`).
- The agent look in place: spheres, role marks, "drafted by X · you accepted", holder rule proposals (Use this / Keep mine), `aw-sheen`, the status pill, Keep as is. None of the new tools use them; the idea room's cards and script's tracked changes use their own wording. The script editor's "Keep mine" means a writer rejecting a creative director's mark-up, not a person keeping a part from an agent.
- `ClanFeedbackTarget` and the F key (feedback by pointing): not defined on any build screen; the build has no `pointer.ts`.
- The confidential rule (#224): `clean.rs`, `client_pieces.rs point_allowed` invert it; Judge and `client_ai.py` ignore it.
- Decisions drawer language (`decisions/words.ts`, `verdictWords`, agent sphere + role signing): the build's decisions (`set_roles`, `set_route`, `move_deadline`, `issue_link`, `client_comment`, `client_answer`, overrule) need words; `words.ts` has no entry (the build adds one `classify` line only).
- The medallion and `markStore` engaged state: the build's `Home` and `TheO` do not use `clan:activity`; the timesheet beacon is separate.
- `desk-recent-first` and entry naming (a keyed entry named by topic, not id); `decisions-verdict-words`.
- The desk's client circles, Dial, "Worth a look", Brand Clan card and `ClientView`.
- `Launcher` fallback and `comingSoon.ts` / `SoonCard` for tools not yet live (the build uses Empty states from `doors.ts` instead).
- `AGENCY_COLOURS`' `accentUse: 'line'`, `pill: 'base'`, `surface: 'mono'` variants (Catapult, Pluto, B+G): the sampled accent has no equivalent.
- Dogfood recording and the "About this beta" notice for every new screen.

### C-3. Things the build has that develop has no rule for yet (designer must ask the owner)

1. **Roles** (nine roles, a home per role, a door table per agency, role switcher for admins), and server 403 by role/group (`roles.rs`). develop has only "admin vs not" for People.
2. **Jobs** as a unit above documents (job number, stage "step n of 11", owner, dates, budget in hours), the job registry and job page.
3. **Money and hours in the shell**: budget in hours, hours percentage, monthly credit cap, Judge run price, "credits returned". The owner's rule on showing price to people is not in develop's code.
4. **Approval route** and holder-with-days-late; reminders computed from the clock; "nothing scores a person".
5. **Per-person Needs you by deadline across jobs** and a Done with 5-second Undo.
6. **Client-facing pages with no account** (`/c/<token>`): signed links, expiry (30 days), withdrawal, reviewers, one approver, rounds, pinned comments, optional email code, mail seam. develop's client review is agency-side.
7. **Brief gate** (six items, two signers, Territories closed until confirmed) and the Territories gate card.
8. **Judge** (score out of 30, trust state, overrule, vault-stripped telemetry, backend named by `NAPKIN_JUDGE_BACKEND`).
9. **Idea room** (humans first, forks as routes, creative director's pick) and **Script editor** (beats, radio notation, live check, tracked changes as human patches).
10. **The one bar** as a command and search surface, its permission-filtered index, and the Ask Nap / voice seams.
11. **Timesheet** (work sessions, consent, drafted day, privacy rule: a manager never reads another person's unconfirmed day).
12. **Audit page** (tamper-evident chain, who did what).
13. **Agency setup flow**, CSV import, creating an agency with no repo change (`/api/control/agencies`, `needs-vault`).
14. **Three modes (Grey)** and a logo-sampled accent.
15. **Visual brief** (rectangle images only, creative director approves one version).
16. **Screen-state vocabulary** (the nine states, "Not right", "Long run") as a shell-wide contract.
17. De-identified J001 seed data ("Client A, an Irish whiskey") for tests: develop has `uat-loop` and `uat-environment`; whether J001 data may share a stack with UAT is not ruled.
18. Rules the build applies to every screen: no em dash in interface strings, 44 px primary buttons at 390 px, axe clean in three modes. develop has no such written rule in the files I read.

---

## Could not determine from code alone

- Whether "shared Ask" in the brief means Research's "Ask about this" (`pv-askfocus`, `ask_research@1`) or something owner-side not in code; I found no component literally named that.
- Where develop's shell (not the tool pages) names its own things for feedback; `pointer.ts` is on develop only and I read its header, not the shell's picking code.
- Whether the owner wants price hidden from people everywhere; develop's shell and templates show none, the Production Tool shows some, and no rule is written in what I read.
- How a Judge verdict reads in develop's Decisions drawer: develop's `words.ts` has no mapping for `judge`, and I did not run it.
- Which of the 59 intervening develop commits touch the same lines the build edits; I listed likely conflict files from the diff against the merge base, I did not attempt a merge.
- Whether `agency-look`'s Helvetica rule was dropped on purpose; the record says it, the code and tokens say Geist.
