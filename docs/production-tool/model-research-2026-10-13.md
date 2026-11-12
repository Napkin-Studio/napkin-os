# Production Tool: image, video and audio model research (2026-10-13)

Research for choosing low, medium and high models on Runway, and the three audio paths
(native video audio, ElevenLabs layers, Napkin Radio). Sources:

- **OAS**: the live <https://docs.dev.runwayml.com/openapi.json>, fetched 2026-10-13.
- **MODELS**: <https://docs.dev.runwayml.com/guides/models/>
- **PRICE**: <https://docs.dev.runwayml.com/guides/pricing/>
- **TIERS**: <https://docs.dev.runwayml.com/usage/tiers/>
- **INPUTS**: <https://docs.dev.runwayml.com/assets/inputs/>
- **UPLOADS**: <https://docs.dev.runwayml.com/assets/uploads/>
- **FAIL**: <https://docs.dev.runwayml.com/errors/task-failures/>
- **MOD**: <https://docs.dev.runwayml.com/api-details/moderation/>

One credit is $0.01. "Unverified" means the docs don't say. Re-check a fact against its source
before building on it.

## 1. Image models (Runway)

### 1.1 Changes since our 2026-10-08 sheet

1. **A real mask now exists on one model.** `ideogram_4_5` takes `maskUri` (black = edit,
   white = keep, the same size as the first reference) and `preciseEdit: true`. Both keep the first
   reference's size. `runway.json` says `"mask": "none"`, which is still true of Gemini and Gen-4.
2. **New models not in our snapshot:** `ideogram_4_0`, `ideogram_4_5`, `gpt_image_2*`,
   `seedream5_*`, `grok_imagine_image_2`, `muse_image`. `nano_banana_2.1` is on MODELS and PRICE
   but **not in OAS**, so its parameters are unverified.
3. **Branding:** `gemini_image3_pro` is "Nano Banana Pro"; `gemini_image3.1_flash` is "Nano Banana 2".
4. **Upscale:** `magnific_precision_upscaler_v2` on `POST /v1/image_upscale`.

### 1.2 Common to every image model

| Topic | Fact |
|---|---|
| Endpoint | `POST /v1/text_to_image` with `model`. The same call does text-to-image, reference-based generation and editing. Returns `{id}`; poll `GET /v1/tasks/{id}`. |
| Task states | `PENDING`, `THROTTLED` (over concurrency: queued, not rejected), `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`. Poll at most every 5 s. `DELETE /v1/tasks/{id}` cancels. |
| Output | `output`: an array of URLs that **expire in 24-48 h**; copy them to S3 at once. The format is stated only for Muse (webp/png/jpeg), Seedream (png/jpeg) and GPT Image with transparency (PNG). Gemini, Gen-4, Grok and Ideogram: unverified. |
| Input images | JPEG, PNG, WebP (no GIF). 16 MB by URL, **5 MB as a data URI** (encoded), 200 MB by upload. The URL must be HTTPS with a hostname, answer HEAD with `Content-Type` and `Content-Length`, and **not redirect**. References under 640 px or over 4K may be resized. |
| Upload | `POST /v1/uploads {filename, type:"ephemeral"}` returns a presigned form; the result is a `runway://` URI valid for 24 h. |
| Tags | `tag` is 3-16 characters, `^[a-z][a-z0-9_]+$`, named `@tag` in the prompt (Gemini, Gen-4, GPT Image). Seedream uses upload order; Muse, Grok and Ideogram have no tags. Whether Gemini honours `@tag` is still unconfirmed. |
| Moderation | **Billed like a success.** Too many and the account is suspended. Never retry `SAFETY.INPUT.*`. `INTERNAL.BAD_OUTPUT.*` (often logos or overlaid text) may be retried. Only Gen-4 has `contentModeration.publicFigureThreshold: auto\|low`. |
| Limits | No requests-per-minute cap. There is a daily generation cap (rolling 24 h, `429`) and a monthly spend cap. Tier 4: 10 at once; tier 5: 20 at once. Our account read 20 per model on 2026-10-09. |
| Latency | Not documented for any model. Measure it. |
| Not on any model | Negative prompt, style or strength, denoise strength, bounding box, webhooks, idempotency key. |

### 1.3 Every image model

