---
name: uat-loop-production-2026-11-21
description: "Owner answers 2026-11-21 for the post-demo UAT loop on the Production Tool + Dex: ship spike branch, $50 soft cap, build everything with records, loop until no bugs"
metadata:
  node_type: memory
  type: project
  originSessionId: 5f9369b1-b1e6-4fd3-b44c-d946c8ad0c67
  modified: 2026-11-20T18:46:38.249Z
---

Shrey (2026-11-21, after the Stena demo) asked for a UAT loop: deploy to UAT, test every feature incl. real generation, watch backend + frontend + timings, audit what Dex (the middle agentic layer: prompt-writing, model choice) gets / could get / sends / should send, judge output quality vs the ask, check every button (e.g. joining two shots in video is broken), try paths: no refs, too many refs, drawing, straight from brief, script writing. List bugs + improvements, build them, loop again.

Answers:
- **What ships:** push `spike/acne-stena-demo` to origin and deploy UAT from it (Deploy workflow `ref`). Fixes go on that branch; nothing to develop until he reviews.
- **Spend:** $50 soft limit; past $50 only tests that definitely need money.
- **Fix gate:** build everything, including look changes, each with a feature record and mock-vs-build screenshots; he reviews after.
- **Stop:** loop until no bugs, or he says stop.

**Why:** he is away and cannot answer questions mid-loop.
**How to apply:** don't stop to ask; record decisions in feature records. Still never touch main/staging/prod, never terraform apply, never --no-verify. Related: [[uat-loop-authority]], [[post-build-live-testing]], [[build-matches-mock]].
- **Scope:** Production Tool only — no deck tool, no brief/research work in this loop.
- **Shared relay:** UAT and staging share napkin-hackathon-relay (Lambda); deploying the spike relay to it (deploy-production-tool.yml from the branch) is approved; record the previous `live` version for rollback each time.
- **Branch actually used (2026-11-21):** the spike push is blocked by the licence gate (licences/fonts.toml from the deck work, needs NAPKIN_LICENCE_APPROVED = Shrey). PT code on spike ≈ develop (12 deck/brief-list files), so the loop runs on `fix/pt-uat-loop` cut from origin/develop (worktree ~/Documents/Code/napkin-wt-pt-uat). Spike stays local with 3 push fixes committed (golden re-record 49d98010, projects example, soffice test path).
- Local soffice = Flathub LibreOffice via ~/.local/bin/soffice wrapper (flock-serialised; flatpak drops concurrent instances).

**Status 2026-11-21 (end):** owner stopped the loop after round 6 ("just give the report, no fixes"). UAT = fix/pt-uat-loop a55d7ce7, relay 25 / stitch 19 (shared with staging). Nothing merged to develop, no PRs. Final report + 25 open questions: ~/Documents/napkin-local-keep/uat-loop-2026-11-21/LOOP-REPORT.md. One S2 left: 9:16 cutdown drops caption + end line (R6-F1). Spend ≈ $42.5 provider + ≈ $8–9 Claude.

Update 2026-11-23: the loop's fixes merged into develop (PR #267), followed by #268 production spin-off, #269 Production finals/rights/fit, #270 deck-cloud. UAT now runs develop 49c2d779 (middleware task rev 39 = middleware + deck engine container, relay on develop); UAT Terraform for the deck applied by the owner. UAT's tfvars are not in the repo: the real values include production_relay_url / production_relay_secret_arn (a plan from the example alone would remove the Production Tool from web) — see [[uat-terraform-values]].
