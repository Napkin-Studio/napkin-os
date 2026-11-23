// A film's lengths and shapes (features/campaign-formats.clan, phases 5 and 6), pure: the master's shots as
// Dex's plan reads them, the windows a length keeps (fitWindows) and the crop of each shot at each shape
// (cropKeys), both the relay's own maths (relay/cutdowns.py; tested against one case table,
// contracts/examples/cutdown-cases.json), so a keep or drop on the plan refits here without asking again.
// Then a size's edit (edlFor) and its captions (captionLayers: the spoken lines, timed in the cut).

import type { Aspect, CropKey, CutdownPlan, CutdownShot, FormatSet, Id, ProductionDocument, PxBox, Region, Size, SizeBeat, SizeEdlWindow, TypeLayer } from '../contracts/types'
import { beatsOf, currentTake, cutItemFor, shotsOf, storyboardOfVideo } from '../model/selectors'
import { formatById } from './formats'
import { linesOf } from '../script/skye'
import { METHOD_WORD } from './rules'
import { modelEntry } from '../jobs/runs'

/** The film's own end card (the client's) in a cutdown: its length, at most this (UAT 2026-11-21, B4). It is the last picture: a
 *  client ad carries no studio card (owner 2026-11-23). */
export const CLIENT_CARD_MAX_S = 2
/** How long the film's own card holds in a size `lengthS` long (absent: as long as it may): its own length, at most
 *  CLIENT_CARD_MAX_S and a third of the length, never under 1 s. relay/cutdowns.py client_card_s. */
export const clientCardS = (cardS: number | undefined, lengthS?: number) =>
  Math.round(Math.min(cardS ?? CLIENT_CARD_MAX_S, CLIENT_CARD_MAX_S, lengthS === undefined ? Infinity : Math.max(1, lengthS / 3)) * 1000) / 1000
/** The picture a size keeps at least when its card would leave less: the card shortens for it (UAT round 3,
 *  R3-F12: the 6 s 9:16 had 2.25 s of picture). */
export const MIN_PICTURE_S = 3.5
/** The film's own card at its shortest. */
export const CLIENT_MIN_S = 1
/** How long a size's end card (the film's own, the client's) holds: `cardLen` its own length, 0 when it has none
 *  (`hasClient`). When it would leave under MIN_PICTURE_S of picture it shortens, to CLIENT_MIN_S at the least. A
 *  client ad carries no studio card (owner 2026-11-23). relay/cutdowns.py card_length. */
