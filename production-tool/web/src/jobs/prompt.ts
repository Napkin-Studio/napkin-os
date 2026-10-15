// Make from a prompt (features/prompt-start.clan; ui-behaviour 3.5, 3.10, 3.17, plan item 3 and
// decision 1): what each start does, over the job paths that already run. No new op and no new
// relay purpose:
//
//   Script      the line is the first scene's words (a pasted Fountain script imports instead);
//               Skye's `write` (intent draft) lands as a suggestion on it, Keep / Keep mine / Why.
//   Storyboard  Dex's `shot_list` plans from the line, sent as the script when the script is empty.
//   Video       the same plan, on the storyboard the video renders from (linked first when none is).
//   Image       a shot's: Wren's `frame` from the words; a picture node's: Wren's `generate`, then
//               the person names it with a role (3.6) and it becomes a reference.
//
// Every start sends the node's scope (model/scope.ts scopeOf: what is linked into it) and the
// @names typed in its box; an unknown @name stops it before anything is sent.

import { canLink, type LinkKind } from '../canvas/core/links'
import type { Id, JobInput, JobInputRef, Link, LinkEndpoint, LinkRole, NamedRef, ProductionDocument, Ratio, RefRole, Storyboard } from '../contracts/types'
import { updateDoc } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import { mentions, nameOf, nameProblem } from '../lib/names'
import { newId } from '../lib/ulid'
import { scopeOf, scopeRefs } from '../model/scope'
import { keyNamed, mainScript, mainStoryboard, ownShotsOf, refsList, scenesOf, scriptOfStoryboard, scriptText, shotsOf } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { addScene, importFountain } from '../script/edits'
import { parseFountain } from '../script/fountain'
import { startWrite } from '../script/skye'
import { drawFrame, type FrameDeps } from './frames'
import { runningPlan } from './plan'
import { isActive } from './runner'
import { jobShot, namedInput, subjectPictures } from './select'

type Doc = ProductionDocument

export type PromptKind = 'script' | 'storyboard' | 'video' | 'image'

/** The idea in a line is enough; the plan's own limit on the words it reads. */
export const IDEA_MAX = 1500

export const NO_WORDS: Record<PromptKind, string> = {
  script: 'Write the idea in a line, or paste a script.',
  storyboard: 'Describe the ad in a line first.',
  video: 'Describe it in a line or two first.',
  image: 'Describe the picture first.',
}

/** "No reference called @jogger." for the first @name in the words that names no picture. */
export function unknownName(d: Doc, words: string): string | null {
  const said = mentions(d, words)
  return said.unknown.length ? `No reference called @${said.unknown[0]}. Name a picture first, or check the spelling.` : null
}

/** The node's scope as job refs: its linked references (and a linked key's pictures), then those the words name. */
export async function promptRefs(relay: FrameDeps['relay'], d: Doc, nodeId: Id, words = ''): Promise<JobInputRef[]> {
  const picked: NamedRef[] = []
  const add = (r: NamedRef | undefined) => { if (r?.asset && !picked.includes(r)) picked.push(r) }
  for (const it of scopeRefs(scopeOf(d, nodeId))) {
    // A linked key's views come as their own items, past its 4 held back (lib/names keyViews).
    if (it.kind === 'ref') { if (!it.held) add(d.refs[it.id]) }
    else if (it.kind === 'key' && it.name && !it.sends) { try { subjectPictures(d, it.name).forEach(add) } catch { /* a key with no front sends none */ } }
  }
  mentions(d, words).found.forEach(add)
  const out: JobInputRef[] = []
  for (const r of picked.slice(0, 14)) out.push(await namedInput(relay, d, r))
  return out
}

// ── script ──────────────────────────────────────────────────────────────────

/** A pasted script: more than one line, with at least one scene heading. */
export function isPastedScript(text: string): boolean {
  if (!text.includes('\n')) return false
  return parseFountain(text).scenes.some((s) => !!s.heading)
}

export type ScriptStart = { pasted: number; dropped: string } | { jobId: string; sceneId: Id }

/**
 * An empty script from its one box (3.10): a pasted script imports; a line becomes the first scene's
 * words (the person's) and Skye drafts from it in place, as a suggestion on that scene.
 */
