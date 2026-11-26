// Make and Edit (features/make-and-edit.clan): the one move from shot-bound takes and video.edl to
// generation records and video.timeline. No shim and no second reader (owner): a document is moved
// once, when it opens (ClanDocumentStore.openBytesNow; the snapshot store calls the same function),
// and from then on only generations and timelines exist.
//
//   takes            → generations. A take is one generation, keyed gen_<the take's ULID>, except the
//                      takes of one box made together (connected-video: one per shot, the same job and
//                      asset, each with a segment marked `by`), which become ONE generation (kind
//                      together) keyed by the take its segments name, with a segment per shot.
//                      kind: together | patch (a clip_patch job) | feel (a clip_edit job) | change (a
//                      parent) | clip. A spliced take's job-made segments become `patched`.
//   video.edl        → video.timeline. Each picked item in rank order is a V1 clip of its take's
//                      generation, laid end to end as the old render played them: the shot's length
//                      (its slot) from in_s (a together take: its shot's segment), held on its last
//                      frame when the footage is shorter (hold_s), an end-framed take retimed whole
//                      within 1.33x (speed). seam → transition_in (dissolve → dissolve, dip →
//                      dip_black; cut, match and continue are cuts). An item with no pick is dropped.
//   anything {kind: 'take', id} (note targets, checks …) → {kind: 'generation', id: the generation}
//   stale marks on takes → removed (takes no longer go stale).
//   jobs[].inputs kind take → generation; format_sets protect.takes → protect.generations and
//   reframes keyed by generation; sizes[].edl take_id → generation_id.
//
// Pure: the input is never changed. Times are rounded to the millisecond.

type Obj = Record<string, unknown>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const FPS = 24
const MAX_SPEED = 1.33
const MAX_HOLD_S = 10
const LAST_FRAME = 'last frame' // web/src/model/purpose.ts: a job input used as the clip's last frame
const r3 = (x: number) => Math.round(x * 1000) / 1000
const r6 = (x: number) => Math.round(x * 1e6) / 1e6
const ulidOf = (id: string) => id.slice(id.indexOf('_') + 1)
const PERSON = /^human:[A-Za-z0-9_:-]{1,128}$/

/** Whether the document still has takes or a video's edl: it has not moved to generations yet. */
export function needsGenerations(doc: unknown): boolean {
  const d = doc as Obj | null
  if (!d || typeof d !== 'object') return false
  if ('takes' in d || !('generations' in d)) return true
  return Object.values((d.videos ?? {}) as Record<string, Obj>).some((v) => v && typeof v === 'object' && ('edl' in v || !('timeline' in v)))
}

interface Segment { source_take?: string; in_s: number; out_s: number; job_id?: string; by?: string }
interface Take {
  id: string; v?: number; shot_id: string; parent_id?: string; asset: string; job_id: string; crew?: string; kind?: string
  model?: string; provider?: string; duration_s: number; quality?: string; size?: string; segments?: Segment[]; end?: Obj
}

/** A take made as one of a box's shots (connected-video): its segments carry `by`. */
const isTogether = (t: Take) => !!t.segments?.length && t.segments.some((s) => s.by !== undefined)

/**
 * The generation id each take becomes. Takes of one box made together share one: the id of the take
 * their segments name (source_take), else the smallest of them.
 */
