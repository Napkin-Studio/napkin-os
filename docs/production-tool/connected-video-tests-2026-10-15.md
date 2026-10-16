# Connected video: phase 0 paid tests (2026-10-15)

The paid tests T1 to T8 from `features/connected-video.clan` (phase 0), run by Sai on his own Runway
key. Shrey approved them on the record (CV3), and the spend cap for the run was 2,500 credits ($25).
They answer one question for the owner: should a run of shots be made as **one take** (one
generation, cuts inside it) or **chained** (a clip per shot, joined)?

- **How it ran:** a script in the session scratchpad calls Runway directly. The relay has no
  capability sheets for `wan3`, `h3_max`, `seedance2_5` or `gemini_omni_flash_1.1` yet (model-swap),
  so it could not be used. Nothing in the repo changed for these tests.
- **Inputs:** the frames of the 2026-10-13 hackathon remakes. *Thor for Vorr* (a stylised Viking, 9:16)
  for the One take, reference and join tests, and *Team DL 2* (a photoreal man and the VELTO robot,
  16:9) for the chain, match and first+last tests.
- **Outputs:** `production-tool/relay/results/outputs/connected-video-tests-2026-10-15/` (git-ignored).
  `log.jsonl` there has one line per task: model, request, queue and total time, failure.
- **Spend:** 2,135 credits ($21.35) in all, under the $25 cap. Every test except T6 came within 8 credits
  of its estimate; T6 cost 391 against an estimate of 240 (the plan said about 376).
- **How to read the results:** every test is **one run**. The pictures were judged by eye from
  contact sheets. The SSIM numbers compare single frames scaled to 640x360, so use them to compare
  arms with each other, not as absolute scores.

## Summary

| Test | Question | Result | Credits |
|---|---|---|---|
| T4 One take | Does one generation keep the character and put the cuts where the prompt says? | **Yes, on all four models.** `wan3` is the best value | 820 |
| T1 Chain | Does starting each clip on the previous last frame keep shots continuous? | Continuous (seam 0.98), but later shots drift from their storyboard frames | 240 |
| T2 Match | Does redrawing each start from the last frame plus references keep identity? | Identity and room hold by eye; the seam is not pixel-continuous (0.27 to 0.29) | 180 |
| T3 First+last | Does Veo land on both given frames? | **Yes** (0.985 first, 0.970 last) | 80 |
| T5 References | Does reference mode (no pinned first frame) hold a character? | Yes across 10 s, but slow (11 min) | 200 |
| T6 Extend | Can Seedance extend a clip? | **Yes**: a new 8 s clip that picks up the pose and keeps the character (seam 0.60, not pixel-exact) | 391 |
| T7 Latency | How long do the steps take? | See the table at the end | none (from the runs above) |
| T8 Two-shot join | Can the cheaper models join two shots with first+last frames? | **`wan3` reproduces both frames** (0.97 to 0.98, seam 0.99); `h3_max` only loosely (0.55 to 0.74, seam 0.95) | 216 |

## T4. One take

One generation of 15 s (10 s on Omni) from Thor's first frame, with a prompt that lists the cuts at
fixed times: boat, beach landing, trainers, forest, cottage (the first four on Omni's 10 s). A timed-cut prompt like
`[0-3s] Wide shot: … [3-6s] Medium shot: …` was used for all four.

| Model | Length | Cuts landed at (asked) | Time | Credits | Audio |
|---|---|---|---|---|---|
| `wan3` | 15 s | 3.0, 6.0, 9.0 s (3, 6, 9) | 5 min 25 s | 150 | none (`audio: false`) |
| `seedance2_5` | 15 s | 2.9, 6.1, 8.9 s (3, 6, 9) | 9 min 12 s | 450 | none (`audio: false`) |
| `gemini_omni_flash_1.1` | 10 s | 2.6, 5.0, 7.4 s (2.5, 5, 7.5) | 58 s | 100 | yes, no switch |
| `h3_max` (768p) | 15 s | 3.8, 6.3, 8.7 s (3, 6, 9) | 27 s | 120 | yes, no switch |

- **Every model made every shot** in one go, and the Viking (braided beard, horned helmet, axe, green
  trainers) holds across the scenes. `wan3` follows the prompt most closely. Seedance has the most
  dramatic action (a leap, a mud splash). `h3_max` is fast but puts the cuts up to 0.8 s off.
- **Scene detection missed a cut.** ffmpeg's scene filter (threshold 0.25) found three cuts in each
  15 s clip, but each has four (five shots visible in the sheets). The missed one is the dark
  forest to cottage cut at about 12 s. The design that maps cuts back to shots with scene detection
  needs a more sensitive detector, or the prompt's own times as a first guess.
- **`wan3` needs `ratio: auto_720p`** for a first-frame request; a fixed ratio is refused with a 400.
- **`wan3`'s 15 s file is 26.8 MB**, close to the 32 MB limit for a video sent to Runway by URL.
- **Not tested here:** dialogue and lip sync, moderation (refusals are billed and all-or-nothing per
  run), photoreal faces, runs longer than 15 s, and retaking one shot's window.

## T1 and T2. Chain, and match

Three DL 2 shots on `veo3.1_fast`, 4 s each, no audio, three ways. **Independent:** each clip from its own
storyboard frame. **Chain:** each clip starts on the previous clip's last frame. **Match:**
`gemini_image3_pro` redraws the next start frame from the previous last frame, the man, and the
storyboard frame as layout only; then a clip from it.

| Arm | Seam 1 to 2 | Seam 2 to 3 | Last frame vs its own storyboard frame |
|---|---|---|---|
| Independent | 0.274 | 0.301 | 0.295, 0.280 |
| Chain | **0.983** | **0.984** | 0.225, 0.214 |
| Match | 0.277 | 0.291 (and 0.274 into shot 4) | 0.274, 0.296, 0.282 |

*Seam* is SSIM between one clip's last frame and the next clip's first frame (1.00 is identical).

- **Chain is continuous** by construction, and it is the only arm that scores above the plan's
  0.95. But its shots stop following their storyboard frames: by the second shot the robot is small
  and on the wrong side of the table, and shot 3 loses the glowing laptop. Part of this is by design
  (a chained start frame does not contain what the next storyboard frame adds, such as the robot in shot 2),
  so the plan's "pin only the first shot of each run" rule matters.
- **Match keeps the room, the man and the robot** as in the storyboard, by eye. Its seam scores look
  like an independent seam because the start is a redraw, not a copy. So pixel SSIM cannot rate a
  match seam: it needs a different measure, or a person.
- **Costs:** 40 credits per clip; 20 per redraw, plus about 30 s each.
- **Drift per hop:** the numbers are close together and one run each, so treat the ordering as a lead.
  The pictures show it more clearly than SSIM does.

## T3. First and last frame

One 8 s `veo3.1_fast` clip from DL 2 shot 3 (first) to shot 4 (last). The clip's first frame matches
shot 3 at 0.985 and its last frame matches shot 4 at 0.970. Veo takes both frames, so a bridge seam
works. 80 credits, 61 s.

## T5. Reference mode

`seedance2_5`, three Thor frames as references (no pinned first frame), 10 s at 480p, asked to run
through the forest and jump a log. The character holds across all 10 s (beard, helmet, cape,
trainers) and the action is right. I did not compare it closely with the three reference frames. It
took **11 minutes** and 200 credits, the slowest test.

## T6. Extend

`seedance2_5` `mode: extend` on the T5 clip, asked to burst out of the forest onto a cliff path and
climb towards a stone cottage. 391 credits, 3 min 34 s (queue 23 s).

- **The result is a new 8 s clip, not the original plus more.** It is 720p although the input was
  480p. The first frame is the original's last pose (seam SSIM 0.60, so it is the same picture
  re-rendered, not an exact copy). The Viking keeps his beard, helmet, cape and trainers all the way
  to the cottage door.
