# UAT round 6 · images (slug: images) · verification round

Account mock@napkin · new project **UAT-R6 images A** (prj_01M7YCG82Y192XM3VTYHBB1MB1 / relay proj_01M7YCG9MCDRJC3B5DBRJF8VV4) · UAT fix/pt-uat-loop a55d7ce7 (director.v17) · Playwright headless Chromium 1440x900 · 06:25–06:50 UTC. Every job has its relay trace (queued/submitted/provider_done/fetched/landed + director + provider_submit).
Files: jobs.jsonl (7 rows), jobs/ (records, relay logs, f1-f4.png, storyboard-leo.jpg, ext219*.png crops), shots/ (70), paid.log, requests/responses.jsonl, browser-log.jsonl.

**S1/S2 found: none.** One round-5 S3 is not fixed (S3-4, below); 2 new S3.

## Summary
- Part A (round-5 ids): **12 fixed, 1 not fixed (S3-4), 2 not retested** (fill-token rough and S2-6 brand-on-plan, which need a paid fill or brand-board job).
- New bugs: 0 S1, 0 S2, 2 S3.
- Prices: none in Resize confirm ("Extend · Ideogram 4.5"), storyboard or Keep. $ only in Decisions (correct).
- Console: clean (only the 401 on /api/session before sign-in).

