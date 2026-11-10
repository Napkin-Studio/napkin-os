# New UI visual guide

This is the visual documentation for Napkin Studio's new UI (branch `feat/new-ui`). Open `index.html` in a browser. Each page is self-contained HTML with inline CSS. Screenshots are in `img/` (JPG, each 200 KB or less). Fonts load from Google Fonts and fall back to system fonts.

Captured 2026-11-11 from the live stack (`:18080`, feat/new-ui; Deck Studio from `:18580`, the deck branch). The browser was read-only and every write was blocked. Only the local test documents were used (roster users tia@tbwa, sam@wk, bo@boysandgirls, cat@catapult, plu@pluto).

## Pages

| File | What it covers |
|---|---|
| `01-principles.html` | The eight rules: one thing at a time, paper sheets, no floating drawers, the panel never repeats the page, one primary per view, plain words, every line clickable, agents in one place only |
| `02-foundations.html` | Colour tokens (light and dark), type specimens (Geist, Newsreader, Geist Mono), spacing, radii, shadows, paper surfaces, button classes |
| `03-agency-looks.html` | All nine agencies from `palette.ts` (base, accent, pill, actions, surface, logos), sign-in switching, the boot look, how an admin adds an agency |
| `04-deep-o.html` | Deep O states rendered from `deepOSvg.ts`, the state table from `deepO.ts`, timing, follow while awake, 30 s sleep, late show, reduced motion |
| `05-agents.html` | Roles, materials and marks rendered from `roles.js`, sizes (stage, 88–96px specified, 44px side line, 28px), the run stage, hover thread, ask flow, never in the bar |
| `06-shell.html` | The top bar per place, menus, the Decisions drawer and its four tabs, desk, dial, client page |
| `07-brief.html` | Prompt and source card, the sheet (ruled rows, Open/Boxed, Show as, Tone, 12-column rows), side tab states, in-place editing, move/resize, provenance, client review, lock, logos |
| `08-research.html` | Report body, visual vocabulary (shapes, marks, bars, tiers), panel states, footing, Evidence map and Key, missing source, Confirm |
| `09-patterns.html` | Source cards, crumbs, Your call, needs-you, empty states, loading, dark mode, breakpoints |
| `10-copy.html` | Copy rules and the old-to-new glossary |
| `11-gaps.html` | Live-versus-design mismatches and open decisions from the feature records and design files |

## Rules for agents building from this

- **Tokens come from code, not this guide.** The source of truth is `app/src/shell/nui/tokens.css`, `nui.css` (generated from the mock, do not hand-edit), `shell.css` (hand additions), `app/src/shell/agency/palette.ts`, `app/src/brand/deepOSvg.ts` / `deepO.ts` / `DeepOMark.tsx`, and `app/templates/shared/agent-sphere/roles.js`. The guide quotes them. If they disagree, the code wins and this guide needs updating.
- **Never hard-code an agency colour.** Use `--ag-base`, `--ag-acc`, `--ag-act` and `--ag-act-ink`, and the surface tokens. Add agencies only in `AGENCY_COLOURS`.
- **One filled button per view**, `--ag-act`. Amber (`--warn`) only for needs-you.
- **The panel shows the document or one item, never both.** Crumb, at most two levels, Esc goes back.
- **Agents:** spheres only on the run stage and the 44px side line (`NapkinRoles.side`). Never in the top bar. Role names only.
- **Copy:** no ids, keys, "pins" or persona names on the surface. See `10-copy.html`.
- Previews marked "simulated" or "previewed by class" were made by toggling CSS classes in the live page, because the guide does not write. Everything else is the live build as it stood.

## Regenerating

The capture and build scripts were throwaway (`/tmp/claude-1000/guide-work/`). To refresh: sign in read-only with Playwright, block non-GET requests apart from sign-in, take 1440×900 screenshots, and compress to JPG at 200 KB or less. Rebuild the token, mark and sphere data by bundling `palette.ts` and `deepOSvg.ts` with esbuild, and by loading `agent-sphere/*.js` in a Node `vm`.
