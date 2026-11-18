# Make and Edit: the contract for the web (P1 and P2)

For the web agent mirroring `web/src/contracts/types.ts`. The authority is the schema
(`contracts/document.schema.json`, `contracts/relay-api.schema.json`); this note says the same in one
place, with the migration and the store's write paths. README item 22. `contractVersion` stays `"3"`.

## Document

### `generations` (replaces `takes`)

Root map `generations: Record<GenId, Generation>`, required, keys `^gen_[ULID]$`, at most 2000.
`takes` and `$defs.take` are gone. There are no versions per shot: a take's number on a box's stack is
its place in creation order (ULID order) among that box's generations.

```ts
type GenerationKind = 'clip' | 'together' | 'change' | 'patch' | 'feel' | 'combine' | 'extend' | 'upload' | 'render'
type DeltaField = 'camera.size' | 'camera.angle' | 'camera.movement' | 'camera.movement_speed' | 'camera.lens_mm'
  | 'words' | 'refs' | 'start_frame' | 'end_frame' | 'moment' | 'feel' | 'length' | 'model' | 'quality' | 'sources'
interface GenerationDelta { field: DeltaField; shot_id?: ShotId; from?: unknown; to: unknown }
interface Generation {
  id: GenId; v: number; field_v: Record<string, number>
  kind: GenerationKind
  parent_id?: GenId            // REQUIRED when kind is change | patch | feel | extend
  delta?: GenerationDelta[]    // max 8; absent/empty on a first take
  label?: string               // max 120: 'Camera: handheld (shot 3)'; absent: derive ('First take')
  inputs?: {                   // a summary; the full request is on the relay (held server-side)
    frames?: { role: 'start' | 'end' | 'still'; asset: Sha256; shot_id?: ShotId }[]   // max 16
    refs?: { name?: RefName; asset: Sha256; role?: RefRole }[]                        // max 14
    words?: string                                                                     // max 4000
    camera?: Record<ShotId, Camera>                                                    // per shot, as sent
    model?: string; quality?: ClipQuality; size?: string /* '720p' */; length_s?: number
    sources?: { generation_id?: GenId; asset: Sha256; in_s?: number; out_s?: number }[] // combine (P4), max 8
  }
  box_id?: RunId               // video.runs key: the box it was made for
  shot_ids: ShotId[]           // REQUIRED (may be []), in order
  segments?: { shot_id: ShotId; in_s: number; out_s: number; by?: 'prompt' | 'detected' | 'human' }[]  // a together box: where each shot is
  patched?: { in_s: number; out_s: number; job_id: JobId; generation_id?: GenId }[]               // max 16
  asset?: Sha256               // REQUIRED when state is 'ready'
  duration_s?: number          // REQUIRED when state is 'ready' (0-600)
  state: 'making' | 'ready' | 'failed'
  job_id?: JobId
  provider?: string; crew?: CrewId
  mock?: true                  // replaces take.kind 'mock'
  end?: { kind: 'next_storyboard' | 'none'; frame_id?: FrameId; at_s?: number; score?: number }
  created_at: string           // ISO date-time, REQUIRED
  by: PersonRef                // 'human:<id>', REQUIRED
}
```

No price, cost, credit or usd field exists on a generation (check.py refuses one).

### `video.timeline` (replaces `video.edl`) and `video.end_card`

`videos[v].timeline: Record<ItemId, TimelineItem>` is required (`{}` when empty), keys
`^item_[ULID]$`, at most 300. `edl` is gone. `pick` (renders), `runs` (the boxes), `join`, `quality`
stay as they were.

```ts
type Track = 'V1' | 'V2' | 'text'
interface TransitionIn { kind: 'cut' | 'dissolve' | 'dip_black' | 'dip_white'; s?: number /* 0-2 */ }
interface ClipItem {                    // track V1 or V2
  track: 'V1' | 'V2'
  start_s: number                       // ad time, 0-600
  source: { generation_id: GenId; in_s: number; out_s: number } | { asset: Sha256; in_s: number; out_s: number }  // exactly one of the two
  follows?: { box_id?: RunId; shot_id?: ShotId }   // the slot it stands for: the swap rule reads it
  fade_in_s?: number; fade_out_s?: number           // 0-10, from/to black
  transition_in?: TransitionIn                      // the join from the clip before on its track; absent = cut
  speed?: number                                    // 0.75-1.33, absent = 1
  hold_s?: number                                   // >0-10: last frame held after out_s
  opacity?: number                                  // 0-1, V2 ONLY (refused on V1)
}
interface TextItem {
  track: 'text'
  words: string                         // 1-300
  style: 'caption' | 'title' | 'super'  // caption: bottom band, title: centred, super: lower third
  from_s: number; to_s: number          // ad time
  fade_in_s?: number; fade_out_s?: number
}                                       // a text item may NOT carry start_s, source, follows, transition_in, speed, hold_s, opacity
interface EndCard {
  headline?: string /* ≤120 */; line: string /* 1-200 */; cta?: string /* ≤80 */
  bg: string /* '#RRGGBB' */; logo_asset?: Sha256; s: number /* 0.5-10 */; transition_in?: TransitionIn
}
// videos[v].end_card?: EndCard   (absent: no card of the person's; the studio roll-up always ends the ad)
```