- **The request must not carry a `ratio`:** it is refused with a 400, because the output follows the
  input's aspect ratio. Nothing is billed for a refused request.
- Extending remakes the audio on this model (see the record's finding); these clips were silent.

## T8. Two-shot join with first and last frames

Thor shots 4 to 5 and 5 to 6, 6 s each, on the cheaper models, each pair pinned to both frames.

Scores compare the clip's first and last frames with the frames it was given; the seam compares the
end of shot a with the start of shot b.

| Model | Credits each | Time (a, b) | First frame vs given (a, b) | Last frame vs target (a, b) | Seam a to b |
|---|---|---|---|---|---|
| `wan3` | 60 | 207 s, 125 s | 0.981, 0.975 | 0.973, 0.982 | **0.992** |
| `h3_max` | 48 | 17 s, 16 s | 0.547, 0.602 | 0.600, 0.738 | 0.948 |

`wan3` reproduces the frames it is given, so the two shots join cleanly. `h3_max` keeps the idea of
both frames but not the pictures (one run each; its output is 768x1344 against 720x1280 frames, which
accounts for some of the gap). Its join scores 0.948, just under the plan's 0.95 for continuous. For
the Draft mode in the record, `wan3` can do first+last joins; `h3_max` is faster and cheaper but looser.

## T7. Time per step (queue was 5.6 to 13 s for every task)

| Step | Time |
|---|---|
| `veo3.1_fast`, 4 s clip | 39 to 50 s |
| `veo3.1_fast`, 8 s clip, first+last | 61 s |
| `gemini_image3_pro`, 2K redraw | 28 to 34 s |
| `h3_max`, 6 s / 15 s | 16 s / 27 s |
| `gemini_omni_flash_1.1`, 10 s | 58 s |
| `wan3`, 6 s / 15 s | 125 to 207 s / 325 s |
| `seedance2_5`, 15 s at 720p / 10 s at 480p | 552 s / 660 s |

## What this means for the open decisions

These are the owner's calls; this is the evidence.

- **CV4, One take as the default for runs without dialogue.** The evidence supports offering it.
  `wan3` is the strongest first choice (15 s for about $1.50, cuts within 0.03 s), with Seedance as the
  slow, expensive "best action" option. Per-shot retakes and moderation behaviour are still untested.
- **Chained joins.** A chain is continuous but drifts from the storyboard from the first hop on;
  match or a first+last pair holds the design better. The plan's cap of 3 chained hops looks too high.
- **Extend.** Seedance can continue a clip into a new shot, but the result is a separate 8 s clip at
  391 credits, and extending remakes audio.
- **Draft and Final modes.** `wan3` works as the cheap join model; `h3_max` is faster and cheaper
  (16 s, 48 credits) but only loosely follows the given frames.
- **Seam scores.** Chain seams score 0.98 and independent ones 0.27 to 0.30, so the plan's 0.85 and
  0.95 thresholds separate those two. Match seams will read as jumps, so they need another check.
- **Before this ships:** model-swap must add `wan3`, `h3_max`, `seedance2_5` and Omni to the
  capability sheets, and the cut detector needs tuning.
