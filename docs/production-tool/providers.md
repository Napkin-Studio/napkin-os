# Production Tool: what each provider can do

> **For the current models, prices and what each provider accepts, read
> [provider-reference.md](provider-reference.md).** It is generated from the capability sheets and
> the providers' own schemas, so it stays in step with the code. This page is the research behind
> it, as of 2026-10-06: the "Combine" step has since been folded into Generate, and the defaults
> changed on 2026-10-08 (features/default-models.clan).

Checked against Runway's docs on 2026-10-06. Runway is the main backend; other
labs (ElevenLabs and others) come later as further adapters. The research on fal
and HeyGen, used for the hackathon and removed after it, is at the git tag
`hackathon-2026-10` (features/drop-hackathon-extras.clan). The design is
in `features/production-tool.clan`. This page holds the facts it relies on.
Re-check a fact against its source before you build on it. Prices change, and
docs pages contradict each other in the places marked below.

## Checked 2026-10-13 (features/runway-sheet-sync.clan)

Read from Runway's openapi.json (version 2024-11-06), `guides/pricing.md` and `_llms-txt/core-api.txt`
on 2026-10-13. The committed snapshots of the first two are in `production-tool/relay/tests/fixtures`;
`tests/test_runway_sheet.py` holds `capabilities/runway.json`'s `models` catalogue to them, and the
weekly `runway-sheet-sync` workflow opens an issue when Runway changes them. Where this section and the
older notes below differ, this section is right.

1. **Credit value.** 1 credit = $0.01 (pricing.md and the OpenAPI info). `usdPerCredit` in the sheet.
2. **Mask polarity.** `ideogram_4_5` `maskUri` is "black-and-white, the same size as the first reference;
   black areas are edited, white preserved": the schema's `png_black_edit`.
3. **preciseEdit** (`ideogram_4_5`) edits the first reference image keeping its composition and size. It
   needs at least one reference, takes no ratio and defaults to quality high (25 cr); `very_low` is not
   allowed with it. It keeps the whole composition and locks no one object, so "Keep the label exactly
   as it is" is a white area in the mask, not `preciseEdit`. Prices: very_low 1, low 4, medium 8, high
   25 credits per image, times `outputCount`.
