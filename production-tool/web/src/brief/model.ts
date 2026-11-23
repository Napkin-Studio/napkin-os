// The Brief node's model (features/brief-node.clan, owner 2026-11-17). Engine-free and UI-free: the
// card, the Booth, Assets › From Napkin and the brief a page arrives with call these.
//
// - A Brief node is made only from a Brief Maker brief, by linking one or spinning one off; never typed
//   here. It is a frozen copy: the brief's spine at the version taken (source.data_sha256, taken).
// - "Brief changed: update?" is the person's decision: takeNewer writes the newer spine (one decision,
//   update_from_brief) and only then marks what the brief feeds out of date; keepVersion says no to
//   that version (one decision) and the notice stays away until the brief changes again.
// - Its scope (model/scope.ts): linked into a Script, Storyboard, Video or Format set; a Script's brief
//   carries on to what it drives unless that has its own. Every job from such a node carries the spine
//   (withBrief, called by the job runner on the director-backed ops).

import type {
  BriefNode, BriefSpine, BriefSpinePart, Check, Id, Job, JobBrief, JobInput, JobInputRow, Link, LinkEndpoint, Op, PersonRef, ProductionDocument, StaleMark, TargetKind,
} from '../contracts/types'
import { BRIEF_SPINE_PARTS } from '../contracts/types'
import { newId } from '../lib/ulid'
import { quoted } from '../lib/quotes'
import { landUpdate, systemUpdate, updateDoc, type DocumentStore } from '../doc/store'
import { scopeOf, type ScopeItem } from '../model/scope'
import { projectSpine, spineSummary, BRIEF_APP_ID } from './spine'
import type { OsBriefRead } from './os'

type Doc = ProductionDocument

/** The ops whose director reads the brief: draft, plan, Generate, frame, change a frame, edit a picture, take, change a
 *  clip, cut-down, sizes. The relay keeps the same list (relay/brief.py BRIEF_OPS; a relay test compares them) and cuts
 *  the spine to each op: a Generate reads its don'ts, tone and feeling, an edit inside a picture its don'ts only, and a
 *  view (the same character turned) none (features/pt-dex-context.clan). */
export const BRIEF_OPS: readonly Op[] = ['write', 'shot_list', 'generate', 'frame', 'frame_edit', 'region_edit', 'clip', 'clip_edit', 'clip_patch', 'cutdown', 'resize']

/** The spine parts each op's director reads, in the relay's priority order (relay/brief.py BUDGET, parts_of; a relay
 *  test compares them): what "What the X agent will send" lists (UAT 2026-11-21: Draw frame listed every part, and
 *  a frame reads only the don'ts, tone, feel, audience and mandatories). */
export const BRIEF_PARTS: Record<string, readonly BriefSpinePart[]> = {
  write: ['mandatories', 'donts', 'proposition', 'tone', 'feel', 'audience', 'insight', 'format'],
  shot_list: ['mandatories', 'donts', 'proposition', 'tone', 'feel', 'audience', 'format', 'insight'],
  generate: ['donts', 'tone', 'feel'],
  frame: ['donts', 'tone', 'feel', 'audience', 'mandatories'],
  frame_edit: ['donts', 'tone', 'feel'],
  region_edit: ['donts'],
  clip: ['donts', 'tone', 'feel', 'audience'],
  clip_edit: ['donts', 'tone'],
  clip_patch: ['donts', 'tone'],
  cutdown: ['mandatories', 'donts', 'proposition', 'format', 'tone'],
  resize: ['mandatories', 'donts', 'proposition'],
}

/** The part of a spine an op's director reads (its parts only; the relay cuts them to its budget). */
export function spineForOp(spine: BriefSpine, op: Op | undefined): BriefSpine {
  const parts = op ? BRIEF_PARTS[op] : undefined
  if (!parts) return spine
  return Object.fromEntries(Object.entries(spine).filter(([k]) => (parts as readonly string[]).includes(k))) as BriefSpine
}

/** The words a decision uses for a brief: “First Light brief” v2. */
const named = (title: string, taken: number) => `“${title}” v${taken}`

