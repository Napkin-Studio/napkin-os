# Lessons from the Brief → Research → Production → Deck UAT runs (2026-11-21..23)

Every item below happened for real. A plan for a new tool must say, per item, how the tool avoids it.

## Getting it running where people are
1. **Built ≠ deployed.** Deck Maker worked on laptops but was never packed into the server image's seed and no engine ran in any cloud env; the first UAT user hit "app not installed". Plan the cloud path (image, seed, Terraform switch, deploy workflow, env vars) as a feature from day one, not "later".
2. **Cloud model access is Bedrock with the task role**, not an API key or the local backend. The deck engine only spoke API-key / local; it had to be retrofitted. Use the shared Bedrock path (engine/brief_llm.py NAPKIN_MODEL_API=bedrock + server/napkin/model_routes.py ALIASES) from the start, and check model agreements (Opus 5.5, Sonnet 5.5, Haiku 4.5 are authorised in eu-west-1).
3. **Heavy native deps are a design decision.** LibreOffice made the deck image heavy; the owner chose PDFs printed by napkin-web's Chromium from HTML (crates/napkin-host/src/export.rs render_pdf), as Brief/Research do. Don't add native deps a tool doesn't strictly need; never put a tool's deps in the shared middleware image.
4. **Infra goes live only by terraform apply (owner), before the deploy; then verify the task definition in AWS.** Deploy workflow runs from develop, so infra/workflow changes need merging first.
5. **Every downloadable output needs a real delivery path.** Deck Maker's Export buttons only toasted; the files existed on the engine but nothing carried them to the person.

## Hand-offs between tools (spin-offs)
6. **Spin-off is the one way between tools** (library.rs spinoff_targets / spinoff_change_from; data.upstream.<doc>), carrying links not media; target tool must be installed or the error must name that, not "could not find the saved project".
7. **Upstream content must actually arrive and be read**: the deck showed "No research brought in" / "brief field is empty" / "Objectives: (field is null)" though both were carried. Test that each upstream field reaches the screen and the output.
8. **Pictures by link need a reader with rights**: a narrow signed `assets` pass (audience assets, GET /assets only). Importing an export must re-home every picture (only 3 of 23 arrived because https locations were assumed to be on this relay).
9. **Pick inputs by identity, not by eye or recency**: the OOH sizes were made from the wrong (non-final) key visual because two similar pictures sat side by side and nothing marked the final. Show Final / version / rights visibly; use content hashes.
10. **Rights**: trust stated rights; unknown/unstated → "Rights to supply"; mock never. Final must carry a rights choice.

## Engine / pipeline correctness
11. **Live ≠ replay.** Gate-continuation was treated as a type change only in live mode; recorded replays never hit it. Every gated pipeline needs a live-mode test (model stubbed) through all gates.
12. **Engine output must match the host schema**: tables of 15 rows vs schema max 8, a QA rule id missing from the enum → the paid deck silently never landed. Contract test: every id/shape the engine emits validates against the app schema; host refusals must be shown to the person.
13. **Recorded model calls cost money twice on timeout retries** (stage e timed out at ~120 s, retry paid again): set timeouts from measured latency; make retries resume, not repay.
14. **Every pictured slot needs a fitting source or an honest gap**, never the key visual reused everywhere; de-duplicate by hash; storyboard frames attached but not drawn.
15. **Text leaks**: raw markdown (~~strike~~), internal field names ("field is null"), "(to confirm)" scattered through titles.
16. **Length discipline**: 21 slides vs "about 10, at most 12"; a "15 s" ad rendered 17.3 s.

## UI / flow
17. **Buttons that only record a request** ("Edit beats", "Shorter", "Say it another way", "Fix this with the agents") read as broken. Either do it or say plainly it applies on the next build.
18. **State after an action**: Approve silently dead after an edit until reload; redraft re-asked 9 already-answered questions; raw 400 errors shown in the booth.
19. **No prices outside Decisions/History.** Spend shown only there.
20. **Format-aware generation**: a 4:1 billboard from a 4:5 master can't hold the product; the tool offered Extend and then the server refused. Check feasibility before offering a method; say why.
21. **Model text on generated pictures** ("PREMIUM DRINKING WATER" on a cider can) needs a check/regenerate loop with the exact words.
22. **Laptop first (1024–1440)**; screenshots of every step; build matches the approved mock.

## Process
23. Design before code; owner approves each feature record; small features that build one at a time, each with done_when, test plan, rollout.
24. Test live end to end after each build (real backends, $ caps, ledger), never only mocks; separate provider spend from Claude spend.
25. Cost caps per run, named before paid calls.