## Part A: round-5 retest
| Id | Result | Evidence |
|---|---|---|
| S2-A look on frames | **fixed**. Every frame POST carries shot.direction "Look: Leo, a man in his forties with a short grey beard and a red knitted beanie." (frames 1-4). Frame 1 prompt has the look; it drew him right: red knitted beanie, short grey beard, ~40s | requests.jsonl, job_01M7YCJK6M93R24WH59DZDHFD9, jobs/f1.png |
| S2-B brand ask | **fixed**. "Acme brand" on the Leo storyboard linked the board (undo "link board to storyboard"); "No brand" on the brief storyboard kept (undo "answer This brief has no Brand board…"). No "could not be saved", no console schema errors; after Save + reload neither asks again | shots/053-056 |
| S2-C extend 21:9 seam | **fixed**. Same sunset (u01_beach_2048 → 1536x864) → 21:9 2048x878. Column step at the master edges: L max 2.0 / mean 0.94 (x≈240), R 2.0 / 0.75 (x≈1808); round 5 on the same picture 4.5 / 2.25 and 5.0 / 2.19; sky baseline 0.56. No blotches at normal view. Faint soft column remains with contrast boost (new S3-B) | job_01M7YD02HM5F8AK0XF8XSAG4A5, jobs/ext219-small.png, ext219-edges100.png, ext219-sky-contrast.png |
| S2-D Draw the rest double | **fixed**. Exactly 3 frame POSTs for shots 2/3/4 (+6.4 s / +13.3 s / +38.1 s); frames 2 and 3 landed 3 s apart, one frame-4 job only; all frames v1 | jobs.jsonl, shots/019-022 |
| S3-1 pen options | **fixed**. After Storyboard and after the picture editor, the pen options sit in the top bar (#pt-tool-options at x 603, y 9); two strokes starting at x=90 both drew; Ctrl+Z took them one at a time | shots/030-032, 035 |
| S3-2 extend words | **fixed**: relay prompt says "flat colour bands taken from its edge" | ext219 provider_submit |
| S3-3 ask twice | **fixed**: one visible ask card in the opened Storyboard (the other is the hidden canvas node) | shots/062 |
| S3-4 "Draft a script" | **NOT fixed**: see S3-A | job_01M7YDH45D3540B8A9DGR2JTZB |
| S3-5 Used in | **fixed**: @leo card "Used in · 4" (shots 1-4); "Show its storyboard on the canvas" is enabled and frames the storyboard | shots/027-029 |
| S3-6 real names | **fixed**: relay line "Shop signs and storefronts show no real business's name." in all 4 frame prompts; the bakery sign reads just "BAKERY" | jobs/f1.png |
| S3-6b "from the script" | **fixed**: the new brief storyboard says "plans the shots from the brief" | shots/052 |
| Rough: group label | **fixed**: "Ruby · 2 views" sits on @ruby_front (its own view), even with @ruby_side placed far away | shots/069 |
| Rough: first load | **fixed**: "Opening Napkin Studio…" from 0.5 s until the canvas (16 s cold, 1.8 s on reload) | shots/001-003 |
| Not retested | fill tokens (needs a paid fill); S2-6 brand context on a brief plan (the brief storyboard was answered No brand, and the board with a brand is empty) | |

## BUG list
- **S3-A (round-5 S3-4, not fixed) "Draft a script from the brief" still plans shots.** Steps: link a brief, New storyboard from this brief, Plan shots. Dex asks "The script is empty. What should the 15 seconds show?", with the option "Draft a script from the brief" (value {"route":"draft_script_from_brief"}). Click it. Expected: the plan stops, the storyboard gets its own script with the brief linked, Skye drafts it, and the Script editor opens. Actual: the web POSTs /jobs/…/answer to Dex, which plans 6 shots in 19 s. No script is drafted. Dex's rationale even says "The empty script was drafted from the brief" (Decisions). Cause: web/src/jobs/scriptFirst.ts SCRIPT_ROUTE = /^(?:(?:write|draft)_(?:a_|the_)?script(?:_first)?|script_first)$/ does not match Dex's actual route "draft_script_from_brief". Its other routes are "await_script" and none. Fix: accept a _from_brief suffix, or match ^(write|draft)_.*script. Claude cost only ($0.05). shots/062-063, job_01M7YDH45D3540B8A9DGR2JTZB.
- **S3-B Extend 21:9: faint soft column just outside the master edges.** There is no step at the edge, but with a contrast boost a soft lighter band about 50 px wide shows just outside each edge (x≈190–250 and ≈1810–1860 of 2048, up to ~5 levels in blue on the right). There are also faint vertical streaks in the far-left band. You can barely see it at 100 %, and not at canvas size. This likely comes from the landing tone-match fading over 35 % of the band (relay/formats.py). jobs/ext219-sky-contrast.png, ext219-edges100.png.
- **S3-C Rough UI bits.** The canvas Undo button label stays "Undo: name leo_front" after pen strokes, though Ctrl+Z undoes the strokes (shots/031). The @leo "Used in" list wraps "Shot 3" / "Shot 4" onto two lines (shots/029). The Storyboard's "← Canvas" control has no button role named "← Canvas" (a click by role timed out; by text it works).
- Note (not a bug): Dex keeps the Look line in the frame-3 prompt but drops it in frames 2 and 4. Those frames have @leo_front as the character ref, so identity still held.

## Dex findings
- **Got:** the frame gets the shot with direction = the Look line (new), the ratio, and, after Keep, the @leo_front character ref with its card, plus the script line "Shot 1 (@anchor): …". shot_list gets the note text and targetS. The brief plan gets the brief spine and the answer.
- **Sent well:** the frame 1 prompt includes the look. Later frames say "The character is @leo_front, exactly as in that picture." The setting comes from each shot ("not the bakery in the script"). The relay adds the no-real-names line once. Extend is passthrough with flat-band words.
- **Should send / fix:** an answer that routes to drafting a script should never reach Dex (S3-A). Dex's rationale claimed a script it never wrote.
- **Tokens / latency** (director.usage): shot_list (note) 6,920 in / 512 out / 3.1 s; frame 1 9,146 / 239 / 2.0 s; frames 2-4 9,573–9,578 / 281–326 / 2.5–5.4 s; brief ask 7,602 / 494 / 4.2 s; brief plan after answer 7,716 / 1,668 / 12.5 s. Resize is passthrough, with no Dex.

## Quality (1-5)
| Job | Score | Notes |
|---|---|---|
| plan (Leo note) | 5 | 4 shots = 4 beats, 15 s, varied cameras |
| frame 1 | 5 | red knitted beanie, short grey beard, 40s; generic "BAKERY" sign; full bleed |
| frame 2 | 5 | same man riding a misty canal path |
| frame 3 | 4.5 | on a bridge parapet over a canal, 4 rowers below; reads more like a canal wall |
| frame 4 | 5 | smiling, hangs the bike in a woodwork shop |
| extend 21:9 | 4.5 | one sun, continuous horizon, no seam step; faint soft column with a boost |
| brief plan | 4 | right cast and end line, but it shouldn't have planned (S3-A) |

No collage, and identity held across all 4 frames (jobs/storyboard-leo.jpg).

## Timings (s)
| Step | Time |
|---|---|
| first load (cold) | loader at 0.5 · canvas 16.4 |
| plan shots | click→POST 3.7 · landed 3.9 |
| frame 1 | POST 2.9 · relay 21.3 (provider 16.3) · UI 23.5 |
| Draw the rest ×3 | POSTs +6.4 / +13.3 / +38.1 · provider 23.3–24.0 each · all landed 75 |
| extend 21:9 | POST 2.3 · provider 43.4 · UI 54.3 |
| brief plan | ask 6.6 · answer→6 shots 19 |

## Spend
Provider **$1.05** of $1.50: frames 1–4 4 × 0.20, extend 21:9 0.25. Every paid action was named in paid.log first, with no unplanned jobs. Claude **$0.16** (cost.agentUsd: plan 0.019, frames 0.021–0.022 ×4, brief ask+plan 0.052).