/** A new Brief node from a brief as read from the OS (not yet in the document). */
export function newBrief(read: OsBriefRead, how: 'link' | 'spinoff', now = new Date()): BriefNode {
  const { spine, confidential } = projectSpine(read.data)
  return {
    id: newId('brief'), v: 1, field_v: {},
    title: read.title.slice(0, 200) || 'Brief',
    source: { document_id: read.documentId, app_id: BRIEF_APP_ID, data_sha256: read.dataSha256 as BriefNode['source']['data_sha256'], taken: 1, at: now.toISOString(), how },
    spine,
    ...(confidential.length ? { confidential } : {}),
  }
}

/** The Brief nodes, oldest first. */
export const briefsList = (d: Doc): BriefNode[] => Object.values(d.briefs ?? {}).sort((a, b) => (a.id < b.id ? -1 : 1))

/** The Brief node already made from this brief, if one is (linking the same brief twice gives the same node). */
export const briefFromDocument = (d: Doc, documentId: string): BriefNode | undefined => briefsList(d).find((b) => b.source.document_id === documentId)

/** Put a Brief node in the document (a system write: the person's undo step is its card on the canvas). One decision. */
export async function addBrief(store: DocumentStore, brief: BriefNode): Promise<BriefNode> {
  await systemUpdate(store, (d) => {
    d.briefs ??= {}
    d.briefs[brief.id] = brief
  }, `${brief.source.how === 'spinoff' ? 'spin off' : 'link'} the brief ${named(brief.title, brief.source.taken)}`, `from Brief Maker (${brief.source.document_id}): ${spineSummary(brief.spine) || 'no spine parts filled in'}`)
  return brief
}

/** The link from a Brief node into a node (not yet in the document). */
export const briefLink = (briefId: Id, to: LinkEndpoint): Link => ({ id: newId('link'), v: 1, field_v: {}, from: { kind: 'brief', id: briefId }, to, role: 'brief' })

// ── Scope: which brief a node (and a job on it) reads ─────────────────────────────────────────────

/** A node's brief, from its scope: its own link, else the nearest upstream. */
export interface BriefInScope {
  brief: BriefNode
  /** 'link': linked into this node; 'upstream': carried from the Script (or Storyboard) that drives it. */
  via: 'link' | 'upstream'
  linkId?: Id
  /** The upstream node it came through. */
  through?: Id
  item: ScopeItem
}

/** The brief in a node's scope, or undefined. */
export function briefOf(d: Doc, nodeId: Id): BriefInScope | undefined {
  const it = scopeOf(d, nodeId).find((x) => x.kind === 'brief')
  const brief = it ? d.briefs?.[it.id] : undefined
  if (!it || !brief) return undefined
  return { brief, via: it.via === 'link' ? 'link' : 'upstream', ...(it.linkId ? { linkId: it.linkId } : {}), ...(it.through ? { through: it.through } : {}), item: it }
}

/** The nodes whose scope a job on `node` reads for its brief, nearest first: a shot reads its storyboard, then
 *  the videos that storyboard renders (a frame, a clip, a frame change); any other node reads itself. */
function readers(d: Doc, node: LinkEndpoint): Id[] {
  if (node.kind !== 'shot') return [node.id]
  const sb = d.shots[node.id]?.storyboard_id
  if (!sb) return []
  const videos = Object.values(d.links ?? {}).filter((l) => l.role === 'renders' && l.from.id === sb).map((l) => l.to.id)
  const own = d.storyboards[sb]?.video_id
  return [sb, ...(own ? [own] : []), ...videos]
}

/** The brief a job on `node` reads, and its node: undefined when there is none. */
export function briefForJob(d: Doc, node: LinkEndpoint): BriefInScope | undefined {
  for (const id of readers(d, node)) {
    const b = briefOf(d, id)
    if (b) return b
  }
  return undefined
}

/**
 * The brief linked straight to the NEWEST Format set made from this film (its master the film, or an ad
 * render of it): what Make all sizes reads (re-test N2; owner 2026-11-18). The sizes are planned on the Film
 * node and land in a new set, so neither read the set the person linked, while its Booth said "the sizes read
 * this brief". The explicit link overrides the film's own brief, as on any node. Only the newest set decides:
 * when it has no brief link the film's own brief does, whatever an older set is linked to. Undefined: the
 * newest set has none (or the film has no set).
 */
