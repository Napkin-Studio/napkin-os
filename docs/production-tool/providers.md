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
