// Skye in place (ui-behaviour 3.10, principle 10; features/script-editor.clan). No chat: a person
// presses a named option on one item (Tighten, Make it N s, Add a beat, Write the VO, Say it
// another way, a draft from one line, Cut him), that starts ONE relay `write` job, and its drafts
// land as suggestions on the item: nothing changes until Keep.
//
// The request carries the item's lines (mentions as their names now), the hash of its prose (the
// relay echoes it on each draft, so a draft lands after a reload and goes stale if the words
// moved), the rows around it (at most 4,000 characters) and the names of the references.

import { EMPTY_PROSE, flatText, keepMine, keepSuggestion, newUlidId, proseHash, rankBetween, shapeProblem, type FragmentKind, type Prose } from '../../../clan-store/src'
import type { Ask, Id, Job, JobState, ProductionDocument, Suggestion, Write, WriteInput, WriteIntent, WriteMode, WriteLine, WriteTarget } from '../contracts/types'
import { writeMode } from '../contracts/types'
import { landUpdate } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import type { FrameDeps } from '../jobs/frames'
import { landingWhy } from '../jobs/landing'
import { askOf, isActive } from '../jobs/runner'
import { proseFromText } from '../model/diff'
import { ModelStore } from '../model/store'
import { keyViews } from '../lib/names'
import { keysList, scenesOf } from '../model/selectors'
import { composeScript } from './compose'
import { refNames } from './extensions'

type Doc = ProductionDocument

export const SKYE = 'Script agent'
/** The options on Skye's bar, in its order. */
export const SKYE_OPTIONS: { intent: WriteIntent; label: (seconds: number) => string }[] = [
  { intent: 'tighten', label: () => 'Tighten' },
  { intent: 'fit_seconds', label: (s) => `Make it ${s} s` },
  { intent: 'add_beat', label: () => 'Add a beat' },
  { intent: 'write_vo', label: () => 'Write the VO' },
  { intent: 'rephrase', label: () => 'Say it another way' },
]
/** The free 'Tell Skye' field beside the canned verbs: the typed words ride as the write's instruction. */
export const TELL_SKYE_PLACEHOLDER = 'Tell the Script agent…'
export const HANDS_OFF_LINE = 'The Script agent is leaving this alone. Ask it anyway?'
export const NOT_HERE = "The Script agent isn't available here yet"
export const QUOTA_OUT = "The Script agent has used today's writing allowance"
export const keptLine = (shotNo?: number, seconds?: number) => `Kept the Script agent's draft.${shotNo && seconds ? ` Shot ${shotNo} now runs ${seconds} s.` : ''}`
/** Skye's line when the scene she drafted for was gone and her draft became a new first scene (owner 2026-10-15). */
export const NEW_SCENE_LINE = 'That scene was gone, so I put my draft in a new first scene. Undo takes it back.'
export const keptMineLine = (kind: WriteTarget['kind']) => `Kept yours. The Script agent will leave this ${kind} alone.`

const KIND: Record<WriteTarget['kind'], FragmentKind> = { scene: 'scene', shot: 'shot', beat: 'beat' }

/** An item's words as lines, a mention under its name now (checkpoint's flattening). */
export function linesOf(d: Doc, prose: Prose): WriteLine[] {
  const refs = refNames(d)
  return (prose.content ?? []).map((b) => ({ type: b.type as WriteLine['type'], text: flatText(b.content, refs).slice(0, 4000) }))
}

/** The rows around a target, as words, at most 4,000 characters: what Skye reads, never rewrites. A shot or a beat
 *  reads the three rows before and after it; a scene (a whole-script ask) reads every other row of the script, its
 *  shots and their lines, so an ask after Plan shots sees the script (UAT round 3, R3-F3: it saw shots 1-3 only). */
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
  const around = target.kind === 'scene'
    ? words.filter((w) => w.id !== id)
    : [...words.slice(Math.max(0, at - 3), at), ...words.slice(at + 1, at + 4)]
  return around.map((w) => w.text).filter((t) => t.trim()).join('\n').slice(0, 4000)
}