export function sizesBriefOf(d: Doc, videoId: Id): { setId: Id; briefId: Id } | undefined {
  const newest = Object.values(d.format_sets ?? {}).filter((s) => {
    const m = s.master
    return (m.kind === 'video' && m.id === videoId) || (m.kind === 'render' && d.renders?.[m.id]?.video_id === videoId)
  }).sort((a, b) => (a.id < b.id ? 1 : -1))[0]
  if (!newest) return undefined
  const l = Object.values(d.links ?? {}).find((x) => x.role === 'brief' && x.from.kind === 'brief' && x.to.kind === 'format_set' && x.to.id === newest.id && d.briefs?.[x.from.id])
  return l ? { setId: newest.id, briefId: l.from.id } : undefined
}

/** The brief Make all sizes reads: the one linked to the film's newest Format set, else the film's own. */
export function sizesBrief(d: Doc, videoId: Id): BriefNode | undefined {
  const linked = sizesBriefOf(d, videoId)
  return linked ? d.briefs?.[linked.briefId] : briefForJob(d, { kind: 'video', id: videoId })?.brief
}

/** "must be", "should read", "is": the words between a mandatory's label and its line. */
const LINE_VERB = /^(?:(?:must|should|will|shall)\s+(?:be|read|say)|reads?|says?|is|to\s+be|as|of)\b\s*[:\-\u2013\u2014]?\s*/i

/** The line a brief says the film ends on, from its mandatories ("End on the line: Lumo. Dein Licht.",
 *  "End line – …", "End line must be "…"", "Sign-off: …", "Tagline: …"): the quoted words when it quotes them
 *  (lib/quotes.ts), else what follows the label and its verb. Undefined: it names none. */
export function endLineOf(spine: BriefSpine | undefined): string | undefined {
  for (const m of spine?.mandatories ?? []) {
    const hit = /\b(?:end(?:s|ing)?\s+(?:on|with)\s+(?:the\s+)?(?:line|words|super)|end[\s-]?line|sign[\s-]?off(?:\s+line)?|tag[\s-]?line|brand\s+line)\b\s*(?:[:\-\u2013\u2014]\s*)?(.+)$/i.exec(m.trim())
    if (!hit) continue
    const line = quoted(hit[1]) ?? hit[1].trim().replace(LINE_VERB, '').replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '').trim()
    if (line) return line.slice(0, 200)
  }
  return undefined
}

/** The legal line a brief carries among its mandatories ("Legal: Please drink responsibly", "Must carry 18+ only",
 *  "Terms apply"): the words after its label, else the whole mandatory. Undefined: it names none. The film's end card
 *  carries it (UAT 2026-11-22: the end card had no legal line). */
export function legalOf(spine: BriefSpine | undefined): string | undefined {
  for (const m of spine?.mandatories ?? []) {
    const text = m.trim()
    if (!/\b(legal|disclaimer|small print|drink(?:\s+\w+)?\s+responsibl[ey]|responsibl[ey]|18\+|over[\s-]18|t&cs?|terms\s+(?:and|&)\s+conditions|terms apply|age[\s-]?(?:gate|verif)\w*)\b/i.test(text)) continue
    const line = (quoted(text) ?? text.replace(/^(?:legal(?:\s+line)?|disclaimer|small print)\s*[:\-\u2013\u2014]\s*/i, '').replace(LINE_VERB, '')).replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '').trim()
    if (line) return line.slice(0, 200)
  }
  return undefined
}

/** JobInput.brief: the title and the spine, nothing else of the brief. */
export const jobBrief = (b: BriefNode): JobBrief => ({ title: b.title.slice(0, 200) || 'Brief', spine: { ...b.spine } })

/**
 * The job's input with the node's brief added (on the director-backed ops), and its inputs row. No brief, or
 * another op: the input as it was, byte for byte.
 */
