// What a participant's write means, in the decision chain's words.
//
// The panels name their writes with short internal actions ('pick front',
// 'sync refs', `submit ${op}`, …). This turns one into the entry the chain
// keeps ("picked as Front", "added ref @ref_a", "drew the frame for shot 2"),
// or null for bookkeeping (a job's state, an asset list, the stage), which is
// written without an entry. Ids go at the end of the rationale, so the History
// panel can find every entry about an item.

import type { DocJob, ProductionDocument, View } from '../contracts/types'
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

const VIEW_LABEL: Record<View, string> = { front: 'Front', three_quarter: '3/4', side: 'Side', back: 'Back', side_2: 'Side 2' }

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
      const refs = (input.refs ?? []).map((r) => `@${r.tag}`)
      const from = [input.sketch ? 'the sketch' : '', ...refs].filter(Boolean).join(', ')
      const more = (input.chips ?? []).includes('more_options')
      return { action: more ? 'generated front view options' : 'generated a front view', rationale: words(from && `from ${from}`, ids) }
    }
    case 'combine':
      return { action: `combined ${(input.refs ?? []).length} pictures`, rationale: words(clip(input.text ?? job.text), (input.refs ?? []).map((r) => `@${r.tag}`).join(', '), ids) }
    case 'view':
      return { action: `asked for the ${viewLabel(input.view ?? 'other')} view`, rationale: words(ids) }
    case 'shot_list':
      return { action: 'planned shots', rationale: words(input.targetS ? `${input.targetS} s` : undefined, clip(input.script ? `"${input.script}"` : undefined), ids) }
    case 'frame': {
      const again = ctx && 'parentFrameId' in ctx && ctx.parentFrameId
      return { action: again ? `made a new version of ${shotNo(after, shotId)}'s frame` : `drew the frame for ${shotNo(after, shotId)}`, rationale: words(clip(input.text), again ? `from ${ctx.parentFrameId}` : undefined, ids) }
    }
    case 'region_edit':
      return { action: `edited part of ${shotNo(after, shotId)}'s frame`, rationale: words(clip(input.text), ids) }
    case 'clip': {
      const again = ctx && 'parentTakeId' in ctx && ctx.parentTakeId
      return { action: again ? `made a new version of ${shotNo(after, shotId)}'s clip` : `made the clip for ${shotNo(after, shotId)}`, rationale: words(clip(input.text), again ? `from ${ctx.parentTakeId}` : undefined, ids) }
    }
    case 'clip_edit':
      return { action: `edited ${shotNo(after, shotId)}'s clip`, rationale: words(clip(input.text), input.feel?.strength ? `feel ${input.feel.strength}` : undefined, ctx && 'parentTakeId' in ctx ? ctx.parentTakeId : undefined, ids) }
    case 'stitch':
      return { action: 'rendered the ad', rationale: words(`${(input.clips ?? []).length} clips`, ids) }
    default:
      return { action: `started ${job.op}`, rationale: words(ids) }
  }
}

function describeRefs(before: ProductionDocument, after: ProductionDocument, restoring = false): Described | null {
  const was = new Map(before.character.refs.map((r) => [r.id, r]))
  const now = new Map(after.character.refs.map((r) => [r.id, r]))
  const said: string[] = []
  const ids: string[] = []
  for (const [id, r] of now) {
    const p = was.get(id)
    if (!p) {
      said.push(restoring ? `restored ref @${r.tag}` : `added ${r.kind === 'sketch' ? 'a drawing' : 'a picture'} as @${r.tag}`)
      ids.push(id, r.asset)
    } else if (p.role !== r.role) {
      said.push(`set @${r.tag} as ${r.role}`)
      ids.push(id)
    } else if (p.tag !== r.tag) {
      said.push(`tagged @${r.tag}`)
      ids.push(id)
    }
  }
  for (const [id, r] of was) {
    if (!now.has(id)) {
      said.push(`deleted ref @${r.tag}`)
      ids.push(id)
    }
  }
  if (!said.length) return null
  return { action: said.join('; '), rationale: words(tail(...ids)) }
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
  if (action.startsWith('pick ')) {
    const view = action.slice(5) as View
    const v = after.character.views[view]
    if (!v || before.character.views[view]?.asset === v.asset) return null
    return { action: `picked as ${viewLabel(view)}`, rationale: tail(v.asset, v.job_id) }
  }
  switch (action) {
    case 'sync refs':
      return describeRefs(before, after)
    case 'restore refs':
      return describeRefs(before, after, true)
    case 'tag': {
      const changed = after.character.refs.find((r) => {
        const p = before.character.refs.find((x) => x.id === r.id)
        return p && (p.tag !== r.tag || p.label !== r.label)
      })
      return changed ? { action: `tagged a ref @${changed.tag}`, rationale: words(changed.label && `"${changed.label}"`, changed.id) } : null
    }
    case 'lock character': {
      const views = Object.entries(after.character.views).map(([k, v]) => `${viewLabel(k)} ${v?.job_id ?? ''}`.trim())
      return { action: 'locked the character', rationale: words(views.join(', ')), pinned: true, mirror: true }
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