export function cardLength(lengthS: number | undefined, cardLen?: number, hasClient = cardLen !== undefined): number {
  if (!hasClient) return 0
  let clientS = clientCardS(cardLen, lengthS)
  if (lengthS === undefined) return clientS
  const short = MIN_PICTURE_S - (lengthS - clientS)
  if (short > 1e-6) clientS -= Math.min(short, Math.max(0, clientS - CLIENT_MIN_S))
  return r3(clientS)
}
export const MIN_WINDOW_S = 1.0
export const PAN_MOVE = 0.1
const FRAME_S = 1 / 24
/** The passthrough's subject when nothing was seen: the middle 30% of the frame. */
export const CENTRE = { x: 0.35, y: 0.15, w: 0.3, h: 0.7 }
export const ALEPH_RATIOS = ['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '21:9'] as const

/** The film shapes Make all sizes offers from a Film node: the film pack's formats (owner, CF6/CF7). */
export const FILM_SHAPES = [
  { id: 'film-16x9', label: '16:9', aspect: { w: 16, h: 9 } },
  { id: 'film-9x16', label: '9:16', aspect: { w: 9, h: 16 } },
  { id: 'film-4x5', label: '4:5', aspect: { w: 4, h: 5 } },
  { id: 'film-1x1', label: '1:1', aspect: { w: 1, h: 1 } },
] as const
export type FilmShapeId = (typeof FILM_SHAPES)[number]['id']

/** The shapes a brief asks for (its format and mandatories: "Deliver in 16:9, 9:16 and 1:1"), as Make all sizes
 *  picks them first; 16:9 and 9:16 when it names none (UAT 2026-11-21: the brief mandated 1:1, not picked). */
export function briefShapes(spine: { format?: string; mandatories?: string[] } | undefined): FilmShapeId[] {
  const text = [spine?.format ?? '', ...(spine?.mandatories ?? [])].join(' ')
  const named = FILM_SHAPES.filter((s) => new RegExp(`(^|[^0-9])${s.label.replace(':', '\\s*[:x×]\\s*')}(?![0-9])`).test(text)).map((s) => s.id)
  return named.length ? named : ['film-16x9', 'film-9x16']
}
/** "1 version", "3 versions" (UAT round 3, R3-F12: the sheet said "Make 1 versions"). */
export const versionsWord = (n: number) => `${n} ${n === 1 ? 'version' : 'versions'}`
/** Lengths offered from a 30 s master (CF5: 15 s and 6 s by default; any length typed). */
export const FILM_LENGTHS = [30, 20, 15, 10, 6]
export const DEFAULT_FILM_LENGTHS = [15, 6]
/** Models that make a shot again at a new shape and carry its characters (Remake for vertical; owner CF6,
 *  features/runway-video-models.clan): Kling O3, Hailuo 3, WAN 3. */
export const REMAKE_MODELS = ['klingO3_pro', 'klingO3_standard', 'hailuo3', 'wan3']
/** The social shapes: captions of the spoken lines are burnt in by default (CF9). */
const SOCIAL = [[9, 16], [4, 5], [1, 1]]

const r3 = (x: number) => Math.round(x * 1000) / 1000

export function sameShape(a: Aspect, b: Aspect, tol = 0.01): boolean {
  return Math.abs(Math.log(a.w / a.h) - Math.log(b.w / b.h)) <= tol
}

export function isSocialShape(a: Aspect): boolean {
  return SOCIAL.some(([w, h]) => sameShape(a, { w, h }, 0.02))
}

/** The Aleph 2 ratio a shape is made at: its own, else the nearest (4:5 is made at 3:4 and cropped). */
export function alephRatio(a: Aspect): (typeof ALEPH_RATIOS)[number] {
  const want = Math.log(a.w / a.h)
  let best: (typeof ALEPH_RATIOS)[number] = ALEPH_RATIOS[0]
  for (const r of ALEPH_RATIOS) {
    const [w, h] = r.split(':').map(Number)
    const [bw, bh] = best.split(':').map(Number)
    if (Math.abs(Math.log(w / h) - want) < Math.abs(Math.log(bw / bh) - want)) best = r
  }
  return best
}

/** The key a shot made again for a shape is kept under: `<generation id>@<w>x<h>` (the size's delivery). */
export function reframeKey(takeId: Id, shape: { width: number; height: number }): string {
  return `${takeId}@${shape.width}x${shape.height}`
}

// ── windows ─────────────────────────────────────────────────────────────────

export interface WindowShot { shotId: Id; inS: number; outS: number; takeS?: number; endCard?: boolean }
export interface Window { shotId: Id; inS: number; outS: number }

/** The kept shots' windows fitted to `lengthS` less the end card, and how far over (or short) they are.
 *  Too long: every window is trimmed from its tail by the same share, none under MIN_WINDOW_S (or its own
 *  length); too short: they grow into their handles. relay/cutdowns.py fit_windows. */
export function fitWindows(shots: readonly WindowShot[], keep: ReadonlySet<Id>, lengthS: number): { windows: Window[]; over: number } {
  // The film's own end card (the client's) comes off the length too (UAT 2026-11-21, B4); on a short size it
  // shortens so the picture keeps MIN_PICTURE_S (R3-F12). A client ad carries no studio card.
  const client = shots.find((s) => s.endCard)
  const clientS = cardLength(lengthS, client ? client.outS - (client.inS || 0) : undefined)
  const target = Math.max(MIN_WINDOW_S, lengthS - clientS)
  const kept = shots.filter((s) => keep.has(s.shotId) && !s.endCard)
  if (!kept.length) return { windows: [], over: r3(-target) }
  const slots = kept.map((s) => Math.max(FRAME_S, s.outS - (s.inS || 0)))
  const total = slots.reduce((a, b) => a + b, 0)
  let lengths = [...slots]
  if (total > target + 1e-6) {
    const floor = slots.map((sl) => Math.min(MIN_WINDOW_S, sl))
    const fixed = new Set<number>()
    let done = false
    for (let round = 0; round < kept.length; round++) {
      const free = kept.map((_, i) => i).filter((i) => !fixed.has(i))
      const room = target - [...fixed].reduce((a, i) => a + floor[i], 0)
      const sum = free.reduce((a, i) => a + slots[i], 0)
      const k = free.length ? room / sum : 0
      const low = free.filter((i) => slots[i] * k < floor[i])
      if (!low.length) {
        for (const i of free) lengths[i] = slots[i] * k
        done = true
        break
      }
      for (const i of low) {
        fixed.add(i)
        lengths[i] = floor[i]
      }
    }
    if (!done) lengths = floor
  } else if (total < target - 1e-6) {
    const handles = kept.map((s) => Math.max(0, (s.takeS ?? s.outS) - s.outS))
    const spare = handles.reduce((a, b) => a + b, 0)
    const grow = Math.min(spare, target - total)
    if (spare > 0) lengths = slots.map((sl, i) => sl + (grow * handles[i]) / spare)
  }
  const windows = kept.map((s, i) => {
    const ins = s.inS || 0
    return { shotId: s.shotId, inS: r3(ins), outS: r3(ins + Math.max(FRAME_S, lengths[i])) }
  })
  const over = windows.reduce((a, w) => a + (w.outS - w.inS), 0) - target
  return { windows, over: r3(over) }
}

// ── crops ───────────────────────────────────────────────────────────────────

/** The largest box of shape `a` inside a take, centred on (cx, cy) as far as it can be. */
export function cropAround(take: Aspect, a: Aspect, cx: number, cy: number): PxBox {
  const r = a.w / a.h
  const [w, h] = take.w / take.h > r ? [take.h * r, take.h] : [take.w, take.w / r]
  const x = Math.min(Math.max(cx - w / 2, 0), take.w - w)
  const y = Math.min(Math.max(cy - h / 2, 0), take.h - h)
  return { x: r3(x), y: r3(y), w: r3(w), h: r3(h) }
}

function union(boxes: readonly PxBox[]): PxBox {
  const x0 = Math.min(...boxes.map((b) => b.x))
  const y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.w))
  const y1 = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** A box of the take round the whole subject (UAT round 5, R5-F6: the plan said the 9:16 crop cuts shot 5, and it was
 *  cropped anyway, the kettle cut off). The size's own crop, widened (or heightened) to the subject with a little room,
 *  centred on it, inside the take. Its shape is not the size's: stitch fits it whole over a blurred fill of itself
 *  (stitch/cutdown.py fits_whole). No spend: New edges stays the person's pick. */