export function withBrief(d: Doc, op: Op, node: LinkEndpoint, input: JobInput): { input: JobInput; rows: JobInputRow[] } {
  if (!BRIEF_OPS.includes(op) || input.brief) return { input, rows: [] }
  const b = briefForJob(d, node)
  // A Generate on the canvas runs for a group or a sketch area, which no brief links into: it reads the project's
  // brief when the project has exactly one (features/pt-dex-context.clan). Two or more: none, rather than a guess.
  const only = !b && op === 'generate' ? onlyBrief(d) : undefined
  if (only) {
    const row: JobInputRow = { kind: 'brief', ref: only.id, used_as: "brief (the project's)", included: true, text: `${only.title} v${only.source.taken}`.slice(0, 200) }
    return { input: { ...input, brief: jobBrief(only) }, rows: [row] }
  }
  if (!b) return { input, rows: [] }
  const row: JobInputRow = {
    kind: 'brief', ref: b.brief.id, ...(b.linkId ? { link_id: b.linkId } : {}), used_as: b.via === 'link' ? 'brief' : 'brief (from its script)', included: true,
    text: `${b.brief.title} v${b.brief.source.taken}`.slice(0, 200),
  }
  return { input: { ...input, brief: jobBrief(b.brief) }, rows: [row] }
}

/** The project's Brief node when it has exactly one; undefined with none or several. */
export function onlyBrief(d: Doc): BriefNode | undefined {
  const all = briefsList(d)
  return all.length === 1 ? all[0] : undefined
}

/** "What Dex will send" lists the brief: one row, its words and where it comes from. */
export interface BriefSendRow {
  key: string
  briefId: Id
  /** "Brief · First Light brief · v2". */
  label: string
  /** "proposition, audience, tone, feel, 2 mandatories · linked" or "… · from Script · First Light". */
  detail: string
  via: 'link' | 'upstream'
}

export function briefSendRow(d: Doc, nodeId: Id, op?: Op): BriefSendRow | undefined {
  const b = briefOf(d, nodeId)
  if (!b) return undefined
  const t = b.through
  // "from Script · First Light"; a node with only its default name is "from the Script" (UAT round 4, R4-F8: "from Script · Script").
  const named = (kind: string, title: string | undefined) => (title?.trim() && title.trim().toLowerCase() !== kind.toLowerCase() ? `${kind} · ${title.trim()}` : `the ${kind}`)
  const from = b.via === 'link' ? 'linked'
    : `from ${t && d.scripts?.[t] ? named('Script', d.scripts[t].title) : t && d.storyboards?.[t] ? named('Storyboard', d.storyboards[t].title) : t && d.videos?.[t] ? named('Film', d.videos[t].title) : 'upstream'}`
  return { key: `brief:${b.brief.id}`, briefId: b.brief.id, label: b.item.label, detail: [spineSummary(spineForOp(b.brief.spine, op)), from].filter(Boolean).join(' · '), via: b.via }
}

/** The nodes a Brief node feeds, as its card says ("Feeds Script · Main, and what it drives"): its own links. */
export function briefFeeds(d: Doc, briefId: Id): LinkEndpoint[] {
  return Object.values(d.links ?? {}).filter((l) => l.from.kind === 'brief' && l.from.id === briefId).map((l) => l.to)
}

// ── Update: "Brief changed: update?" ───────────────────────────────────────────────────────────────

/** How a Brief node stands against the brief as it is now: the same, changed (offer the update), or changed
 *  to a version the person already chose not to take. */
export type BriefFreshness = 'same' | 'changed' | 'kept'

export function freshness(b: BriefNode, now: Pick<OsBriefRead, 'dataSha256'>): BriefFreshness {
  if (now.dataSha256 === b.source.data_sha256) return 'same'
  if (now.dataSha256 === b.source.kept) return 'kept'
  return 'changed'
}

/** The spine parts that differ between two spines (what the notice and the decision name). */
export function spineChanges(a: BriefSpine, b: BriefSpine): BriefSpinePart[] {
  return BRIEF_SPINE_PARTS.filter((p) => JSON.stringify(a[p] ?? null) !== JSON.stringify(b[p] ?? null))
}

