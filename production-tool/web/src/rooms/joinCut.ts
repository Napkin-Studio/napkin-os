// Join or cut (features/join-or-cut-shots.clan, mock join-or-cut-v1): the Make room shows every shot of the
// video in story order, and every gap between two shots is a toggle: joined (one generation) or cut (a new
// video). The toggles write through the one join model (jobs/runView writeJoins: the person's boxes as
// video.runs); the boxes stay derived (rooms/model roomBoxes). What a box says it will make, its limits on its
// model before Make, and the gap's tip are worked out here, pure, so they are tested on their own.

import { clipRefCapacity, modelChoicesFor } from '../capabilities'
import type { Config, Id, ModelChoice, ProductionDocument, Shot } from '../contracts/types'
import type { UiState } from '../doc/ui'
import { selectedFrame } from '../jobs/frames'
import { joinBlock } from '../jobs/runs'
import { gapJoins, videoShots, writeJoins } from '../jobs/runView'
import { shotRefSet } from '../jobs/select'
import { shotNumber } from '../model/selectors'
import { boxModel, boxModelCant, boxModelWhyNot, entryOf, takeLimits } from './boxModel'
import { roomBoxes, type Box } from './model'
import { startPicture } from './newBox'

type Doc = ProductionDocument

const s1 = (n: number) => `${Math.round(n * 10) / 10}`

/** A gap between two shots of the strip: before shot `shotId` (number `n`), joined or cut, and why it can
 *  never be joined (an end card, a product or type shot, a spoken line; connected video off). */
export interface Gap {
  shotId: Id
  /** The number of the shot after the gap (the gap sits between shots n-1 and n). */
  n: number
  joined: boolean
  blocked?: string
}

/** Every gap of the strip, in story order: joined where both shots are in one box. */
export function stripGaps(doc: Doc, boxes: Box[], videoId: Id, config: Pick<Config, 'flags'>): Gap[] {
  const order = boxes.flatMap((b) => b.shotIds)
  const boxOf = new Map(boxes.flatMap((b) => b.shotIds.map((id) => [id, b.key] as const)))
  const plan = new Map(videoShots(doc, videoId).map((s, i) => [s.id, { s, i }]))
  return order.slice(1).map((id, k) => {
    const prev = order[k]
    const joined = boxOf.get(prev) === boxOf.get(id)
    const a = plan.get(prev)
    const b = plan.get(id)
    const blocked = joined ? undefined : !config.flags.connectedVideo ? 'Making several shots as one video is off in this build'
      : a && b ? joinBlock(a.s, b.s, a.i) : undefined
    return { shotId: id, n: shotNumber(doc, id), joined, ...(blocked ? { blocked } : {}) }
  })
}

/** The boxes as they would be once this gap is flipped (the same join model, on a copy of the document). */
export function boxesAfterFlip(doc: Doc, ui: Pick<UiState, 'jobs'>, videoId: Id, config: Config, gap: Pick<Gap, 'shotId' | 'joined'>): Box[] {
  const copy = structuredClone(doc)
  const shown = roomBoxes(doc, ui, videoId, config).map((b) => b.shotIds)
  writeJoins(copy, videoId, gapJoins(doc, videoId, gap.shotId, gap.joined ? 'cut' : 'continue', shown))
  return roomBoxes(copy, ui, videoId, config)
}

/** The model picked for a box: kept by shot, so a joined box keeps the earlier box's model (mock
 *  recommendation 2): the first of its shots with a pick. */
export function pickedFor(models: Record<Id, ModelChoice>, box: Pick<Box, 'shotIds'>): ModelChoice | undefined {
  for (const id of box.shotIds) if (models[id]) return models[id]
  return undefined
}

/** The picks with `m` set for this box (on its first shot; its other shots' picks go). */
export function withPick(models: Record<Id, ModelChoice>, box: Pick<Box, 'shotIds'>, m: ModelChoice): Record<Id, ModelChoice> {
  const out = { ...models }
  for (const id of box.shotIds) delete out[id]
  out[box.shotIds[0]] = m
  return out
}

