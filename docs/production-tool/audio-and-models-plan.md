# Production Tool: better models and sound, the plan (2026-10-13)

This draws on four documents:
- [model-research-2026-10-13.md](model-research-2026-10-13.md): what the providers offer.
- [pathway-tests-2026-10-13.md](pathway-tests-2026-10-13.md): live tests of each path.
- [hackathon-remakes-2026-10-13.md](hackathon-remakes-2026-10-13.md): three hackathon ads remade
  and graded.
- A read of the harness (`production-tool/relay`, `contracts`, `stitch`, `web`).

It is a proposal. Each item becomes a feature record (`scripts/feature new`), with its design
approved before any code.

## 1. Which path is best

**Not one path per ad: a path per shot, on one shared audio system.**

| Shot | Path | Why (tested) |
|---|---|---|
| Someone speaks on camera | **Path 1**: a native-audio model speaks the line; ElevenLabs re-voices it into the character's voice if needed | The only route with reliable lip sync. Veo 3.1 / Fast and H3 Max scored 0.33-0.40 at under 42 ms. Re-voicing kept the timing exactly. Best picture in the remakes. |
| No speech on camera (action, product, b-roll, voiceover) | **Path 2**: a silent or cheap model, plus ElevenLabs layers | Cheaper, and every layer can be redone on its own. Picture-timed effects (R5) make it match. |
| The ad as radio, or the final loudness pass | **Path 3**: Napkin Radio's timeline and export model | Took our stems unchanged in 2-5 s, with a delivery report. It needs fixes before production use: a loudness overshoot, booked lengths, and no auth. |

All three share one data model (layers and a cue sheet), one mixer (the stitch Lambda) and the
coherence rules **R1-R5**:

| Rule | What it does |
|---|---|
| R1 | Dialogue sets the shot length |
| R2 | Every on-screen line is lip-synced |
| R3 | One voice at a time |
| R4 | Speech comes first |
| R5 | Impacts land on the frame of biggest motion |

The rules held across the three remade ads: lines heard went from 0.06-0.43 to 0.73-1.00, with
zero voice overlap.

## 2. Models to use (tested where marked ✓)

| Step | Low | Medium | High |
|---|---|---|---|
| Character, views and frames | `nano_banana_2.1` 1K, 4 cr ✓ | `nano_banana_2.1` 2K, 6 cr ✓ | `gemini_image3_pro` 2K, 20 cr ✓; `gpt_image_2_5_sunburst` high, 16 cr ✓ for frames with text |
| Region edit | Pro + the box workaround (today) | **`ideogram_4_5` with `maskUri`**, 8 cr ✓: face untouched; returns a slightly different size, so resize before pasting back | Pro or Ideogram high, after a face benchmark |
| Clip with native audio (Path 1) | `h3_max` 768p, 8 cr/s ✓ (15 s per clip) | `veo3.1_fast`, 15 cr/s ✓ | `veo3.1`, 40 cr/s ✓; `seedance2_5` for **stylised** characters only ✓ (best sync; blocks photoreal faces) |
| Silent clip (Path 2) | `gen4_turbo`, 5 cr/s ✓ | `gen4.5`, 12 cr/s ✓ or `wan3` with audio off, 10 cr/s ✓ | `veo3.1` with audio off, 20 cr/s |
| Lip sync onto a silent shot | n/a | `wan3` with `referenceAudio` and the frame as an unpositioned reference, 10 cr/s ✓ (continuity drifts) | Runway avatar for talking heads, 2 cr ✓; ElevenLabs `creatify-aurora` (key permissions); a Sync Labs adapter (not tested) |
| Clip edit / extend | `aleph2` (keeps audio) ✓ | | `gemini_omni_flash_1.1` extend (remakes the audio) ✓ |
| VO / dialogue | `eleven_flash_v2_5` direct | `eleven_v4` ✓ (via Runway, presets) | `eleven_v3`/`v4` direct with a **designed voice per character** ✓ (voice design works) |
| Effects | `eleven_text_to_sound_v2` ✓ | the same, with `prompt_influence` direct | the same, timed by R5 |
| Music | `seed_audio` via Runway ✓ (short prompts only) | `music_v2_5` direct | **`/v1/music/video-to-music`** (music written from the cut), then inpaint sections |

**Every clip model needs a fallback on moderation, per shot:**
- Veo refused a child-and-shadow frame and H3 Max took it.
- Seedance refuses photoreal faces.
- Refusals were free, so retry on the next model automatically.

## 3. Path 1: native audio

1. `video_audio()` returns the job's flag. `director.schema.json` `audio` becomes a boolean.
   Price `clip` by the audio flag.
2. Add the native-audio models as `clip` alternates:
   - `h3_max` takes `resolution` (not `ratio`), runs 5-15 s and has no audio switch.
   - Seedance takes a duration range, no `negativePrompt`, and should be avoided for photoreal
     faces.
   - Fix the adapter so it judges each alternate on its own sheet (`effective_sheet`).
3. The director writes the line into the clip prompt **only for audio-on models and on-screen
   lines**. This reverses the 2026-10-07 dialogue-strip decision for this case; record it and add
   an eval case for caption boxes.