export async function scriptFromLine(deps: FrameDeps, store: ModelStore, scriptId: Id, line: string): Promise<ScriptStart> {
  const words = line.trim()
  if (!words) throw new Error(NO_WORDS.script)
  if (!store.get().scripts[scriptId]) throw new Error('This script is gone.')
  if (isPastedScript(words)) {
    const r = await importFountain(store, scriptId, parseFountain(words))
    return { pasted: r.scenes, dropped: r.dropped }
  }
  await store.flush()
  const sceneId = scenesOf(store.get(), scriptId)[0]?.id ?? await addScene(store, scriptId)
  await updateDoc(store, (d) => {
    const s = d.scenes[sceneId]
    if (!s) throw new Error('This script is gone.')
    s.text = words.slice(0, 4000)
  }, `write scenes[${sceneId}]`)
  await store.flush()
  const jobId = await startWrite(deps, store, scriptId, { kind: 'scene', id: sceneId }, 'draft')
  return { jobId, sceneId }
}

// ── storyboard and video ────────────────────────────────────────────────────

/** The script that drives a storyboard (its `drives` link), else the project's. */
export function scriptOf(d: Doc, storyboardId: Id): Id | undefined {
  const l = Object.values(d.links ?? {}).find((x) => x.role === 'drives' && x.to.kind === 'storyboard' && x.to.id === storyboardId)
  return (l && d.scripts[l.from.id]?.id) ?? (d.storyboards[storyboardId]?.implicit ? scriptOfStoryboard(d, storyboardId)?.id : undefined) ?? mainScript(d)?.id
}

/** Whether the script that would drive this storyboard has words a plan can read. */
export function scriptHasWords(d: Doc, storyboardId: Id): boolean {
  const id = scriptOf(d, storyboardId)
  return !!id && !!scriptText(d, id).trim()
}


/** The plan request from a line: the line is the script when the script has no words; the refs are the node's scope. */
export async function ideaPlanInput(deps: FrameDeps, storyboardId: Id, idea: string, scopeNode: Id = storyboardId): Promise<JobInput> {
  const d = deps.doc.get()
  const sb = d.storyboards[storyboardId]
  if (!sb) throw new Error('This storyboard is gone.')
  const refs = await promptRefs(deps.relay, d, scopeNode, idea)
  const own = scriptOf(d, storyboardId)
  const script = scriptHasWords(d, storyboardId) ? scriptText(d, own).slice(0, IDEA_MAX) : idea.trim().slice(0, IDEA_MAX)
  const shots = shotsOf(d, storyboardId)
  return {
    script,
    targetS: Math.min(600, Math.max(1, Math.round(sb.target_s))),
    ...(refs.length ? { refs } : {}),
    ...(shots.length ? { shots: shots.map((s) => jobShot(d, s, false)) } : {}),
  }
}

/**
 * Dex plans an empty storyboard from a line (decision 1), on that storyboard (any node, not only the
 * project's first); a plan already running there is joined, never started twice.
 */
export async function storyboardFromLine(deps: FrameDeps, storyboardId: Id, line: string, scopeNode: Id = storyboardId): Promise<{ jobId: string; joined: boolean }> {
  const words = line.trim()
  const d = deps.doc.get()
  if (!words && !scriptHasWords(d, storyboardId)) throw new Error(NO_WORDS.storyboard)
  const unknown = unknownName(d, words)
  if (unknown) throw new Error(unknown)
  // The plan lands on the node it started from (planOrJoin's targeting): joined when one runs there.
  const running = runningPlan(d, storyboardId)
  if (running) return { jobId: running, joined: true }
  const input = await ideaPlanInput(deps, storyboardId, words, scopeNode)
  const ctx = storyboardId !== mainStoryboard(d)?.id ? { for: 'shot_list' as const, storyboardId } : { for: 'shot_list' as const }
  return { jobId: await deps.runner.submit('shot_list', input, [], ctx), joined: false }
}

/** The role a link from `from` into `to` takes, by the linking rules; null with the reason when it may not. */
export function linkRoleFor(from: LinkEndpoint['kind'], to: LinkEndpoint['kind']): { role: LinkRole } | { reason: string } {
  const can = canLink(from as LinkKind, to as LinkKind)
  return can.ok ? { role: can.roles[0] as unknown as LinkRole } : { reason: can.reason }
}

