// What a person's write means, in the decision chain's words (contract 3).
//
// The panels name their writes with short internal actions ('name', 'publish',
// `submit ${op}`, …). This turns one into the entry the chain keeps, starting
// with a verb from production-tool/contracts/collab.md §8 ("name @maya_front",
// "start frame for shot 2", "pick take v2 for shot 3"), or null for
// bookkeeping (a job's state, an asset list), which is written quietly. The
// decision's targets come from the buses; ids in the words are for people.

import type { DocJob, NamedRef, ProductionDocument, View } from '../contracts/types'
import { framesOf, jobsList, keysList, refsList, reviewsList, shotName, shotsOf, takesOf } from '../model/selectors'
import type { Removal } from './remove'

export interface Described {
  action: string
  rationale?: string
  pinned?: boolean
  /** Mirror the .clan right after this is written (locks). */
  mirror?: boolean
  /** Consecutive writes with the same key fold into one entry (typing). */
  coalesce?: string
  /** What the decision rests on (addresses), e.g. the refs a job sends. */
  cites?: string[]
}

/** Written as data only: no decision-chain entry. */
const QUIET = new Set(['edit', 'stage', 'add picture', 'shot list', 'frame', 'take', 'ad', 'sync', 'set', 'set sync'])

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

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${m}:${r.toFixed(1).padStart(4, '0')}`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const at = (r: NamedRef) => `@${r.key}_${r.variant}`

/** The job a submit added. */
function describeSubmit(before: ProductionDocument, after: ProductionDocument): Described | null {
  const job: DocJob | undefined = jobsList(after).find((j) => !before.jobs[j.id])
  if (!job) return null
  const shotId = job.node.kind === 'shot' ? job.node.id : undefined
  const ids = tail(shotId, job.id)
  const where = shotId ? ` for ${shotName(after, shotId)}` : ''
  switch (job.op) {
    case 'generate':
      return { action: 'start generate', rationale: words(clip(job.text), ids) }
    case 'view':
      return { action: 'start view', rationale: words(ids) }
    case 'shot_list':
      return { action: 'start plan', rationale: words(clip(job.text), ids) }
    case 'frame':
      return { action: `start frame${where}`, rationale: words(job.purpose, clip(job.text), ids) }
    case 'region_edit':
      return { action: `start an edit of the frame${where}`, rationale: words(clip(job.text), ids) }
    case 'clip':
      return { action: `start clip${where}`, rationale: words(job.purpose, clip(job.text), ids) }
    case 'clip_edit':
      return { action: `start an edit of the clip${where}`, rationale: words(clip(job.text), ids) }
    case 'stitch':
      return { action: 'start the ad render', rationale: words(ids) }
    default:
      return { action: `start ${job.op}`, rationale: words(ids) }
  }
}

/** Names given, changed or taken off since `before`. */
function describeNames(before: ProductionDocument, after: ProductionDocument): Described | null {
  const said: string[] = []
  const ids: string[] = []
  for (const r of refsList(after)) {
    const p = before.refs[r.id]
    if (!p) said.push(`name ${at(r)}`)
    else if (at(p) !== at(r)) said.push(`name ${at(p)} ${at(r)}`)
    else if (p.asset !== r.asset) said.push(`set ${at(r)} to another image`)
    else if (p.role !== r.role) said.push(`set ${at(r)} as ${r.role}`)
    else continue
    ids.push(r.id)
  }
  for (const r of refsList(before)) {
    if (!after.refs[r.id]) {
      said.push(`delete the name ${at(r)}`)
      ids.push(r.id)
    }
  }
  for (const k of keysList(after)) {
    const p = before.keys[k.id]
    if (p && p.role !== k.role) said.push(`set ${k.key} as ${k.role}`)
  }
  if (!said.length) return null
  return { action: said.join('; '), rationale: words(tail(...ids)) }
}

/** The entry when a run of "Update what follows" ends: "render what follows: 2 frames, 2 clips, ad". */
export function describeFollow(run: { id: string; framesDone: string[]; clipsDone: string[]; adDone: boolean }, stopped = false): Described {
  const n = (k: number, one: string) => k && `${k} ${one}${k === 1 ? '' : 's'}`
  const what = [n(run.framesDone.length, 'frame'), n(run.clipsDone.length, 'clip'), run.adDone && 'ad'].filter(Boolean).join(', ') || 'nothing'
  return { action: `${stopped ? 'set the update stopped after' : 'render what follows:'} ${what}`, rationale: words(tail(...run.framesDone, ...run.clipsDone, run.id)) }
}

/** The entry for a delete ("delete frame frame_… (shot 2, v1)") or putting it back. */
export function describeRemoval(r: Removal, restoring = false): Described {
  return { action: `${restoring ? 'create again' : 'delete'} ${r.what}`, rationale: words(r.note, tail(...r.ids)) }
}

/** The chain entry for a write, or null to write it quietly. */
export function describeWrite(action: string, before: ProductionDocument, after: ProductionDocument): Described | null {
  if (action.startsWith('submit ')) return describeSubmit(before, after)
  if (action.startsWith('delete ') || action.startsWith('create again ')) return { action }
  if (action.startsWith('complete ')) return null
  if (QUIET.has(action)) return null
  switch (action) {
    // Sketch areas (features/frame-aspect.clan): a person's frame made into one, Fin's ask on one, its answer.
    case 'sketch area': {
      const s = Object.values(after.sketches).find((x) => !before.sketches[x.id])
      return s ? { action: `create sketch area ${s.ratio ?? `${s.aspect.w}:${s.aspect.h}`}`, rationale: words(`${s.aspect.w}×${s.aspect.h} from a frame`, s.id) } : null
    }
    case 'ask sketch': {
      const a = Object.values(after.asks).find((x) => !before.asks[x.id])
      return a ? { action: `ask ${a.question.text}`, rationale: words(`${a.crew} asks before sending`, tail(a.node.id, a.id)) } : null
    }
    case 'answer': {
      const a = Object.values(after.asks).find((x) => x.answers.length !== (before.asks[x.id]?.answers.length ?? 0))
      const last = a?.answers.at(-1)
      if (!a || !last) return null
      const chose = last.option_id ? a.question.options.find((o) => o.id === last.option_id)?.label ?? last.option_id : `"${last.text}"`
      return { action: `answer ${a.question.text}`, rationale: words(chose, tail(a.node.id, a.id)) }
    }
    case 'name':
      return describeNames(before, after)
    case 'publish': {
      const k = keysList(after).find((x) => x.library && x.library.ver !== before.keys[x.id]?.library?.ver)
      return k?.library ? { action: `publish ${k.key} to the ${k.library.shelf} shelf`, rationale: words(`version ${k.library.ver}`), mirror: true } : null
    }
    case 'import': {
      const k = keysList(after).find((x) => x.library && x.library.ver !== before.keys[x.id]?.library?.ver)
      return k?.library
        ? { action: `update_from_library ${k.key}`, rationale: words(`version ${k.library.ver}`, refsList(after).filter((r) => r.key === k.key).map(at).join(', ')) }
        : null
    }
    case 'clean up': {
      const gone = Object.keys(before.assets).length - Object.keys(after.assets).length
      return gone > 0 ? { action: `delete ${plural(gone, 'unused picture')}` } : null
    }
    case 'lock storyboard': {
      const shots = shotsOf(after)
      return { action: 'set the storyboard locked', rationale: words(`${shots.length} shots, ${shots.reduce((a, s) => a + s.duration_s, 0)} s`), pinned: true, mirror: true }
    }
    case 'select frame': {
      const shot = shotsOf(after).find((s) => s.pick?.current !== before.shots[s.id]?.pick?.current)
      if (!shot?.pick) return null
      const v = after.frames[shot.pick.current]?.version ?? framesOf(after, shot.id).length
      return { action: `pick frame v${v} for ${shotName(after, shot.id)}`, rationale: tail(shot.id, shot.pick.current) }
    }
    case 'pick take': {
      for (const v of Object.values(after.videos)) {
        for (const [itemId, item] of Object.entries(v.timeline)) {
          const now = item.source?.generation_id
          const was = before.videos[v.id]?.timeline?.[itemId]?.source?.generation_id
          const shotId = item.follows?.shot_id
          if (now && now !== was && shotId) {
            const n = takesOf(after, shotId).findIndex((t) => t.id === now) + 1
            return { action: `pick take v${n} for ${shotName(after, shotId)}`, rationale: tail(shotId, now) }
          }
        }
      }
      return null
    }
    case 'comment': {
      const r = reviewsList(after).find((x) => !before.reviews[x.id])
      if (!r) return null
      return { action: `create a note at ${fmtTime(r.at_s ?? 0)}`, rationale: words(clip(r.text ? `"${r.text}"` : undefined), r.region ? 'on a marked region' : undefined, r.target.id, r.id) }
    }
    case 'edit shot': {
      const changed = shotsOf(after).find((s) => before.shots[s.id] && JSON.stringify(before.shots[s.id]) !== JSON.stringify(s))
      if (!changed) return null
      const cam = [changed.camera.size, changed.camera.movement].filter(Boolean).join(', ')
      return { action: `set ${shotName(after, changed.id)}`, rationale: words(clip(changed.action, 200), `${cam}, ${changed.duration_s} s`, changed.id), coalesce: `edit shot ${changed.id}` }
    }
    case 'add shot': {
      const s = shotsOf(after).find((x) => !before.shots[x.id])
      return s ? { action: `create ${shotName(after, s.id)}`, rationale: s.id } : null
    }
    case 'move shot': {
      const s = shotsOf(after).find((x) => before.shots[x.id] && before.shots[x.id].rank !== x.rank)
      return s ? { action: `move ${shotName(after, s.id)}`, rationale: s.id } : null
    }
    default:
      return { action }
  }
}