/** The notice a Brief node shows when its brief has changed in Brief Maker, or null. */
export interface BriefNotice {
  briefId: Id
  /** "Brief changed: update?" */
  text: string
  /** "Proposition and tone changed in Brief Maker (now v3)." */
  detail: string
  changes: BriefSpinePart[]
  read: OsBriefRead
}

export function briefNotice(b: BriefNode, now: OsBriefRead): BriefNotice | null {
  if (freshness(b, now) !== 'changed') return null
  const changes = spineChanges(b.spine, projectSpine(now.data).spine)
  const words = changes.map((p) => (p === 'donts' ? 'don’ts' : p))
  const what = !words.length
    ? 'The brief changed in Brief Maker, but not its spine'
    : `${words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`} changed in Brief Maker`
  return { briefId: b.id, text: 'Brief changed: update?', detail: `${what.charAt(0).toUpperCase()}${what.slice(1)} (would be v${b.source.taken + 1}).`, changes, read: now }
}

/** The nodes taking a brief update makes out of date: what it feeds, and what those drive (scope's reach). */
export function briefReach(d: Doc, briefId: Id): LinkEndpoint[] {
  const out = new Map<Id, LinkEndpoint>()
  const nodes: { kind: LinkEndpoint['kind']; id: Id }[] = [
    ...Object.values(d.scripts ?? {}).map((x) => ({ kind: 'script' as const, id: x.id })),
    ...Object.values(d.storyboards ?? {}).filter((x) => !x.implicit).map((x) => ({ kind: 'storyboard' as const, id: x.id })),
    ...Object.values(d.videos ?? {}).map((x) => ({ kind: 'video' as const, id: x.id })),
    ...Object.values(d.format_sets ?? {}).map((x) => ({ kind: 'format_set' as const, id: x.id })),
  ]
  for (const n of nodes) if (briefOf(d, n.id)?.brief.id === briefId) out.set(n.id, n)
  return [...out.values()]
}

/**
 * Take the newer version (the person's decision): the spine, title and version change, one decision
 * (update_from_brief), and what the brief feeds is marked out of date. Nothing is made again by itself.
 */
export async function takeNewer(store: DocumentStore, briefId: Id, now: OsBriefRead, at = new Date()): Promise<BriefNode | undefined> {
  const before = store.get().briefs?.[briefId]
  if (!before || freshness(before, now) === 'same') return before
  const { spine, confidential } = projectSpine(now.data)
  const changes = spineChanges(before.spine, spine)
  const taken = before.source.taken + 1
  const title = now.title.slice(0, 200) || before.title
  await updateDoc(store, (d) => {
    const b = d.briefs?.[briefId]
    if (!b) return
    b.title = title
    b.spine = spine
    if (confidential.length) b.confidential = confidential
    else delete b.confidential
    b.source = { ...b.source, data_sha256: now.dataSha256 as BriefNode['source']['data_sha256'], taken, at: at.toISOString() }
    delete b.source.kept
    for (const target of briefReach(d, briefId)) {
      const id = newId('stale')
      d.stale[id] = {
        id, v: 1, field_v: {}, target: { kind: target.kind as StaleMark['target']['kind'], id: target.id }, caused_by: { kind: 'brief', id: briefId },
        reason: `The brief changed (v${before.source.taken} → v${taken})${changes.length ? `: ${changes.join(', ')}` : ''}.`.slice(0, 200), marked_at: at.toISOString(),
      }
    }
  }, `update_from_brief ${named(title, taken)}`, changes.length ? `took the newer brief: ${changes.join(', ')} changed` : 'took the newer brief; its spine is the same')
  return store.get().briefs?.[briefId]
}

/** Keep this version (the person's decision): the newer one is not taken, and its notice goes until the brief changes again. */
export async function keepVersion(store: DocumentStore, briefId: Id, now: Pick<OsBriefRead, 'dataSha256'>): Promise<void> {
  const b = store.get().briefs?.[briefId]
  if (!b || freshness(b, now) !== 'changed') return
  await updateDoc(store, (d) => {
    const x = d.briefs?.[briefId]
    if (x) x.source = { ...x.source, kept: now.dataSha256 as BriefNode['source']['data_sha256'] }
  }, `keep the brief ${named(b.title, b.source.taken)}`, 'Brief Maker has a newer version; it was not taken')
}

/** Whether a stale mark came from a brief update (the amber "brief changed" mark, not a frame's). */
export const staleFromBrief = (m: StaleMark): boolean => m.caused_by.kind === 'brief'

// ── The Review flags: a job that breaks a mandatory or a don't (never blocking) ────────────────────

/** One line the work breaks, as the relay keeps it (director.schema.json briefFlags). */
export interface BriefFlag { kind: 'mandatory' | 'dont'; line: string; note: string }

const FLAG_TARGETS: readonly TargetKind[] = ['script', 'storyboard', 'video', 'format_set', 'shot', 'size', 'render', 'frame', 'generation']

/** The flags a finished job's agent named (Dex's plan, frame or clip; the cutter's cut). */
export function flagsOf(job: Pick<Job, 'director'>): BriefFlag[] {
  const f = (job.director?.output as { briefFlags?: unknown } | undefined)?.briefFlags
  return Array.isArray(f) ? f.filter((x): x is BriefFlag => !!x && typeof x === 'object' && typeof (x as BriefFlag).line === 'string') : []
}

/**
 * Write a job's Review flags as Jude's checks on the job's node, with the brief they read: one decision by
 * Jude, never an ask and never a block. Once per job (a job whose checks are written is left alone).
 */
export async function recordBriefFlags(store: DocumentStore, job: Pick<Job, 'jobId' | 'director'>): Promise<Check[]> {
  const flags = flagsOf(job)
  const d = store.get()
  const entry = d.jobs[job.jobId]
  if (!flags.length || !entry) return []
  if (Object.values(d.checks).some((c) => c.job_id === job.jobId && c.brief_id)) return []
  const briefId = entry.inputs?.find((r) => r.kind === 'brief')?.ref
  const node = entry.node
  if (!briefId || !d.briefs?.[briefId] || !FLAG_TARGETS.includes(node.kind as TargetKind)) return []
  const made: Check[] = flags.map((f) => ({
    id: newId('check'), v: 1, field_v: {}, target: { kind: node.kind as TargetKind, id: node.id }, crew: 'jude', job_id: job.jobId,
    result: 'flag', reason_code: f.kind === 'dont' ? 'brief_dont' : 'brief_mandatory', brief_id: briefId, note: `${f.line}: ${f.note}`.slice(0, 300),
  }))
  const docId = store.documentId?.()
  await landUpdate(store, (x) => {
    for (const c of made) x.checks[c.id] = c
  }, {
    action: `flag ${made.length === 1 ? 'a line' : `${made.length} lines`} of the brief ${named(d.briefs[briefId].title, d.briefs[briefId].source.taken)}`,
    rationale: flags.map((f) => `${f.kind === 'dont' ? 'don\u2019t' : 'mandatory'} \u201c${f.line}\u201d: ${f.note}`).join(' \u00b7 ').slice(0, 1000),
    agent: 'jude', ...(docId ? { cites: [`${docId}#jobs[${job.jobId}]`] } : {}),
  })
  return made
}

/** The Review flags on a node that nobody has ignored: what its amber mark counts. */
export function briefFlagsOn(d: Doc, nodeId: Id): Check[] {
  return Object.values(d.checks ?? {}).filter((c) => c.brief_id && c.result === 'flag' && !c.ignored && c.target.id === nodeId)
}

/** Ignore a Review flag (the person's decision): it stays in Decisions, its amber mark goes. */
export async function ignoreBriefFlag(store: DocumentStore, checkId: Id, by: PersonRef, at = new Date()): Promise<void> {
  const c = store.get().checks[checkId]
  if (!c || c.ignored) return
  await updateDoc(store, (d) => {
    const x = d.checks[checkId]
    if (x) x.ignored = { by, at: at.toISOString() }
  }, `ignore the brief flag \u201c${c.note.split(':')[0]}\u201d`)
}