/** Link one node into another in the document (one undo step, the person's). Returns the link. */
export async function linkInto(store: DocumentStore, from: LinkEndpoint, to: LinkEndpoint): Promise<Link> {
  const d = store.get()
  const there = Object.values(d.links ?? {}).find((l) => l.from.id === from.id && l.to.id === to.id)
  if (there) return there
  const r = linkRoleFor(from.kind, to.kind)
  if ('reason' in r) throw new Error(r.reason)
  const link: Link = { id: newId('link'), v: 1, field_v: {}, from: { ...from }, to: { ...to }, role: r.role }
  await updateDoc(store, (x) => { x.links[link.id] = link }, `link ${from.kind} to ${to.kind}`)
  return link
}

/** The storyboard a video renders from: its own shot list, else its `renders` link's, if any. */
export function storyboardOfVideo(d: Doc, videoId: Id): Storyboard | undefined {
  const own = ownShotsOf(d, videoId)
  if (own) return own
  const l = Object.values(d.links ?? {}).find((x) => x.role === 'renders' && x.to.kind === 'video' && x.to.id === videoId)
  return l ? d.storyboards[l.from.id] : undefined
}

/**
 * The video's own shot list (ui-behaviour 3.5, decided 2026-10-15): an implicit storyboard with no canvas
 * node and no link, owned by this video (video_id), made when the video has no storyboard. Its shots are the video's
 * timeline in the Video editor. One write, in the document only. Returns its id.
 */
export async function ownShotList(store: DocumentStore, videoId: Id): Promise<Id> {
  const d = store.get()
  const v = d.videos[videoId]
  if (!v) throw new Error('This video is gone.')
  const there = storyboardOfVideo(d, videoId)
  if (there) return there.id
  const sbId = newId('storyboard')
  await updateDoc(store, (x) => {
    x.storyboards[sbId] = { id: sbId, v: 1, field_v: {}, title: v.title || 'Video', ratio: v.ratio, target_s: v.target_s ?? 15, implicit: true, video_id: videoId }
  }, `add the shot list of videos[${videoId}]`)
  return sbId
}

/**
 * "15 s · Make it" on a video (3.5, 3.17): Dex plans the words on the storyboard the video renders
 * from. With none linked, the project's storyboard is linked in first, when it has no shots yet.
 * Free: no paid job starts (clips are made from Make clips, through the send tray).
 */
export async function videoFromWords(deps: FrameDeps, videoId: Id, words: string): Promise<{ jobId: string; joined: boolean }> {
  const d = deps.doc.get()
  if (!d.videos[videoId]) throw new Error('This video is gone.')
  if (!words.trim()) throw new Error(NO_WORDS.video)
  const unknown = unknownName(d, words)
  if (unknown) throw new Error(unknown)
  let sb = storyboardOfVideo(d, videoId)
  if (!sb && (!mainStoryboard(d) || mainStoryboard(d)?.implicit)) sb = deps.doc.get().storyboards[await ownShotList(deps.doc, videoId)]
  if (!sb) {
    const main = mainStoryboard(d)
    if (!main) throw new Error('This project has no storyboard.')
    if (shotsOf(d, main.id).length) throw new Error('The project\'s storyboard already has shots. Link it to this video instead.')
    await linkInto(deps.doc, { kind: 'storyboard', id: main.id }, { kind: 'video', id: videoId })
    sb = main
  }
  return storyboardFromLine(deps, sb.id, words, videoId)
}

/** The video's length for the primary button ("15 s · Make it"): its own, its storyboard's, else 15. */
export function videoSeconds(d: Doc, videoId: Id): number {
  const v = d.videos[videoId]
  return Math.round(v?.target_s ?? storyboardOfVideo(d, videoId)?.target_s ?? mainStoryboard(d)?.target_s ?? 15)
}

// ── image ───────────────────────────────────────────────────────────────────

/** A shot's first frame from words (its Image editor while it has none): Wren's frame job. */
export async function frameFromWords(deps: FrameDeps, shotId: Id, words: string): Promise<string> {
  const d = deps.doc.get()
  const index = shotsOf(d).findIndex((s) => s.id === shotId)
  if (index < 0) throw new Error('This shot is not on the storyboard any more.')
  if (!words.trim()) throw new Error(NO_WORDS.image)
  const unknown = unknownName(d, words)
  if (unknown) throw new Error(unknown)
  return drawFrame(deps, index, index === 0 ? 'first' : 'next', { text: words.trim() })
}