| Model (brand) | Prompt max | Sizes | References | Outputs | Seed | Other parameters | Credits per image |
|---|---|---|---|---|---|---|---|
| `gemini_image3_pro` (Nano Banana Pro) | 5,500 | 30 ratios in three tiers: 1K (1344:768, 1024:1024, …), 2K (2048:2048, 2752:1536, …), 4K (4096:4096, 5504:3072, …) | 14: up to 5 `human` plus 9 `object`; `{uri, tag, subject}` | 1 or 4 | no | none | 20 at 1K/2K, 40 at 4K |
| `gemini_image3.1_flash` (Nano Banana 2) | 5,500 | 56 ratios from 512 px to 4K and extreme strips (256:1024, 8192:2048) | 14 (5 human + 9 object) | 1 or 4 | no | none | 5 at 512, 7 at 1K, 11 at 2K, 16 at 4K |
| `gemini_2.5_flash` (Nano Banana) | 5,500 | 10 ratios, 1K only | 3 (`tag`, `uri`) | 1 | no | none | 5 |
| `nano_banana_2.1` | unverified | unverified | unverified | unverified | unverified | not in OAS | 4 at 1K, 6 at 2K, 12 at 4K |
| `gen4_image` | 1,000 | 16 ratios from 720:720 to 1920:1080 | up to 3, `@tag` | 1 | **yes** | `contentModeration` | 5 at 720p, 8 at 1080p |
| `gen4_image_turbo` | 1,000 | same 16 | **1-3 required** | 1 | **yes** | `contentModeration` | 2 |
| `gpt_image_2` | 32,000 | 30 ratios (1920×1088 to 3840×2160) and `auto` | 16, `@tag` | 1-10 | no | `quality` low/medium/high/auto; `background` transparent/opaque/auto | low 1-2, medium 5-11, high 20-41 |
| `gpt_image_2_5_flare` | 32,000 | same | 16 (+1 credit each) | 1-10 | no | `quality` low…max; `background` opaque/auto | 1K/2K: 1 / 5 / 16 / 28 / 63; 4K: 2 / 11 / 19 / 34 / 76 |
| `gpt_image_2_5_sunburst` | 32,000 | same | 16 (+1 credit each) | 1-10 | no | as flare, plus transparent PNG | as flare |
| `ideogram_4_5` | 10,000 | 27 ratios and `auto`; none with a mask or `preciseEdit` | 5, no tags; with a mask the first is the image edited | 1-8 | no | `quality` very_low…high; **`maskUri`**; **`preciseEdit`** | very_low 1, low 4, medium 8, high 25 |
| `ideogram_4_0` | 4,000 | 9 ratios, 2K only | 1 (remix) | 1-4 | no | `quality` low/medium/high | 4 / 7 / 11 |
| `seedream5_pro` | 4,000 | 14 ratios and `auto_1k`/`auto_2k` | 10, by order | 1-4 | no | `outputFormat`; `grounding` (web search) | 5 at 1K, 9 at 2K |
| `seedream5_lite` | 4,000 | 16 ratios or any W:H from 3.7 to 16.8 MP | 14, by order | 1-4 | no | `outputFormat`; `grounding` | 4 |
| `grok_imagine_image_2` | 2,500 | 26 ratios and `auto_*` | 3 (+1 credit each per request) | 1-4 | no | `quality` low/medium; **`edit: true`** (edits its one reference) | 4-8 |
| `muse_image` | 4,000 | 8 ratios and `auto` | 10 ("edits and combines") | 1-10 | no | `outputFormat` webp/png/jpeg | 1 |
| `magnific_precision_upscaler_v2` (`/v1/image_upscale`) | none | input 300-8000 px; `scaleFactor` 2/4/8/16; output ≤ 25.3 MP | the image | 1 | no | `sharpen`, `smartGrain`, `ultraDetail` 0-100; `flavor` sublime/photo/photo_denoiser | 25, or 150 above 4096 px |

Other ways in: `POST /v1/generate/image` (a saved Model Router `configId`, 16 references, `dryRun`)
and recipes (`ad_localization` 21 credits, `product_campaign_image` 36 credits per 1080p image,
`marketing_stock_image`).

### 1.4 Every way to send, edit and regenerate an image

| Way | Models | Notes |
|---|---|---|
| Text only | all but `gen4_image_turbo` | |
| Reference images (character and object) | Gemini (5 human + 9 object), Gen-4 (3, `@tag`), GPT Image (16), Seedream (10-14), Muse (10) | For consistency across turnarounds and frames |
| Edit by reference plus prompt ("same image, change X") | every model with references | No hard boundary: the whole image may drift |
| True mask edit | **`ideogram_4_5`** `maskUri` | A hard region boundary that keeps the image's size |
| Whole-image directed edit | `ideogram_4_5` `preciseEdit`, `grok_imagine_image_2` `edit` | Keeps the composition |
| Our box workaround | any (Gemini today) | Clean frame plus a copy with the box drawn; paste the original back outside the box |
| Variations | `outputCount` 4 (Gemini), up to 10 (GPT, Muse) | Each output is billed |
| Reproducible re-roll | **`gen4_image` and `gen4_image_turbo` only** (seed) | "Similar results", not identical |
| Chain | any | An output becomes the next call's reference (re-serve from S3 or upload) |
| Upscale | Magnific | 2-16× |
| Not available | | Masks except on Ideogram 4.5, inpainting, outpainting, seeds outside Gen-4, negative prompts |

### 1.5 Recommendation: low, medium and high

| Tier | Model | Cost | Why |
|---|---|---|---|
| **Low** | `gemini_image3.1_flash` at 1K | 7 credits ($0.07) | Cheapest model with human character references (14 references, 4 outputs), and already in our contract. Use `gen4_image_turbo` (2 credits) only for seeded quick drafts from existing references. |
| **Medium** | `gemini_image3.1_flash` at 2K | 11 credits ($0.11) | Same references and prompt length at storyboard resolution; 4 variants cost 44 credits. |
| **High** | `gemini_image3_pro` at 1K/2K (4K for hero frames) | 20 credits ($0.20), 40 at 4K | Our best proven character consistency. Benchmark `gpt_image_2_5_sunburst` high where the frame needs text or typography. |
| **Region edit** | Trial `ideogram_4_5` with `maskUri` (medium, 8 credits) | 8-25 credits | The only model with a real mask. Benchmark it against Pro with the box workaround on faces before switching. |