export function fitBox(take: Aspect, shape: Aspect, subject: PxBox): PxBox {
  const cx = subject.x + subject.w / 2
  const cy = subject.y + subject.h / 2
  const crop = cropAround(take, shape, cx, cy)
  const w = Math.min(take.w, Math.max(crop.w, subject.w * 1.06))
  const h = Math.min(take.h, Math.max(crop.h, subject.h * 1.06))
  const x = Math.min(Math.max(cx - w / 2, 0), take.w - w)
  const y = Math.min(Math.max(cy - h / 2, 0), take.h - h)
  return { x: r3(x), y: r3(y), w: r3(w), h: r3(h) }
}

/** The crop keys for one shot at one shape, and whether the crop cuts the subject (Aleph 2 should make
 *  its new edges). relay/cutdowns.py crop_keys. */
export function cropKeys(take: Aspect, aspect: Aspect, subjects: readonly PxBox[]): { keys: CropKey[]; cuts: boolean } {
  if (sameShape(take, aspect)) return { keys: [{ at: 0, box: { x: 0, y: 0, w: take.w, h: take.h } }], cuts: false }
  const seen = subjects.length ? subjects : [{ x: CENTRE.x * take.w, y: CENTRE.y * take.h, w: CENTRE.w * take.w, h: CENTRE.h * take.h }]
  const u = union(seen)
  const boxes = seen.map((b) => cropAround(take, aspect, b.x + b.w / 2, b.y + b.h / 2))
  const { w, h } = boxes[0]
  const cuts = seen.some((b) => b.w > w * 1.02 || b.h > h * 1.02)
  const xs = boxes.map((b) => b.x)
  const ys = boxes.map((b) => b.y)
  const moves = Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys)
  if (boxes.length > 1 && moves > PAN_MOVE * take.w) {
    const ats = boxes.length === 3 ? [0, 0.5, 1] : [0, 1]
    return { keys: boxes.slice(0, ats.length).map((box, i) => ({ at: ats[i], box })), cuts }
  }
  return { keys: [{ at: 0, box: cropAround(take, aspect, u.x + u.w / 2, u.y + u.h / 2) }], cuts }
}

