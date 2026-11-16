# Production Tool: pathway tests (2026-10-13)

Live tests of the image models, the video models and the three audio paths, run on one storyboard
frame and one line of dialogue: *"Rain or shine, the night bus always gets you home."* They
measure what the research in [model-research-2026-10-13.md](model-research-2026-10-13.md) could
only cite.

- **Where the outputs are:** `production-tool/relay/results/outputs/pathways-2026-10-13/`
  (git-ignored). Open its `index.html` to watch and listen to everything.
- **The job log:** `log.jsonl` in the same folder: one line per call, with model, latency, queue
  time, credits, failure and files.
- **Spend:** 1,274 Runway credits ($12.74). ElevenLabs direct cost nothing so far: only voice
  design ran (see 5).
- **How it ran:** scripts in the session scratchpad call Runway directly. They don't go through
  the relay, because the relay forces `audio: false` and has no audio, reference-audio or
  avatar ops.

## 1. Images (same prompt)

| Model | Size | Latency | Credits | Verdict |
|---|---|---|---|---|
| `gemini_image3.1_flash` (Nano Banana 2) | 1K | 20 s | 7 | Good; a wider framing |
| `gemini_image3.1_flash` | 2K | 26 s | 11 | Good |
| `gemini_image3_pro` (Nano Banana Pro) | 2K | 33 s | 20 | The best face and light; used as the frame for every clip |
| `nano_banana_2.1` | 2K | 33 s | **6** | Close to Pro for a third of the price. **It works on the API although it is missing from the OpenAPI spec.** |
| `gpt_image_2_5_sunburst` high | 1920×1088 | 39 s | 16 | Strong; it added a bus and pedestrians nobody asked for |
| `ideogram_4_5` **masked edit** (coat → yellow) | follows the input | 47 s | 8 | **Face and scene untouched, coat recoloured inside the mask.** It returned 2695×1536 instead of 2752×1536, so a paste-back step must resize. |

Every job queued about 7 s before running.

## 2. Path 1: the video model makes the audio (dialogue written into the prompt)

**Measures used here and in section 3:**
- *Line*: Whisper transcribes the clip; the figure is the share of the line's words it heard.
- *Lip sync*: how closely movement in the mouth area follows the loudness of the speech, from 0
  (none) to 1.
  - As a control, our voiceover laid over a silent clip scores **−0.05**.
  - "Best" is the delay at which the two line up most closely.

| Model | Credits (6 s) | Latency | Line | Lip sync at 0 ms (best) | Output |
|---|---|---|---|---|---|
| `veo3.1_fast`, audio on | 90 | 54 s | 100% | **0.35** (0 ms) | 1280×720, 24 fps, AAC 48 kHz |
| `veo3.1`, audio on | 240 | 188 s | 100% | **0.35** (0 ms) | as above |
| `h3_max` 768p | **48** | **15 s** | 100% | 0.33 (0.40 at +42 ms) | 1344×768, 24 fps, AAC 32 kHz, 6.6 s |
| `gemini_omni_flash_1.1` | 61 | 162 s | 100% | 0.35 (0.42 at −208 ms) | 720p, 24 fps |
| `wan3` 720p | 60 | 137 s | 100% | 0.27 (0.30 at −33 ms) | 1284×716, **30 fps**, AAC 44.1 kHz |
| `seedance2_5`, stylised frame | 180 | 168 s | 100% | **0.53** (0.56 at −42 ms) | 720p |
| `seedance2_5` / `seedance2_mini`, photoreal frame | 0 | | | **Blocked by moderation** | |

Every model spoke the exact line from the prompt alone. Identity held against the frame in every
clip (contact sheets `contact_clips1.jpg` and `contact_clips2.jpg`).

**Seedance refuses photoreal human faces.** It blocked the frame whether it was sent as the first
frame or as a reference, on both 2.5 and Mini, and refunded the jobs (0 credits). The same scene
redrawn in a stylised 3D look passed and gave the best lip sync of any model.

### Extras on top of native audio

| Step | Result |
|---|---|
| Voice isolation (Runway `eleven_voice_isolation`) | 10 s, 2 credits. Clean voice, line 100%, same timing (0.86-4.92 s). |
| Re-voice to another voice (Runway `eleven_multilingual_sts_v2`, sent **the video**) | 14 s, 2 credits. Returns **the mp4 with the new voice**. **The timing is identical** (0.90-4.92 s) and lip sync stays 0.34. Whisper misheard one word ("debt to" for "gets you"), so listen before trusting it. |
| Edit with `aleph2` (heavier rain) | 245 s, 168 credits, 1920×1080. **It keeps the original audio exactly** (waveform correlation 1.000), so a visual change, such as heavier rain, needs the sound layers updated too. |
| Extend with `gemini_omni_flash_1.1` (`mode: extend`, no `ratio`) | 97 s, 106 credits, 16 s. **It makes all of the audio again, including the original 6 s** (correlation 0.003), so voice and timing can drift. |
| Layered mix (ffmpeg): native voice + rain + bus + music ducked under the voice, normalised to −14 LUFS | `m1_path1_veofast_layers.mp4`: −14.4 LUFS, true peak −1.5 dB |