const ASK_STOP = new Set(['make', 'more', 'less', 'line', 'lines', 'shot', 'shots', 'scene', 'script', 'words', 'word', 'with', 'that', 'this',
  'than', 'then', 'them', 'they', 'into', 'from', 'about', 'some', 'have', 'just', 'also', 'please', 'whole', 'change', 'write', 'rewrite',
  'funnier', 'better', 'shorter', 'longer', 'again', 'there', 'their', 'where', 'when', 'what', 'which', 'would', 'could', 'should'])
const stems = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !ASK_STOP.has(w)).map((w) => w.slice(0, 5)))

/** A scene's shot rows (its shots, their beats; the end card too), in order: on a script of one scene, every shot. */
function sceneRows(d: Doc, scriptId: Id, sceneId: Id) {
  const c = composeScript(d, scriptId)
  if (!c) return []
  const lone = c.rows.filter((r) => r.kind === 'scene').length <= 1
  const inScene = (shotId: Id) => lone || d.shots[shotId]?.scene_id === sceneId
  return c.rows.filter((r) => (r.kind === 'shot' || r.kind === 'end_card') ? inScene(r.id) : r.kind === 'beat' ? inScene(r.shotId) : false)
}

/** A scene's words as the Script agent reads them. Its own prose when it has words; once Plan shots made them into
 *  shots (its prose is empty), its shots' words, each spoken line and voice-over as a cue and its dialogue, and the
 *  other beats as action lines (UAT round 4, R4-F3: the request went with lines [{action: ""}], so a length ask dropped
 *  "Good boy." and the brief's end line, which skye.v7 keeps only when they are in the lines). */
export function sceneLines(d: Doc, scriptId: Id, sceneId: Id, prose: Prose): WriteLine[] {
  const own = linesOf(d, prose)
  if (own.some((l) => l.text.trim())) return own
  const out: WriteLine[] = []
  for (const r of sceneRows(d, scriptId, sceneId)) {
    if (r.kind === 'shot' || r.kind === 'end_card') {
      if (r.shot.action?.trim()) out.push({ type: 'action', text: r.shot.action.trim().slice(0, 4000) })
      continue
    }
    if (r.kind !== 'beat') continue
    const b = r.beat
    const text = (b.text ?? '').trim()
    if (!text) continue
    if (b.kind === 'line' || b.kind === 'vo') {
      const who = (b.speaker?.trim() || (b.kind === 'vo' ? 'NARRATOR' : 'SOMEONE')).toUpperCase()
      out.push({ type: 'character', text: b.kind === 'vo' && !/\(V\.?O\.?\)/i.test(who) ? `${who} (V.O.)` : who })
      if (b.parenthetical?.trim()) out.push({ type: 'parenthetical', text: b.parenthetical.trim().replace(/^\((.*)\)$/s, '$1') })
      out.push({ type: 'dialogue', text: text.slice(0, 4000) })
    } else {
      out.push({ type: 'action', text: `${b.kind.charAt(0).toUpperCase()}${b.kind.slice(1)}: ${text}`.slice(0, 4000) })
    }
  }
  return out.length ? out : own
}

/** A scene's length now: its own words by the band's rule while it has words; its shots' seconds once Plan shots made
 *  them (R4-F3: "about 0 s -> 8 s" for a scene of 10 s of shots). Undefined: it has neither. */
export function sceneShotSeconds(d: Doc, scriptId: Id, sceneId: Id): number | undefined {
  const shots = sceneRows(d, scriptId, sceneId).filter((r) => r.kind === 'shot' || r.kind === 'end_card') as { shot: { duration_s: number } }[]
  if (!shots.length) return undefined
  return Math.round(shots.reduce((a, r) => a + (r.shot.duration_s ?? 0), 0) * 10) / 10
}

