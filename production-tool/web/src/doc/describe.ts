// What a participant's write means, in the decision chain's words.
//
// The panels name their writes with short internal actions ('name', 'publish',
// `submit ${op}`, …). This turns one into the entry the chain keeps ("named
// @maya_front", "generated from 3 inputs", "drew the frame for shot 2"),
// or null for bookkeeping (a job's state, an asset list, the stage), which is
// written without an entry. Ids go at the end of the rationale, so the History
// panel can find every entry about an item.

import type { DocJob, NamedRef, ProductionDocument, View } from '../contracts/types'
import type { Removal } from './remove'
import type { JobCtx } from './ui'

export interface Described {
  action: string
  rationale?: string
  pinned?: boolean
  /** Mirror the .clan right after this is written (locks). */
  mirror?: boolean
  /** Consecutive writes with the same key fold into one entry (typing). */
  coalesce?: string
}

export type JobCtxOf = (jobId: string) => JobCtx | undefined

/** Written as data only: no decision-chain entry. */
const QUIET = new Set([
  'edit', 'stage', 'add picture', 'script revision', 'shot list', 'frame', 'take', 'ad', 'sync',
])

const VIEW_LABEL: Record<View, string> = { front: 'Front', 'three-quarter': '3/4', side: 'Side', back: 'Back' }

export function viewLabel(v: string): string {
  return VIEW_LABEL[v as View] ?? v
}

const tail = (...ids: (string | undefined)[]) => ids.filter(Boolean).join(' · ')

function words(...parts: (string | undefined | false)[]): string | undefined {
  const t = parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join(' · ')
  return t || undefined
}