/** The picture job a prompt start made for a node, newest first (its node is the start's). */
export function pictureJob(d: Doc, nodeId: Id) {
  return Object.values(d.jobs).filter((j) => j.op === 'generate' && j.node?.kind === 'group' && j.node.id === nodeId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
}

/**
 * A picture node from words (decision 1): Wren's generate, the existing image path, words only plus
 * the node's scope. Its outputs land in the document's assets (jobs/runner); naming it is the next step.
 */
export async function pictureFromWords(deps: FrameDeps, nodeId: Id, words: string, ratio?: Ratio): Promise<string> {
  const d = deps.doc.get()
  if (!words.trim()) throw new Error(NO_WORDS.image)
  const unknown = unknownName(d, words)
  if (unknown) throw new Error(unknown)
  const running = pictureJob(d, nodeId)
  if (running && isActive(running.state)) return running.id
  const refs = await promptRefs(deps.relay, d, nodeId, words)
  const input: JobInput = { text: words.trim().slice(0, 1000), ratio: ratio ?? mainStoryboard(d)?.ratio ?? '16:9', ...(refs.length ? { refs } : {}) }
  return deps.runner.submit('generate', input, [], { for: 'canvas' }, undefined, undefined, { node: { kind: 'group', id: nodeId } })
}

/** The roles the picker shows first (3.6), then More… for the rest. */
export const ROLE_PILLS: RefRole[] = ['character', 'location', 'lighting', 'composition', 'product', 'style', 'wardrobe', 'pose', 'prop', 'other']
export const ROLE_MORE: RefRole[] = ['texture', 'colour', 'layout', 'logo', 'palette', 'typography', 'brand_rule', 'document']

const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'with', 'and', 'for', 'to', 'by', 'from', 'our', 'my', 'some', 'two', 'one'])

/** A free name for a picture made from words: the first telling word as the key, the role's view, numbered on a clash. */
export function suggestName(d: Doc, words: string, role: RefRole): { key: string; variant: string } {
  const word = (words.toLowerCase().match(/[a-z][a-z0-9]*/g) ?? []).find((w) => w.length > 1 && !STOP.has(w) && !w.startsWith('@')) ?? 'pic'
  const key = word.slice(0, 16).replace(/^[^a-z]+/, '') || 'pic'
  const base = role === 'character' ? 'front' : role === 'location' ? 'wide' : 'main'
  const taken = new Set(refsList(d).map(nameOf))
  let variant = base
  for (let n = 2; taken.has(`${key}_${variant}`); n++) variant = `${base}${n}`
  return { key: key.length >= 2 ? key : `${key}x`, variant }
}

/**
 * Name the picture a prompt start made (3.6's role picker): a reference with the person's role and
 * @name, on the job's first output. One step, the person's. A name in use elsewhere is refused.
 */
export async function nameMadePicture(store: DocumentStore, jobId: Id, name: { key: string; variant: string; role: RefRole; label?: string }, nodeId?: Id): Promise<Id> {
  const asset = store.get().jobs[jobId]?.outputs?.[0]
  if (!asset) throw new Error('Name the picture once it is finished.')
  return nameAsset(store, asset, name, nodeId)
}

/** A picture in the document named as a reference (Name this picture): also the Image editor's
 *  cut-out, Save as reference (features/image-editor.clan). A name in use elsewhere is refused. */
export async function nameAsset(store: DocumentStore, asset: string, name: { key: string; variant: string; role: RefRole; label?: string }, nodeId?: Id): Promise<Id> {
  const problem = nameProblem(name.key, name.variant)
  if (problem) throw new Error(problem)
  const d = store.get()
  const full = `${name.key}_${name.variant}`
  const other = refsList(d).find((r) => nameOf(r) === full)
  if (other && other.asset !== asset) throw new Error(`@${full} is taken. Pick another name.`)
  if (other) return other.id
  const id = newId('ref')
  await updateDoc(store, (x) => {
    const now = new Date().toISOString()
    let k = keyNamed(x, name.key)
    if (!k) {
      const kid = newId('key')
      k = x.keys[kid] = { id: kid, v: 1, field_v: {}, key: name.key, role: name.role }
    }
    x.refs[id] = {
      id, v: 1, field_v: {}, key: name.key, variant: name.variant, role: k.role, asset, named_at: now,
      ...(name.label?.trim() ? { label: name.label.trim().slice(0, 120) } : {}),
      ...(nodeId ? { node: nodeId } : {}),
    }
  }, `name refs[${id}]`)
  return id
}
