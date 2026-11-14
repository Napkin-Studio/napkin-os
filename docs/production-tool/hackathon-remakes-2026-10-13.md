# Hackathon ads remade: before and after (2026-10-13)

Three ads that the Production Tool made at the 9 Oct hackathon were remade with the new models
and the audio paths, then graded against the originals. The tests behind it are in
[pathway-tests-2026-10-13.md](pathway-tests-2026-10-13.md).

- **Outputs:** `production-tool/relay/results/outputs/hackathon-remakes-2026-10-13/` (git-ignored).
  Open `index.html` to watch them side by side.
- **Spend:** 1,778 Runway credits ($17.78).

## Method

- **Ads:** *Thor for Vorr* (stylised Viking, 7 shots, portrait), *Velto Baby* (3D animated,
  4 shots + a text pack shot, portrait) and *Team DL 2* (photoreal man and robot, 4 shots,
  landscape). All three are silent hackathon ads, unaltered.
- **The same storyboard frames.** Each shot's first frame was taken from the team's own ad. The
  hackathon projects in S3 were out of reach (expired AWS SSO login), so the shot actions,
  sounds and lines were written by watching the originals.
- **After, Path 1:**
  - **Model:** Veo 3.1 Fast with audio on. The prompts carry the action, the sounds and any line.
  - **Added layers:** a music bed ducked under the speech, and the tagline voiceover.
- **After, Path 2:**
  - **Picture:** Gen-4.5, silent, cut to the original shot lengths.
  - **Lines spoken on screen:** WAN 3 with the frame as a reference and our voiceover as
    `referenceAudio`, so the lips follow the voice.
  - **Sound layers:** effects per shot, music and the tagline. All sound comes through Runway's
    ElevenLabs (`eleven_v4` presets, `eleven_text_to_sound_v2`) and Seed Audio, because the
    ElevenLabs key lacked the permissions for direct calls.
- **After, Path 3:** the Path 2 stems sent through Napkin Radio's `/timeline` and `/export`
  (48 kHz, −18 LUFS, exact booked length).
- **The same 2.5 s end card** on every version.
- **What was graded:**
  - **By machine:** Whisper transcripts (how many words of each scripted line are heard), loudness
    (EBU R128), whether voices overlap, a mouth-movement sync score on lines spoken on screen,
    effect-to-picture correlation, and length.
  - **By eye:** contact sheets of each shot (`compare_<ad>.jpg`).
  - **Audio was not judged by ear.** Listen to the page before trusting the audio scores.

## Version 1 and the coherence problems it exposed

The first assembly (v1) placed every layer naively. Grading it found four ways sound and picture
went apart:

| Problem in v1 | Evidence |
|---|---|
| The tagline started 0.05 s after the last line, so two voices overlapped | Thor: lines heard **0.06-0.10**. Whisper heard "7th ти 4 bad humanity Meet speed". DL Path 1 put the tagline before the last line. |
| A shot trim cut off its own dialogue | Thor's last shot is 2.0 s; the line needs 3.0-3.4 s. |
| A character speaks on screen in Path 2 with no lip sync | The silent model, told he "speaks a short line", moved his mouth at random; DL Path 2 lines heard **0.43**. |
| A vocal effect masked a line | The "frustrated sigh" effect played under "Where do I even start?". |

## The coherence rules (v2)

These hold on every path. Each is a check a machine can run before an ad is shown.

| Rule | What it does | Check |
|---|---|---|
| **R1. Dialogue sets the shot length** | A shot with a line is at least as long as the speech (+0.25 s). The time comes from neighbouring action shots, never from the line. | Speech end, from transcription or alignment, ≤ the shot's end |
| **R2. Every line spoken on screen is lip-synced** | Path 1 uses the model's own speech. Path 2 uses a lip-sync route (WAN `referenceAudio`, an avatar, or a lip-sync provider). Otherwise the line becomes a voiceover over a shot where nobody is visibly talking. | Mouth-motion sync score above a threshold on every dialogue shot |
| **R3. One voice at a time** | Lines and the tagline are scheduled: the tagline goes after the last line and is sped up ≤ 15% to fit, else the plan is flagged. | Total voice overlap = 0 s |
| **R4. Speech comes first** | No vocal effects (sighs, laughs) on a line; effects duck 8 dB and music 12 dB under speech. | Lines-heard score ≥ 0.9 (proper nouns aside) |
| **R5. Impacts land on the picture** | An impact sound's loudest moment is moved to the frame with the most motion in its shot. Moved here: Thor's landing +1.13 s, the door +0.55 s, Velto's dial click −1.22 s, DL's high five −0.67 s. | Effect onsets correlate with picture motion |

Two more facts the mix stage must handle:
- **Aleph 2 edits keep the original audio**, so a visual edit (heavier rain) must update the
  effect layers.
- **Omni Flash's extend makes new audio for the whole clip**, so voice and timing can change.

## Grades