Bottlenecks to plan around: no seed on Gemini (a re-roll never comes back the same), billed
moderation, 24-48 h output URLs, the 5 MB data URI limit, no-redirect input URLs, and
undocumented latency.

## 2. Video models (Runway)

Sources as above, plus **FULL**: <https://docs.dev.runwayml.com/llms-full.txt> (the whole docs
text: changelog, output formats, errors).

### 2.1 Changes since our 2026-10-08 sheet

1. **Turning audio on doubles the clip price.** Our `$1.20` (Veo 3.1) and `$0.60` (Fast) estimates
   are right for today: the relay always sends `audio: false` (`video_audio()` in
   `relay/providers/types.py`), and the stitch Lambda drops audio (`-an`). With audio, Veo 3.1 is
   **$0.40/s** and Fast **$0.15/s**, so a 6 s clip costs **$2.40 and $0.90**. Any audio path
   has to change both the relay and the stitch step.
2. **Far more models.** 22 video models across `text_to_video`, `image_to_video`,
   `video_to_video`, `character_performance`, `video_upscale`, `video_to_hdr` and `avatar_videos`.
   `gen3a_turbo` and `gen4_aleph` stopped working on 2026-07-30, `aleph2_alpha` is a deprecated
   alias, and plain `veo3` is gone.
3. **There is an extend:** `seedance2_5` and `gemini_omni_flash_1.1` on `video_to_video`, `mode: "extend"`.
4. **There is lip sync, for characters only.** `POST /v1/avatars` makes a custom avatar from
   a reference image and a voice. `POST /v1/avatar_videos` (`gwm1_avatars`) then makes it speak from
   **an audio file** or text. Runway's docs show it as the visual layer for ElevenLabs. There is
   **no lip sync for arbitrary footage**.

### 2.2 Common to every video model

| Topic | Fact |
|---|---|
| Tasks | As for images: poll at most every 5 s, no webhooks, no idempotency key, `THROTTLED` queues, `DELETE` cancels. |
| Output | H.264 MP4 by default (stated for Gen-4.5 and Aleph; unverified for others). Gen-4.5 also offers ProRes, PNG sequence and HDR (HDR10, HLG, 10-bit Rec.709, EXR/ACES); Aleph 2 offers ProRes, PNG sequence and 10-bit. ProRes or PNG +5 cr/s; 10-bit/HDR +20 cr/s. A PNG sequence arrives as a .zip, **plus a separate .wav if the clip has audio**. fps and bitrate are not documented. URLs expire in 24-48 h. |
| Inputs | Image 16 MB by URL / 5 MB data URI; **video and audio 32 MB by URL / 16 MB data URI**; 200 MB by upload. Video: MP4, MOV (H.264, H.265, ProRes), MKV, WebM. Audio: MP3, WAV, FLAC, M4A, AAC. Inputs are centre-cropped to `ratio`. |
| Moderation | Billed, never refunded for `SAFETY.INPUT.*`. Logos, watermarks or text in inputs cause `INTERNAL.BAD_OUTPUT.01` (retryable). Other codes: `INPUT_VALIDATION.VIDEO.TOO_MANY_SHOTS`, `UNSUPPORTED_FPS`, `THIRD_PARTY.*`. |
| Limits | As for images (tier 4: 10, tier 5: 20; our account 20 per model). |
| Latency | Not documented for any model. |
| Minimum charges | `aleph2` 56 credits, `seedance2_mini` 64, `seedance2_5` 80 per generation. `duration: "auto"` bills the maximum and refunds the rest. |

### 2.3 Models with native audio