/** A picture a box sends: a character's (named), or a shot's frame as its guide. */
export interface BoxPicture { kind: 'character' | 'frame' | 'other'; id: Id; sha?: string; label: string; shotId?: Id; k?: number }

/** What a box made together sends, in the order makeTake sends it (jobs/clips.ts): the characters' pictures,
 *  then each shot's frame in shot order ("Image k → shot n"), then the other named pictures. */
export function boxPictures(doc: Doc, box: Pick<Box, 'shotIds'>, declined: Record<Id, readonly Id[]> = {}): BoxPicture[] {
  const named: BoxPicture[] = []
  for (const id of box.shotIds) {
    const shot = doc.shots[id]
    if (!shot) continue
    let set: ReturnType<typeof shotRefSet> = []
    try { set = shotRefSet(doc, shot, '', declined[id] ?? []) } catch { /* a bare @name with no picture: said elsewhere */ }
    for (const { ref } of set) {
      if (named.some((x) => x.id === ref.id)) continue
      named.push({ kind: ref.role === 'character' ? 'character' : 'other', id: ref.id, sha: ref.asset, label: `@${ref.key} · ${ref.variant}` })
    }
  }
  const frames: BoxPicture[] = []
  box.shotIds.forEach((id, i) => {
    const f = selectedFrame(doc, id)
    if (f) frames.push({ kind: 'frame', id: f.id, sha: f.asset, label: `Image ${frames.length + 1}`, shotId: id, k: i + 1 })
  })
  // As makeTake orders them: a character's clean views before one with a swatch strip (paid test P1, finding 9).
  const sheet = (x: BoxPicture) => (doc.refs[x.id]?.swatches?.length ? 1 : 0)
  const chars = named.filter((x) => x.kind === 'character').sort((a, b) => sheet(a) - sheet(b))
  return [...chars, ...frames, ...named.filter((x) => x.kind === 'other')]
}

/** Whether a box is made from its shots' words: none of them has a frame or a start picture. */
export function fromWords(doc: Doc, box: Pick<Box, 'shotIds'>): boolean {
  return !box.shotIds.some((id) => !!selectedFrame(doc, id) || !!startPicture(doc, id))
}

/** The characters a box's pictures are of: "@mira", "@mira and @tom". */
function castWords(pics: BoxPicture[]): string | undefined {
  const keys = [...new Set(pics.filter((p) => p.kind === 'character').map((p) => p.label.split(' · ')[0]))]
  return keys.length ? keys.join(' and ') : undefined
}

/** What Make on a box will make, said on the box (no prices): "One video · 3 shots · 10 s / Every frame used
 *  as a guide", "One video from the words / 3 shots · 9.5 s · with @mira's pictures", "Separate video / 3 s". */
export function boxWords(doc: Doc, box: Box, pics: BoxPicture[] = boxPictures(doc, box)): { title: string; sub: string } {
  const len = `${s1(box.lengthS)} s`
  if (fromWords(doc, box)) {
    const cast = castWords(pics)
    return box.together
      ? { title: 'One video from the words', sub: `${box.shotIds.length} shots · ${len}${cast ? ` · with ${cast}’s pictures` : ''}` }
      : { title: 'Separate video', sub: `${len} · its words` }
  }
  return box.together ? { title: `One video · ${box.shotIds.length} shots · ${len}`, sub: 'Every frame used as a guide' } : { title: 'Separate video', sub: len }
}

/** The Box tab's line under One video / Separate videos. */
export function boxHow(doc: Doc, box: Box, pics: BoxPicture[] = boxPictures(doc, box)): string {
  const cast = castWords(pics)
  const withCast = cast ? `, with ${cast}’s pictures` : ''
  if (fromWords(doc, box)) {
    return box.together ? `One generation from the shots’ words, in order${withCast}. Cut where the lines are.` : `Made on its own from its words${cast ? ` and ${cast}’s pictures` : ''}.`
  }
  return box.together ? `One generation. Every shot’s frame goes in as a guide, in shot order${withCast}. No frame is pinned.` : 'Made on its own, starting on its frame.'
}

