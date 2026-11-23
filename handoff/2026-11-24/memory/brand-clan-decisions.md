---
name: brand-clan-decisions
description: "Owner decisions (2026-10-19) for the Brand Clan: one kit per brand per agency, frozen copies, roster-only seed, write-back only through client-accepted documents, strictly per agency"
metadata:
  node_type: memory
  type: project
  originSessionId: 5f9369b1-b1e6-4fd3-b44c-d946c8ad0c67
  modified: 2026-11-23T13:42:47.916Z
---

Brand Clan (feature `brand-clan`, contract draft `docs/contracts/brand-clan.md` on feat/production-tool-overhaul), owner (Shrey) decisions on 2026-10-19:
- One Brand Clan per brand per agency (tenant); it IS the client shelf's "Brand kit". Documents hold a frozen copy under `data.upstream.<brand doc id>` with a version and an Update chip (same carry as spin-off; new `attach` verb). Live-link-only and per-project-only were rejected.
- Naming a brand with no kit seeds it from the roster and the brand layer ONLY. No public-web reading.
- Write-back is NOT automatic and NOT agent-proposed mid-project: it goes through the existing client review. When a document is recorded as client-accepted, its brand-worthy items and the approved document itself (as an exemplar) are offered to the kit; a person confirms; the kit publishes a new version.
- Strictly per agency: no Napkin house seed, nothing crosses tenants.
- Also decided 2026-10-19: the kit's chain travels into projects whole and unpinned; harvest is offered on accepted AND accepted_with_changes; the brief's theme from the brand is a proposal, never applied; the name is 'Brand Clan' wherever the kit is named (canvas node stays Brand board); contract v3 carries project.brand {document_id, version} instead of project.client_id. Design approved; record status designed (commit a49b1f4 on feat/production-tool-overhaul).
- Facts stay in the brand layer (D1); the kit holds pins plus design language, assets, voice, rules, formats, people and approved work.

Update 2026-11-23 (owner, after a review of feat/brand-clan — now pushed, 947775c4, 238 commits behind develop and duplicating develop's own attach):
- For a deck's colours/type/logo the **client's Brand Clan wins**; the agency look only when the client has no kit. This reverses Sai's 17 Nov rule (agency look unless the deck "wears" the client) — Sai needs telling (Slack only as a draft unless approved).
- A finished deck takes a new look **only when a person presses Update look** (re-theme the same words); never automatically.
- "The entire tool works on per agency workflow. Everything is isolated by agency." → one kit per client per agency; nothing shared across agencies.
- The owner wants to CHANGE Brand Clan before it is built further: there are no mock UIs for it, and the real workflow is in the owner's head. Next step = capture the owner's workflow, then mocks, then build. Do NOT port/merge/build the branch until then. Review: napkin-local-keep/brand-clan-review-2026-11-23.md.

Owner's Brand Clan workflow (2026-11-23), redesign input — start with the Brand Bible only:
- A Brand Clan holds EVERYTHING for a brand; v1 = the Brand Bible (logos, colours, typography, usage rules + tone, imagery style, and the original uploaded file as source). Keep provisions (empty sections in the shape) for later: previous work/ads, categories explored, likes and dislikes, preferences over time.
- Built in the background when someone uploads a brand bible during Brief, Research or Production: Napkin detects it and ASKS ONCE ("Build its Brand Clan?"), then builds while the person carries on; attached to the brand so all future work has it through the whole flow.
- No separate app: it shows in the CLIENT WINDOW at the bottom (like today), rendered like the boards; it is a CLAN file with edits, editable in place.
- A newer bible later → new version + what changed; a person accepts (or keeps parts). Old work keeps its version.
- In-flight work: offer an Update chip, never change silently. New work gets the latest automatically.
- Production: a Brand Clan node placed automatically on a brand's project (renders like colour/typography boards), powers jobs ONLY WHEN LINKED (same rule as refs/Brief).
- Multiple per brand: YES (owner 2026-11-23, rejecting "one per brand with variants inside"): "multiple brand clans is required, because brands might want to have different looks as well, and experiment with them. We just need a way for them to select the correct brand clan either during brief or during production." (e.g. Coca-Cola Original / Zero / Diet, or an experimental look). Selection happens in the Brief or in Production.
  - Each brand marks one Brand Clan as its DEFAULT; new work starts with it, switchable in one click.
  - Upload for a brand that has Brand Clans asks once: Update '<name>' (new version + what changed) / Make a new Brand Clan (name it) / Not a brand bible.
  - Chosen in: a brand chip in Brief Maker (carried by spin-off), a picker on the Production Brand Clan node, the Deck's Update look, and the client window (lists the brand's Brand Clans, sets the default, open/edit).
  - Mocks (looks) APPROVED by the owner 2026-11-23: napkin-local-keep/brand-clan-redesign-2026-11-23/mock (12 screens; d1/d3 redone). Link rule: a Brand Clan links to ANY node (Script = words; Storyboard/Film/Key visual = look), carries DOWNSTREAM, nearest link wins per branch. The 12 questions in DESIGN.md §8 were APPROVED with the recommended answers (owner: 'Most of these are good'). Editing mocks f1-f4b (edit in place → Draft vN → Publish → Update chip on open work; history; old versions read-only) APPROVED; owner 2026-11-23: 'Approved. Build.' — the whole redesign is approved for build (fresh branch from develop, reuse develop's attach).
  - One Production project may use TWO Brand Clans side by side (two nodes; each job uses the one it is linked to) to compare looks.

**Why:** set while designing the Brand Clan after the plan had switched to a brand database; the owner wants both a database (facts) and a carried clan (everything else).
**How to apply:** design brand features within these; the design is approved; build phase 1 on feat/brand-clan per the record's next_step. Related: [[production-tool-overhaul]], [[design-before-code]], [[no-backward-compat-by-default]].

Build decisions (owner 2026-11-23, "Yes to both"): (1) add `pypdfium2` (permissive licence) so vector logos drawn inside a brand-bible PDF can be cut out; (2) the "looks like a brand bible" question is a strip under the shell's top bar (tool frames are sandboxed), an accepted difference from mock a1.
