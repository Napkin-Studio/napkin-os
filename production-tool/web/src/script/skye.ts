// Skye in place (ui-behaviour 3.10, principle 10; features/script-editor.clan). No chat: a person
// presses a named option on one item (Tighten, Make it N s, Add a beat, Write the VO, Say it
// another way, a draft from one line, Cut him), that starts ONE relay `write` job, and its drafts
// land as suggestions on the item: nothing changes until Keep.
//
// The request carries the item's lines (mentions as their names now), the hash of its prose (the
// relay echoes it on each draft, so a draft lands after a reload and goes stale if the words
// moved), the rows around it (at most 4,000 characters) and the names of the references.

import { flatText, keepMine, keepSuggestion, newUlidId, proseHash, shapeProblem, type FragmentKind, type Prose } from '../../../clan-store/src'
import type { Id, Job, ProductionDocument, Suggestion, Write, WriteInput, WriteIntent, WriteLine, WriteTarget } from '../contracts/types'
import { landUpdate } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import type { FrameDeps } from '../jobs/frames'
import { landingWhy } from '../jobs/landing'
import { isActive } from '../jobs/runner'
import { proseFromText } from '../model/diff'
import type { ModelStore } from '../model/store'
import { composeScript } from './compose'
import { refNames } from './extensions'

type Doc = ProductionDocument

export const SKYE = 'Skye · scripts'
/** The options on Skye's bar, in its order. */
export const SKYE_OPTIONS: { intent: WriteIntent; label: (seconds: number) => string }[] = [
  { intent: 'tighten', label: () => 'Tighten' },
  { intent: 'fit_seconds', label: (s) => `Make it ${s} s` },
  { intent: 'add_beat', label: () => 'Add a beat' },
  { intent: 'write_vo', label: () => 'Write the VO' },
  { intent: 'rephrase', label: () => 'Say it another way' },
]
export const HANDS_OFF_LINE = 'Skye is leaving this alone. Ask her anyway?'
export const NOT_HERE = "Skye isn't available here yet"
export const QUOTA_OUT = "Skye has used today's writing allowance"
export const keptLine = (shotNo?: number, seconds?: number) => `Kept Skye's draft.${shotNo && seconds ? ` Shot ${shotNo} now runs ${seconds} s.` : ''}`
export const keptMineLine = (kind: WriteTarget['kind']) => `Kept yours. Skye will leave this ${kind} alone.`

const KIND: Record<WriteTarget['kind'], FragmentKind> = { scene: 'scene', shot: 'shot', beat: 'beat' }

/** An item's words as lines, a mention under its name now (checkpoint's flattening). */
export function linesOf(d: Doc, prose: Prose): WriteLine[] {
  const refs = refNames(d)
  return (prose.content ?? []).map((b) => ({ type: b.type as WriteLine['type'], text: flatText(b.content, refs).slice(0, 4000) }))
}

/** The rows around a target, as words, at most 4,000 characters: what Skye reads, never rewrites. */
export function neighbours(d: Doc, scriptId: Id, target: WriteTarget): string {
  const c = composeScript(d, scriptId)
  if (!c) return ''
  const id = target.kind === 'beat' ? d.beats[target.id]?.shot_id : target.id
  const words = c.rows.map((r) => {
    if (r.kind === 'scene') return { id: r.id, text: [r.scene.heading, r.scene.text].filter(Boolean).join('\n') }
    if (r.kind === 'shot' || r.kind === 'end_card') return { id: r.id, text: `Shot ${r.number}: ${r.shot.action ?? ''}` }
    return { id: r.id, text: `  ${r.beat.kind}${r.beat.speaker ? ` ${r.beat.speaker}` : ''}: ${r.beat.text ?? ''}` }
  })
  const at = Math.max(0, words.findIndex((w) => w.id === id))
  const around = [...words.slice(Math.max(0, at - 3), at), ...words.slice(at + 1, at + 4)].map((w) => w.text).filter((t) => t.trim())
  return around.join('\n').slice(0, 4000)
}