/** What a box made together is past on its model, and what fixes it (mock state `limit`). */
export interface BoxLimit {
  /** Longer, or more shots, than the model makes in one go: Make waits. Only too many pictures: a warning. */
  hard: boolean
  why: string
  /** The frames left out when the pictures are more than the model takes (characters go first). */
  leftOut: Id[]
  pictures: number
  picturesMax: number
  /** A model that makes it all ("Use WAN 3 · up to 15 s"). */
  alt?: { choice: ModelChoice; label: string; maxS: number }
  /** Where to cut so the first part fits ("Cut before shot 7"). */
  cutBefore?: Id
}

/** The box against its model's limits (boxModelLimit, the pictures clipRefCapacity carries with no frame), or
 *  undefined when it fits. A one-shot box has none here. */
export function boxLimit(doc: Doc, box: Box, m: ModelChoice | undefined, config: Config, pics: BoxPicture[] = boxPictures(doc, box)): BoxLimit | undefined {
  if (!box.together || !m) return undefined
  const lim = takeLimits(m)
  const e = entryOf(m)
  if (!lim || !e) return undefined
  const fitsPics = (c: ModelChoice) => {
    const cap = clipRefCapacity(c, false, config).max
    const chars = pics.filter((p) => p.kind === 'character').length
    const frames = pics.filter((p) => p.kind === 'frame')
    return { cap, count: chars + frames.length, leftOut: frames.slice(Math.max(0, cap - chars)).map((f) => f.shotId!) }
  }
  const p = fitsPics(m)
  const longer = box.lengthS > lim.maxS + 1e-6
  const more = box.shotIds.length > lim.maxShots
  if (!longer && !more && !p.leftOut.length) return undefined
  const options = modelChoicesFor('clip', config)
  const can = options.filter((o) => !boxModelWhyNot(doc, box, o))
  const altChoice = can.find((o) => !fitsPics(o).leftOut.length) ?? (longer || more ? can[0] : undefined)
  const alt = altChoice && !(altChoice.provider === m.provider && altChoice.model === m.model)
    ? { choice: { provider: altChoice.provider, model: altChoice.model }, label: entryOf(altChoice)?.label ?? altChoice.model, maxS: takeLimits(altChoice)?.maxS ?? 0 }
    : undefined
  const n = (id: Id) => shotNumber(doc, id)
  const lastLeft = p.leftOut.at(-1)
  const nums = p.leftOut.map(n)
  const leftWords = nums.length === 1 ? `shot ${nums[0]}’s frame` : `the frames of shots ${nums.slice(0, -1).join(', ')} and ${nums.at(-1)}`
  if (!longer && !more) {
    return { hard: false, why: `${e.label} takes ${p.cap} pictures. This box has ${p.count}: the characters’ first, then the frames in order, so ${leftWords} ${p.leftOut.length === 1 ? 'is' : 'are'} left out.`,
      leftOut: p.leftOut, pictures: p.count, picturesMax: p.cap, ...(alt ? { alt } : {}) }
  }
  // Where to cut: the longest run from the start that the box's model makes in one go.
  let acc = 0
  let k = 0
  for (const id of box.shotIds) {
    const d = doc.shots[id]?.duration_s ?? 0
    if (acc + d > lim.maxS + 1e-6 || k >= lim.maxShots) break
    acc += d
    k++
  }
  const why = longer ? `${s1(box.lengthS)} s is longer than ${e.label} makes in one go (${lim.maxS} s).` : `${box.shotIds.length} shots is more than ${e.label} makes in one go (${lim.maxShots}).`
  const pw = p.leftOut.length && lastLeft ? ` It also takes ${p.cap} pictures, so ${leftWords} would be left out.` : ''
  return { hard: true, why: why + pw, leftOut: p.leftOut, pictures: p.count, picturesMax: p.cap, ...(alt ? { alt } : {}), cutBefore: box.shotIds[Math.max(1, k)] }
}

