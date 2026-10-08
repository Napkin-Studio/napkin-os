# Production Tool: what each provider can do

> **For the current models, prices and what each provider accepts, read
> [provider-reference.md](provider-reference.md).** It is generated from the capability sheets and
> the providers' own schemas, so it stays in step with the code. This page is the research behind
> it, as of 2026-10-06: the "Combine" step has since been folded into Generate, and the defaults
> changed on 2026-10-08 (features/default-models.clan).

Checked against each provider's docs on 2026-10-06. Runway is the backend we
test on. fal and HeyGen run the hackathon. After the hackathon, Runway becomes
the main backend, with other labs added (ElevenLabs and others). The design is
in `features/production-tool.clan`. This page holds the facts it relies on.
Re-check a fact against its source before you build on it. Prices change, and
docs pages contradict each other in the places marked below.

## What each flow step needs, by provider

| Step | Runway (testing) | fal (hackathon) | HeyGen (hackathon) |
|---|---|---|---|
| Front view and Combine | `text_to_image`: `gemini_image3.1_flash` (7 cr at 1K) / `gemini_image3_pro` (20 cr). Up to 14 refs `{uri, tag, subject: human\|object}`, at most 5 human. Refs are named `@tag` in the prompt. No seed. | `fal-ai/kling-image/o3/image-to-image`: `@Image1..10`, `elements` named `@Element1`, $0.028/image. Or `google/nano-banana-2.1/edit` at $0.08, which documents no ref naming. | Portrait only (`POST /v3/avatars type:prompt`, 3 refs). Not used. |
| Turnaround | One Gemini call per view, with the chosen front as a `human` ref | `fal-ai/qwen-image-edit-2511-multiple-angles`: `horizontal_angle` 0/45/90/180, $0.035/MP | No |
| Storyboard frames | Gemini, with the 4 views as `human` refs. One task per frame. | Kling image O3: `elements: [{frontal_image_url, reference_image_urls[1-3]}]`. `result_type: series` returns 2-9 frames. | No |
| Region edit (image) | **No mask, bbox or region field anywhere.** We send the clean frame plus a copy with the box drawn on it, then paste the original back outside the box on our side. | `ideogram/v4.5/edit`: `mask_url` (BLACK = edit), up to 3 refs with a mask. `fal-ai/sam-3/image` click/box to mask, $0.005; always set `prompt` (it defaults to "wheel"). | No |
| Frame to clip | `image_to_video`: `veo3.1_fast` (first and last frame, 4/6/8 s). `seedance2_5` in ref mode takes the frame and the views, but **not together with a pinned first frame**. `gen4.5` (2-10 s). | `fal-ai/kling-video/v3/pro/image-to-video`: `start_image_url` **plus** `elements` (the 4 views) plus `multi_prompt`, $0.112/s with audio off. | `heygen-video-1` (`POST /v3/models/videos`): `image_to_video` (first frame) or `reference_to_video` (≤9 images as `<Picture n>`), 5-15 s, sound always on. Price not documented. |
| Region comment on a paused video | `aleph2` on `video_to_video`: an edited keyframe plus `range` (integer seconds, end exclusive). Limits the edit in **time only**. 28 cr/s, 56 cr minimum. | `fal-ai/sam2/video` (click on frame *t*) then `fal-ai/wan-vace-14b/inpainting` (720p max). Or `luma/agent/ray/v3.2/video-to-video` with keyframes pinned to frame indexes. | No. Regenerate the shot. |
| "Change the feel" | `aleph2` with a prompt only | Luma Ray 3.2 `edit_strength` adhere/flex/reimagine | Re-prompt with the same `seed` |
| Audio (later) | `text_to_speech` (`eleven_v4`), `sound_effect` | `fal-ai/mmaudio-v2` (video to SFX, $0.001/s), Sync lip-sync | Voice design and TTS, lip-sync, Avatar IV |
| Getting results | Polling only, at most every 5 s. No webhooks. No idempotency key. | Queue with `queue_position`, signed (ED25519) webhooks. No idempotency key. | Polling or webhooks (a callback is sent once only). `Idempotency-Key` header on `heygen-video-1`. |
| Concurrency | Tier 4: 10 video and 10 image, after $1,000 of purchases. The docs say both "per model" and "shared", so ask `GET /v1/organization`. | 2 for a new account, rising automatically with paid invoices to 40 | Pay-as-you-go: 10 |

## Rules for the adapters

- **Tags.** Each provider names references differently:
  - Runway: `@tag`, 3-16 characters, `^[a-z][a-z0-9_]+$`
  - Kling: `@Image1` / `@Element1`
  - HeyGen: `<Picture 1>`
  - Seedream: "Figure N"
  - Qwen-image-3: "image N"

  The user's tags are stored once. The adapter rewrites them into the provider's syntax.
- **Audio.** Always set it explicitly. It defaults to ON for Veo, Seedance, Kling v3, Wan, LTX and HeyGen.
- **Inputs.**
  - Runway needs HTTPS with a hostname, an answer to HEAD with the correct Content-Type, no redirects, and fetches time out at 10 s.
  - fal and HeyGen take public URLs. HeyGen doesn't follow redirects.
  - Serve inputs from our CloudFront path. Data URIs are 5 MB at most and would break Lambda's 6 MB request limit.
- **Outputs.** URLs expire: Runway after 24-48 h, fal after its retention setting, HeyGen through presigned links. Copy every output to our S3 as soon as it lands.
- **Masks.** The colour convention differs: Ideogram v4.5 uses black for the area to edit, LTX-2.3 uses white. It is undocumented for FLUX Fill, Kontext, Qwen and Wan VACE. The adapter converts the mask per endpoint, and a test pins each one.
- **Moderation.**
  - Runway bills moderated requests and may suspend the account after "too many". Never retry `SAFETY.INPUT.*`.
  - fal returns `422 content_policy_violation`.
  - Pre-check prompts and uploaded images before they reach a provider.
- **fal fallback.** fal may reroute a request to an "equivalent" endpoint. Send `x-app-fal-disable-fallback`.

## Not documented (measure or ask)

- Latency, for every provider.
- Runway: whether the Gemini models honour `@tag`; the per-model concurrency limit.
- HeyGen: API prices; whether cartoon or back-view characters work in the API.
- fal: mask polarity for most endpoints; which side "90° right" means on the angles model.