/** A free ask whose words fit two shots or more equally (UAT round 4, R4-F3, UX 3): the Booth asks which one, rather
 *  than writing for the whole scene blind. */
export class WhichItem extends Error {
  readonly choices: { target: WriteTarget; label: string }[]
  constructor(choices: { target: WriteTarget; label: string }[]) {
    super(`Which one is it about: ${choices.map((c) => c.label).join(' or ')}?`)
    this.name = 'WhichItem'
    this.choices = choices
  }
}

/**
 * The one item a whole-script ask is about, once Plan shots made the scene's words into shots and lines and its own
 * text is empty (UAT round 3, R3-F3: "Make the snoring line funnier" went with lines [] and Skye said the scene had
 * no snoring line). Each shot is scored by the ask's words its action and its beats share; the shot that shares the
 * most wins, and inside it the line the most is about (its action when a beat does not share more). Two shots that
 * share as much: `tie`, the shots to ask about (R4-F3: "snoring" was in shot 4's action and sound and shot 5's action,
 * and the ask fell back to the scene). Nothing shared: neither.
 */
export function askedItems(d: Doc, scriptId: Id, sceneId: Id, instruction: string): { pick?: WriteTarget; tie?: { target: WriteTarget; label: string }[] } {
  const asked = stems(instruction)
  if (!asked.size) return {}
  const score = (t: string) => [...stems(t)].filter((w) => asked.has(w)).length
  const shots: { id: Id; number: number; action: string; n: number; best: { t: WriteTarget; n: number } }[] = []
  for (const r of sceneRows(d, scriptId, sceneId)) {
    if (r.kind === 'shot') {
      const n = score(r.shot.action ?? '')
      shots.push({ id: r.id, number: r.number, action: r.shot.action ?? '', n, best: { t: { kind: 'shot', id: r.id }, n } })
    } else if (r.kind === 'beat') {
      const sh = shots.find((x) => x.id === r.shotId)
      if (!sh) continue
      const n = score(r.beat.text ?? '')
      sh.n += n
      if (n > sh.best.n) sh.best = { t: { kind: 'beat', id: r.id }, n }
    }
  }
  const ranked = shots.filter((x) => x.n > 0).sort((a, b) => b.n - a.n)
  if (!ranked.length) return {}
  if (ranked.length > 1 && ranked[0].n === ranked[1].n) {
    const tied = ranked.filter((x) => x.n === ranked[0].n).sort((a, b) => a.number - b.number)
    const words = (t: string) => { const w = t.replace(/@([a-z0-9_]+)/gi, '$1').trim(); return w.length > 40 ? `${w.slice(0, 39)}…` : w }
    return { tie: tied.map((x) => ({ target: { kind: 'shot' as const, id: x.id }, label: `Shot ${x.number}${x.action.trim() ? ` (${words(x.action)})` : ''}` })) }
  }
  return { pick: ranked[0].best.t }
}

/** The one item an ask is about, or undefined (no single one: none shares words, or two shots share as many). */
export function askedItem(d: Doc, scriptId: Id, sceneId: Id, instruction: string): WriteTarget | undefined {
  return askedItems(d, scriptId, sceneId, instruction).pick
}

/** The seconds 'Make it N s' asks for: the shot's fair share of the target, in half seconds. */
export function fitSeconds(d: Doc, scriptId: Id, target: WriteTarget): number {
  const c = composeScript(d, scriptId)
  const target_s = c?.storyboard?.target_s ?? c?.script.target_s ?? 15
  const n = Math.max(1, c?.shots.length ?? 1)
  if (target.kind !== 'shot') return target_s
  return Math.max(0.5, Math.round((target_s / n) * 2) / 2)
}

/** The names Skye may write (context.refs): each whole key by its bare name first (owner 2026-10-15: Skye was
 *  given only the views, so "@samurai is not in the references" and it wrote @samurai_front, @samurai_side…
 *  instead), labelled with its views, then every view by its own name. */