function clip(s: string | undefined, n = 300): string | undefined {
  if (!s) return undefined
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

function shotNo(d: ProductionDocument, shotId: string | undefined): string {
  const s = (d.shots ?? []).find((x) => x.id === shotId)
  return s ? `shot ${s.order}` : 'a shot'
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${m}:${r.toFixed(1).padStart(4, '0')}`
}

function describeSubmit(before: ProductionDocument, after: ProductionDocument, ctxOf: JobCtxOf): Described | null {
  const known = new Set(before.jobs.map((j) => j.id))
  const job: DocJob | undefined = after.jobs.find((j) => !known.has(j.id))
  if (!job) return null
  const ctx = ctxOf(job.id)
  const input = ctx?.request.input ?? {}
  const shotId = ctx && 'shotId' in ctx ? ctx.shotId : undefined
  const ids = tail(shotId, job.id)
  switch (job.op) {
    case 'generate': {
      const refs = input.refs ?? []
      const named = refs.filter((r) => r.name).map((r) => `@${r.name}`)
      const drawings = refs.filter((r) => !r.name && r.kind === 'drawing').length
      const others = refs.filter((r) => !r.name && r.kind !== 'drawing').length
      const from = [...named, drawings && plural(drawings, 'drawing'), others && plural(others, 'picture')].filter(Boolean).join(', ')
      const more = (input.chips ?? []).includes('more_options')
      return { action: more ? 'generated options' : `generated from ${plural(refs.length || 1, 'input')}`, rationale: words(clip(input.text ?? job.text), from && `from ${from}`, ids) }
    }
    case 'view':
      return { action: `asked for the ${viewLabel(input.view ?? 'other')} view`, rationale: words(ids) }
    case 'shot_list':
      return { action: 'planned shots', rationale: words(input.targetS ? `${input.targetS} s` : undefined, clip(input.script ? `"${input.script}"` : undefined), ids) }
    case 'frame': {
      const again = ctx && 'parentFrameId' in ctx && ctx.parentFrameId
      const how = ctx && ctx.for === 'frame' ? ctx.how : undefined
      const from = words(input.anchorFrame && 'kept the setting of frame 1', input.previousFrame && 'continued from the frame before')
      if (how === 'update') return { action: `drew ${shotNo(after, shotId)}'s frame again`, rationale: words('updating what follows', from, ids) }
      if (again) return { action: `made a new version of ${shotNo(after, shotId)}'s frame`, rationale: words(clip(input.text), `from ${ctx.parentFrameId}`, from, ids) }
      if (how === 'first') return { action: 'drew frame 1', rationale: words((input.refs ?? []).map((r) => r.name && `@${r.name}`).filter(Boolean).join(', '), ids) }
      if (how === 'next') return { action: `drew the next frame (${shotNo(after, shotId)})`, rationale: words(clip(input.text), from, ids) }
      if (how === 'rest') return { action: 'drew the rest', rationale: words(`starting with ${shotNo(after, shotId)}`, from, ids) }
      if (how === 'chain') return { action: `drew the next frame (${shotNo(after, shotId)})`, rationale: words('drawing the rest', from, ids) }
      return { action: `drew the frame for ${shotNo(after, shotId)}`, rationale: words(clip(input.text), from, ids) }
    }
    case 'region_edit':
      if (ctx?.for === 'frame' && ctx.fixReviewIds?.length) return { action: `fixed ${shotNo(after, shotId)}'s frame for a note on its clip`, rationale: words(clip(input.text), 'then a new clip from it', ids) }
      return { action: `edited part of ${shotNo(after, shotId)}'s frame`, rationale: words(clip(input.text), ids) }
    case 'clip': {
      const again = ctx && 'parentTakeId' in ctx && ctx.parentTakeId
      if (ctx?.for === 'clip' && ctx.followRun) return { action: `made ${shotNo(after, shotId)}'s clip again`, rationale: words('updating what follows', again ? `from ${ctx.parentTakeId}` : undefined, ids) }
      return { action: again ? `made a new version of ${shotNo(after, shotId)}'s clip` : `made the clip for ${shotNo(after, shotId)}`, rationale: words(clip(input.text), again ? `from ${ctx.parentTakeId}` : undefined, ids) }
    }
    case 'clip_edit':
      return { action: `edited ${shotNo(after, shotId)}'s clip`, rationale: words(clip(input.text), input.feel?.strength ? `feel ${input.feel.strength}` : undefined, ctx && 'parentTakeId' in ctx ? ctx.parentTakeId : undefined, ids) }
    case 'stitch':
      return { action: 'rendered the ad', rationale: words(`${(input.clips ?? []).length} clips`, ctx?.for === 'stitch' && ctx.followRun ? 'updating what follows' : undefined, ids) }
    default:
      return { action: `started ${job.op}`, rationale: words(ids) }
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const at = (r: NamedRef) => `@${r.key}_${r.variant}`

/** Names given, changed or taken off since `before`. */
function describeNames(before: ProductionDocument, after: ProductionDocument): Described | null {
  const was = new Map(before.refs.map((r) => [r.id, r]))
  const now = new Map(after.refs.map((r) => [r.id, r]))
  const said: string[] = []
  const ids: string[] = []
  for (const [id, r] of now) {
    const p = was.get(id)
    if (!p) said.push(`named ${at(r)}`)
    else if (at(p) !== at(r)) said.push(`renamed ${at(p)} to ${at(r)}`)
    else if (p.asset !== r.asset) said.push(`${at(r)} now shows another image`)
    else continue
    ids.push(id, r.asset)
  }
  for (const [id, r] of was) {
    if (!now.has(id)) {
      said.push(`took the name ${at(r)} off`)
      ids.push(id)
    }
  }
  for (const k of after.keys) {
    const p = before.keys.find((x) => x.key === k.key)
    if (p && p.role !== k.role) said.push(`set ${k.key} as ${k.role}`)
  }
  if (!said.length) return null
  return { action: said.join('; '), rationale: words(tail(...ids)) }
}

/** The entry when a run of "Update what follows" ends: "updated what follows: 2 frames, 2 clips, ad". */
export function describeFollow(run: { id: string; framesDone: string[]; clipsDone: string[]; adDone: boolean }, stopped = false): Described {
  const n = (k: number, one: string) => k && `${k} ${one}${k === 1 ? '' : 's'}`
  const what = [n(run.framesDone.length, 'frame'), n(run.clipsDone.length, 'clip'), run.adDone && 'ad'].filter(Boolean).join(', ') || 'nothing'
  return { action: `${stopped ? 'stopped updating what follows after' : 'updated what follows:'} ${what}`, rationale: words(tail(...run.framesDone, ...run.clipsDone, run.id)) }
}

/** The entry for a delete ("deleted frame frame_… (shot 2, v1)") or its undo ("restored …"). */
export function describeRemoval(r: Removal, restoring = false): Described {
  return { action: `${restoring ? 'restored' : 'deleted'} ${r.what}`, rationale: words(r.note, tail(...r.ids)) }
}

/** The chain entry for a write, or null to write it without one. */
export function describeWrite(action: string, before: ProductionDocument, after: ProductionDocument, ctxOf: JobCtxOf = () => undefined): Described | null {
  if (action.startsWith('submit ')) return describeSubmit(before, after, ctxOf)
  // Deletes and their undo are named where they happen (remove.ts, describeRemoval).
  if (action.startsWith('deleted ') || action.startsWith('restored ')) return { action }
  if (action.startsWith('complete ')) return null
  if (QUIET.has(action)) return null
  switch (action) {
    case 'name':
      return describeNames(before, after)
    case 'publish': {
      const k = after.keys.find((x) => x.library && x.library.ver !== before.keys.find((y) => y.key === x.key)?.library?.ver)
      return k?.library ? { action: `published ${k.key} to the ${k.library.workspace} library`, rationale: words(`version ${k.library.ver}`), mirror: true } : null
    }
    case 'import': {
      const k = after.keys.find((x) => x.library && x.library.ver !== before.keys.find((y) => y.key === x.key)?.library?.ver)
      return k?.library ? { action: `imported ${k.key} from the library`, rationale: words(`version ${k.library.ver} by @${k.library.by}`, after.refs.filter((r) => r.key === k.key).map(at).join(', ')) } : null
    }
    case 'clean up': {
      const gone = before.assets.length - after.assets.length
      return gone > 0 ? { action: `cleaned up ${plural(gone, 'unused picture')}` } : null
    }
    case 'lock storyboard': {
      const shots = after.shots ?? []
      return { action: 'locked the storyboard', rationale: words(`${shots.length} shots, ${shots.reduce((a, s) => a + s.duration_s, 0)} s`, after.script?.current), pinned: true, mirror: true }
    }
    case 'select frame': {
      const changed = (after.frames ?? []).find((f) => f.selected && !(before.frames ?? []).find((x) => x.id === f.id)?.selected)
      return changed ? { action: `picked a frame for ${shotNo(after, changed.shot_id)}`, rationale: tail(changed.shot_id, changed.id, changed.job_id) } : null
    }
    case 'pick take': {
      const changed = (after.takes ?? []).find((t) => t.selected && !(before.takes ?? []).find((x) => x.id === t.id)?.selected)
      if (!changed) return null
      const n = (after.takes ?? []).filter((t) => t.shot_id === changed.shot_id).findIndex((t) => t.id === changed.id) + 1
      return { action: `picked take v${n} for ${shotNo(after, changed.shot_id)}`, rationale: tail(changed.shot_id, changed.id, changed.job_id) }
    }
    case 'comment': {
      const known = new Set((before.reviews ?? []).map((r) => r.id))
      const r = (after.reviews ?? []).find((x) => !known.has(x.id))
      if (!r) return null
      return { action: `noted at ${fmtTime(r.at_s ?? 0)}`, rationale: words(clip(`"${r.comment}"`), r.region ? 'on a marked region' : undefined, r.target.id, r.id) }
    }
    case 'edit shot': {
      const changed = (after.shots ?? []).find((s) => {
        const p = (before.shots ?? []).find((x) => x.id === s.id)
        return p && JSON.stringify(p) !== JSON.stringify(s)
      })
      if (!changed) return null
      return { action: `edited ${shotNo(after, changed.id)}`, rationale: words(clip(changed.action, 200), `${changed.composition}, ${changed.camera_move}, ${changed.duration_s} s`, changed.id), coalesce: `edit shot ${changed.id}` }
    }
    case 'add shot': {
      const known = new Set((before.shots ?? []).map((s) => s.id))
      const s = (after.shots ?? []).find((x) => !known.has(x.id))
      return s ? { action: `added shot ${s.order}`, rationale: s.id } : null
    }
    case 'sign in':
      return { action: `signed in as @${after.participant.handle}`, rationale: after.participant.id }
    default:
      return { action }
  }
}