| Model | Endpoints | Length | Inputs | Size | Audio | Seed | Credits per second |
|---|---|---|---|---|---|---|---|
| `veo3.1` | t2v, i2v | 4, 6, 8 s | prompt ≤ 1,000 + `negativePrompt`; first frame, or first + last (no last-only); **no references** | 1280:720, 720:1280, 1920:1080, 1080:1920 | **Dialogue with lip sync, SFX, ambience**; default ON, `audio: false` | yes | **40 with audio, 20 without** |
| `veo3.1_fast` | t2v, i2v | 4, 6, 8 s | as Veo 3.1 | as Veo 3.1 | as Veo 3.1 | yes | **15 with audio, 10 without** |
| `seedance2_5` | t2v, i2v, v2v | 4-30 s or `auto` | prompt ≤ 3,500 (i2v) / 15,000; keyframes (first/last) **or** references (≤ 30 images, 10 videos ≤ 30 s, 10 audio < 30 s), not both; v2v `mode` reference/extend/edit; `draft` (480p preview, then 1080p from `draftTaskId` within 7 days) | 18 ratios, 480p-1080p | default ON, `audio` toggle; lip sync likely, not stated | yes | 20 / 30 / **68** (480p/720p/1080p) + 10-34 per input video second; no stated discount without audio |
| `seedance2` | t2v, i2v, v2v | 4-15 s | 9 images, 3 videos, 3 audio references | 24 ratios, 480p-**4K** | default ON | yes | 36 (≤ 720p), 40 (1080p), 150 (4K) |
| `seedance2_fast` / `seedance2_mini` | as `seedance2` | 4-15 s | as `seedance2` | 480p, 720p | default ON | yes | 29 / 16 (mini: 64-credit minimum) |
| `wan3` / `wan3_prime` | t2v, i2v | 2-30 s | prompt ≤ 20,000; 10 images, 5 videos, 5 audio references (t2v); first/last frames (i2v) | 15 ratios + `auto_*`, 480p-1080p | toggle; default ON per one reading of OAS (verify) | unverified | 5 / 10 / 20; prime (faster) 6.8 / 14 / 28 |
| `h3_max` (MiniMax) | t2v, i2v | 5-15 s | prompt ≤ 6,000; first (+ last) frame; `promptExpansionMode` | 480p, 768p | native, **no toggle** | yes (only with expansion off) | 5 / 8 |
| `grok_imagine_1_5` | t2v, i2v | 1-15 s | prompt ≤ 2,500; 7 image references (`[Image 1]`), 3 audio references (audio-driven performance) | 480p-1080p (720p max with references) | native, no toggle | no | 10 / 16 / 29 + 1 per reference |
| `happyhorse_1_0` | t2v, i2v | 3-15 s | prompt ≤ 2,500; first frame | 720p, 1080p | native, no toggle | no | 15 / 30 |
| `gemini_omni_flash_1.1` | t2v, i2v, v2v | 3-10 s or `auto` | prompt ≤ 20,000; 5 image + 3 video references; v2v reference/extend (input ≤ 30 s)/edit | 360p-4K | native, no toggle | no | 3.4 / 10 / 15 / 30 (360p…4K) |

`hailuo3` (5-15 s, 768p/2K, 9 references, audio references, v2v; 10/15 cr/s) and
`grok_imagine_1_5_lite` (2/3/14 cr/s) do not claim native audio: treat them as unverified. Only Veo
documents speech ("audio and speech"). **No model documents music.**

### 2.4 Silent models

| Model | Endpoint | Length | Inputs | Size | Seed | Credits per second |
|---|---|---|---|---|---|---|
| `gen4_turbo` | i2v | 2-10 s | first frame; prompt ≤ 1,000 (optional) | 6 ratios | yes | **5** |
| `gen4.5` | t2v, i2v | 2-10 s | first frame only, no references; prompt ≤ 1,000 | t2v 2 ratios; i2v 6 | yes | **12** (+5 ProRes, +20 HDR) |
| `aleph2` (edit) | v2v | input 2-30 s, ≤ 30 fps | video + prompt ≤ 1,000; up to 5 keyframe images with an optional time `range`; `targetAspectRatio` (outpaint) | follows input, ≤ 1080p | yes | 28 (56 minimum); whether it keeps input audio is unverified |
| `act_two` | character_performance | reference 3-30 s | `character` (image or video, face visible) + `reference` performance video; `bodyControl`, `expressionIntensity` 1-5 | 6 ratios | yes | 5 |
| `gwm1_avatars` | avatar_videos | not stated | preset or custom avatar (from **one reference image + voice**); speech = **audio file** or text ≤ 5,000 | not stated | no | async price not listed; real-time 2 credits + 2 per 6 s |
| `magnific_video_upscaler_creative` | video_upscale | ≤ 30 s | 720p/1k/2k/4k, `creativity`, `sharpen`, `smartGrain`, `fpsBoost` | | | $0.007-0.012 per frame (~$0.21-0.36/s at 30 fps) |
| `enhance_frame_rate` | video_upscale | ≤ 300 s | target 24-120 fps (incl. 23.976, 29.97, 59.94) | | | 1 per 2 s |
| `ruby` | video_to_hdr | | SDR in, HDR out | | | 20 (40 above 4 MP) |

### 2.5 Every way to send, edit and regenerate a clip

| Need | How |
|---|---|
| Storyboard frame to clip | `image_to_video` with `promptImage: [{uri, position: "first"}]` (every i2v model) |
| Frame pair (start and end) | Veo 3.1 / Fast, WAN 3, H3 Max, Seedance (keyframe mode), Hailuo 3 |
| Characters as references in a clip | Seedance (up to 30 images), WAN 3, Hailuo 3, Grok 1.5 (7), Omni Flash 1.1 (5). **Not with a pinned first frame.** Veo and Gen-4 take none. |
| Re-roll | `seed` on Gen-4.5, Gen-4 Turbo, Veo, Seedance, H3 Max ("similar", not identical) |
| Change the feel or restyle | Aleph 2, prompt only |
| Local edit | Aleph 2 keyframe image + `range` (limits time only; no mask). Also Seedance 2.5 and Omni 1.1 `mode: edit`. |
| Reframe or outpaint | Aleph 2 `targetAspectRatio` |
| Extend a clip | Seedance 2.5 and Omni Flash 1.1, `mode: extend` |
| Performance transfer | Act-Two: an actor's video drives the character's face and body |
| Talk from an audio file (lip sync) | `avatar_videos` with a custom avatar, or `referenceAudio` on Grok 1.5, Seedance, WAN 3, Hailuo 3 (audio-driven performance, quality unverified) |
| Cheap preview, then final | Seedance 2.5 `draft` then `draftTaskId` |
| Upscale, frame rate, HDR | Magnific (to 4K), `enhance_frame_rate`, Ruby |