export function generationIds(takes: Record<string, Take>): Map<string, string> {
  const groups = new Map<string, Take[]>()
  for (const t of Object.values(takes)) {
    const key = isTogether(t) ? `job:${t.job_id}|${t.asset}` : `take:${t.id}`
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const out = new Map<string, string>()
  for (const group of groups.values()) {
    const named = group.flatMap((t) => (t.segments ?? []).map((s) => s.source_take)).find((id) => id && group.some((t) => t.id === id))
    const rep = named ?? group.map((t) => t.id).sort()[0]
    for (const t of group) out.set(t.id, `gen_${ulidOf(rep)}`)
  }
  return out
}

function endFramed(d: Any, t: Take): boolean {
  if ((t.end as Any)?.kind === 'next_storyboard') return true
  return !!d.jobs?.[t.job_id]?.inputs?.some((r: Any) => r.used_as === LAST_FRAME && r.kind === 'take')
}

/** Replace every {kind: 'take', id} in `node` (in place) with its generation. */
function retarget(node: unknown, gen: (id: string) => string): void {
  if (Array.isArray(node)) {
    node.forEach((n) => retarget(n, gen))
    return
  }
  if (!node || typeof node !== 'object') return
  const o = node as Obj
  if (o.kind === 'take' && typeof o.id === 'string') {
    o.kind = 'generation'
    o.id = gen(o.id)
  }
  for (const v of Object.values(o)) retarget(v, gen)
}

/**
 * The document moved to generations and timelines. Returns a new object; `doc` is untouched. A document
 * that has already moved comes back as a copy, unchanged.
 */
export function migrateToGenerations<T>(doc: T): T {
  const d = structuredClone(doc) as Any
  if (!needsGenerations(d)) return d
  const takes: Record<string, Take> = d.takes ?? {}
  const ids = generationIds(takes)
  const gen = (takeId: string) => ids.get(takeId) ?? `gen_${ulidOf(takeId)}`
  const runOfJob = new Map<string, string>()
  for (const v of Object.values((d.videos ?? {}) as Record<string, Any>)) {
    for (const [runId, run] of Object.entries((v.runs ?? {}) as Record<string, Any>)) if (run.job_id) runOfJob.set(run.job_id, runId)
  }
  const jobOfTake = (t: Take) => d.jobs?.[t.job_id] as Any
  const fallbackBy = PERSON.test(String(d.project?.created_by)) ? d.project.created_by : 'human:unknown'

  // ── takes → generations ──
  const generations: Record<string, Any> = {}
  const members = new Map<string, Take[]>()
  for (const t of Object.values(takes)) members.set(gen(t.id), [...(members.get(gen(t.id)) ?? []), t])
  for (const [gid, group] of members) {
    const together = group.length > 1 || isTogether(group[0])
    const sorted = together
      ? [...group].sort((a, b) => (a.segments?.[0]?.in_s ?? 0) - (b.segments?.[0]?.in_s ?? 0))
      : group
    const rep = sorted.find((t) => gen(t.id) === `gen_${ulidOf(t.id)}`) ?? sorted[0]
    const job = jobOfTake(rep)
    // The parent: the take's own parent_id, else a take the job named as its source.
    let parent: string | undefined = rep.parent_id ? gen(rep.parent_id) : undefined
    if (!parent) {
      const src = job?.inputs?.find((r: Any) => r.kind === 'take' && r.ref && takes[r.ref])?.ref
        ?? Object.values(takes).find((t) => t.job_id !== rep.job_id && (job?.parent_ids ?? []).includes(t.job_id))?.id
      if (src && (job?.op === 'clip_patch' || job?.op === 'clip_edit')) parent = gen(src)
    }
    if (parent === gid) parent = undefined
    const op = job?.op
    const kind = together && !parent ? 'together'
      : op === 'clip_patch' && parent ? 'patch'
        : op === 'clip_edit' && parent ? 'feel'
          : parent ? 'change' : 'clip'
    const own = rep.segments ?? []
    const byPieces = own.filter((s) => s.by !== undefined)
    const segments = together && group.length > 1
      ? sorted.map((t) => {
        const s = (t.segments ?? []).find((x) => x.by !== undefined) ?? { in_s: 0, out_s: t.duration_s }
        return { shot_id: t.shot_id, in_s: r3(s.in_s), out_s: r3(s.out_s), ...(s.by ? { by: s.by } : {}) }
      })
      : byPieces.length
        ? [{ shot_id: rep.shot_id, in_s: r3(Math.min(...own.map((s) => s.in_s))), out_s: r3(Math.max(...own.map((s) => s.out_s))), by: byPieces[0].by }]
        : []
    const patched = own
      .filter((s) => s.job_id && s.by === undefined)
      .map((s) => ({ in_s: r3(s.in_s), out_s: r3(s.out_s), job_id: s.job_id!, ...(s.source_take ? { generation_id: gen(s.source_take) } : {}) }))
    const box = runOfJob.get(rep.job_id)
    const createdAt = typeof job?.created_at === 'string' ? job.created_at : d.project?.created_at
    const g: Any = {
      id: gid,
      v: Math.max(1, ...group.map((t) => t.v ?? 1)),
      field_v: {},
      kind,
      ...(parent ? { parent_id: parent } : {}),
      inputs: {
        ...(rep.model ? { model: rep.model } : {}),
        ...(rep.quality ? { quality: rep.quality } : {}),
        ...(rep.size ? { size: rep.size } : {}),
        length_s: rep.duration_s,
      },
      ...(box ? { box_id: box } : {}),
      shot_ids: [...new Set(sorted.map((t) => t.shot_id))],
      ...(segments.length ? { segments } : {}),
      ...(patched.length ? { patched } : {}),
      asset: rep.asset,
      duration_s: rep.duration_s,
      state: 'ready',
      job_id: rep.job_id,
      ...(rep.provider ? { provider: rep.provider } : {}),
      ...(rep.crew ? { crew: rep.crew } : {}),
      ...(rep.kind === 'mock' ? { mock: true } : {}),
      ...(rep.end ? { end: rep.end } : {}),
      created_at: createdAt,
      by: PERSON.test(String(job?.started_by)) ? job.started_by : fallbackBy,
    }
    generations[gid] = g
  }

  // ── video.edl → video.timeline ──
  for (const v of Object.values((d.videos ?? {}) as Record<string, Any>)) {
    const items = Object.entries((v.edl ?? {}) as Record<string, Any>).sort(([, a], [, b]) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    const timeline: Record<string, Any> = {}
    let at = 0
    let first = true
    items.forEach(([key, item], i) => {
      const t = item.pick?.current ? takes[item.pick.current] : undefined
      if (!t) return
      const g = generations[gen(t.id)]
      const shot = item.shot_id ? d.shots?.[item.shot_id] : undefined
      const seg = isTogether(t) ? (t.segments ?? []).find((s) => s.by !== undefined) : undefined
      const landed = (t.end as Any)?.at_s !== undefined ? r3((t.end as Any).at_s + 1 / FPS) : undefined
      const inS = seg ? seg.in_s : (item.in_s ?? 0)
      let end = seg ? seg.out_s : (item.out_s ?? landed ?? t.duration_s)
      end = Math.min(end, t.duration_s)
      const next = items.slice(i + 1).find(([, n]) => n.pick?.current && takes[n.pick.current])?.[1]
      const framed = endFramed(d, t)
      if (framed && next?.seam?.kind === 'continue') end -= 1 / FPS // the shared frame shows once
      const avail = Math.max(0, end - inS)
      const slot = typeof shot?.duration_s === 'number' ? shot.duration_s : avail
      let out = end
      let speed: number | undefined
      let hold: number | undefined
      const factor = slot > 0 ? avail / slot : 0
      if (framed && factor >= 1 / MAX_SPEED - 1e-6 && factor <= MAX_SPEED + 1e-6) {
        if (Math.abs(factor - 1) > 1e-6) speed = r6(Math.min(MAX_SPEED, Math.max(0.75, factor)))
      } else if (avail >= slot - 1e-9) {
        out = inS + slot
      } else if (slot - avail > 1e-3) {
        hold = r3(Math.min(MAX_HOLD_S, slot - avail))
      }
      if (out - inS <= 1e-6) return // nothing to show
      const seam = item.seam as { kind: string; s?: number } | undefined
      const transition = !first && seam && (seam.kind === 'dissolve' || seam.kind === 'dip')
        ? { kind: seam.kind === 'dip' ? 'dip_black' : 'dissolve', s: seam.s ?? 0.5 }
        : undefined
      const follows = { ...(g?.box_id ? { box_id: g.box_id } : {}), ...(item.shot_id ? { shot_id: item.shot_id } : {}) }
      timeline[`item_${ulidOf(key)}`] = {
        track: 'V1',
        start_s: r3(at),
        source: { generation_id: gen(t.id), in_s: r3(inS), out_s: r3(out) },
        ...(Object.keys(follows).length ? { follows } : {}),
        ...(transition ? { transition_in: transition } : {}),
        ...(speed !== undefined ? { speed } : {}),
        ...(hold !== undefined ? { hold_s: hold } : {}),
      }
      at += slot
      first = false
    })
    // timeline takes edl's place among the video's fields.
    const fields = Object.entries(v)
    for (const k of Object.keys(v)) delete v[k]
    for (const [k, val] of fields) {
      if (k === 'edl') v.timeline = timeline
      else if (k !== 'timeline') v[k] = val
    }
    v.timeline ??= timeline
    if (v.field_v) for (const k of Object.keys(v.field_v)) if (k === 'edl' || k.startsWith('edl/')) delete v.field_v[k]
  }

  // ── what pointed at takes ──
  for (const [name, map] of Object.entries(d as Record<string, unknown>)) {
    if (name === 'takes' || name === 'upstream' || name === 'project' || !map || typeof map !== 'object') continue
    retarget(map, gen)
  }
  for (const [id, s] of Object.entries((d.stale ?? {}) as Record<string, Any>)) {
    if (s.target?.kind === 'generation' || s.caused_by?.kind === 'generation') delete d.stale[id]
  }
  for (const j of Object.values((d.jobs ?? {}) as Record<string, Any>)) {
    for (const r of j.inputs ?? []) {
      if (r.kind === 'take') {
        r.kind = 'generation'
        if (r.ref) r.ref = gen(r.ref)
      }
    }
    if (Array.isArray(j.parent_ids)) j.parent_ids = [...new Set(j.parent_ids.map((p: string) => (p.startsWith('take_') ? gen(p) : p)))]
  }
  for (const f of Object.values((d.format_sets ?? {}) as Record<string, Any>)) {
    if (f.protect?.takes) {
      const byGen: Record<string, unknown> = {}
      for (const [tid, boxes] of Object.entries(f.protect.takes as Record<string, unknown>)) byGen[gen(tid)] ??= boxes
      delete f.protect.takes
      f.protect.generations = byGen
    }
    if (f.reframes) {
      const out: Record<string, Any> = {}
      for (const [key, r] of Object.entries(f.reframes as Record<string, Any>)) {
        const [tid, shape] = key.split('@')
        const nk = `${gen(tid)}@${shape}`
        if (out[nk]) continue
        const { take_id, ...rest } = r
        out[nk] = { generation_id: gen(take_id ?? tid), ...rest }
      }
      f.reframes = out
    }
  }
  for (const s of Object.values((d.sizes ?? {}) as Record<string, Any>)) {
    if (!Array.isArray(s.edl)) continue
    s.edl = s.edl.map((w: Any) => {
      if (!('take_id' in w)) return w
      const { take_id, ...rest } = w
      // Keep the window's place in the object: shot_id, then generation_id, then the rest.
      return { shot_id: rest.shot_id, generation_id: gen(take_id), ...rest }
    })
  }

  delete d.takes
  // generations sits where takes was, after videos.
  const ordered: Any = {}
  for (const [k, val] of Object.entries(d)) {
    ordered[k] = val
    if (k === 'videos') ordered.generations = generations
  }
  if (!('generations' in ordered)) ordered.generations = generations
  return ordered as T
}
