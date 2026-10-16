# Production Tool: every Runway model on our key (2026-10-15)

A catalogue of the 70 model ids that the owner's Runway dev key reaches (`GET /v1/organization`,
2026-10-15), what each one takes and costs, and which Production Tool job each could serve. It
builds on [model-research-2026-10-13.md](model-research-2026-10-13.md) (**R13**) and
[pathway-tests-2026-10-13.md](pathway-tests-2026-10-13.md) (**PT13**), and does not repeat their
common rules (polling, URL expiry, input hosting, billed moderation). Read those first.

No Runway API call was made for this page and no generation was started. Every fact comes from a
public document or from our own earlier paid tests.

## Sources

| Key | Source |
|---|---|
| **OAS** | <https://docs.dev.runwayml.com/openapi.json>, fetched 2026-10-15 (version `2024-11-06`) |
| **PRICE** | <https://docs.dev.runwayml.com/guides/pricing/>, fetched 2026-10-15 |
| **MODELS** | <https://docs.dev.runwayml.com/guides/models/> |
| **INPUTS** | <https://docs.dev.runwayml.com/assets/inputs/> ("Aspect ratios and auto-cropping", "Input asset aspect ratio requirements") |
| **CL** | The changelog: <https://docs.dev.runwayml.com/api-details/changelog/>, read through <https://docs.dev.runwayml.com/llms-full.txt> |
| **TIERS** | <https://docs.dev.runwayml.com/usage/tiers/> |
| **MOD** | <https://docs.dev.runwayml.com/api-details/moderation/> |
| **REC** | The recipe pages under <https://docs.dev.runwayml.com/recipes/> (product-ad, product-swap, product-ugc, multi-shot-video, ad-localization, marketing-stock-image, product-campaign-image, reference-media) |
| **CHAR** | Characters and voices: <https://docs.dev.runwayml.com/characters/core-concepts/>, <https://docs.dev.runwayml.com/characters/custom-voice/> |
| **R13** | `docs/production-tool/model-research-2026-10-13.md` |
| **PT13** | `docs/production-tool/pathway-tests-2026-10-13.md` (live paid tests) |
| **AMP** | `docs/production-tool/audio-and-models-plan.md` |
| **SNAP** | `production-tool/relay/tests/fixtures/schemas/runway/*.json` (our OpenAPI snapshots, **2026-10-08**, image_to_video, text_to_image and video_to_video only) |
| **V-SD** | Third-party reports on Seedance and real faces: <https://docs.apiyi.com/en/faq/seedance2-asset-face-reference>, <https://www.mindstudio.ai/blog/seedance-2-0-content-restrictions-workarounds>, <https://technode.com/2026/02/10/bytedance-suspends-seedance-2-0-feature-that-turns-facial-photos-into-personal-voices-over-potential-risks/> |
| **V-KL** | Third-party guides to Kling 3.0 Omni: <https://flick.art/blog/kling-character-consistency>, <https://www.hedra.com/models/video/kling/o3-standard> (Kling's own guide, home.kling.ai, would not resolve) |
| **V-SR** | Third-party listings for Seedream 5.0 Flash: <https://openrouter.ai/bytedance-seed/seedream-5-0-flash>, <https://docs.apiyi.com/en/news/seedream-5-0-flash-launch> |

**Conventions.** 1 credit (cr) = $0.01. "cr/s" means credits per second of output unless stated.
**NEW** marks a model or fact that R13/PT13 did not have. "Undocumented" means no public
Runway page says it. "Inference" marks my reading, not a stated fact.

The pricing fixture `production-tool/relay/tests/fixtures/pricing/runway.json` named in the brief does
not exist in this worktree. Prices here come from PRICE and OAS.

## 1. Summary

### 1.1 Counts by type (70 ids)

| Type | Count | Ids |
|---|---|---|
| Image generation and editing (`/v1/text_to_image`) | 18 | `gemini_image3_pro`, `gemini_image3.1_flash`, `gemini_2.5_flash`, `nano_banana_2.1`, `gpt_image_2`, `gpt_image_2_5_flare`, `gpt_image_2_5_sunburst`, `ideogram_4_5`, `ideogram_4_0`, `seedream5_pro`, `seedream5_lite`, `seedream5_flash`*, `grok_imagine_image_2`, `muse_image`, `gen4_image`, `gen4_image_turbo`, `bria_fibo_1_5`, `bria_fibo_edit_1_5` |
| Video generation (text or image to video; most also edit) | 24 | `veo3.1`, `veo3.1_fast`, `gen4.5`, `gen4_turbo`, `kling2.5_turbo_pro`, `kling3.0_standard`, `kling3.0_pro`, `kling3.0_4k`, `klingO3_standard`, `klingO3_pro`, `klingO3_4k`, `seedance2_5`, `seedance2`, `seedance2_fast`, `seedance2_mini`, `wan3`, `wan3_prime`, `h3_max`, `hailuo3`, `happyhorse_1_0`, `grok_imagine_1_5`, `grok_imagine_1_5_lite`, `gemini_omni_flash`, `gemini_omni_flash_1.1` |
| Video edit only | 1 | `aleph2` |
| Retired video ids (listed on the key, but requests fail) | 3 | `veo3`, `gen3a_turbo`, `gen4_aleph` |
| Performance and avatars | 4 | `act_two`, `gwm1_avatars`, `gwm1_avatar_async_audio_to_video`*, `gwm1_avatar_async_text_to_video`* |
| Upscale, frame rate, HDR | 4 | `magnific_precision_upscaler_v2`, `magnific_video_upscaler_creative`, `enhance_frame_rate`, `ruby` |
| Audio | 9 | `eleven_v4`, `eleven_v3`, `eleven_multilingual_v2`, `eleven_multilingual_sts_v2`, `eleven_text_to_sound_v2`, `eleven_voice_isolation`, `eleven_voice_dubbing`, `seed_audio`, `voice_processing`* |
| Recipes (whole workflows) | 7 | `product_ad`, `product_swap`, `product_ugc`, `multi_shot_video`, `product_campaign_image`, `marketing_stock_image`, `ad_localization` |

\* Not documented anywhere public. They appear only in an OAS enum of model ids (likely the usage
report's), or not at all (`seedream5_flash`). See section 2.8.

So **63 ids are usable and documented**, 3 are retired, and 4 are undocumented.

### 1.2 What matters most

1. **Kling O3 takes character references *and* a pinned first frame in one clip (NEW, CL 2026-10-13).**
   `klingO3_standard`, `klingO3_pro` and `klingO3_4k` on `image_to_video` accept `promptImage`
   (first, or first + last) plus a separate `references` array. INPUTS and CL: "up to 7 reference
   images on image-to-video (keyframes count toward that total)". Every other model on Runway
   either takes no references (Veo, Gen-4.x, Kling 3.0, H3 Max, HappyHorse, Grok i2v, Omni i2v) or
   refuses to mix them with keyframes (Seedance, WAN, Hailuo: "The two modes cannot be mixed").
   This is the first route to *frame-exact composition plus a held character* on our key.
   - **Not proven for photoreal people.** No Runway page restricts real faces on Kling, and nothing
     in the vendor guides (V-KL) does either. Only a paid test can tell (Q1).
   - Limits: no seed. A last keyframe can't be combined with `multiPrompt`. Prompt ≤ 2,500. 3-15 s.
     Audio is on by default and **billed the same with it off** (13 / 17 / 43 cr/s).
2. **Character references in video that work for photoreal people, as far as we know today:**
   - **WAN 3 / WAN 3 Prime** in reference mode (≤ 10 images, ≤ 5 videos, ≤ 5 audio; no keyframes).
     PT13 sent our photoreal Gemini frame as a reference with our VO; it passed moderation, kept the
     frame's composition and lip-synced our VO. Tested ✓ (PT13 §3).
   - **Kling O3** (above): schema allows refs with a pinned frame; photoreal untested.
   - **Hailuo 3 (MiniMax H3)**: ≤ 9 image refs, ≤ 3 video, ≤ 3 audio, not mixed with keyframes.
     Untested; MiniMax's sibling `h3_max` took a frame that Veo refused (PT13, AMP §2).
   - **Grok Imagine 1.5** (t2v only): ≤ 7 image refs addressed as `[Image 1]`… and ≤ 3 audio refs
     (which need an image ref); capped at 720p with refs. Untested.
   - **Gemini Omni Flash 1.1** (t2v and v2v only): ≤ 5 image refs. Untested with refs; i2v passed a
     photoreal frame in PT13.
   - **Seedance (all four) blocks photoreal faces** whether the face comes as a frame or a
     reference (PT13 §2, §3). Runway's docs don't say so; third-party API docs describe it as an
     upstream ByteDance deepfake filter that needs a liveness-verified asset path Runway does not
     expose (V-SD). Treat Seedance as stylised-only.
3. **Kling 3.0 is a cheaper, longer Veo alternative with audio (NEW).** First + last frame,
   3-15 s, 1080p for 17 cr/s with audio (Pro) or 13 cr/s at 720p (Standard), against Veo 3.1 Fast's
   15 cr/s for 4/6/8 s. Its dialogue and lip sync are untested (Q3).
4. **Multi-shot in one call (NEW):** `providerSettings.multiPrompt` on every Kling 3.0 and O3 model
   (≤ 6 segments, 3-15 s in total, `shotType` `customize` or `intelligence`), and the
   `multi_shot_video` recipe (3-5 shots, optional first frame, 13 / 17 cr/s). The recipe's prices
   equal Kling 3.0 Standard/Pro with audio, so it is probably Kling underneath (inference).
5. **A second video editor with references (NEW):** Kling O3 `video_to_video` edits a clip of ≤ 10 s
   with ≤ 4 reference images and keeps the original sound by default (`keepOriginalSound: true`),
   billed per second of input (13 / 17 / 43 cr/s): cheaper than Aleph 2 (28 cr/s, 56 minimum).
6. **Seed Audio clones a voice from a reference clip (NEW to our notes).** `seed_audio` on
   `/v1/text_to_speech` takes `voice: {type: "reference-audio", audioUri}`, at 0.25 cr/s (5 cr
   minimum), up to 120 s, WAV/MP3/Opus at 8-48 kHz. It is the only route on Runway to speak in
   *our* character's voice; the ElevenLabs models there take preset voices only.
7. **`nano_banana_2.1` is now in OAS (NEW).** Up to 14 tagged references (no `subject` field),
   `thinkingLevel` minimal/medium/high, 42 sizes from 1K to 4K, 1-4 outputs. PT13 found it close to
   Nano Banana Pro at a third of the price.
8. **Bria FIBO 1.5 and FIBO Edit 1.5 (NEW, undocumented outside OAS):** seeded, *reproducible*
   ("the same seed with an identical request reproduces the same image") image generation and an
   edit model that keeps the first reference's framing. 5 cr at 1 MP, 10 at 4 MP (OAS text, not on
   PRICE). Edit price undocumented.