### 2.6 Recommendation: low, medium and high

**With native audio**

| Tier | Model | 6 s clip | Why |
|---|---|---|---|
| **Low** | `wan3` 720p (or `h3_max` 768p) | $0.60 ($0.48) | Cheap, up to 30 s, first and last frames and references; audio quality unverified |
| **Medium** | `veo3.1_fast`, audio on | **$0.90** | The only family whose dialogue and lip sync is documented; first + last frame; seed |
| **High** | `veo3.1`, audio on (dialogue shots); `seedance2_5` 1080p when a shot needs character references, extend or more than 8 s | **$2.40**; Seedance $4.08 | Veo has the best-documented audio; Seedance has the most control |

**Silent (sound added afterwards)**

| Tier | Model | 6 s clip | Why |
|---|---|---|---|
| **Low** | `gen4_turbo` | $0.30 | Cheapest; first frame only |
| **Medium** | `gen4.5` (or `veo3.1_fast` with `audio: false` when the shot needs an end frame) | $0.72 ($0.60) | Better quality, seed, ProRes and HDR for grading |
| **High** | `veo3.1` with `audio: false` | $1.20 | First + last frame at 1080p; Gen-4.5 with ProRes/HDR for a grading pipeline |

**Edit step:** Aleph 2 for restyles and timed local edits; Seedance 2.5 or Omni Flash 1.1 to extend.

Also note:
- **No camera or motion-strength fields** on any video endpoint. Camera direction goes in the prompt.
- **Recipes** (`multi_shot_video`, `product_ad`, `product_ugc`, `product_swap`) are whole workflows with no seed, no per-shot references and no last frame. They don't fit frame → clip.
- **Router** `POST /v1/generate/video` picks a model for us, and `dryRun` shows its choice and cost. It isn't suited to pinning a model.
- **Models with no audio off-switch** (Grok, H3 Max, HappyHorse, Omni Flash) always return sound. Strip it with ffmpeg when the clip must be silent.

Bottlenecks to plan around:
- **Clip length.** Veo stops at 8 s, Gen-4.x at 10 s, Omni at 10 s, and H3 and HappyHorse at 15 s. Seedance 2.5 and WAN 3 go to 30 s.
- **Character consistency.** Only the reference-capable models help. Veo and Gen-4 can't take references and a pinned first frame together.
- **No mask in video.** Aleph limits an edit in time only.
- **Minimum charges** on Aleph and Seedance, and moderation is billed.
- **Undocumented:** speed, output fps, whether Aleph keeps input audio, and Seedance's price without audio.
- **To do:** price `clip` by the audio flag in `runway.json`, and snapshot the `text_to_video`, `character_performance`, `video_upscale` and `avatar_videos` schemas.

### 2.7 Seedance in detail (checked against OAS 2026-10-13)

Four models from ByteDance, all on `text_to_video`, `image_to_video` and `video_to_video`. All take
`audio` (**default true**), `seed`, and `duration` (an integer or `"auto"`).

| | `seedance2_mini` | `seedance2_fast` | `seedance2` | `seedance2_5` |
|---|---|---|---|---|
| Length | 4-15 s | 4-15 s | 4-15 s | **4-30 s** |
| Size | 480p, 720p (12 ratios) | 480p, 720p (12) | 480p-**4K** (24) | 480p-1080p (18) |
| Prompt | ≤ 3,500 | ≤ 3,500 | ≤ 3,500 | **≤ 15,000** (optional) |
| Image references | 9 | 9 | 9 | **30** |
| Video references | 3 (≤ 15 s) | 3 | 3 | **10 (≤ 30 s)** |
| Audio references | 3 (≤ 15 s) | 3 | 3 | **10 (< 30 s)** |
| v2v modes | reference | reference | reference | **reference, extend, edit** |
| Draft | | | | **480p preview, then 1080p** |
| Credits per second | 16 (64 minimum) | 29 | 36 (≤ 720p), 40 (1080p), 150 (4K) | 20 / 30 / 68 (480p / 720p / 1080p), + 10 / 15 / 34 per second of input or reference video; **images and audio free**; 80 minimum |

How the inputs work:

- **`promptImage` has two modes, which can't be mixed.** With `position: "first"`/`"last"` the images
  are keyframes. Without a position they are **references**, and the model composes from them.
- **References carry no tags.** Each is just `{uri}`, addressed by order. That is unlike Gemini's
  `@tag`: the director has to describe "the woman in the first reference" in words.
- **The three v2v modes on 2.5:**
  - `reference` makes a new clip conditioned on the input video.
  - `extend` continues the input clip. It needs `promptText` and keeps the input's ratio.
  - `edit` changes the clip in place. It needs `promptText` and `duration: "auto"`, and takes no `ratio`.
- **Draft:** `draft: true` renders a 480p preview at the 480p rate. Sending `{model, draftTaskId}` to
  `text_to_video` then gives the same shot at 1080p. It reuses the prompt, references, seed and
  audio, and must be done within 7 days. The two calls are billed separately.
- **Audio:** native audio defaults ON, and there's no stated discount for turning it off.
  `referenceAudio` (for example our ElevenLabs VO) conditions the clip, but **whether it locks the lips is not documented.**