4. **A stopped task.** CANCELLED and FAILED tasks carry `cost.credits` ("final cost in credits for a
   terminal task; fully refunded tasks report 0"); PENDING, THROTTLED and RUNNING carry `estimatedCost`.
   An aborted task "will not be able to be fetched again", so after our own DELETE its cost cannot be
   read. Whether a stop is charged is not published: `relay/scripts/live_check_stop_charge.sh` settles it
   from the credit balance. Billed failures and moderations are charged silently (owner, 2026-10-13).
5. **Aleph 2** (`aleph2`; `aleph2_alpha` is a deprecated alias) is on Runway Dev since 2026-06-02 with
   no tier gate in the docs. Input 2-30 s at 30 fps or lower; the output keeps the input's resolution
   (up to 1080p) and length. Prompt at most 1000 UTF-16 units. 1-5 keyframes, each with `seconds` (0-30)
   or `at` (a fraction); an optional `range` {start_seconds, end_seconds} in whole seconds, end
   exclusive, on every keyframe or none. `targetAspectRatio` expands to 16:9, 4:3, 3:2, 1:1, 2:3, 3:4,
   9:16 or 21:9 (no 4:5). 28 cr/s, 56 cr minimum. Access on our key: `live_check_aleph2.sh`.
6. **Veo 3.1.** `promptImage` is one image, or a first frame with an optional last frame (never a last
   frame alone). 4, 6 or 8 s. Ratios 1280:720, 720:1280, 1080:1920, 1920:1080. Audio defaults on.
   `veo3.1` 40 cr/s with audio, 20 without; `veo3.1_fast` 15 and 10.
7. **Upscale.** `magnific_precision_upscaler_v2` (POST /v1/image_upscale): `scaleFactor` 2, 4, 8 or 16;
   25 cr, or 150 cr when the output passes 4096 px. Our frames are 1344:768, 768:1344, 1024:1024 or
   896:1152 (director.py picks the allowed ratio nearest 1 MP), so 2× gives 2688 × 1536 for 25 cr and 4×
   gives 5376 × 3072 for 150 cr. Video: `magnific_video_upscaler_creative` (POST /v1/video_upscale),
   $0.007, $0.009 or $0.012 per output frame (720p/1k, 2k, 4k), credits = ceil(USD / 0.01).
8. **Extend and reframe.** No Runway model outpaints a still: pad it and fill the padding with an
   `ideogram_4_5` mask (8 or 25 cr), or re-render on Gemini at the new ratio (20 cr). Video in space:
   `aleph2` `targetAspectRatio` (no 4:5). Video in time: `mode: extend` on `seedance2_5` and
   `gemini_omni_flash_1.1`. No Runway model tracks a subject to reframe.
9. **Prompt limits** in UTF-16 code units: `gemini_image3_pro` 5500, `veo3.1` 1000, `aleph2` 1000,
   `ideogram_4_5` 10000. The adapter and the director count UTF-16 units from the sheet's `promptMax`,
   so an emoji (2 units) at the limit is refused by us, not by Runway.
10. **Concurrency** is per model, per project; the Magnific upscalers have their own table. The sheet's
    note (one shared count per class, read from GET /v1/organization) stays.
11. **Gemini price tiers** follow the output resolution: Pro 20 cr at 1K and 2K, 40 at 4K; Flash 5 at
    512 px, 7 at 1K, 11 at 2K, 16 at 4K. Our ratios are 1K, so $0.20 and $0.07 a frame.

What one ad costs at these prices is `production-tool/contracts/cost-model.json`, printed in
[provider-reference.md](provider-reference.md#what-one-ad-costs). The tool shows no price to people;
each job's cost is recorded and shown in History (owner, 2026-10-13).

## What each flow step needs, by provider

| Step | Runway |
|---|---|
| Front view and Combine | `text_to_image`: `gemini_image3.1_flash` (7 cr at 1K) / `gemini_image3_pro` (20 cr). Up to 14 refs `{uri, tag, subject: human\|object}`, at most 5 human. Refs are named `@tag` in the prompt. No seed. |
| Turnaround | One Gemini call per view, with the chosen front as a `human` ref |
| Storyboard frames | Gemini, with the 4 views as `human` refs. One task per frame. |
| Region edit (image) | **No mask, bbox or region field anywhere.** We send the clean frame plus a copy with the box drawn on it, then paste the original back outside the box on our side. |
| Frame to clip | `image_to_video`: `veo3.1_fast` (first and last frame, 4/6/8 s). `seedance2_5` in ref mode takes the frame and the views, but **not together with a pinned first frame**. `gen4.5` (2-10 s). |
| Region comment on a paused video | `aleph2` on `video_to_video`: an edited keyframe plus `range` (integer seconds, end exclusive). Limits the edit in **time only**. 28 cr/s, 56 cr minimum. |
| "Change the feel" | `aleph2` with a prompt only |
| Audio (later) | `text_to_speech` (`eleven_v4`), `sound_effect` |
| Getting results | Polling only, at most every 5 s. No webhooks. No idempotency key. |
| Concurrency | Tier 4: 10 video and 10 image, after $1,000 of purchases. The docs say both "per model" and "shared", so ask `GET /v1/organization`. |

## Rules for the adapters

- **Tags.** Runway names references `@tag`, 3-16 characters, `^[a-z][a-z0-9_]+$`.
  The user's tags are stored once. The adapter rewrites them into the provider's syntax.
- **Audio.** Always set it explicitly. It defaults to ON for Veo and Seedance.
- **Inputs.**
  - Runway needs HTTPS with a hostname, an answer to HEAD with the correct Content-Type, no redirects, and fetches time out at 10 s.
  - Serve inputs from our CloudFront path. Data URIs are 5 MB at most and would break Lambda's 6 MB request limit.
- **Outputs.** URLs expire: Runway's expire after 24-48 h. Copy every output to our S3 as soon as it lands.
- **Masks.** Runway takes no mask: the relay sends the clean frame plus a copy with the box drawn on it, and pastes the original back outside the box.
- **Moderation.**
  - Runway bills moderated requests and may suspend the account after "too many". Never retry `SAFETY.INPUT.*`.
  - Pre-check prompts and uploaded images before they reach a provider.

## Not documented (measure or ask)

- Latency, for every provider.
- Runway: whether the Gemini models honour `@tag`; the per-model concurrency limit.