// ── the master ─────────────────────────────────────────────────────────────

export interface MasterShot extends CutdownShot { number: number; frameAsset?: string; takeAsset?: string }

/** The master's shots in cut order, each with the window of its take the ad shows (its V1 clip's source in and
 *  out, at most the shot's length), its take's length and pixels, its words and its spoken lines. */
export function masterShots(d: ProductionDocument, videoId: Id): MasterShot[] {
  const v = d.videos[videoId]
  const sb = storyboardOfVideo(d, videoId)
  const [rw, rh] = (v?.ratio ?? '16:9').split(':').map(Number)
  const out: MasterShot[] = []
  for (const [i, s] of (sb ? shotsOf(d, sb.id) : []).entries()) {
    const take = currentTake(d, s.id, videoId)
    if (s.kind === 'end_card') {
      out.push({ shotId: s.id, number: i + 1, inS: 0, outS: Math.min(CLIENT_CARD_MAX_S, v?.end_card?.s ?? s.duration_s ?? CLIENT_CARD_MAX_S), endCard: true })
      continue
    }
    if (!take?.asset) continue
    const item = cutItemFor(d, s.id, videoId)
    const ins = item?.source?.in_s ?? 0
    const a = d.assets[take.asset]
    const takeS = a?.duration_s ?? take.duration_s ?? s.duration_s
    const end = item?.source?.out_s
    const outS = end !== undefined && end > ins ? Math.min(end, ins + s.duration_s) : ins + s.duration_s
    const spoken = spokenWords(d, s.id, take).slice(0, 600)
    out.push({
      shotId: s.id, number: i + 1, takeId: take.id, inS: r3(ins), outS: r3(outS), takeS: r3(Math.max(takeS, outS)),
      takeSize: a?.w && a?.h ? { w: a.w, h: a.h } : { w: rw * 120, h: rh * 120 },
      ...(s.action?.trim() ? { words: s.action.trim().slice(0, 600) } : {}),
      ...(spoken ? { spoken } : {}),
      takeAsset: take.asset,
      ...(s.pick?.current && d.frames[s.pick.current]?.asset ? { frameAsset: d.frames[s.pick.current].asset } : {}),
    })
  }
  return out
}

/** A film's own length for Make all sizes: its shots as cut now, else `wholeS` (its render's length or its
 *  target; the render carries no studio card). UAT 2026-11-18: the sheet said "Film · 15 s", the target, for a
 *  12.7 s cut. */
export function filmSeconds(shots: readonly MasterShot[], wholeS?: number): number {
  const body = shots.filter((s) => !s.endCard)
  if (body.length) return r3(body.reduce((a, s) => a + (s.outS - s.inS), 0))
  return Math.max(0, wholeS ?? 0)
}

/** A shot's spoken lines as the cut plan reads them: who says each, a V.O. said so, and whether its take voices it
 *  (UAT round 5, R5-F8: Dex wrote that Maya "says the end line", an unvoiced NARRATOR voice-over shown as words).
 *  'MAYA (whispering, to the kettle): Good boy.' / 'NARRATOR (V.O.; not voiced in its take): Quietboil. Let them sleep.' */