/** The model a box is made on in the room: its pick (kept past its limits), else boxModel's. */
export function roomBoxModel(doc: Doc, box: Box, config: Config, models: Record<Id, ModelChoice>): ModelChoice | undefined {
  return boxModel(doc, box, config, pickedFor(models, box))
}

/** What flipping a gap does, in words, for its tip: "Join: shots 3 and 4 become one video" with what the new
 *  box will be and a warning when it is past its model's limits; "Cut here: two videos" with both parts. */
export interface FlipWords { head: string; sub: string; warn?: string; verb: 'Join' | 'Cut here' }

export function flipWords(doc: Doc, ui: Pick<UiState, 'jobs'>, videoId: Id, config: Config, gap: Gap, models: Record<Id, ModelChoice>): FlipWords {
  const a = gap.n - 1
  const b = gap.n
  if (gap.blocked) return { head: `Always a cut: shots ${a} and ${b}`, sub: gap.blocked, verb: 'Join' }
  const after = boxesAfterFlip(doc, ui, videoId, config, gap)
  const range = (x: Box) => (x.shotIds.length > 1 ? `shots ${shotNumber(doc, x.shotIds[0])}–${shotNumber(doc, x.shotIds.at(-1)!)}` : `shot ${shotNumber(doc, x.shotIds[0])}`)
  if (gap.joined) {
    const prevId = videoShots(doc, videoId)[b - 2]?.id
    const x = after.find((y) => y.shotIds.includes(prevId ?? ''))
    const y = after.find((z) => z.shotIds.includes(gap.shotId))
    return { verb: 'Cut here', head: 'Cut here: two videos',
      sub: x && y ? `Shots ${a} and ${b} are made apart: ${range(x)} (${s1(x.lengthS)} s), then ${range(y)} (${s1(y.lengthS)} s).` : `Shots ${a} and ${b} are made apart.` }
  }
  const nb = after.find((x) => x.shotIds.includes(gap.shotId))
  if (!nb) return { verb: 'Join', head: `Join: shots ${a} and ${b} become one video`, sub: 'One video.' }
  const words = fromWords(doc, nb) ? ', from the words' : ', every frame a guide'
  const m = roomBoxModel(doc, nb, config, models)
  const lim = boxLimit(doc, nb, m, config)
  const label = m ? entryOf(m)?.label ?? m.model : 'this model'
  const max = m ? takeLimits(m) : undefined
  const warn = lim?.hard
    ? nb.lengthS > (max?.maxS ?? Infinity) + 1e-6
      ? `${s1(nb.lengthS)} s is longer than ${label} makes in one go (${max?.maxS} s)${lim.alt ? `; ${lim.alt.label} can` : ''}. The box will say so before Make.`
      : `${nb.shotIds.length} shots is more than ${label} makes in one go (${max?.maxShots}). The box will say where to cut.`
    : undefined
  return { verb: 'Join', head: `Join: shots ${a} and ${b} become one video`, sub: `One video · ${nb.shotIds.length} shots · ${s1(nb.lengthS)} s${words}.`, ...(warn ? { warn } : {}) }
}

/** The shot a box is named by in the Box tab's guides: "Image 2 → shot 5". */
export function guideLine(doc: Doc, p: BoxPicture): string {
  return p.kind === 'frame' && p.shotId ? `${p.label} → shot ${shotNumber(doc, p.shotId)}` : p.label
}

/** Whether a model can make this box at all (its limits aside): Veo is greyed for shots made together. */
export const canMakeBox = (doc: Doc, box: Box, m: ModelChoice) => !boxModelCant(doc, box, m)

/** A shot's line for the strip: "Wide · 4 s". */
export function shotCamLine(shot: Pick<Shot, 'camera' | 'duration_s'> | undefined, size: (s: string | undefined) => string): string {
  return `${size(shot?.camera.size)} · ${s1(shot?.duration_s ?? 0)} s`
}