Where it fits:

| Use | Model | Why |
|---|---|---|
| Low tier, with audio and characters | `seedance2_mini` 720p ($0.16/s; at least $0.64 a clip) | The cheapest model that takes character references **and** has audio |
| **Medium, character consistency** | `seedance2_5` 720p ($0.30/s) | Storyboard frame + turnaround views + props as references, up to 30 s, audio, seed |
| **High** | `seedance2_5` 1080p ($0.68/s), drafted at 480p first | Preview cheaply, pay 1080p only for the take kept |
| 4K master | `seedance2` 4K ($1.50/s) | The only 4K generator on Runway |
| Edit and extend | `seedance2_5` v2v `edit` / `extend` | A second edit route beside Aleph 2, and the only extend besides Omni |

Its catch for our flow: **frame → clip normally pins the storyboard frame as the first frame**, and
then Seedance can't take the character views. Pick one per shot:

- **Keyframe mode** (frame first, plus optionally an end frame) gives exact composition. The character holds only as well as the frame does.
- **Reference mode** (the frame plus the views) gives a stronger character but a looser composition.

Our `providers.md` already noted this (2026-10-06). A test should decide which mode wins on our shots.

## 3. Audio: ElevenLabs, and the three paths

Sources: <https://elevenlabs.io/docs/overview/intro>, the ElevenLabs API reference and capability
pages cited per row, <https://elevenlabs.io/pricing/api>, and Runway's OAS and PRICE. Some
ElevenLabs values were read through a summarising fetch: re-check any number before building on it.

### 3.1 Today

- The relay sends `audio: false` on every video request, and `stitch.py` drops audio (`-an`). The
  Production Tool makes **no sound at all** today.
- Mixing is ours to build. ElevenLabs Studio has a multitrack timeline, but only in the web app;
  there is no mix API. The stitch Lambda already ships ffmpeg, so the mix belongs there.

### 3.2 ElevenLabs capabilities we need

| Capability | Endpoint (direct) | Models and key parameters | Output | Direct price | Through Runway |
|---|---|---|---|---|---|
| Text to speech | `POST /v1/text-to-speech/{voice_id}` (+ `/with-timestamps`: per-character times) | `eleven_v4` (newest; 10k characters; audio tags; IPA), `eleven_v3` (5k; dramatic; no stitching), `eleven_multilingual_v2` (most stable), `eleven_flash_v2_5` (cheap, ~75 ms). `voice_settings` (stability 0.5, similarity 0.75, style, speed 0.7-1.2), `seed` (best effort), `previous_text`/`next_text`, `previous_request_ids` (stitching, ids live 2 h), 3 pronunciation dictionaries, `audio_effects` (room, distance, pan; bakes in) | MP3 to 192 kbps (Creator+), PCM/WAV 8-48 kHz (44.1 kHz needs Pro), Opus | v4/v3/v2 $0.08 per 1k characters; Flash $0.04 | `/v1/text_to_speech`: v4 **$0.05** per 1k (from 2026-10-13), v3/v2 $0.20; **preset voices only**, no format choice, no timestamps |
| Dialogue (several speakers) | `POST /v1/text-to-dialogue` | `inputs[{text, voice_id}]`, ≤ 10 voices, ≤ 2,000 characters per call; tags per turn | one mixed file | as TTS | not offered |
| Voices | voice design (`text_to_voice` previews, then save), instant clone (1-2 min sample), professional clone (v4, rolling out), 3,000+ library voices | | `voice_id` usable everywhere | | `/v1/voices` creates a voice for Runway avatars; use in TTS unverified |
| Speech to speech | `POST /v1/speech-to-speech/{voice_id}` | `eleven_multilingual_sts_v2`; `remove_background_noise`; ≤ 5 min per call. **Keeps timing, breaths and emotion**, so the lips still match | as TTS | $0.12/min | `/v1/speech_to_speech` takes **a video** directly; preset voices; $0.20/min |
| Sound effects | `POST /v1/sound-generation` | `eleven_text_to_sound_v2`; `duration_seconds` 0.5-30, `prompt_influence` 0-1 (0.3), `loop`; sequences in one prompt ("footsteps, then a door") | MP3, PCM, Opus | $0.12/min | `/v1/sound_effect`: $0.01/s (**5× direct**), no `prompt_influence` |
| Music | `POST /v1/music` | `music_v2_5` (best; v1 is still the default, so always pass `model_id`); `prompt` + `music_length_ms`, **or** a `composition_plan` of up to 30 sections (each 3-120 s, styles, lyrics); `force_instrumental`; `store_for_inpainting` then **re-do one section** while keeping the rest; ~30 s audio reference to steer style | MP3 to 320 kbps, PCM to 48 kHz | $0.15/min; paid plans only; check the terms for ads | not offered (Runway's `seed_audio` is its own text-to-audio) |
| Stems | `POST /v1/music/stem-separation` | a file in, a ZIP of stems out; names and price unverified | | | |
| Voice isolation | `POST /v1/audio-isolation` | audio or **video**, ≤ 500 MB, 1 h; returns the speech only | | $0.12/min | $0.10/min, input 4.6 s to 1 h |
| Speech to text | `POST /v1/speech-to-text` | `scribe_v2`; **word timestamps**, `diarize` (32 speakers), `tag_audio_events` | JSON | $0.22/h | not offered |
| Forced alignment | `POST /v1/forced-alignment` | an audio file + its script give word start and end times | JSON | unverified | not offered |
| Dubbing | dubbing v1/v2 | 32 speakers, 3 jobs at once (self-serve); background kept | | v1 $0.33-0.50/min, v2 $2.20/min | `/v1/voice_dubbing`: $0.30/min, audio only |
| Lip sync | **none in the API.** ElevenLabs Avatars do lip sync, but their API is "not available at launch". Their Image & Video API offers `creatify-aurora` (one image + audio → talking video, 480p/720p, Pro plan); the video-to-video lip-sync models (Sync, Veed) are app only. | | | | Runway avatars (section 2) |

ElevenLabs concurrency per plan (multilingual v2 / Flash): Creator 5/10, Pro 10/20, Scale 15/30.
v3, v4, music and SFX limits are not documented. Plans: Creator $22, **Pro $99** (needed for 44.1 kHz
WAV), Scale $299 a month.

**Direct or through Runway?** Go **direct** for anything with a character's voice (custom
`voice_id`s, timestamps, WAV output, dialogue, music, alignment). Through Runway, only `eleven_v4`
TTS with a preset voice is cheaper ($0.05 vs $0.08 per 1k), and SFX costs 5× more. Use Runway only
where one bill matters more than control.