A clip lasts `(out_s - in_s) / speed + hold_s` (`itemLength` in clan-store). V1 is magnetic: its clips
never overlap (1 ms tolerance; a gap is black). The store refuses an overlap, a clip whose generation is
missing, a source past the generation's `duration_s`, a text that ends before it starts, a generation
whose parent is missing (integrity.ts, check.py).

A dissolve or dip overlaps the clips by `s` using the outgoing clip's footage after its `out_s` (held
on its last frame when there is none), so clips keep their `start_s` and the film its length: the same
rule stitch has always had.

### Elsewhere

- Targets: every `{kind: 'take', id}` is now `{kind: 'generation', id}` (`$defs.target`, `reviews[].target`).
  A note on a generation is in that generation's own time (noteToTakeWindow passes it through).
- `jobs[].inputs[].kind`: `'take'` → `'generation'` (`ref` is the generation id).
- `format_sets[].protect.takes` → `protect.generations` (keyed by generation id);
  `format_sets[].reframes` keys `<gen id>@<w>x<h>`, with `generation_id` (was `take_id`).
- `sizes[].edl[]`: `take_id` → `generation_id` (size.edl reads V1's windows).
- `stale` marks on takes are removed; nothing marks a generation stale.
- `renders` is unchanged (kind `render` is reserved for when the Bin holds renders).

## Store write paths (clan-store `src/bus/leaf.ts`, LocalPatchBus)

| Write | Patch |
|---|---|
| a new generation | `{op: 'create', entity: 'generations', id, value}` |
| a generation's state, asset, duration_s, label, segments, patched, delta, inputs, … | `{op: 'set', entity: 'generations', path: '<field>'}` (each top-level field set whole) |
| a new clip or text | `{op: 'set', entity: 'videos', id: videoId, path: 'timeline/<item>', value: item}` |
| remove a clip or text | the same path with `value: null` |
| move, trim, fade, speed, hold, transition, words, style, timing | `timeline/<item>/<field>`: `track`, `start_s`, `source`, `follows`, `fade_in_s`, `fade_out_s`, `transition_in`, `speed`, `hold_s`, `opacity`, `words`, `style`, `from_s`, `to_s` |
| a trim of one end, a swap | `timeline/<item>/source/<generation_id\|asset\|in_s\|out_s>` |
| the slot a clip stands for | `timeline/<item>/follows/<box_id\|shot_id>` |
| the end card | `end_card` (set whole; `null` removes it) |
| boxes | `runs` (set whole, as before) |

`timeline` alone is refused (`has parts`), as `edl` was. Every path above has a real-store test
(`clan-store/test/make-and-edit.test.ts`).

## The migration (clan-store `migrateToGenerations`, run by the store on open)

A document that still has `takes` or a video's `edl` is moved once when it opens, in one decision by
`clan-store` ("move takes and the edl to generations and the timeline"). The snapshot (no-wasm) store
must call `migrateToGenerations(doc)` on load too (`needsGenerations(doc)` says whether to).

| Before | After |
|---|---|
| a take | one generation `gen_<the take's ULID>` |
| the takes of a box made together (connected-video: same job and asset, segments with `by`) | ONE generation, kind `together`, keyed by the take its segments name (`source_take`), `shot_ids` in segment order, `segments[{shot_id, in_s, out_s, by}]` |
| take kind | `together`; `patch` (its job is clip_patch, with a parent); `feel` (clip_edit, with a parent); `change` (any other with a parent); else `clip` |
| parent | `parent_id` → the parent's generation; when absent, the take its job used ('new version of') for a patch or feel |
| `segments` of a spliced take (no `by`, with `job_id`) | `patched[{in_s, out_s, job_id, generation_id}]` |
| model, quality, size, duration_s | `inputs: {model, quality, size, length_s}` (nothing else is known; frames, refs, words, camera are left out) |
| `kind: 'mock'` | `mock: true` |
| run with the take's job | `box_id` |
| — | `state: 'ready'`, `created_at` / `by` from the take's job (else the project's) |
| `video.edl` items with a pick, in rank order | V1 clips laid end to end from 0: `item_<the edl item's ULID>`, `source.generation_id`, `follows {box_id?, shot_id}` |
| an item's window | `in_s`: the together segment's in_s, else the item's in_s (0); footage end: the segment's out_s, else the item's out_s, else the landing frame (`end.at_s` + 1 frame), else the take's length |
| the slot (the shot's duration_s) | `out_s = in_s + slot` when there is footage; shorter footage keeps `out_s` and `hold_s` = the shortfall; an end-framed take within 1.33x keeps its whole window with `speed` |
| `seam` | dissolve → `transition_in {dissolve, s}`, dip → `{dip_black, s}` (s default 0.5); cut, match, continue → no transition (a continue after a landed take drops one frame from its window, as stitch did) |
| an edl item with no pick, or a missing take | dropped |
| `{kind: 'take', id}` anywhere, job inputs, protect, reframes, size windows | moved to the generation (see Elsewhere) |
| stale marks on takes | removed |

The owner's samurai project (a copy, `clan-store/test/fixtures/samurai.clan`) moves from 20 takes to
11 generations (three boxes made together, of 5, 5 and 2 shots, each collapse into one; 2 changes; 6
single clips) and a 6-clip V1 of exactly 10 s, valid and passing the integrity rules, and reopens
unchanged (test/make-and-edit.test.ts).

## Relay: remakeWith (Change this…)

`JobRequest.remakeWith = { parentJobId: JobId; parentId?: GenId; delta: RemakeDelta[] /* 1-4 */ }`,
`input: {}` (ignored), with `op`:

| delta | op | `to` |
|---|---|---|
| `camera.movement` (+ `shotId` for a shot of a together box) | `clip` | a `cameraMovement` |
| `words` (+ `shotId`) | `clip` | the shot's new words (1-600) |
| `moment` (alone) | `clip_patch` | `{inS, outS, note, region?, still?}` in the parent's own time |
| `feel` (alone) | `clip_edit` | `{words?, strength?: 'adhere' \| 'flex' \| 'reimagine'}` |

`modelChoice` and `quality` may pick the model and level; absent, the parent's. Refused with
`promoteFrom`, and on any other op. The relay rebuilds the parent's held request server-side (a patch's
or feel's parent clip request is held on that job too), changes only the delta, keeps the seed where
the model repeats one, and answers `Job.remake = { parentJobId, parentId?, delta: [{field, shotId?,
from, to}], window?: {from_s, to_s}, atS? }`, `from` filled from the held request. A moment's window
is snapped (whole seconds, at least 2 s, inside the parent; the same as clan-store `momentWindow`) and
is also on `Job.patch.window`. Write the new generation's `parent_id` from `remake.parentId` and its
`delta` from `remake.delta` (`shotId` → `shot_id`). `Job.cost` stays History-only.

## Relay: stitch in timeline mode (Render ad)

`op: 'stitch'`, `input: { timeline: TimelinePlan, ratio?: '16:9' | … }` (never with `clips`; `ratio`, the video's, sets the shape the relay draws the texts and end card at, 16:9 when absent):

```ts
interface TimelinePlan {
  clips: { asset: AssetRef; startS: number; inS: number; outS: number; speed?: number; holdS?: number;
           fadeInS?: number; fadeOutS?: number; transitionIn?: { kind: 'cut' | 'dissolve' | 'dip_black' | 'dip_white'; s?: number } }[]  // 1-300, V1 in start order
  texts?: { words: string; style: 'caption' | 'title' | 'super'; fromS: number; toS: number; fadeInS?: number; fadeOutS?: number }[]
  endCard?: { headline?: string; line: string; cta?: string; bg: string; logo?: AssetRef; s: number; transitionIn?: TransitionIn }
  lengthS: number   // the last clip's end + the end card; the render is exactly this, then the roll-up
}
```

clan-store `compileTimeline(video, generations)` builds it (each clip's footage as `sha256`; the web
turns it into an AssetRef, and `endCard.logo_sha256` into `logo`). Use the same plan for the preview.
A gap before a clip renders black. The old `input.clips` request is unchanged. The relay refuses (job failed, `invalid_input`, free) a plan whose V1 clips overlap or whose `lengthS` is not the last clip's end plus the end card.

## clan-store exports for the web

`migrateToGenerations`, `needsGenerations`, `generationIds`; `adTimeToSource(timeline, adS)`,
`compileTimeline(video, generations)`, `itemLength(item)`, `TRANSITION_S`; `noteToTakeWindow`
(generation targets), `momentWindow(inS, outS, takeS)`, `patchPlan`, `patchedStretches`,
`patchedRanges(gen)`, `applyPatchGeneration(doc, job, {parentId, by, now, note?})` (a new generation
beside its parent, never swapped into the cut). Gone: `applyPatchTake`, `spliceSegments`, `Segment`,
`PatchTake`, `MAX_SEGMENTS`, `MAX_ALTERNATES`.