export function spokenWords(d: ProductionDocument, shotId: Id, take?: { provider?: string; inputs?: { model?: string } }): string {
  const beats = (d.beats ? beatsOf(d, shotId) : []).filter((b) => (b.kind === 'line' || b.kind === 'vo') && (b.text ?? '').trim())
  if (!beats.length) return spokenOf(d, shotId).map((x) => x.text).join(' ')
  const e = take?.provider && take.inputs?.model ? modelEntry(take.provider as never, take.inputs.model) : null
  const voiced = !!e?.video.audioControl
  return beats.map((b) => {
    const who = (b.speaker?.trim() || (b.kind === 'vo' ? 'NARRATOR' : 'SOMEONE')).toUpperCase()
    const paren = b.parenthetical?.trim().replace(/^\((.*)\)$/s, '$1').trim()
    const notes = [b.kind === 'vo' ? 'V.O.' : '', paren ?? '', voiced ? '' : 'not voiced in its take'].filter(Boolean)
    return `${who}${notes.length ? ` (${notes.join('; ')})` : ''}: ${b.text!.trim()}`
  }).join(' ')
}

/** A shot's spoken lines, each at its moment in the shot: its line and VO beats, else its script's dialogue
 *  lines spread through it. */
export function spokenOf(d: ProductionDocument, shotId: Id): { atS: number; text: string }[] {
  if (!d.shots?.[shotId]) return []
  const beats = (d.beats ? beatsOf(d, shotId) : []).filter((b) => (b.kind === 'line' || b.kind === 'vo') && (b.text ?? '').trim())
  if (beats.length) return beats.map((b) => ({ atS: b.at_s, text: b.text!.trim() }))
  const shot = d.shots[shotId]
  const lines = shot?.prose ? linesOf(d, shot.prose as Parameters<typeof linesOf>[1]).filter((l) => l.type === 'dialogue' && l.text.trim()) : []
  return lines.map((l, i) => ({ atS: (i * (shot?.duration_s ?? 3)) / Math.max(1, lines.length), text: l.text.trim() }))
}

/** The film's last spoken line: of its last shot that has one. */
export function lastLineOf(d: ProductionDocument, shots: readonly MasterShot[]): string | undefined {
  for (const s of [...shots].reverse()) {
    if (s.endCard) continue
    const line = spokenOf(d, s.shotId).at(-1)?.text
    if (line) return line.slice(0, 200)
  }
  return undefined
}

// ── a size's edit ───────────────────────────────────────────────────────────

/** A plan's beats for a length, as a size keeps them (by: dex). */
export function beatsFor(plan: CutdownPlan, lengthS: number): SizeBeat[] {
  const l = plan.lengths.find((x) => Math.abs(x.lengthS - lengthS) < 0.5)
  return (l?.beats ?? []).map((b) => ({ shot_id: b.shotId, keep: b.keep, why: b.why, by: 'dex' as const }))
}

/** A size's edit: the kept shots' windows fitted to its length, each with its crop at the size's shape (a
 *  person's crop on a shot is kept). */
export function edlFor(shots: readonly MasterShot[], beats: readonly SizeBeat[], lengthS: number, shape: Aspect,
  crops: CutdownPlan['crops'], before?: readonly SizeEdlWindow[]): { edl: SizeEdlWindow[]; over: number } {
  const keep = new Set(beats.filter((b) => b.keep).map((b) => b.shot_id))
  const { windows, over } = fitWindows(shots, keep, lengthS)
  const edl = windows.map((w): SizeEdlWindow => {
    const s = shots.find((x) => x.shotId === w.shotId)!
    const take = s.takeSize ?? { w: 1920, h: 1080 }
    const mine = before?.find((b) => b.shot_id === w.shotId && b.crop_by === 'person')
    const item: SizeEdlWindow = { shot_id: w.shotId, ...(s.takeId ? { generation_id: s.takeId } : {}), in_s: w.inS, out_s: w.outS, take_size: { ...take } }
    if (mine?.crop) return { ...item, crop: { ...mine.crop }, crop_by: 'person' }
    if (sameShape(take, shape)) return item
    const c = crops.find((x) => x.shotId === w.shotId && sameShape(x.aspect, shape))
    // The plan says the crop cuts the subject: the whole subject, fitted (R5-F6); a reframe, when picked, replaces it.
    if (c?.cuts && c.subject && (c.keys?.length ?? 1) <= 1) return { ...item, crop: fitBox(take, shape, c.subject), crop_by: 'rule' }
    const keys = c?.keys ?? cropKeys(take, shape, []).keys
    return keys.length > 1 ? { ...item, crop_keys: keys.map((k) => ({ at: k.at, box: { ...k.box } })), crop_by: 'rule' }
      : { ...item, crop: { ...keys[0].box }, crop_by: 'rule' }
  })
  return { edl, over }
}