### 3.3 Path 1: the video model makes the audio; ElevenLabs adds extras

For: Veo 3.1 / Fast with audio on, Seedance, WAN 3.

1. Generate the clip with `audio: true`. Dialogue is lip-synced by the model itself.
2. Pull the clip's audio into its own layer, the **native** layer (ffmpeg), so the user can mute or duck it.
3. Optional clean-up: isolate the voice (`audio-isolation`), or **re-voice the character** with
   speech to speech. It keeps the timing, so the lips still match, and gives one consistent branded
   voice across clips that each had a different native voice.
4. Add layers: a music bed (`music_v2_5`, instrumental, sections timed to the edit), SFX and looped
   ambience (`sound-generation`), and extra VO (v4).
5. Optional: `scribe_v2` with word times and audio events on the native audio, so music and VO keep clear of the dialogue.
6. Mix in our stitch step: per-layer gain, fades, ducking under dialogue, loudness to target, mux onto the video.

| Tier | Video | Audio |
|---|---|---|
| Low | WAN 3 720p, audio on | Native only + one SFX/ambience pass; MP3 working files |
| Medium | Veo 3.1 Fast, audio on ($0.90 per 6 s) | + `music_v2_5` bed, v4 extra VO, isolation |
| High | Veo 3.1, audio on ($2.40 per 6 s) | + composition-plan music per scene, speech to speech into a designed or cloned character voice, WAV at 48 kHz |

Risks: native voices change from clip to clip (fix with speech to speech); isolation returns only
the speech, so there is no clean music-and-effects bed to keep; only Veo documents speech.

### 3.4 Path 2: silent video; ElevenLabs builds the whole soundtrack in layers

For: Gen-4 Turbo, Gen-4.5, Veo with `audio: false`.

1. **Plan the sound from the script and shot list:** per shot, the lines (character, text), SFX cues, ambience, and a music brief timed to shots.
2. **Voices:** one ElevenLabs `voice_id` per character (designed, cloned or library), stored with
   the character like its pictures. This is direct-only, since Runway allows presets only.
3. **VO:** `text-to-dialogue` for exchanges, or TTS `with-timestamps` per line, with
   `previous_text` / `next_text` (or `previous_request_ids` on v4) so lines flow. One file per line.
4. **SFX:** one call per cue, its length taken from the shot. **Ambience:** `loop: true`, looped in the mix.
5. **Music:** a composition plan whose section lengths equal the scene lengths, with `store_for_inpainting`.
6. **Timing:** a cue sheet (layer, start, length, gain). Line in- and out-points come from timestamps
   or forced alignment. Nothing in a silent clip times itself, so this is the core of Path 2.
7. **Mix** in the stitch step, as in Path 1.
8. **Lip sync, the extreme case.** There is no API that lip-syncs our existing silent footage. In order of preference:
   - (a) Make dialogue shots with Path 1 (Veo, audio on), then speech to speech into the character's voice. The lips are right and the voice is ours. **Recommended.**
   - (b) Generate the VO first, then pass it as `referenceAudio` to Seedance 2.5, WAN 3 or Grok 1.5 ("audio-driven performance"). Lip accuracy is undocumented: **test it.**
   - (c) For talking-head framing, a Runway custom avatar from the character's front view + the VO file (`avatar_videos`), or ElevenLabs' `creatify-aurora` (image + audio).
   - (d) Act-Two: a performer video of the line drives the character. Accurate, but someone has to film the line.
   - (e) A third-party video-to-video lip-sync API (e.g. Sync). Not researched: a later decision.

| Tier | Video | Audio |
|---|---|---|
| Low | Gen-4 Turbo | Flash v2.5 VO (off camera only), short SFX, `music_v2` prompt, no lip sync |
| Medium | Gen-4.5 | v4 VO + dialogue, `music_v2_5` composition plan, SFX + looped ambience; dialogue shots by route (a) |
| High | Veo 3.1 silent (+ Veo with audio for dialogue shots) | Designed or cloned voices, several takes per line, music per scene with an audio reference, forced alignment, lip sync by (a), with (b) and (c) tested |