export function writeRefs(d: Doc): WriteInput['context']['refs'] {
  const keys = keysList(d).flatMap((k) => {
    const { views } = keyViews(d, k.key)
    return views.length ? [{ name: k.key, role: k.role, label: `the whole ${k.role}: ${views.map((v) => v.variant).join(', ')}`.slice(0, 120) }] : []
  })
  const views = Object.values(d.refs).map((r) => ({ name: `${r.key}_${r.variant}`, role: r.role, ...(r.label ? { label: r.label.slice(0, 120) } : {}) }))
  return [...keys, ...views]
}

/** Whether Skye leaves this item alone unless asked (Keep mine put skye in its hands_off). */
export function handsOff(d: Doc, target: WriteTarget): boolean {
  const map = { scene: d.scenes, shot: d.shots, beat: d.beats }[target.kind] as Record<string, { hands_off?: string[] }>
  return !!map[target.id]?.hands_off?.includes('skye')
}

/** The write request for one press. `instruction` carries a draft's brief or a free 'Tell Skye' ask;
 *  it is never planted in the document, so the item's `lines` stay the writer's own. */
export async function writeInput(store: ModelStore, scriptId: Id, asked: WriteTarget, intent: WriteIntent, opts: { mode?: WriteMode; instruction?: string; selection?: { from: number; to: number; text: string }; seconds?: number; name?: string; explicit?: boolean } = {}): Promise<WriteInput> {
  const d = store.get()
  // A free ask on a scene whose words Plan shots made into shots goes to the shot or line it is about (R3-F3).
  const planned = asked.kind === 'scene' && intent === 'instruct' && !opts.selection && !!opts.instruction?.trim()
    && !linesOf(d, store.text.prose('scene', asked.id)).some((l) => l.text.trim())
  const found = planned ? askedItems(d, scriptId, asked.id, opts.instruction!) : {}
  // Two shots fit the ask as well: ask which (R4-F3, UX 3), never write for the whole scene blind.
  if (found.tie) throw new WhichItem(found.tie)
  const target = found.pick ?? asked
  const prose = store.text.prose(KIND[target.kind], target.id)
  const script = d.scripts[scriptId]
  const sceneId = target.kind === 'scene' ? target.id : target.kind === 'shot' ? d.shots[target.id]?.scene_id : d.shots[d.beats[target.id]?.shot_id ?? '']?.scene_id
  const refs = writeRefs(d)
  const mode = writeMode({ intent, mode: opts.mode })
  return {
    intent,
    mode,
    target,
    base_hash: await proseHash(prose),
    ...(opts.instruction?.trim() ? { instruction: opts.instruction.trim().slice(0, 4000) } : {}),
    // A scene Plan shots made into shots reads as its shots and their lines (R4-F3).
    lines: target.kind === 'scene' ? sceneLines(d, scriptId, target.id, prose) : linesOf(d, prose),
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

/**
 * Skye's write job on a script now: `working` while she writes, `waiting` (its question) while it waits on
 * the person (needs_input: no "I'm writing that now", owner 2026-10-15), `newScene` when her last draft
 * became a new first scene, and the last one's trouble (off, or out of allowance). `liveState`: the runner's state, ahead of the document's.
 */
export function skyeState(d: Doc, scriptId: Id, liveState: (jobId: string) => JobState | undefined = () => undefined): { working?: string; waiting?: { jobId: string; ask?: Ask }; newScene?: Id; off: boolean; quota: boolean } {
  const jobs = Object.values(d.jobs).filter((j) => j.op === 'write' && j.node.kind === 'script' && j.node.id === scriptId).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
  const state = (id: string) => liveState(id) ?? d.jobs[id].state
  const working = jobs.find((j) => isActive(state(j.id)) && state(j.id) !== 'needs_input')?.id
  const asking = jobs.find((j) => state(j.id) === 'needs_input')
  const ask = asking ? askOf(d, asking.id) : undefined
  const last = jobs.at(-1)
  // Her last draft had no scene to go to and is a new first scene now (landWrites): she says so until the next press.
  const newScene = last && last.state === 'completed' && d.scenes[sceneForJob(last.id)] ? sceneForJob(last.id) : undefined
  return {
    ...(working ? { working } : {}),
    ...(newScene ? { newScene } : {}),
    ...(asking ? { waiting: { jobId: asking.id, ...(ask && ask.state === 'open' ? { ask } : {}) } } : {}),
    off: last?.error?.code === 'capability_missing', quota: last?.error?.code === 'quota_exhausted',
  }
}

/** What Skye says in the facts while a job of hers waits on the person: the question itself. */
export const waitingLine = (ask?: Ask) => (ask ? `Waiting for you: ${ask.question.text}` : 'Waiting for you: The Script agent has a question about a draft.')

/**
 * Skye's waiting questions on a script and where each shows (owner 2026-10-15: "Draft the scene as
 * written?" was shown nowhere): on the item the draft was for while it is on the page (a beat on its shot,
 * since only the current shot's beats show), else `null`, the top of the page, where the work started.
 * `targetOf`: the item a job was asked about (this browser's request; another person's is not known here).
 */
export function skyeAsks(d: Doc, scriptId: Id, targetOf: (jobId: string) => WriteTarget | undefined,
  liveState: (jobId: string) => JobState | undefined = () => undefined): { ask: Ask; jobId: string; at: WriteTarget | null }[] {
  const c = composeScript(d, scriptId)
  const onPage = new Set((c?.rows ?? []).filter((r) => r.kind === 'scene' || r.kind === 'shot' || r.kind === 'end_card').map((r) => `${r.kind === 'end_card' ? 'shot' : r.kind}:${r.id}`))
  const out: { ask: Ask; jobId: string; at: WriteTarget | null }[] = []
  for (const j of Object.values(d.jobs).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    if (j.op !== 'write' || j.node.kind !== 'script' || j.node.id !== scriptId || (liveState(j.id) ?? j.state) !== 'needs_input') continue
    const ask = askOf(d, j.id)
    if (!ask || ask.state !== 'open') continue
    const t = targetOf(j.id)
    const at: WriteTarget | null = !t ? null
      : t.kind === 'beat' ? (d.beats[t.id] && onPage.has(`shot:${d.beats[t.id].shot_id}`) ? { kind: 'shot', id: d.beats[t.id].shot_id } : null)
      : onPage.has(`${t.kind}:${t.id}`) ? t : null
    out.push({ ask, jobId: j.id, at })
  }
  return out
}

/** A parenthetical's words without its parens: the page and every flat copy add them (UAT 2026-11-21: Skye's
 *  "(whispering)" was kept as it came and showed, and went to the Director, as "((whispering))"). */
const bare = (type: string, text: string) => (type === 'parenthetical' ? text.trim().replace(/^\((.*)\)$/s, '$1').trim() : text)

/** A draft as the suggestion's proposed words, or null when its blocks do not fit the item. */
export function proposedOf(d: Doc, w: Write): Suggestion['proposed'] | null {
  const kind = KIND[w.target.kind]
  const lines = w.lines.map((l) => ({ type: l.type, text: l.type === 'direction' || kind === 'beat' ? l.text.replace(/\n/g, ' ') : bare(l.type, l.text) }))
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

/** The scene a write job's draft becomes when the scene it was for is gone: one per job, named by the job. */
export const sceneForJob = (jobId: string) => `scene_${jobId.slice(jobId.indexOf('_') + 1)}`

/**
 * A write job landed: each draft is a suggestion on its item, for the person who asked (Skye's decision,
 * citing the job). A scene draft whose scene is gone (the person undid it while Skye's question waited)
 * becomes a new first scene of the script instead, as Skye's words, in one undo step (owner 2026-10-15);
 * her line says so (skyeState newScene). A shot or beat draft whose item is gone still lands nowhere.
 */
export async function landWrites(store: DocumentStore, job: Job): Promise<string[]> {
  const d = store.get()
  const ids: string[] = []
  const made: Suggestion[] = []
  let orphan: Write | undefined
  for (const w of job.writes ?? []) {
    const map = { scene: d.scenes, shot: d.shots, beat: d.beats }[w.target.kind] as Record<string, unknown>
    if (!map[w.target.id]) {
      if (w.target.kind === 'scene' && !orphan && proposedOf(d, w)) orphan = w
      continue
    }
    const proposed = proposedOf(d, w)
    if (!proposed) continue
    const id = newUlidId('sug')
    ids.push(id)
    made.push({ id, v: 1, field_v: {}, target: w.target, crew: 'skye', job_id: job.jobId, for: job.startedBy, base_hash: w.base_hash, ...(w.mode ? { mode: w.mode } : {}), proposed, note: w.note.slice(0, 200), state: 'open' })
  }
  if (made.length) {
    const n = made.length
    await landUpdate(store, (x) => { for (const s of made) x.suggestions[s.id] = s }, { ...landingWhy(store, job.jobId, `${n} ${n === 1 ? 'draft' : 'drafts'} in the script`), agent: 'skye' })
  }
  if (orphan && job.node.kind === 'script') {
    const sceneId = await landAsFirstScene(store, job, job.node.id, orphan)
    if (sceneId) ids.push(sceneId)
  }
  return ids
}

/** A scene draft as a new first scene of the script, Skye's words, one undo step of the person's. Resolves its id,
 *  or undefined when it is there already (the job landed before) or the script is gone. */
async function landAsFirstScene(store: DocumentStore, job: Job, scriptId: Id, w: Write): Promise<Id | undefined> {
  const d = store.get()
  const id = sceneForJob(job.jobId)
  if (d.scenes[id] || !d.scripts[scriptId]) return undefined
  const rank = rankBetween(null, scenesOf(d, scriptId)[0]?.rank ?? null)
  const why = { ...landingWhy(store, job.jobId, 'a draft as a new first scene'), agent: 'skye', rationale: NEW_SCENE_LINE }
  const lines = w.lines.map((l) => ({ type: l.type, text: l.type === 'direction' ? l.text.replace(/\n/g, ' ') : bare(l.type, l.text) }))
  if (!(store instanceof ModelStore)) {
    await landUpdate(store, (x) => {
      x.scenes[id] = { id, v: 1, field_v: {}, script_id: scriptId, rank, heading: '', text: lines.map((l) => l.text).join('\n') }
    }, { ...why, undo: true })
    return id
  }
  // The scene and its words in one step: the entity through PatchBus, its prose through TextBus (joinStep).
  await store.flush()
  const r = await store.bus.apply({
    patches: [{ op: 'create', entity: 'scenes', id, value: { script_id: scriptId, rank, heading: '' }, base_version: 0 }],
    why: { action: why.action, agent: 'skye', rationale: why.rationale, ...(why.cites ? { cites: why.cites } : {}) },
  }, { undo: true })
  if (!r.applied) throw new Error(r.refused.map((x) => x.message).join('; ') || 'That scene could not be made.')
  await store.text.replace('scene', id, proseFromText(store.get(), lines), 'skye', { label: why.action, undo: true, joinStep: true })
  await store.flush()
  return id
}

/**
 * The one entry for a draft from a brief (owner's named bug, 2026-11-03): the brief is carried as the
 * write job's `instruction`, never planted in the scene, so the draft is not diffed against the prompt.
 * The brief is the line the person typed; the scene it lands on is cleared first so Skye's draft is a
 * whole-block insertion, not a rewrite of the prompt. `scriptFromLine`, `draftFromLine` and the
 * empty-script Enter path all come through here, so none can regress on its own.
 */
export async function draftFromBrief(deps: FrameDeps & { doc: ModelStore | DocumentStore }, store: ModelStore, scriptId: Id, sceneId: Id, brief: string): Promise<string> {
  const instruction = brief.trim().slice(0, 4000)
  if (!instruction) throw new Error('Write the idea in a line first.')
  // The scene holds the brief the person typed; take it out so the draft inserts into empty words,
  // never diffed against the prompt (owner's named bug). One undo step, the person's. flatText reads a
  // block's inline nodes, so the scene's words are each block's text joined, not the block array.
  const refs = refNames(store.get())
  const words = (store.text.prose('scene', sceneId).content ?? []).map((b) => flatText(b.content, refs)).join('\n')
  if (words.trim()) {
    await store.text.replace('scene', sceneId, EMPTY_PROSE, store.clan.personClaim(), { label: 'clear the brief before the draft', undo: true })
    await store.flush()
  }
  return startWrite(deps, store, scriptId, { kind: 'scene', id: sceneId }, 'draft', { mode: 'draft', instruction })
}

/** The empty-script Enter path (ScriptEditor): the line in the scene is the brief. One entry: draftFromBrief. */
export async function draftFromLine(deps: FrameDeps & { doc: ModelStore | DocumentStore }, store: ModelStore, scriptId: Id, sceneId: Id): Promise<string> {
  const refs = refNames(store.get())
  const brief = (store.text.prose('scene', sceneId).content ?? []).map((b) => flatText(b.content, refs)).join('\n')
  return draftFromBrief(deps, store, scriptId, sceneId, brief)
}

/**
 * The idea the writer already typed, to seed 'Write with Skye' so they never retype it: the longest
 * words they put in a scene, shot or beat that are not just a scene heading. '' when they typed none.
 */
export function pickedIdea(d: Doc, scriptId: Id): string {
  const c = composeScript(d, scriptId)
  if (!c) return ''
  const texts: string[] = []
  for (const r of c.rows) {
    if (r.kind === 'scene') { if (r.scene.text?.trim()) texts.push(r.scene.text.trim()) }
    else if (r.kind === 'shot' || r.kind === 'end_card') { if (r.shot.action?.trim()) texts.push(r.shot.action.trim()) }
    else if (r.kind === 'beat') { if (r.beat.text?.trim()) texts.push(r.beat.text.trim()) }
  }
  return texts.filter((t) => t.split('\n').some((line) => !headingHint(line))).sort((a, b) => b.length - a.length)[0] ?? ''
}

/** A line that reads as a scene heading (so it is not mistaken for the typed idea). */
function headingHint(line: string): boolean {
  return /^(?:(?:INT|EXT|INT\.?\/EXT|I\/E|EST)[. ]|\.[A-Za-z0-9])/i.test(line.trim())
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

export const DISCARDED_LINE = 'Discarded the Script agent\'s draft.'

/**
 * Discard a draft (a whole-block insertion, mode 'draft'): the suggestion is dropped and nothing lands.
 * Unlike Keep mine, Skye is not asked to leave the item alone — the writer may ask her again. One undo step.
 */
export async function discardDraft(store: ModelStore, sugId: string): Promise<{ line: string }> {
  await store.flush()
  const sug = store.get().suggestions[sugId]
  if (!sug) return { line: DISCARDED_LINE }
  const r = await store.bus.apply({
    patches: [
      { op: 'set', entity: 'suggestions', id: sugId, path: 'state', value: 'dropped', base_version: sug.v },
      { op: 'set', entity: 'suggestions', id: sugId, path: 'decided_by', value: store.clan.personClaim(), base_version: sug.v },
    ],
    why: { action: `discard suggestions[${sugId}]`, cites: [`${store.documentId()}#suggestions[${sugId}]`] },
  }, { undo: true })
  if (!r.applied) throw new Error(r.refused.map((x) => x.message).join('; ') || 'That could not be discarded.')
  await store.flush()
  return { line: DISCARDED_LINE }
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