4. R1 in the director: a dialogue shot is at least as long as the line (2.6 words a second, as
   Radio's scorer uses). After generation, check the speech end with alignment or Whisper.
5. Stitch keeps clip audio (drop `-an` / `a=0`), extracts it as the `native` layer, and pads silent
   clips with `anullsrc`.
6. Extras: re-voice into the character's `voice_id` (ElevenLabs speech-to-speech); music ducked
   under speech; picture-timed effects.

## 4. Path 2: silent picture, sound in layers

1. **Data:** additive keys in `document.schema.json`:
   - `voices[]`, `audio_lines[]`, `audio_cues[]`, `music_plan`, `audio_takes[]` and `mix`;
   - an `audio` asset kind, and audio mimes in `assetRef`.

   Each layer keeps its takes; the mix is always rebuilt.
2. **ElevenLabs provider:** `providers/elevenlabs.py` plus `capabilities/elevenlabs.json`, with ops
   `vo`, `dialogue`, `sfx`, `music`, `isolate`, `revoice` and `align`. Direct, not through Runway:
   custom voices, timestamps, WAV, music and alignment. The calls are synchronous, so the adapter
   writes to S3 and returns a key, or long jobs (music) run on a Lambda with the stitch result-key
   pattern.
3. **Director `audio_plan` op:**
   - lines, with the speaker key and whether they are on screen;
   - cues (kind, brief, shot, impact or bed);
   - a music brief per scene;
   - the native mode for Path 1 shots.
4. **Picture first:** after the cut exists, compute motion per shot (as `assemble2.py` does) and
   place impact cues by R5. Music comes from `video-to-music` on the cut.
5. **Lip sync for on-screen lines (R2):**
   - first choice is a Path 1 shot;
   - else WAN `referenceAudio`;
   - else an avatar (talking heads);
   - later, a Sync Labs `lipsync` provider for any footage.
6. **Mix in stitch:** per-layer delay and gain, effects ducked −8 dB and music −12 dB under speech,
   loudnorm to the deliverable (TV −23, online −14), then mux. Every layer stays editable: redo one
   line, cue or music section without touching the rest.

## 5. Path 3: Napkin Radio

1. **Now:** adopt Radio's manifest `{assets, clips{track, startSec, durationSec}}` as the import and
   export shape of our cue sheet. Our model is richer (fades, gain, duck); the manifest is the
   common subset.
2. **Next:** port the loudness export (target LUFS, true peak, booked length, report) into the
   stitch step. That way our mix produces the same report without calling Vercel.
3. **Then:** a "radio cut" deliverable from the same brief, voices and stems, edited to a booked
   length (20 or 30 s), with Radio's station catalogue for delivery profiles.
4. **From Laurence:**
   - repo access (`larryob78/napkin-radio`);
   - a fix for the export's loudness overshoot (−21.3 in, −14.9 out, at target −18);
   - auth on the API;
   - a working ElevenLabs key (`/voices` returns 502);
   - a licence to reuse the parser, scorer and station data.
5. **Don't** call Radio's API from the relay in production: no auth, a ~4 MB body limit, and state
   that lives only in the browser.

## 6. Feature records, in order

| # | Slug | What | Depends on |
|---|---|---|---|
| 1 | `model-swap` | New alternates: `nano_banana_2.1`, `h3_max`, `wan3`, `gen4_turbo`, `ideogram_4_5` (region edit). Adapter judges each model on its own sheet; per-model ratio tables; per-shot moderation fallback; schema snapshots refreshed. | none |
| 2 | `audio-contracts` | Additive schema: layers, ops, `audio` kind and mimes, per-unit pricing in sheets, `audio` boolean. | none |
| 3 | `audio-native` (Path 1) | Audio flag and pricing, prompts for on-screen lines, R1, stitch keeps audio. | 2 |
| 4 | `audio-elevenlabs` | Provider, sheet, ops, S3 or Lambda results, `ELEVENLABS_API_KEY` secret (Terraform applied by a person). | 2 |
| 5 | `audio-mix` | Stitch mix: layers, R3-R5, ducking, loudnorm targets, report, end-card audio. | 2 |
| 6 | `audio-director` | `audio_plan` op and prompt; picture-first cue timing. | 2, 4 |
| 7 | `audio-music` | `video-to-music`, composition plans, section inpainting. | 4, 5 |
| 8 | `audio-ui` | Sound panel per shot, takes per layer, mute and gain, cost before running. | 3-6 |
| 9 | `lipsync` | WAN `referenceAudio` route, then Sync Labs. | 4, 5 |
| 10 | `radio-bridge` | Manifest import and export, loudness report parity, radio cut. | 5, Laurence |

**Fastest visible win:** 1 + 3 + 5 give Path 1 ads with sound and a proper mix. That needs no new
vendor key, and the remakes show it is the best-looking path.

## 7. Before building

- Give the ElevenLabs key the `text_to_speech`, `speech_to_speech`, `sound_generation`,
  `music_generation` and `forced_alignment` permissions. Its name in `.env` is
  `ELEVELLABS_API_KEY`; the code should read `ELEVENLABS_API_KEY`.
- Re-run the direct-ElevenLabs tests: designed-voice TTS with timestamps, video-to-music, Aurora,
  alignment.
- Pull the hackathon director shot lists from S3 (needs `aws sso login --profile napkin`) to remake
  with the real prompts.
- Listen to the remakes by ear; the audio grades here are machine-only.