### 3.5 Editing and regenerating one layer (both paths)

- Every layer is its own versioned asset: `{layer, kind, provider, model, params, seed, requestId, file, startS, gain}`.
  The final mix is **always rebuilt** from the layer files by ffmpeg, which takes seconds and costs nothing.
- **A VO line:** re-run that line only, with the same voice and seed and the neighbouring text for
  continuity. If its length changes, re-align it and shift the cues after it.
- **An SFX cue:** re-run that cue (no seed; vary the prompt and `prompt_influence`).
- **Music:** re-do one section by inpainting (`song_id` + ranges), keeping the other sections.
- **Native audio (Path 1):** re-voice it with speech to speech, or mute it; regenerating it means regenerating the clip.
- Keep the last few takes per layer so the user can go back. Avoid baked-in `audio_effects`; apply effects in the mix.
- Work in WAV or PCM, not MP3: MP3 encoder padding shifts timing between layers.

### 3.6 Path 3: Napkin Radio (Laurence)

What it is (read from the live tool <https://napkin-radio-ten.vercel.app/radio>; the repo
`larryob78/napkin-radio` is private and our GitHub login can't open it):

- **Flow:** brief → Claude writes the script (scored for quality, with retries) → review → cast and
  direct voices → listen → export → hand off to a station.
- **Script language:** `VO:`, `FVO:`, `MVO:` mark voices; `SFX:` and `MUSIC:` mark cues. Booked length 5-180 s; one voice, two voices or dialogue.
- **Endpoints** (Next.js on Vercel):
  - `/api/radio/generate-script` takes `{brief, brand, tone, durationSec, castMode}`.
  - `/api/radio/synthesize` takes `{script, voices, gapMs: 350, cueMs: 700, sound, direction, durationSec}` and returns audio.
  - `/api/radio/voices` and `/voice-library` list voices.
  - `/api/radio/voice-design` previews a voice from a description of 20-1,000 characters and 100-400 characters of audition text.
  - `/api/radio/import` reads Word, PDF or text, up to 3 MB.
- **Timeline:** `/api/radio/timeline` renders a manifest of `assets` and `clips` (`track`, `startSec`,
  `durationSec`). Its four tracks are **recording, voice, music and effects**. The manifest is the
  same shape as the layer model in 3.5.
- **Export:** `/api/radio/export` takes `sampleRate`, `targetLufs`, `truePeak` and `targetDuration`,
  and returns a WAV with a loudness report. It follows the XR UK/ROI delivery profile: PCM WAV,
  16-bit, 44.1 or 48 kHz, stereo.
- **Station delivery:** a catalogue of stations by jurisdiction. Dispatch (email via Resend) is
  **not connected**.
- **Limits:**
  - Projects live only in the browser (IndexedDB).
  - Timeline audio is capped at about 4 MB, from Vercel's request size limit.
  - **On 2026-10-13 its ElevenLabs key was rejected** (`/voices` returned 502, `/voice-library` 503).

How it could join the Production Tool:

| Option | What | Effort | Why or why not |
|---|---|---|---|
| A. **Shared layer contract** | Adopt Radio's manifest (`assets`, `clips{track, startSec, durationSec}`) as our audio layer model, and add a `native` track for Path 1 | Low | One audio model across TV and radio; the cue-sheet design is already proven |
| B. **Port its pieces into the relay** | Its script parser (VO/SFX/MUSIC cues) as the audio side of our director's output; its synth (gaps, cues, direction); its loudness export as the last stitch step | Medium | Reuses tested logic on our infra, without Vercel's 4 MB limit or browser-only storage |
| C. **Radio cut as a deliverable** | From the same brief and the same voices, also export a radio spot | Low after A/B | One brief gives a TV ad and a radio ad; voice ids are shared |
| D. Call Radio's API from the relay | | Not advised | Vercel body limits, no auth, browser-local state, a broken key |

**Recommended:** A now, then B for the mix and loudness stage, then C as a feature. First: ask
Laurence for repo access, and get the ElevenLabs key fixed.

### 3.7 Loudness targets for the mix

Broadcast TV in the UK and Ireland is −23 LUFS (EBU R128); radio follows the station or XR profile
(Radio's export takes the target); online is about −14 LUFS. These are standard values, not from
the sources above: confirm them per deliverable.

## 4. Open questions to test with paid calls

1. Does `referenceAudio` on Seedance 2.5 / WAN 3 / Grok 1.5 lip-sync to a supplied VO?
2. How faithful is a Runway custom avatar made from one of our character fronts, how long can it run, and what does an `avatar_videos` call cost?
3. Latency of every model we pick (none is documented).
4. Does Aleph 2 keep or drop the input audio? Does Act-Two return audio?
5. Is Seedance cheaper with audio off? WAN 3's audio default?
6. Does Gemini honour `@tag`? What is `nano_banana_2.1`'s schema?
7. Concurrency for ElevenLabs v3, v4, music and SFX; the stem-separation output and price.
8. Ideogram 4.5 masked edit vs Gemini Pro with our box workaround, on faces.