| Ad | Version | Sound | Lines heard | Voice overlap | Lip sync on dialogue shots | Loudness (LUFS / true peak) | Length |
|---|---|---|---|---|---|---|---|
| Thor | **Before** | none | n/a | n/a | n/a | n/a | 22.52 s |
| | v1 Path 1 | yes | 0.10 | overlapping | s7 0.05 | −14.4 / −1.3 | 22.5 s |
| | v1 Path 2 | yes | 0.06 | overlapping | s7 −0.11 | −14.6 / −1.4 | 22.5 s |
| | **v2 Path 1** | yes | **0.79** | **0 s** | s7 **0.16** | −14.4 / −1.4 | 22.5 s |
| | **v2 Path 2** | yes | **0.73** | **0 s** | s7 −0.04 | −14.2 / −1.1 | 22.5 s |
| Velto | **Before** | none | n/a | n/a | no dialogue | n/a | 22.52 s |
| | v2 Path 1 | yes | 0.50-0.75 * | 0 s | no dialogue | −16.9 / −1.4 | 22.5 s |
| | v2 Path 2 | yes | 0.50-0.75 * | 0 s | no dialogue | −16.1 / −1.5 | 22.5 s |
| DL 2 | **Before** | none | n/a | n/a | n/a | n/a | 17.52 s |
| | v1 Path 2 | yes | 0.43 | overlapping | s1 0.03, s4 −0.01 | −14.6 / −1.4 | 17.5 s |
| | **v2 Path 1** | yes | **1.00** | **0 s** | s1 **0.28**, s4 0.00 † | −15.2 / −1.4 | 17.5 s |
| | **v2 Path 2** | yes | **1.00** | **0 s** | s1 −0.01, s4 **0.13** | −14.8 / −1.4 | 17.5 s |

\* Whisper writes "Velto Dial One" as "Dial 1" or "Veltodial", which counts as missed words. The
tagline is clear in both transcripts.

† The mouth-movement sync score is unreliable on wide shots with small faces. It read 0.15 in v1
on the same video, so treat it as an alarm on close shots only. Earlier medium close-ups scored
0.33-0.53.

### Path 3: Napkin Radio export of the v2 Path 2 stems

| Ad | Timeline | Export | Loudness check | True peak | Length | Note |
|---|---|---|---|---|---|---|
| Thor | 4.0 s | 4.4 s | ✓ (−15.4 → −18.0) | ✓ | ✓ | |
| Velto | 2.3 s | 5.5 s | **✗ (−21.3 → −14.9)** | ✓ | ✓ | **A Radio bug:** asked for −18 LUFS, a quiet mix overshoots by 3 dB. It reproduced twice. |
| DL 2 | 2.1 s | 4.1 s | ✓ (−18.0 → −18.3) | ✓ | ✓ | |

The length check passes only with the exact booked length (22.5 s, not 23). TV ads of 17.5 or
22.5 s don't fit radio's whole-second bookings, so a radio cut needs its own edit to 20 or 30 s.

### Picture (by eye, from `compare_<ad>.jpg`; scores out of 5)

| Ad | Before | v2 Path 1 (Veo 3.1 Fast) | v2 Path 2 (Gen-4.5 + WAN on lines) |
|---|---|---|---|
| Thor | 4: good frames, little action | **4.5**: stronger action (wave, splash), glowing door, feet up by the fire as briefed; the character holds | 3.5: shot 1 drifts (small figure, odd boat), shot 2 posture odd; the lip-synced last shot holds |
| Velto | 4 | 3.5: lovely bunny shadows, but **the product's blue ring light became a glowing puck**. The shadow shot was refused by Veo's moderation and made on H3 Max. | 3: the same product drift, a scarier toothy monster (off brief), and the room changes in the last shot (curtains) |
| DL 2 | 3.5 | **4**: consistent man, room and robot; lines on the lips | 3: the lip-synced shot 1 loses "hands on head"; **two robots appear in the last shot** (WAN) |

## What this says

1. **Every remade ad now has sound, and the rules make it coherent.** The hackathon ads had none.
   After R1-R5, all three have the right lines, no voice overlap, and on-target loudness
   (−14 online; Radio −18).
2. **Path 1 is the best path for any ad with lines spoken on screen.** It gave the best picture and
   the only reliable lip sync. Path 2 needs a lip-sync step for every such line, and today's WAN
   route costs continuity (lost pose, a duplicated robot).
3. **Path 2 is right for shots without visible speech**: product shots, b-roll and voiceover. It is
   cheaper and gives full control of every layer.
4. **Path 3 (Radio) is a delivery stage, not a generator.** It takes our stems unchanged in
   seconds. It needs its loudness overshoot fixed and booked lengths handled.
5. **Moderation shapes model choice per shot:**
   - Veo refused a frame showing a child with a looming shadow, twice (free, code
     `INPUT_PREPROCESSING.SAFETY.THIRD_PARTY`); H3 Max took it.
   - Seedance refuses photoreal faces.
   - The harness needs a per-shot fallback model for refusals, not a per-ad one.