/** The seconds 'Make it N s' asks for: the shot's fair share of the target, in half seconds. */
export function fitSeconds(d: Doc, scriptId: Id, target: WriteTarget): number {
  const c = composeScript(d, scriptId)
  const target_s = c?.storyboard?.target_s ?? c?.script.target_s ?? 15
  const n = Math.max(1, c?.shots.length ?? 1)
  if (target.kind !== 'shot') return target_s
  return Math.max(0.5, Math.round((target_s / n) * 2) / 2)
}

/** Whether Skye leaves this item alone unless asked (Keep mine put skye in its hands_off). */
export function handsOff(d: Doc, target: WriteTarget): boolean {
  const map = { scene: d.scenes, shot: d.shots, beat: d.beats }[target.kind] as Record<string, { hands_off?: string[] }>
  return !!map[target.id]?.hands_off?.includes('skye')
}

/** The write request for one press. */
export async function writeInput(store: ModelStore, scriptId: Id, target: WriteTarget, intent: WriteIntent, opts: { selection?: { from: number; to: number; text: string }; seconds?: number; name?: string; explicit?: boolean } = {}): Promise<WriteInput> {
  const d = store.get()
  const prose = store.text.prose(KIND[target.kind], target.id)
  const script = d.scripts[scriptId]
  const sceneId = target.kind === 'scene' ? target.id : target.kind === 'shot' ? d.shots[target.id]?.scene_id : d.shots[d.beats[target.id]?.shot_id ?? '']?.scene_id
  const refs = Object.values(d.refs).map((r) => ({ name: `${r.key}_${r.variant}`, role: r.role, ...(r.label ? { label: r.label.slice(0, 120) } : {}) }))
  return {
    intent,
    target,
    base_hash: await proseHash(prose),
    lines: linesOf(d, prose),
    ...(opts.selection ? { selection: { ...opts.selection, text: opts.selection.text.slice(0, 4000) } } : {}),
    ...(opts.seconds ? { seconds: Math.min(60, Math.max(0.5, opts.seconds)) } : {}),
    ...(opts.name ? { name: opts.name.slice(0, 60) } : {}),
    ...(opts.explicit ? { explicit: true } : {}),
    context: {
      ...(script?.title ? { script_title: script.title.slice(0, 200) } : {}),
      target_s: composeScript(d, scriptId)?.storyboard?.target_s ?? script?.target_s ?? 15,
      ...(sceneId && d.scenes[sceneId]?.heading ? { scene_heading: d.scenes[sceneId].heading.slice(0, 200) } : {}),
      neighbours: neighbours(d, scriptId, target),
      refs: refs.slice(0, 64),
    },
  }
}

/** Start Skye on one item: one `write` job on the script. Resolves its id. */
export async function startWrite(deps: FrameDeps & { doc: ModelStore | DocumentStore }, store: ModelStore, scriptId: Id, target: WriteTarget, intent: WriteIntent, opts: Parameters<typeof writeInput>[4] = {}): Promise<string> {
  const input = await writeInput(store, scriptId, target, intent, opts)
  return deps.runner.submit('write', { write: input }, [], { for: 'write', scriptId })
}

/** Skye's write job running on a script now, if any, and the last one's trouble (off, or out of allowance). */
export function skyeState(d: Doc, scriptId: Id): { working?: string; off: boolean; quota: boolean } {
  const jobs = Object.values(d.jobs).filter((j) => j.op === 'write' && j.node.kind === 'script' && j.node.id === scriptId).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
  const working = jobs.find((j) => isActive(j.state))?.id
  const last = jobs.at(-1)
  return { ...(working ? { working } : {}), off: last?.error?.code === 'capability_missing', quota: last?.error?.code === 'quota_exhausted' }
}

/** A draft as the suggestion's proposed words, or null when its blocks do not fit the item. */
export function proposedOf(d: Doc, w: Write): Suggestion['proposed'] | null {
  const kind = KIND[w.target.kind]
  const lines = w.lines.map((l) => ({ type: l.type, text: l.type === 'direction' || kind === 'beat' ? l.text.replace(/\n/g, ' ') : l.text }))
  const prose = proseFromText(d, lines)
  if (kind === 'beat' && (prose.content?.length ?? 0) > 1) return null
  if (shapeProblem(kind, prose)) return null
  const proposed: Suggestion['proposed'] = { prose: prose as unknown as Suggestion['proposed']['prose'], text: lines.map((l) => l.text).join('\n').slice(0, 20000) }
  if (w.duration_s !== undefined) proposed.duration_s = w.duration_s
  if (w.new_beats?.length) {
    proposed.new_beats = w.new_beats.map((b) => ({
      kind: b.kind, at_s: b.at_s, ...(b.speaker ? { speaker: b.speaker } : {}),
      prose: proseFromText(d, [{ type: b.kind === 'line' ? 'dialogue' : 'action', text: b.text.replace(/\n/g, ' ') }]) as unknown as Suggestion['proposed']['prose'],
    }))
  }
  return proposed
}