## 2. The catalogue

Each table row is one model. "Refs" are images unless stated. "Pinned frame + refs" says whether
the model takes character references in the same call as a positioned first frame.

### 2.1 Image models (`POST /v1/text_to_image`)

| Model (brand) | Prompt max | References | Sizes | Outputs | Seed | Other parameters | Credits per image | Notes | New? |
|---|---|---|---|---|---|---|---|---|---|
| `gemini_image3_pro` (Nano Banana Pro) | 5,500 (min 3) | 14: ≤ 5 `subject: human` (for character consistency), ≤ 9 `object`; `tag` 3-16 chars, named `@tag` | 30 ratios, 1K / 2K / 4K | 1 or 4 | no | none | 20 at 1K/2K, 40 at 4K | The best face and light in PT13 (2K, 33 s). Sources: OAS, PRICE, PT13 | |
| `gemini_image3.1_flash` (Nano Banana 2) | 5,500 | 14 (5 human + 9 object), tags | 56 ratios, 512 px to 4K | 1 or 4 | no | none | 5 (512) / 7 (1K) / 11 (2K) / 16 (4K) | PT13: 20-26 s. Sources: OAS, PRICE | |
| `nano_banana_2.1` (Nano Banana 2.1) | 5,500 | 14, optional `tag` (no `subject`) | 42 sizes, 14 aspects (1:1 … 8:1), 1K/2K/4K | 1-4 | no | `thinkingLevel` minimal / medium (default) / high | 4 (1K) / 6 (2K) / 12 (4K) | Reference aspect 0.25-4. PT13: 2K, 33 s, close to Pro. Sources: OAS, CL 2026-10-06, INPUTS | **NEW in OAS** |
| `gemini_2.5_flash` (Nano Banana) | 5,500 | 3, tags | 10 ratios, 1K | 1 | no | none | 5 | Legacy. Sources: OAS, PRICE | |
| `gpt_image_2` | 32,000 | 16, tags | 31 sizes incl. `auto` (4K tier) | 1-10 | no | `quality` low/medium/high/auto (default high); `background` transparent/opaque/auto | 1-2K: 1 / 5 / 20 (high, auto); 4K and `auto`: 2 / 11 / 41 | CL 2026-04-23 says *no* transparency on GPT Image 2, but OAS lists `transparent`: unverified. Sources: OAS, PRICE | |
| `gpt_image_2_5_flare` | 32,000 | 16, tags; **+1 cr per ref per output** | 31 sizes, `auto` = 4K tier | 1-10 | no | `quality` low/medium/high/xhigh/max (default high); `background` opaque/auto | 1-2K: 1 / 5 / 16 / 28 / 63; 4K: 2 / 11 / 19 / 34 / 76 | Faster sibling of Sunburst. Sources: OAS, PRICE | |
| `gpt_image_2_5_sunburst` | 32,000 | 16, tags; +1 per ref per output | as Flare | 1-10 | no | as Flare, plus `background: transparent` (PNG with alpha) | as Flare | PT13: high, 39 s, 16 cr; strong but added unrequested people. Sources: OAS, PRICE, PT13 | |
| `ideogram_4_5` | 10,000 | 5, no tags; with a mask or `preciseEdit` the first is the image edited (mask: + up to 3 refs) | 27 sizes 1K/2K + `auto`; none with mask/preciseEdit (keeps the first ref's size) | 1-8 | no | `quality` very_low/low/medium/high; **`maskUri`** (black = edit, white = keep, same size as ref 1); **`preciseEdit`** | 1 / 4 / 8 / 25; default medium with refs, high otherwise and with preciseEdit; very_low needs refs, not with preciseEdit | Mask/ref aspect 0.167-6. PT13: masked recolour left the face untouched, 47 s, 8 cr; returned 2695×1536 for 2752×1536. Sources: OAS, PRICE, CL 2026-10-12, PT13 | |
| `ideogram_4_0` | 4,000 | 1 (remix) | 9 sizes, 2K only | 1-4 | no | `quality` low/medium/high | 4 / 7 / 11 | Typography. Sources: OAS, PRICE | |
| `seedream5_pro` | 4,000 | 10, by order ("Figure 1, Figure 2") | 14 sizes 1K/2K + `auto_1k`/`auto_2k` | 1-4 | no | `outputFormat` png/jpeg; `grounding` (live web search) | 5 (1K) / 9 (2K) | "Reasoning image editing with layer control" (MODELS). Seedance's moderation policy may extend to Seedream; untested on real faces. Sources: OAS, PRICE, MODELS | |
| `seedream5_lite` | 4,000 | 14, by order | 16 sizes 2K/3K, or any W:H string | 1-4 | no | `outputFormat`; `grounding` | 4 | Sources: OAS, PRICE | |
| `seedream5_flash` | undocumented | undocumented | undocumented | undocumented | ? | ? | undocumented | **On the key, absent from OAS, MODELS and PRICE.** Elsewhere it is ByteDance's fast, cheap Seedream 5.0 (14 refs, 1K/2K, ~$0.018/image, point-to-edit, layered output) (V-SR). Probably launching on Runway soon (inference). | **NEW** |
| `grok_imagine_image_2` | 2,500 | 3 (+1 cr each, once per request) | 28 sizes 1K/2K + `auto_1k`/`auto_2k` | 1-4 | no | `quality` low/medium; **`edit: true`** (edits its one ref directly, or combines several) | low 4 (1K) / 6 (2K); medium 6 / 8; minimum 6 for a plain 1K medium; max 35 per request | Sources: OAS, PRICE | |
| `muse_image` (Meta) | 4,000 | 10 ("edits and combines them") | 8 sizes + `auto` | 1-10 | no | `outputFormat` webp/png/jpeg | 1 | The cheapest image on Runway. Sources: OAS, PRICE | |
| `gen4_image` | 1,000 | ≤ 3, `@tag` | 16 ratios, 720p/1080p | 1 | **yes** | `contentModeration.publicFigureThreshold` auto/low | 5 (720p) / 8 (1080p) | Seeded re-rolls give "similar" results. Sources: OAS, PRICE | |
| `gen4_image_turbo` | 1,000 | **1-3 required**, `@tag` | 16 ratios | 1 | **yes** | `contentModeration` | 2 | Sources: OAS, PRICE | |
| `bria_fibo_1_5` | 10,000 | 1 ("the prompt describes how the output should build on it") | 18 sizes (1 MP and 4 MP tiers) | 1 | **yes, reproducible** ("the same seed with an identical request reproduces the same image") | `outputFormat` png/jpeg | 5 at 1 MP, 10 at 4 MP (OAS `ratio` text; not on PRICE) | Not on MODELS or PRICE. Bria markets FIBO as trained on licensed data; not verified this session. Source: OAS | **NEW** |
| `bria_fibo_edit_1_5` | 10,000 (an edit instruction) | **1-4 images to edit**; with several, the instruction says how to combine them | `auto` keeps ref 1's framing; a chosen size needs ≥ 2 refs | 1 | **yes, reproducible** | `outputFormat` | **undocumented** | An instruction editor that keeps framing: a candidate for frame edits. Source: OAS | **NEW** |

Common to all: no negative prompt, no strength, no inpainting except Ideogram 4.5's mask, no
outpainting (R13 §1.2, re-checked in OAS 2026-10-15).

### 2.2 Video models with native audio

All take `promptImage` as a URL or an array of `{uri, position}`. "Audio on/off" means an `audio`
boolean exists.

| Model | Endpoints | Length | Frames | References (pinned frame + refs?) | Sizes | Audio | Seed | Credits per second | Moderation and notes | New? |
|---|---|---|---|---|---|---|---|---|---|---|
| `veo3.1` | t2v, i2v | 4, 6, 8 s | first, or first + last (no last-only); aspect 0.5-2 | **none** | 1280:720, 720:1280, 1920:1080, 1080:1920 | dialogue with lip sync, SFX; default on; `audio` | yes | **40 with audio, 20 without** | `negativePrompt` ≤ 1,000. Prompt ≤ 1,000. PT13: 6 s, 188 s latency, line 100%, lip sync 0.35. Refused a child-with-shadow frame (AMP). Sources: OAS, PRICE, PT13 | |
| `veo3.1_fast` | t2v, i2v | 4, 6, 8 s | as Veo 3.1 | none | as Veo 3.1 | as Veo 3.1 | yes | **15 / 10** | PT13: 54 s, lip sync 0.35, photoreal frame passed | |
| `kling3.0_standard` | t2v, i2v | 3-15 s (default 5) | first, or first + last; ≥ 300 px; aspect 0.4-2.5 | none | t2v 1280:720, 720:1280, 960:960; i2v follows the first frame | default on, `audio` | no | **13 with audio, 9 without** | `cfgScale` 0-1; **`multiPrompt`** ≤ 6 segments (3-512 chars each, 3-15 s total), `shotType` customize/intelligence. Prompt 2-2,500. Moderation of real faces: undocumented. Sources: OAS, PRICE, INPUTS, CL 2026-10-13 | **NEW** |
| `kling3.0_pro` | t2v, i2v | 3-15 s | as Standard | none | 1920:1080, 1080:1920, 1440:1440 | default on | no | **17 / 12** | as Standard, 1080p | **NEW** |
| `kling3.0_4k` | t2v, i2v | 3-15 s | as Standard | none | 3840:2160, 2160:3840, 2880:2880 | default on | no | **43 either way** | as Standard, 4K | **NEW** |
| `klingO3_standard` | t2v, i2v, **v2v** | 3-15 s | first, or first + last | **yes: `references`, ≤ 7 images including the keyframes** (aspect 0.4-2.5). A last keyframe can't be combined with `multiPrompt`. | 1280:720, 720:1280, 960:960 | default on | no | **13, audio on or off** | `multiPrompt` (t2v, i2v). v2v: see 2.4. Vendor guides call these "elements" and suggest the start frame for composition and refs for identity (V-KL). Real faces: undocumented. Sources: OAS, PRICE, INPUTS, CL 2026-10-13 | **NEW** |
| `klingO3_pro` | t2v, i2v, v2v | 3-15 s | as O3 Standard | **yes, ≤ 7 incl. keyframes** | 1920:1080, 1080:1920, 1440:1440 | default on | no | **17, audio on or off** | as O3 Standard, 1080p | **NEW** |
| `klingO3_4k` | t2v, i2v, v2v | 3-15 s | as O3 Standard | **yes, ≤ 7 incl. keyframes** | 3840:2160, 2160:3840, 2880:2880 | default on | no | **43** | as O3 Standard, 4K | **NEW** |
| `seedance2_5` | t2v, i2v, v2v | 4-30 s or `auto` (billed at max, rest refunded) | first/last keyframes **or** unpositioned refs, never both | ≤ 30 images, ≤ 10 videos, ≤ 10 audio (< 30 s together); refs carry no tags | 18 ratios, 480p-1080p | default on | yes | 20 / 30 / 68 (480p/720p/1080p) + 10 / 15 / 34 per second of input or reference video; images and audio free; **80 minimum** | **Blocks photoreal faces** as frame or ref (PT13: refused, refunded to 0 cr); stylised frame gave the best lip sync, 0.53. `draft: true` 480p preview, then `draftTaskId` → 1080p within 7 days. Prompt ≤ 15,000. Sources: OAS, PRICE, PT13, V-SD | |
| `seedance2` | t2v, i2v, v2v | 4-15 s or `auto` | as 2.5 | ≤ 9 images, ≤ 3 videos (v2v 2), ≤ 3 audio (≤ 15 s) | 24 ratios, 480p-**4K** | default on | yes | 36 (≤ 720p) / 40 (1080p) / **150 (4K)** | Photoreal block assumed as 2.5 (V-SD) | |
| `seedance2_fast` | t2v, i2v, v2v | 4-15 s | as 2.5 | as `seedance2` | 12 ratios, 480p/720p | default on | yes | 29 | as above | |
| `seedance2_mini` | t2v, i2v, v2v | 4-15 s | as 2.5 | as `seedance2` | 12 ratios, 480p/720p | default on | yes | 16, **64 minimum** | PT13: photoreal blocked | |
| `wan3` | t2v, i2v | 2-30 s | first, or first + last (`ratio` must be `auto_*`) | t2v: ≤ 10 images, ≤ 5 videos, ≤ 5 audio (video and audio each < 15 s). i2v: ≤ 10 `promptImage` as keyframes **or** unpositioned refs, not mixed; plus `referenceVideos`, `referenceAudio` | 18 ratios incl. `auto_480p/720p/1080p`, 480p-1080p | `audio` boolean, no stated default; **same price either way** (PT13) | no | 5 / 10 / 20 | Prompt ≤ 20,000. PT13: photoreal frame passed as first frame and as ref; frame-as-ref + our VO gave our exact VO with lip sync 0.21-0.36; 30 fps output. Sources: OAS, PRICE, INPUTS, PT13 | |
| `wan3_prime` | t2v, i2v | 2-30 s | as WAN 3 | as WAN 3 | as WAN 3 | as WAN 3 | no | 6.8 / 14 / 28 | "High-speed" WAN 3 | |
| `h3_max` (MiniMax H3 Max) | t2v, i2v | 5-15 s | first, or first + last (≥ 256 px; aspect 0.2-4) | none | `resolution` 480p, 768p (no `ratio`; follows the image) | native, **no toggle** | yes (identical only with `promptExpansionMode: disabled`) | 5 / 8 | Prompt ≤ 6,000. PT13: 6 s at 768p in 15 s for 48 cr, lip sync 0.33-0.40; took a frame Veo refused. Sources: OAS, PRICE, PT13, AMP | |
| `hailuo3` (MiniMax H3) | t2v, i2v, v2v | 5-15 s | i2v: ≤ 9 `promptImage` as keyframes **or** unpositioned refs, not mixed | t2v/i2v ≤ 9 images; ≤ 3 videos (v2v 2) and ≤ 3 audio, each set ≤ 15 s; **audio refs only with unpositioned refs** | `resolution` 768p/2K (default 2K); `ratio` adaptive/21:9/16:9/4:3/1:1/3:4/9:16 | **no `audio` field**; MODELS lists it under "text, image, video, and audio references" only | no | 10 (768p) / 15 (2K) **+ 2 per ref image or keyframe** (incl. the start frame); ref video at the output rate (≤ 15 s) | Aspect 0.2-4. Prompt ≤ 6,000. Whether it outputs sound: unverified (R13 too). Sources: OAS, PRICE, INPUTS, CL 2026-08-05 | detail **NEW** |
| `grok_imagine_1_5` | t2v, i2v | 1-15 s | i2v: one first frame only | **t2v only**: ≤ 7 images, prompt-addressable as `[Image 1]`…; ≤ 3 audio (3-15 s each, need ≥ 1 image ref); refs cap output at 720p. No refs on i2v. | 480p/720p/1080p; t2v 7 aspects | native, no toggle | no | 10 / 16 / 29 **+ 1 per image or audio ref** (incl. a start frame) | "audio-driven performance" (MODELS). Prompt ≤ 2,500. Sources: OAS, PRICE, INPUTS, CL 2026-08-07 | |
| `grok_imagine_1_5_lite` | t2v, i2v | 1-15 s | i2v: first frame only | none | t2v 21 sizes; i2v `auto_480p/720p/1080p` (1080p is 720p upscaled) | MODELS doesn't claim audio; schema has no `audio` field: unverified | no | 2 / 3 / 14 + 1 for a start frame | The cheapest clip on Runway (3 cr/s at 720p). Sources: OAS, PRICE, CL 2026-10-01 | |
| `happyhorse_1_0` | t2v, i2v | 3-15 s | i2v: first frame only (≥ 300 px; aspect 0.55-1.8) | none | t2v 10 sizes 720p/1080p; i2v `resolution` 720P/1080P | native, no toggle | no | 15 / 30 | Prompt ≤ 2,500. Sources: OAS, PRICE, INPUTS | |
| `gemini_omni_flash_1.1` | t2v, i2v, v2v | 3-10 s or `auto` | i2v: first, or first + last (aspect 0.4-2.5) | **t2v: ≤ 5 images + ≤ 3 videos; i2v: none**; v2v: ≤ 5 images | 360p, 720p, 1080p, 4K (8 sizes) | native, no toggle | no | 3.4 / 10 / 15 / 30 **+ 1 per ref image (incl. start frame) + 1 per second of input video** | Prompt ≤ 4,000. PT13: 720p i2v 61 cr / 6 s; photoreal frame passed; extend remade all the audio. Sources: OAS, PRICE, PT13 | |
| `gemini_omni_flash` (v1) | t2v, i2v, v2v | 3-10 s | i2v: first frame only | v2v: ≤ 5 images | 720p only: 1280:720, 720:1280 | CL: "optional generated audio", but no `audio` field in OAS | no | t2v 10; i2v 10 + 1; v2v **11 per input second** (≤ 10 s) + 1 per ref | Superseded by 1.1. Sources: OAS, PRICE, CL 2026-07-01 | **NEW to our notes** |

### 2.3 Video models without audio

| Model | Endpoints | Length | Frames and refs | Sizes | Seed | Credits per second | Notes | New? |
|---|---|---|---|---|---|---|---|---|
| `gen4.5` | t2v, i2v | 2-10 s | first frame only (aspect 0.5-2); no refs | t2v 1280:720, 720:1280; i2v 6 ratios | yes | 12 (+5 ProRes/PNG, +20 10-bit/HDR, +40 HDR above 4 MP) | `outputFormat` mp4 / ProRes / PNG sequence / HDR10 / HLG / 10-bit / 12-bit master / EXR / ACEScg; `contentModeration.publicFigureThreshold`. PT13: 214 s for 6 s. Sources: OAS, PRICE | |
| `gen4_turbo` | i2v | 2-10 s | first frame only | 6 ratios | yes | 5 | PT13: 27 s for 6 s | |
| `kling2.5_turbo_pro` | t2v, i2v | 5 or 10 s | first, or first + last (≥ 300 px; aspect 0.4-2.5) | t2v 1920:1080 (default), 1440:1440, 1080:1920 (+ 720p sizes still accepted); i2v follows the image | no | 12 | `cfgScale`. No `audio` field and no claim of sound (inference: silent). Sources: OAS, PRICE, INPUTS, CL 2026-10-13 | **NEW** |

### 2.4 Video editing and extending (`POST /v1/video_to_video`)

| Model | Modes | Input | Guidance | Output | Audio | Seed | Credits | Notes | New? |
|---|---|---|---|---|---|---|---|---|---|
| `aleph2` | edit (and outpaint with `targetAspectRatio`) | `videoUri` 2-30 s, ≤ 30 fps | prompt ≤ 1,000 (optional); ≤ 5 `keyframes` at `seconds` or `at` (0-1), each with an optional `range` | the input's size up to 1080p; mp4 / ProRes / PNG sequence / 10-bit | **keeps the input audio exactly** (PT13: correlation 1.000) | yes | 28/s, **56 minimum** (+5 ProRes/PNG, +20 10-bit) | `contentModeration`. PT13: 168 cr, 245 s for 6 s. Sources: OAS, PRICE, PT13 | |
| `klingO3_standard` / `_pro` / `_4k` | edit | `promptVideo` **≤ 10 s**, each side 720-3840 px | prompt 2-2,500 (required); `references` ≤ 4 images (aspect 0.4-2.5), as a URL or `{uri, position?}` | as the O3 sizes | `providerSettings.keepOriginalSound` **default true** | no | **13 / 17 / 43 per second of input video** | Sources: OAS, PRICE, INPUTS, CL 2026-10-13 | **NEW** |
| `seedance2_5` | `reference` (default), `extend`, `edit` | `promptVideo` ≥ 480p; ref video ≤ 30 s in total (v2v keeps one slot for the input) | prompt ≤ 15,000; ≤ 30 images, ≤ 9 more videos, ≤ 10 audio | extend keeps the input ratio; edit needs `duration: "auto"`, no `ratio` | `audio` default on | yes | output rate + 10/15/34 per input second; 80 minimum | Photoreal faces blocked. Sources: OAS, PRICE | |
| `seedance2` / `_fast` / `_mini` | `reference` only | `promptVideo` | ≤ 9 images, ≤ 2 more videos, ≤ 3 audio | as their t2v | `audio` | yes | as their t2v rates | Photoreal faces blocked | |
| `gemini_omni_flash_1.1` | `reference` (default), `extend`, `edit` | `videoUri`: reference/edit ≤ 10 s, **extend ≤ 30 s** | prompt ≤ 4,000; ≤ 5 images | 360p-4K; in extend `duration` is the footage *added* | native; PT13: extend **re-made all the audio** (correlation 0.003) | no | output rate + 1 per input second + 1 per ref | PT13: extend 106 cr, 97 s, 16 s out. Sources: OAS, PRICE, PT13 | |
| `gemini_omni_flash` (v1) | edit | `videoUri` ≤ 10 s | prompt ≤ 4,000; ≤ 5 images | 720p, the input's orientation and length | ? | no | 11 per input second + 1 per ref | Sources: OAS, PRICE, CL 2026-07-01 | **NEW to our notes** |
| `hailuo3` | reference | `promptVideo` (+ ≤ 2 ref videos, ≤ 15 s in total) | ≤ 9 images, ≤ 3 audio | 768p/2K, 5-15 s | ? | no | as its t2v, + ref video at the output rate | A new clip conditioned on the input, not an in-place edit. Sources: OAS, PRICE | |

### 2.5 Performance and avatars

| Model | Endpoint | Inputs | Output | Credits | Notes | New? |
|---|---|---|---|---|---|---|
| `act_two` | `POST /v1/character_performance` | `character`: image or video with a visible face that stays in frame; `reference`: an actor's performance video; `bodyControl`; `expressionIntensity` 1-5 (default 3); aspect 0.5-2.358 | 6 ratios | 5/s | `contentModeration`, seed. Whether the output carries the reference's audio: undocumented (R13 Q4). Sources: OAS, PRICE | |
| `gwm1_avatars` (Characters) | `POST /v1/avatars` then `POST /v1/avatar_videos` (async) or `/v1/realtime_sessions` (live) | avatar: `name`, `referenceImage` (one image; "any visual style works: photorealistic humans, animated mascots…"; face centred; 1088×704 recommended), `personality` (required), `voice` (30 live presets or a custom voice id), `imageProcessing` optimize/none. Video: `speech` = `{type: audio, audio}` or `{type: text, text ≤ 5,000, voice?}` | a talking-head clip; PT13 got 1088×704 | 2 up front, then 2 per 6 s (PRICE "Real-time"; the async price isn't listed separately) | PT13: our VO spoken word for word, 14 s latency, **2 cr**, lip sync 0.23. 9 preset avatars too. Sources: OAS, PRICE, CHAR, PT13 | `imageProcessing` **NEW** |
| `gwm1_avatar_async_audio_to_video` | (none of its own) | | | undocumented | Appears only in an OAS enum of model ids. Probably the billing name for `avatar_videos` with `speech.type: audio` (inference). | **NEW** |
| `gwm1_avatar_async_text_to_video` | (none of its own) | | | undocumented | As above, for `speech.type: text` (inference). | **NEW** |

Custom voices (`POST /v1/voices`, CHAR): design from a text prompt (`eleven_ttv_v3` or
`eleven_multilingual_ttv_v2`, prompt 20-1,000 chars; `/v1/voices/preview` previews one) or clone from
a 10 s-5 min sample (≤ 10 MB). Creation is asynchronous (poll until `READY`). **The voices work
only for avatars**: the TTS, STS and dubbing endpoints take Runway preset voices only (OAS).

### 2.6 Upscale, frame rate and HDR

| Model | Endpoint | Input | Settings | Credits | New? |
|---|---|---|---|---|---|
| `magnific_precision_upscaler_v2` | `POST /v1/image_upscale` | image 300-8,000 px | `scaleFactor` 2/4/8/16 (output ≤ 25.3 MP, R13); `sharpen`, `smartGrain`, `ultraDetail` 0-100; `flavor` sublime/photo/photo_denoiser | 25, or **150 when the output exceeds 4,096 px** | |
| `magnific_video_upscaler_creative` | `POST /v1/video_upscale` | video ≤ 30 s | `resolution` 720p/1k/2k (default)/4k; `creativity`, `sharpen`, `smartGrain` 0-100; `flavor` vivid/natural; `fpsBoost` | per output frame: $0.007 (720p/1k), $0.009 (2k), $0.012 (4k). At 24 fps: 16.8 / 21.6 / 28.8 cr/s; at 30 fps: 21 / 27 / 36 | |
| `enhance_frame_rate` | `POST /v1/video_upscale` | video ≤ 300 s | `targetFramerate` 24, 25, 30, 48, 50, 60, 120, 23_98, 29_97, 59_94 | **1 per 2 s of input** (0.5 cr/s) | |
| `ruby` | `POST /v1/video_to_hdr` | SDR video ≤ 30 s, < 4,096 px a side; keeps the source's pixels, audio and alpha | `outputFormat` hdr10 (default) / hlg / hdr_prores / EXR / ACEScg 1.3 / 2.0 | 20/s, 40/s above 4 MP | |

Sources: OAS, PRICE, INPUTS, CL (2026-06-11, 2026-08-20, 2026-09-11, 2026-09-17).

### 2.7 Audio

| Model | Endpoint | Inputs | Voices | Output | Credits | Notes | New? |
|---|---|---|---|---|---|---|---|
| `eleven_v4` | `/v1/text_to_speech` | script with tags (`[laughs]`, `[whispers]`, `[pause]`); MODELS and CL say ≤ 2,500 chars (OAS sets no maximum); `stability`, `similarityBoost`, `style`, `speed` 0.7-1.2, `useSpeakerBoost`, `languageCode`, **`previousText`/`nextText`**, `seed` | 49 Runway presets | not selectable | **5 per 1,000 chars** (since 2026-10-12; was 2.2), minimum 1 | PT13: 1 cr, 7 s. Sources: OAS, PRICE, CL 2026-09-30 | price **NEW** |
| `eleven_v3` | `/v1/text_to_speech` | ≤ 5,000 chars with tags; same settings as v4 except context; `applyTextNormalization` | 49 presets | | 1 per 50 chars (20 per 1,000), minimum 1 | PT13: 2 cr, 12 s | |
| `eleven_multilingual_v2` | `/v1/text_to_speech` | ≤ 1,000 chars | 49 presets | | 1 per 50 chars | | |
| `seed_audio` (Seed Audio 1.0) | `/v1/text_to_speech` and `/v1/sound_effect` | TTS: the words, plus **`voice: {type: "reference-audio", audioUri}` (a cloned voice)**; SFX: a scene description "that can include voice direction, dialogue, music, and sound effects", ≤ 3 `referenceAudios` named `@Audio1`…; `speechRate`, `loudnessRate`, `pitchRate`; ≤ 2,048 chars; up to 120 s out; refs ≤ 30 s | any, by reference clip | WAV / MP3 / Ogg Opus, **8-48 kHz** | **0.25/s, 5 minimum** | PT13: music from a short prompt worked (5 cr, 20 s); a long prompt failed. Sources: OAS, PRICE, CL 2026-06-30, MODELS ("including cloned voices") | cloning **NEW to our notes** |
| `eleven_text_to_sound_v2` | `/v1/sound_effect` | ≤ 3,000 chars; `duration` 0.5-30 s; `loop` | | | 1/s with a duration; 2 without | PT13: 6 s rain 6 cr | |
| `eleven_multilingual_sts_v2` | `/v1/speech_to_speech` | `media`: audio **or video**; `removeBackgroundNoise` | 49 presets | the same container (a video comes back with the new voice) | 1 per 3 s | PT13: timing kept to the hundredth; 2 cr | |
| `eleven_voice_isolation` | `/v1/voice_isolation` | `audioUri` (R13: 4.6 s to 1 h) | | | 1 per 6 s | PT13: 2 cr, clean | |
| `eleven_voice_dubbing` | `/v1/voice_dubbing` | `audioUri`; `targetLang` (29); `disableVoiceCloning`; `dropBackgroundAudio`; `numSpeakers` | clones the speaker unless disabled | audio | 1 per 2 s | Audio only: the picture is not re-lip-synced | |
| `voice_processing` | (none of its own) | | | | undocumented | Appears only in an OAS enum of model ids. Possibly the billing name for `/v1/voices` design or cloning (inference). | **NEW** |

There is **no music model** on Runway. `seed_audio`'s scene prompt can include music. Router audio
(`POST /v1/generate/audio`) covers `speech` and `audio` only.

### 2.8 Recipes (`POST /v1/recipes/*`)

Each needs `version` (`2026-06`, `2026-07` for Product Ad, or `unsafe-latest`). No seed, no
per-shot references, no last frame (R13).

| Recipe | Inputs | Output | Credits | Notes |
|---|---|---|---|---|
| `product_ad` | `productImages` 1-10 (the first is primary; several angles advised); `styleImages` ≤ 4; `productInfo` ≤ 2,500; `userConcept` ≤ 3,500; 8 ratios 720p/1080p; 4-15 s (default 10) | video; `audio` **default false** | 720p: 200 for 4 s + 36/s; 1080p: 216 + 40/s. A 10 s 1080p ad is 456 | "analyzes the product, builds a storyboard, and renders" (REC) |
| `product_swap` | `referenceVideo` 1.8-15 s; `originalProductImage`; `newProductImages` 1-10 with `view` front/side/back (or one composed sheet); 720p/1080p; 4-15 s | video; `audio` default true | 720p: 212 + 36/s; 1080p: 228 + 40/s | |
| `product_ugc` | **`characterImage`** (the creator on camera, face visible; aspect 0.4-4) + `productImage`; `productInfo`; `userConcept` (tone, or "an entire dialog script"); 9:16 only (720p/1080p); 4-15 s (default 15) | talking presenter video; audio default true | 720p: 192 + 36/s; 1080p: 208 + 40/s. 15 s 720p = 588 | REC: "only use references of people you have permission to depict". The per-second rates equal Seedance 2.0 (36/40), so it may run on Seedance (inference): whether it accepts **photoreal** creators is untested |
| `multi_shot_video` | `mode: auto` (one story prompt ≤ 2,500) or `custom` (3-5 shots, 3-512 chars each, durations summing to the total); optional `firstFrame`; 720p or 1080p ratios; 5/10/15 s | video; audio default true | 13/s (720p), 17/s (1080p) | Same rates as Kling 3.0 with audio (inference: Kling underneath) |
| `product_campaign_image` | `image` (the product) + `prompt` ≤ 3,500 | **4 images** per call | 36 per 1080p image (so 144 per call) | |
| `marketing_stock_image` | `prompt` ≤ 3,500; optional brand logo `referenceImage`; `outputCount` 1-4 (default 4); `quality` low/medium/high | images | 8 per call + 1-20 per image by quality; default (4, high) = 88 | REC latency: ~40 s low, ~70 s medium, ~3 min high |
| `ad_localization` | `referenceImage` (the ad) + `targetLanguage` (22 codes) | one localized image, layout kept | 21 | Text-in-image translation only |

Sources: OAS, PRICE, REC.

### 2.9 Retired and undocumented ids

| Id | Status | Source |
|---|---|---|
| `gen3a_turbo`, `gen4_aleph` | "No longer available… Requests that use these model identifiers will fail" (2026-07-30) | CL |
| `veo3` | Absent from OAS, MODELS and PRICE; last named in CL 2026-07-10 (negative prompt). R13 found it gone. Treat as retired. | OAS, CL, R13 |
| `seedream5_flash`, `voice_processing`, `gwm1_avatar_async_*` | See 2.1, 2.5, 2.7 | OAS, V-SR |

The key also lists no `eleven_scribe_v2`, although OAS names it in the same id enum.

## 3. Characters in video: which route keeps a person

| Route | Pinned first frame | Character refs | Photoreal people | Lip sync to our VO | Cost for 6 s |
|---|---|---|---|---|---|
| **Kling O3 i2v, frame + refs** | ✓ (first; a last frame too, but not with `multiPrompt`) | ✓ ≤ 7 in total | **untested**; nothing documented against it | dialogue from the prompt (untested); no audio refs | 78 (Std) / 102 (Pro) / 258 (4K) |
| WAN 3 reference mode | ✗ (frame sent as an unpositioned ref; PT13: composition kept) | ✓ ≤ 10 | ✓ (PT13) | ✓ `referenceAudio` (PT13: our exact VO, sync 0.21-0.36) | 60 (720p) |
| Hailuo 3 reference mode | ✗ | ✓ ≤ 9 (+2 cr each) | untested | `referenceAudio` with refs (untested) | 60 + 2/ref (768p) |
| Grok Imagine 1.5 t2v | ✗ (no frame with refs) | ✓ ≤ 7 `[Image n]`; ≤ 720p | untested | audio refs "audio-driven performance" (untested) | 96 + 1/ref (720p) |
| Omni Flash 1.1 t2v | ✗ | ✓ ≤ 5 | untested (i2v passed a photoreal frame) | ✗ | 60 + 1/ref (720p) |
| Seedance 2.x reference mode | ✗ | ✓ ≤ 30 (2.5) | **✗ blocked** (PT13) | ✓ best for stylised (0.53) | 180 (2.5, 720p) |
| Veo 3.1 / Kling 3.0 / H3 Max frame only | ✓ (+ last) | ✗ | ✓ (Veo, H3 Max: PT13) | native dialogue only | Veo Fast 90; Kling 3.0 Std 78 |
| Avatar (`gwm1_avatars`) | its own reference image | one image | ✓ (docs and PT13) | ✓ our audio file | ~2-4 |

## 4. What each Production Tool job could use

Each job lists two **best** (top quality, cost no object), two **mid** (best value) and two **low**
(cheap and fast) picks, more where useful. Prices are at the setting we would use. "✓" marks a model
PT13 tested. Where fewer than six models on the key fit a job, the table says so.

### 4.1 Generate pictures and character pictures

| Tier | Model | Endpoint | Price (setting) | Takes | Why this tier |
|---|---|---|---|---|---|
| Best | `gemini_image3_pro` ✓ | text_to_image | 20 cr, $0.20 (2K); 40 at 4K | 14 tagged refs, 5 as `human` | Best faces and light in PT13; explicit human slots |
| Best | `gpt_image_2_5_sunburst` ✓ | text_to_image | 16 cr + 1/ref, $0.16+ (high, 2K); 28 xhigh | 16 tagged refs; transparent background | Strongest prompt following and text; cut-outs |
| Mid | `nano_banana_2.1` ✓ | text_to_image | 6 cr, $0.06 (2K) | 14 tagged refs; `thinkingLevel` | Near-Pro quality at a third of the price (PT13) |
| Mid | `seedream5_pro` | text_to_image | 9 cr, $0.09 (2K) | 10 refs by order | Multi-reference fusion; real faces untested |
| Mid | `gemini_image3.1_flash` ✓ | text_to_image | 11 cr, $0.11 (2K) | 14 refs with `human` slots | Our current low default; keeps the subject flag |
| Low | `nano_banana_2.1` | text_to_image | 4 cr, $0.04 (1K) | as above | Cheapest good tagged-reference model |
| Low | `muse_image` | text_to_image | 1 cr, $0.01 | 10 refs, no tags | Cheapest on Runway; quality unknown |
| Low | `gen4_image_turbo` | text_to_image | 2 cr, $0.02 | 1-3 tagged refs required; seed | Seeded drafts from existing refs |

### 4.2 Turnaround views (front, three-quarter, side, back)

| Tier | Model | Endpoint | Price | Takes | Why |
|---|---|---|---|---|---|
| Best | `gemini_image3_pro` ✓ | text_to_image | 20 cr (2K), 4 views in one call with `outputCount: 4` = 80 | front as `human` ref | Proven identity hold; but the 4 outputs share one prompt, so one call per view (R13) |
| Best | `gpt_image_2_5_sunburst` | text_to_image | 17 cr (high + 1 ref) | front as a tagged ref; up to 10 outputs | High fidelity; a sheet in one image is possible |
| Mid | `nano_banana_2.1` | text_to_image | 6 cr (2K) | tagged front | Cheap per view |
| Mid | `bria_fibo_edit_1_5` | text_to_image | undocumented | front as image to edit; seed | Keeps framing and reproduces with a seed: steady sheets (untested) |
| Low | `gemini_image3.1_flash` | text_to_image | 7 cr (1K) | `human` ref | Cheap, proven |
| Low | `grok_imagine_image_2` | text_to_image | 5 cr (low 1K + 1 ref) | ≤ 3 refs, `edit` | Cheap and fast; untested on identity |

### 4.3 Storyboard frame

| Tier | Model | Endpoint | Price | Takes | Why |
|---|---|---|---|---|---|
| Best | `gemini_image3_pro` ✓ | text_to_image | 20 cr (2K), 40 (4K hero) | 4 views + props as refs | Best consistency with character views |
| Best | `gpt_image_2_5_sunburst` ✓ | text_to_image | 16-28 cr + refs | 16 refs | Frames with text or signage |
| Mid | `nano_banana_2.1` ✓ | text_to_image | 6 cr (2K) | 14 refs | The value pick (PT13) |
| Mid | `ideogram_4_5` | text_to_image | 8 cr (medium, with refs) | 5 refs, no tags | Typography and layout |
| Low | `nano_banana_2.1` | text_to_image | 4 cr (1K) | 14 refs | Cheap first pass |
| Low | `seedream5_lite` | text_to_image | 4 cr | 14 refs by order | Cheap fusion of many refs |

### 4.4 Frame edit and region edit

| Tier | Model | Endpoint | Price | Takes | Why |
|---|---|---|---|---|---|
| Best | `ideogram_4_5` + `maskUri` ✓ | text_to_image | 25 cr (high) | image + mask + ≤ 3 refs | The only real mask; face left untouched (PT13); resize before paste-back |
| Best | `gemini_image3_pro` + box workaround ✓ | text_to_image | 20 cr | clean frame + boxed copy | Our current path; best render quality, softer boundary |
| Mid | `ideogram_4_5` + `maskUri` ✓ | text_to_image | 8 cr (medium) | as above | The tested setting |
| Mid | `bria_fibo_edit_1_5` | text_to_image | undocumented | 1-4 images + instruction; seed | Keeps framing; reproducible (untested) |
| Mid | `ideogram_4_5` + `preciseEdit` | text_to_image | 25 cr (high is its default) | the image | Whole-image directed edit that keeps composition and size |
| Low | `grok_imagine_image_2` `edit: true` | text_to_image | 5 cr (low 1K + 1 ref) | one ref | Direct edit, cheap |
| Low | `nano_banana_2.1` | text_to_image | 4 cr (1K) | frame as ref + instruction | Cheap "same image, change X"; may drift |

### 4.5 Clip from a frame (first frame, optionally last)

| Tier | Model | Endpoint | Price per second (6 s) | Takes | Why |
|---|---|---|---|---|---|
| Best | `veo3.1` ✓ | image_to_video | 40 cr, $0.40 with audio (240); 20 silent | first + last; 4/6/8 s | Best documented dialogue and picture |
| Best | `kling3.0_pro` | image_to_video | 17 cr, $0.17 with audio (102); 12 silent | first + last; 3-15 s; `multiPrompt` | 1080p and up to 15 s at under half of Veo (untested) |
| Best (4K) | `kling3.0_4k` / `gen4.5` | image_to_video | 43 / 12 (+20 HDR) | first (+ last on Kling) | Native 4K; or Gen-4.5's HDR and ProRes for grading |
| Mid | `veo3.1_fast` ✓ | image_to_video | 15 with audio (90); 10 silent | first + last | Tested, in sync, quick (54 s) |
| Mid | `kling3.0_standard` | image_to_video | 13 with audio (78); 9 silent | first + last; 3-15 s | Cheaper than Veo Fast, longer (untested) |
| Mid | `wan3` ✓ | image_to_video | 10 (720p) (60) | first + last; 2-30 s | Long takes; audio on or off at one price |
| Low | `h3_max` ✓ | image_to_video | 8 (768p) (48) | first + last; 5-15 s | 15 s latency, good native dialogue (PT13) |
| Low | `gen4_turbo` ✓ | image_to_video | 5 (30) | first only; silent | Cheapest proven silent clip |
| Low | `grok_imagine_1_5_lite` | image_to_video | 3 + 1 (720p) (19) | first only | Cheapest clip on Runway; untested |

### 4.6 Clip with character references

| Tier | Model | Endpoint | Price (6 s) | Takes | Why |
|---|---|---|---|---|---|
| Best | `klingO3_pro` | image_to_video | 17/s (102) | **first frame + refs, ≤ 7 in total**; 1080p | The only documented frame + refs mix; photoreal untested (Q1) |
| Best | `klingO3_4k` | image_to_video | 43/s (258) | as Pro, 4K | Same, at 4K |
| Best (stylised only) | `seedance2_5` | image_to_video | 68/s at 1080p (408); draft at 20/s first | ≤ 30 refs (no pinned frame) | The most refs and best stylised lip sync; blocks photoreal |
| Mid | `klingO3_standard` | image_to_video | 13/s (78) | frame + refs, 720p | Frame + refs at Veo Fast's price |
| Mid | `wan3` ✓ | image_to_video | 10/s (60) at 720p | ≤ 10 refs (frame as a ref), audio refs | The only route **proven** on photoreal |
| Mid | `hailuo3` | image_to_video | 10/s + 2/ref (64 with 2 refs) at 768p | ≤ 9 refs, audio refs | Another photoreal candidate (untested) |
| Low | `wan3` | image_to_video | 5/s (30) at 480p | as above | Cheapest proven |
| Low | `grok_imagine_1_5` | text_to_video | 10/s + 1/ref (63 with 3 refs) at 480p | ≤ 7 `[Image n]` refs; no frame | Cheap and fast; refs named in the prompt |
| Low | `gemini_omni_flash_1.1` | text_to_video | 3.4/s + 1/ref (≈ 25) at 360p | ≤ 5 refs | Cheapest ref-capable preview |
| Low (stylised) | `seedance2_mini` | image_to_video | 16/s, 64 minimum (96) | ≤ 9 refs | Cheapest Seedance; stylised only |

### 4.7 Multi-shot and one-take

| Tier | Model | Endpoint | Price | Takes | Why |
|---|---|---|---|---|---|
| Best | `klingO3_pro` + `multiPrompt` | image_to_video | 17/s (15 s = 255) | first frame + refs + ≤ 6 segments (no last frame) | Several shots with a held character in one call (untested) |
| Best | `seedance2_5` one take | image_to_video | 68/s at 1080p (30 s = 2,040) | keyframes or 30 refs; 4-30 s | Longest single take at 1080p; stylised only |
| Mid | `multi_shot_video` recipe | recipes | 17/s at 1080p, 13/s at 720p (10 s = 170 / 130) | story or 3-5 shots; optional first frame | Runway's own shot planning |
| Mid | `kling3.0_standard` + `multiPrompt` | image_to_video | 13/s with audio | first frame + segments | Cheaper multi-shot without refs |
| Mid | `wan3` one take | image_to_video | 10/s at 720p (30 s = 300) | first + last or refs; 2-30 s | Long one-takes, photoreal-proven |
| Low | `wan3` | image_to_video | 5/s at 480p | as above | Cheapest 30 s take |
| Low | `h3_max` | image_to_video | 8/s (15 s = 120) | first + last; 5-15 s | Fast, cheap 15 s take |

### 4.8 Clip edit

| Tier | Model | Endpoint | Price | Takes | Why |
|---|---|---|---|---|---|
| Best | `aleph2` ✓ | video_to_video | 28/s, 56 minimum (6 s = 168) | ≤ 30 s clip; 5 timed keyframes; outpaint | Proven; keeps audio exactly; ProRes and 10-bit |
| Best | `klingO3_pro` | video_to_video | 17 per input second (102) | ≤ 10 s clip; ≤ 4 refs; keeps sound | Edits with character or prop refs (untested) |
| Mid | `klingO3_standard` | video_to_video | 13 per input second (78) | as above, 720p | Cheaper ref-guided edit |
| Mid | `gemini_omni_flash_1.1` `edit` | video_to_video | 15/s + 1/s + refs at 1080p (≈ 96) | ≤ 10 s; ≤ 5 refs | Cheap at 1080p; its audio handling in edit mode is untested |
| Low | `gemini_omni_flash_1.1` `edit` | video_to_video | 10/s + 1/s at 720p (≈ 66) | as above | |
| Low | `gemini_omni_flash` (v1) | video_to_video | 11 per input second + 1/ref (≈ 67) | ≤ 10 s; ≤ 5 refs; 720p | Plain instruction edit |
| (stylised) | `seedance2_5` `edit` | video_to_video | output + input rates; 80 minimum | 30 refs | Not for photoreal people |

### 4.9 Extend

Fewer than six models do this on our key: **two native extenders**, plus last-frame chaining.

| Tier | Model | Endpoint | Price | Takes | Why |
|---|---|---|---|---|---|
| Best | `seedance2_5` `extend` | video_to_video | output rate + input-second rate; 80 minimum (720p: +6 s on a 6 s clip ≈ 270) | the clip + prompt | Up to 30 s; stylised only |
| Best/Mid | `gemini_omni_flash_1.1` `extend` ✓ | video_to_video | 10/s added + 1 per input second at 720p (PT13: 106) | clip ≤ 30 s | Works on photoreal; **remakes all the audio** |
| Mid | chain: the clip's last frame → `veo3.1_fast` or `kling3.0_standard` | image_to_video | 15 / 13 per second | last frame as first frame | Keeps audio separate per clip; a visible seam is possible |
| Low | chain → `h3_max` or `wan3` 480p | image_to_video | 8 / 5 per second | as above | Cheapest continuation |

### 4.10 Upscale an image

Fewer than six: **one** upscaler. The rest regenerate at a higher size.

| Tier | Model | Endpoint | Price | Takes | Why |
|---|---|---|---|---|---|
| Best | `magnific_precision_upscaler_v2` | image_upscale | 25 cr; 150 above 4,096 px | image, 2-16× | The only true upscaler |
| Best | `gemini_image3_pro` at 4K | text_to_image | 40 cr | the frame as ref | Re-render at 4K (may drift) |
| Mid | `nano_banana_2.1` at 4K | text_to_image | 12 cr | the frame as ref | Cheap 4K re-render |
| Low | `gpt_image_2_5_flare` medium 4K | text_to_image | 11 + 1 cr | ref | Cheap 4K re-render |

### 4.11 Upscale a video

Fewer than six: **one** upscaler; the alternatives generate natively at a higher size.

| Tier | Model | Endpoint | Price | Takes | Why |
|---|---|---|---|---|---|
| Best | `magnific_video_upscaler_creative` 4k | video_upscale | $0.012/frame = 28.8 cr/s at 24 fps | clip ≤ 30 s | The only video upscaler |
| Best | `kling3.0_4k` / `klingO3_4k` | image_to_video | 43/s | as in 4.5/4.6 | Native 4K instead of upscaling |
| Mid | `magnific_video_upscaler_creative` 2k | video_upscale | 21.6 cr/s at 24 fps | | |
| Mid | `seedance2_5` draft → 1080p | text_to_video | 20/s preview, then 68/s | `draftTaskId` | Pay for 1080p only on the keeper (stylised) |
| Low | `gemini_omni_flash_1.1` at 4K | image_to_video | 30/s + 1 | first + last | Cheapest native 4K |
| Also | `ruby` | video_to_hdr | 20/s | SDR clip | HDR finishing, not resolution |

### 4.12 Frame rate

Fewer than six: **two**.

| Tier | Model | Endpoint | Price | Why |
|---|---|---|---|---|
| Best/Low | `enhance_frame_rate` | video_upscale | 0.5 cr/s | Any target 24-120 fps incl. 23.976/29.97/59.94; ≤ 300 s |
| Mid | `magnific_video_upscaler_creative` `fpsBoost` | video_upscale | per output frame | Only alongside an upscale; frame count (and cost) may rise |

### 4.13 Voice and VO

| Tier | Model | Endpoint | Price | Takes | Why |
|---|---|---|---|---|---|
| Best | `eleven_v3` ✓ | text_to_speech | 20 cr per 1,000 chars | ≤ 5,000 chars, tags, presets | Most expressive delivery |
| Best | native dialogue in `veo3.1` ✓ | image_to_video | 40/s (the clip) | the line in the prompt | Lips right by construction (Path 1) |
| Mid | `eleven_v4` ✓ | text_to_speech | 5 per 1,000 chars | ≤ 2,500 chars; context; seed | Cheapest quality TTS, continuity between lines |
| Mid | `seed_audio` voice clone | text_to_speech | 0.25/s, 5 minimum | a reference clip of the voice | Our own character voice on Runway (untested) |
| Mid | `eleven_multilingual_sts_v2` ✓ | speech_to_speech | 1 per 3 s | audio or video | Re-voice native dialogue, timing kept |
| Low | `eleven_v4` | text_to_speech | ~1 cr a line | presets | |
| Low | `seed_audio` | text_to_speech | 5 cr minimum (20 s) | default voice | |

Runway has no route to use a designed or cloned ElevenLabs voice in TTS: `/v1/voices` voices serve
avatars only.

### 4.14 Sound effects

Fewer than six dedicated models: **two**, plus native audio.

| Tier | Model | Endpoint | Price | Takes | Why |
|---|---|---|---|---|---|
| Best | `eleven_text_to_sound_v2` ✓ | sound_effect | 1/s with a duration (6 s = 6) | ≤ 3,000 chars; 0.5-30 s; `loop` | Tested; loops for ambience |
| Best | native audio (`veo3.1`, `kling3.0_pro`) | image_to_video | the clip's audio premium (Veo +20/s, Kling +5/s) | the prompt | Sync with picture for free |
| Mid | `seed_audio` | sound_effect | 0.25/s, 5 minimum | scene prompt, 3 ref sounds | Long beds (≤ 120 s), cheap |
| Low | `eleven_text_to_sound_v2` without duration | sound_effect | 2 cr | | Cheapest one-shot |

### 4.15 Music

Fewer than six: **no music model on the key**.

| Tier | Model | Endpoint | Price | Why |
|---|---|---|---|---|
| Only | `seed_audio` ✓ | sound_effect | 0.25/s, 5 minimum | Short music beds from short prompts (PT13; a long prompt failed) |
| Workaround | native audio of a clip model | | | No model documents music |

Real music needs a provider outside Runway (ElevenLabs `music_v2_5`, AMP §2), which the
Runway-only rule (2026-10-13) rules out for now.

### 4.16 Lip sync and avatars

| Tier | Model | Endpoint | Price (6 s) | Takes | Why |
|---|---|---|---|---|---|
| Best | native dialogue, `veo3.1` ✓ | image_to_video | 240 | frame + the line | Best sync measured (0.35 at 0 ms) |
| Best | `wan3` + `referenceAudio` ✓ | image_to_video | 60 (720p) | frame as ref + our VO | Our exact VO on a photoreal character |
| Mid | `gwm1_avatars` ✓ | avatars + avatar_videos | ~2-4 | one image + our audio | Talking heads, nearly free |
| Mid | `h3_max` native ✓ | image_to_video | 48 | frame + the line | Cheap, fast Path 1 |
| Mid | `hailuo3` / `grok_imagine_1_5` + audio refs | t2v/i2v | 64 / 98 (768p / 720p) | refs + our VO | Audio-driven performance (untested) |
| Low | `act_two` | character_performance | 30 | character image + an actor's video | Accurate if someone performs the line |
| Low | `product_ugc` recipe | recipes | 192 + 36/s | creator image + script | Presenter-to-camera ads (photoreal untested) |

There is still no lip sync for arbitrary existing footage on Runway.

### 4.17 Dubbing and localisation

Fewer than six: **three** dedicated tools.

| Tier | Model | Endpoint | Price | Why |
|---|---|---|---|---|
| Best | `eleven_voice_dubbing` | voice_dubbing | 0.5 cr/s (30 s = 15) | 29 languages; keeps the speaker's voice; audio only |
| Best | re-lip-sync: dubbed audio → `wan3` `referenceAudio` | image_to_video | 10/s | New picture whose lips match the new language |
| Mid | `eleven_v3` with `languageCode` | text_to_speech | 20 per 1,000 chars | A fresh read in the target language (preset voice) |
| Mid | `ad_localization` | recipes | 21 per image | Localises text in stills and end cards |
| Low | `seed_audio` with a reference voice | text_to_speech | 0.25/s | The character's voice in another language (untested) |

### 4.18 Product shots (stills)

| Tier | Model | Endpoint | Price | Takes | Why |
|---|---|---|---|---|---|
| Best | `product_campaign_image` | recipes | 144 per call (4 × 36) | one product image + brief | Runway's tuned product workflow |
| Best | `gpt_image_2_5_sunburst` | text_to_image | 16 + 1/ref (high) | 16 refs; transparent PNG | Packshots and cut-outs, accurate labels |
| Mid | `gemini_image3_pro` | text_to_image | 20 | ≤ 9 `object` refs | High-fidelity object slots |
| Mid | `marketing_stock_image` | recipes | 8 + 1-20 per image | brief + logo | On-brand lifestyle images |
| Low | `nano_banana_2.1` | text_to_image | 4-6 | 14 refs | |
| Low | `bria_fibo_1_5` | text_to_image | 5 (1 MP) | 1 ref; seed | Reproducible; possibly licensed-data (unverified) |

### 4.19 Product ads (video)

| Tier | Model | Endpoint | Price (10 s) | Takes | Why |
|---|---|---|---|---|---|
| Best | `product_ad` recipe | recipes | 456 (1080p) | 1-10 product angles, 4 style images, concept | Whole storyboard-to-video workflow |
| Best | `klingO3_pro` | image_to_video | 170 | storyboard frame + product refs | Our shot plan, product held by refs |
| Mid | `seedance2_5` | image_to_video | 300 (720p) | ≤ 30 product refs | Fine when no photoreal person is in shot |
| Mid | `product_swap` recipe | recipes | 428 (720p) | existing video + new product | Re-use a shot with another product |
| Low | `veo3.1_fast` from a product frame | image_to_video | 100 with audio (8 s = 120) | frame | Cheap, proven model |
| Low | `wan3` 480p | image_to_video | 50 | refs or frame | Cheapest product motion |

## 5. Open questions that only a paid test can answer

Ordered by value. Costs are the cheapest test that settles the question, in credits, from PRICE.
Check `GET /v1/organization` and `POST /v1/organization/usage` first: they are free.

| # | Question | Cheapest test | Credits |
|---|---|---|---|
| Q1 | **Does Kling O3 accept a photoreal first frame plus photoreal character refs, and hold the identity?** | `klingO3_standard` i2v, 3 s, our photoreal frame as `first` + 2 character views as refs | 39 |
| Q2 | Does Kling O3 keep the frame's composition while honouring refs (or does one override the other)? | Same call; compare against the frame | (Q1) |
| Q3 | How good is Kling 3.0 / O3 native dialogue and lip sync against Veo (PT13 metric)? | `kling3.0_standard` i2v 3 s with the line, audio on | 39 |
| Q4 | Does `multiPrompt` with a first frame and refs keep the character across segments? | `klingO3_standard` 6 s, 2 segments, frame + 2 refs | 78 |
| Q5 | Do Hailuo 3 refs pass on photoreal faces, and does it output sound? | `hailuo3` t2v 5 s at 768p with 2 refs | 54 |
| Q6 | Do Grok 1.5 image refs pass on photoreal, and does an audio ref lip-sync our VO? | `grok_imagine_1_5` t2v 480p, 3 s, 1 image ref + 1 VO ref (≥ 3 s) | 32 |
| Q7 | Do Omni Flash 1.1 t2v refs hold a photoreal character? | `gemini_omni_flash_1.1` t2v 360p 3 s with 2 refs | 13 |
| Q8 | Does WAN 3 in reference mode hold identity across a 2nd and 3rd shot? | `wan3` 480p 2 s × 2 with the same refs | 20 |
| Q9 | Does Seed Audio's `reference-audio` voice clone sound like the character (and keep it across lines)? | `seed_audio` TTS, 2 lines with one reference clip | 10 |
| Q10 | Does Kling O3 v2v keep the original audio (`keepOriginalSound`), and how well do refs steer an edit? | `klingO3_standard` v2v on a 3 s clip with 1 ref | 39 |
| Q11 | What does `bria_fibo_edit_1_5` cost, and does it keep the frame on an edit? | One edit with 1 ref | ~5-10 (undocumented) |
| Q12 | `seedream5_flash`: what schema and price? | Ask Runway; a call without a schema risks a billed failure | 0 (ask) |
| Q13 | What are `voice_processing` and `gwm1_avatar_async_*`, and how are they billed? | Read `/v1/organization/usage` after an avatar video, or ask Runway | 0 |
| Q14 | Are moderated jobs billed? Docs say yes (MOD); PT13 saw Seedance refusals refunded to 0 | `POST /v1/organization/usage` for 2026-10-13 | 0 |
| Q15 | Does `multi_shot_video` keep a first frame's character across its shots, and which model runs it? | `multi_shot_video` custom, 5 s at 720p, 3 shots + `firstFrame` | 65 |
| Q16 | Does `product_ugc` accept a photoreal creator image? | `product_ugc` 4 s at 720p | 192 |
| Q17 | Does `nano_banana_2.1` honour `@tag` (and Gemini, the open R13 question)? | 2 × `nano_banana_2.1` 1K, with and without tags | 8 |
| Q18 | Is `eleven_v4` really capped at 2,500 chars (OAS has no maximum)? | One 2,600-char request (a refusal may be free) | ≤ 13 |
| Q19 | Does `gemini_omni_flash` v1 make sound (CL says so; OAS has no flag)? | t2v 3 s | 30 |
| Q20 | Does Act-Two return the reference's audio? | `act_two` with a 3 s reference | 15 |
| Q21 | Latency and concurrency for every new model (Kling, Hailuo, Grok): undocumented | Time the jobs above; read the org limits | 0 extra |

**A first batch of Q1, Q3, Q5, Q6, Q7 and Q9 costs about 187 credits ($1.87)** and settles whether
photoreal characters can be held in video on Runway.