6. **Product fidelity is the weak spot on every path.** Velto's ring light changed in both. Product
   shots need the product as a reference (reference-mode models), a product check (compare against
   the packshot), or the pack shot kept as a still. The text pack shot was never sent to a video
   model; it was the team's frame with a gentle push-in, and its words stayed intact.

## Not done or not measured

- **Direct ElevenLabs** (designed voice, video-to-music, forced alignment, Aurora): the key lacks
  permissions (see the pathway tests).
- **The original director prompts and shot lists** from S3: AWS SSO had expired.
- **Motion quality and audio by ear:** only stills and machine metrics were graded.

## Batch 2: five more ads, and the final rules (v3)

The other five ads the tool made untouched were remade the same way:
- Recycled Jane, Beep, Melto (Cat Runners), VENTO (DL) and Meet Mr. Flex.
- 2,112 credits ($21.12), plus about $2.40 for 6 jobs that ran while the work was paused and
  were redone.
- No AWS was used.

All eight ads were then rebuilt with the final rule set (v3). One page shows them all:
`production-tool/relay/results/outputs/index.html` (served by the `test-results` launch config,
`http://localhost:8765/index.html`).

### Rules added after batch 2

| Rule | Why | Evidence |
|---|---|---|
| **R1+R3** The last spoken shot also leaves room for the tagline | Making the shot only as long as the line left no room for the tagline (Thor overlapped 0.3-0.9 s) | Thor and DL now 0 s overlap |
| **R6** Unscripted words in native audio are muted, and that shot gets our effects | Veo invents speech on shots with no line | Velto shot 4 "I'm going to get you a new one", Melto shots 3 and 6, and **VENTO's dragon shot "Help me!"**: 4 of 27 shots with no line (15%) |
| **R4b** Native audio ducks under any added voiceover | Melto's crowd track drowned the tagline | Melto Path 1: tagline heard again |
| **Text shots never go to a video model** | The words would garble | Jane's "REPEAT. RESELL. REUSE." and tagline card, and VENTO's end card, came out intact as stills |
| **Brand names need a pronunciation dictionary** (next) | The TTS says "Veltor" and "War" for Velto and Vorr; Whisper hears "Deep" for Beep | Use ElevenLabs pronunciation dictionaries or IPA; this needs direct ElevenLabs |

Two measures turned out unreliable:
- **The mouth-movement sync score fails on stylised faces.** Its face detector is trained on real
  faces, so it misreads Thor, Flex and the cartoons. The numbers below for those ads need checking
  by eye.
- **Transcribing the whole ad over music makes Whisper invent words.** Lines-heard now transcribes
  only the windows where a voice is scheduled.

### All eight ads (v3)

Picture is scored by eye, out of 5. "Lines" is the share of scripted words heard.

| Ad | Before picture | Path 1 picture | Path 1 lines | Path 2 picture | Path 2 lines | Voice overlap | Radio checks |
|---|---|---|---|---|---|---|---|
| Thor for Vorr | 4 | **4.5** | 0.69 | 3.5 | 0.73 | 0 / 0 | all ✓ |
| Velto Baby | 4 | **3.5** | 1.00 | 3 | 1.00 | 0 / 0 | loudness ✗ (Radio bug) |
| Team DL 2 | 3.5 | **4** | 1.00 | 3 | 0.93 | 0 / 0 | all ✓ |
| Recycled Jane | 4 | 4 | 0.92 | 4 | 0.92 | 0 / 0 | all ✓ |
| Beep | 3.5 | 3.5 | 0.75 | 3.5 | 0.25 * | 0 / 0 | all ✓ |
| Melto | 3.5 | 3 | 0.75 | **4** | 0.75 | 0 / 0 | all ✓ |
| VENTO | 3.5 | **4** | 1.00 | 3 | 1.00 | 0 / 0 | all ✓ |
| Mr. Flex | 4 | 3.5 | 0.80 | **4** | 0.90 | 0 / 0 | all ✓ |
| **Mean** | 3.75 | **3.75** | **0.86** | 3.5 | 0.81 | **0** | 7 of 8 |

\* Mostly the brand name misheard ("Deep, you're home, so steady").

### What batch 2 changed in the conclusion

- **Path 1 still wins overall:**
  - better picture on 4 ads, Path 2 on 2, ties on 2;
  - more lines heard (0.86 against 0.81);
  - the only reliable lip sync on human faces.
- **Path 2 wins on product shots and character design.**
  - Flex: Gen-4.5 kept "MELTO PROTEIN BAR" crisp where Veo garbled it.
  - Melto: Veo turned a chocolate-bar character into a bear; Gen-4.5 kept it.
- **Path 1 wins on character consistency for robots.** In Path 2, Gen-4.5 and WAN redesigned the
  Beep and VENTO robots in places.
- **So the per-shot choice stands, refined:**
  - dialogue and character performance → Path 1;
  - product close-ups and text → Path 2 or a still;
  - every shot with native audio must pass R6 before it ships.
- **Sound is where every remake gains over the hackathon ad.** The picture scores average the same
  as the originals (3.75), because the same team frames went in.