/** A write job landed: each draft is a suggestion on its item, for the person who asked (Skye's decision, citing the job). */
export async function landWrites(store: DocumentStore, job: Job): Promise<string[]> {
  const d = store.get()
  const ids: string[] = []
  const made: Suggestion[] = []
  for (const w of job.writes ?? []) {
    const map = { scene: d.scenes, shot: d.shots, beat: d.beats }[w.target.kind] as Record<string, unknown>
    if (!map[w.target.id]) continue
    const proposed = proposedOf(d, w)
    if (!proposed) continue
    const id = newUlidId('sug')
    ids.push(id)
    made.push({ id, v: 1, field_v: {}, target: w.target, crew: 'skye', job_id: job.jobId, for: job.startedBy, base_hash: w.base_hash, proposed, note: w.note.slice(0, 200), state: 'open' })
  }
  if (!made.length) return []
  const n = made.length
  await landUpdate(store, (x) => { for (const s of made) x.suggestions[s.id] = s }, { ...landingWhy(store, job.jobId, `${n} ${n === 1 ? 'draft' : 'drafts'} in the script`), agent: 'skye' })
  return ids
}

/** An empty script's one line: the draft lands on the first scene (made if there is none). */
export async function draftFromLine(deps: FrameDeps, store: ModelStore, scriptId: Id, sceneId: Id): Promise<string> {
  return startWrite(deps, store, scriptId, { kind: 'scene', id: sceneId }, 'draft')
}

/** Keep: the words, the length and new beats, as Skye's, decided by the person; one undo step. */
export async function keep(store: ModelStore, sugId: string): Promise<{ line: string }> {
  await store.flush()
  const sug = store.get().suggestions[sugId]
  try {
    await keepSuggestion(store.bus, store.text, sugId)
  } finally {
    // Kept, or marked stale: show what the buses hold.
    await store.flush()
  }
  const shotNo = sug?.target.kind === 'shot' ? composeScript(store.get())?.shots.findIndex((s) => s.id === sug.target.id) : undefined
  const after = sug?.target.kind === 'shot' ? store.get().shots[sug.target.id]?.duration_s : undefined
  return { line: keptLine(shotNo !== undefined && shotNo >= 0 ? shotNo + 1 : undefined, sug?.proposed.duration_s !== undefined ? after : undefined) }
}

/** Keep mine: the draft goes and Skye leaves the item alone (hands_off). */
export async function keepMineDraft(store: ModelStore, sugId: string): Promise<{ line: string }> {
  await store.flush()
  const sug = store.get().suggestions[sugId]
  const r = await keepMine(store.bus, sugId)
  if (!r.applied) throw new Error(r.refused.map((x) => x.message).join('; ') || 'That could not be kept.')
  await store.flush()
  return { line: keptMineLine(sug?.target.kind ?? 'shot') }
}


/** Old → new, word by word (a longest-common-subsequence over words): struck, kept, underlined. */
export function wordDiff(a: string, b: string): { kind: 'same' | 'gone' | 'new'; text: string }[] {
  const x = a.split(/(\s+)/).filter(Boolean)
  const y = b.split(/(\s+)/).filter(Boolean)
  const n = x.length
  const m = y.length
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: { kind: 'same' | 'gone' | 'new'; text: string }[] = []
  const push = (kind: 'same' | 'gone' | 'new', text: string) => {
    const last = out.at(-1)
    if (last && last.kind === kind) last.text += text
    else out.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) { push('same', x[i]); i++; j++ } else if (L[i + 1][j] >= L[i][j + 1]) { push('gone', x[i]); i++ } else { push('new', y[j]); j++ }
  }
  while (i < n) push('gone', x[i++])
  while (j < m) push('new', y[j++])
  return out
}