## 3. Path 2: silent video, the soundtrack in layers

| Clip | Credits | Latency | Audio track |
|---|---|---|---|
| `gen4_turbo` | 30 | 27 s | none |
| `gen4.5` | 72 | 214 s | none |
| `wan3` with `audio: false` | 60 | 142 s | none, at the same price as with audio |
| `seedance2_mini` with `audio: false` | 0 | | blocked (photoreal face) |

| Layer (through Runway's ElevenLabs) | Credits | Latency |
|---|---|---|
| VO `eleven_v4`, preset voice | 1 | 7 s |
| VO `eleven_v3`, preset voice | 2 | 12 s |
| SFX rain loop, 6 s | 6 | 7 s |
| SFX bus arrives, 4 s | 4 | 8 s |
| Music `seed_audio` (a long prompt failed; a short one worked) | 5 | 20 s |

The mix `m2_path2_gen45_vo_layers.mp4` (VO off camera at 1.2 s, rain, bus at 2.5 s, music
ducked) came out at −23.2 LUFS, the TV broadcast target.

### The extreme case: lip sync to our own voiceover

| Route | Result |
|---|---|
| `referenceAudio` together with a first frame | **Refused** by Runway on Seedance and WAN: "Audio references cannot be combined with keyframe images". The frame has to be sent as an unpositioned reference instead. |
| **WAN 3, frame as a reference + our VO** | 168 s, 60 credits. **It uses our exact VO** (the loudness envelope matches at 1.17, against about 0.35 for clips that made up their own voice), shifted to start at 1.8 s. The mouth follows it (0.21 at 0 ms, 0.36 at +200 ms). **It also kept our frame's composition.** |
| Seedance 2.5, frame as a reference + our VO | Blocked (photoreal face) |
| **Runway avatar** (`/v1/avatars` from the frame, then `/v1/avatar_videos` with our VO) | 14 s, **2 credits**. Speaks our VO word for word. Talking-head crop, 1088×704. Lip sync 0.23 (0.27 at −292 ms): look at it before relying on it. |
| ElevenLabs `creatify-aurora` (`/v1/flows/video`, one image + audio) | Not run: the key lacks `text_to_speech`, so there was no designed-voice VO to send. |

## 4. Path 3: Napkin Radio

Our VO, two SFX and the music were sent as separate tracks to `/api/radio/timeline` (4 assets,
0.49 MB):
- **The timeline rendered in 4.1 s.**
- **`/api/radio/export` returned a 48 kHz, 16-bit stereo WAV in 3.5 s**, with its report:
  - before: −18.07 LUFS, −2.4 dBTP; after: −18.01 LUFS, −2.33 dBTP;
  - checks: loudness ✓, true peak ✓, **duration ✗**;
  - "Station acceptance: Not verified".
- **The duration check failed for a real reason.** Radio renders to the longest file (16.5 s of
  music) and never trims, so layers must be cut to the picture before they reach it.
- **No ElevenLabs credits are used.** These two endpoints only mix and measure; its broken
  ElevenLabs key doesn't matter for them.

## 5. ElevenLabs direct (key `ELEVELLABS_API_KEY`)

| Call | Result |
|---|---|
| Voice design + save (`/v1/text-to-voice/design`, `/v1/text-to-voice`) | **Worked**: voice `10XD5HLvd46RypcDCsed`, "warm Irish woman, mid thirties" |
| TTS with timestamps, speech to speech, forced alignment, sound effects, music (`/v1/music/video-to-music`) | **401: the key lacks the permissions** `text_to_speech`, `speech_to_speech`, `forced_alignment`, `sound_generation`, `music_generation` (and `user_read`) |

Two endpoints found in ElevenLabs' OpenAPI that matter for keeping sound and picture together:
- **`/v1/music/video-to-music`** takes up to 10 videos and writes music from them, with a
  description, up to 10 tags and `music_v2_5`.
- **`/v1/flows/video`** runs `creatify-aurora` (one image + audio → lip-synced video, 480p/720p,
  `audio_guidance_scale`), plus Veo 3.1 and Seedance 2.x. Their Seedance takes up to 10 reference
  `audios` "e.g. for lipsync".

## 6. What the tests settle

1. **Path 1 works across models.** Native dialogue is correct and in sync on Veo 3.1 / Fast,
   H3 Max, Omni 1.1 and WAN 3. **H3 Max is the surprise: 15 s and 48 credits for 6 s.**
2. **A consistent character voice keeps the lip sync.** Speech-to-speech re-voicing preserves the
   timing to the hundredth of a second.
3. **Path 2 lip sync to our own VO is possible on Runway today:** WAN 3 in reference mode (frame +
   VO), or an avatar for talking-head shots. Seedance can do it only for non-photoreal characters.
4. **Edits:** Aleph keeps audio untouched, while Omni's extend rewrites it. The mix has to know
   which.
5. **Napkin Radio's timeline and export work on our layers in seconds.** Its manifest and loudness
   report are a ready contract for the final mix stage.
6. **Not yet tested:** ElevenLabs direct TTS, SFX, video-to-music, alignment and Aurora (waiting
   on key permissions). Sync Labs is not tested either.