/** How long a size's film runs: its windows (no studio card after them). */
export function filmLength(edl: readonly SizeEdlWindow[] | undefined): number {
  return r3((edl ?? []).reduce((a, w) => a + (w.out_s - w.in_s), 0))
}

/** The shots of a size that need a reframe of their own at its shape: the plan said the crop cuts them. */
export function cutsAt(crops: CutdownPlan['crops'], shape: Aspect): Set<Id> {
  return new Set(crops.filter((c) => c.cuts && sameShape(c.aspect, shape)).map((c) => c.shotId))
}

// ── captions (CF9) ──────────────────────────────────────────────────────────

/** The caption band: the lower part of the safe area, above the line. In 0-1 of the size. */
export function captionBox(fracs: readonly [number, number, number, number]): Region {
  const [l, t, r, b] = fracs
  const sh = 1 - t - b
  return { x: l + 0.06 * (1 - l - r), y: t + sh * 0.6, w: (1 - l - r) * 0.88, h: Math.min(0.12, sh * 0.16) }
}

/** The film's captions: each spoken line of a kept shot, from its moment in the cut until the next line or
 *  its window's end (at least 1.2 s, never past the clips). Drawn by stitch, never sent to a model. */
export function captionLayers(d: ProductionDocument, edl: readonly SizeEdlWindow[], box: Region, colour = '#FFFFFF', h = 1920): TypeLayer[] {
  const out: TypeLayer[] = []
  let at = 0
  const body = edl.reduce((a, w) => a + (w.out_s - w.in_s), 0)
  for (const w of edl) {
    const len = w.out_s - w.in_s
    const lines = spokenOf(d, w.shot_id).filter((l) => l.atS < len)
    for (const [i, l] of lines.entries()) {
      const from = at + l.atS
      const next = i + 1 < lines.length ? at + lines[i + 1].atS : at + len
      const to = Math.min(body, Math.max(from + 1.2, next))
      out.push({ kind: 'captions', box: { ...box }, text: l.text.slice(0, 600), sizeFrac: Math.max(0.022, 22 / h), colour, align: 'centre', plate: '#000000', fromS: r3(from), toS: r3(to) })
    }
    at += len
  }
  return out.slice(0, 30)
}

/** The size's format, and whether its shape is the master's. */
export function shapeOf(size: Pick<Size, 'delivery'>): Aspect {
  return { w: size.delivery.width, h: size.delivery.height }
}

export function filmFormat(id: FilmShapeId) {
  return formatById(id)
}

/** The reframes a size waits for: one per kept shot that the set has a reframe for at its shape. */
export function reframesOf(set: FormatSet, size: Size): { key: string; done: boolean }[] {
  const out: { key: string; done: boolean }[] = []
  for (const w of size.edl ?? []) {
    if (!w.generation_id) continue
    const key = reframeKey(w.generation_id, size.delivery)
    const r = set.reframes?.[key]
    if (r) out.push({ key, done: !!r.asset })
  }
  return out
}

/** The tile's caption line: how it is made ("Reframe · 2 shots new edges"), its length and its shots. */
export function filmWords(set: FormatSet, size: Size): string {
  const kept = size.edl?.length ?? 0
  const keys = (size.edl ?? []).map((w) => (w.generation_id ? set.reframes?.[reframeKey(w.generation_id, size.delivery)] : undefined)).filter(Boolean)
  const edges = keys.filter((r) => r!.method === 'outpaint').length
  const remade = keys.filter((r) => r!.method === 'remake').length
  return [`${METHOD_WORD[size.method]} · ${kept} ${kept === 1 ? 'shot' : 'shots'}`, edges ? `${edges} new edges` : '', remade ? `${remade} remade` : ''].filter(Boolean).join(', ')
}
