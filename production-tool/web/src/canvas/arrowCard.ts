// What an arrow card says (features/canvas-arrow-cards.clan): the step a provenance
// arrow stands for, in words. Hovering or selecting an arrow shows it. Pure: built
// from the document, the UI state (each job's request) and the arrow's link, so it
// is tested without a canvas. The arrow's `to` is the generated node's id, which is
// its job id (canvas/controller.ts placeGen); `from` is the source node.

import { modelLabel } from '../capabilities'
import type { AgentBlock, DocJob, JobInputRef, Provider, ProductionDocument, Region, View } from '../contracts/types'
import type { UiState } from '../doc/ui'
import { nameOf } from '../lib/names'
import { purposeOf } from '../model/purpose'
import { refsList } from '../model/selectors'
import { CAST, castOf, jobWhat } from '../ui/agents/cast'
import type { ProvenanceOf } from './arrowHit'

export interface CardInput {
  /** What the input is called: @maya_front, "drawing", "picture", "your words". */
  label: string
  /** This arrow's source. */
  here: boolean
}

export interface ArrowCard {
  /** "A picture", "The side view", "A change in a box". */
  title: string
  /** "Dex · Gen-4 Image (runway)". */
  who: string
  /** "Made on Runway: mock could not take Gen-4 Image". */
  fallback?: string
  /** Not finished yet, or did not come back. */
  state?: string
  from: CardInput[]
  /** The typed instruction plus the selected text boxes, as sent. */
  words?: string
  /** What it changed: the view, the box and its note, the version it replaced. */
  changed?: string
  /** What the director told the model; absent when the words went as written. */
  told?: string
  /** One line when there was no director block. */
  passthrough?: string
  /** "Ran at 14:05 · took 12 s". */
  when?: string
}

/** What a source node is, when it is not a named image (the canvas knows; tests pass a map). */
export type NodeKind = { kind: 'pic' | 'drawn' | 'gen' | 'note'; text?: string }

export interface CardOptions {
  kindOf?: (nodeId: string) => NodeKind | undefined
  fmtTime?: (iso: string) => string
}

const PROVIDER: Record<Provider, string> = { runway: 'Runway', mock: 'the mock' }
/** A document's madeBy can name a provider no longer routed (features/drop-hackathon-extras.clan): as recorded, then. */
const providerName = (p: string) => PROVIDER[p as Provider] ?? p
const VIEW: Record<View, string> = { front: 'front', 'three-quarter': '3/4', side: 'side', back: 'back' }
const REF_KIND: Record<JobInputRef['kind'], string> = { drawing: 'drawing', picture: 'picture', generated: 'earlier result' }
const NODE_KIND: Record<NodeKind['kind'], string> = { pic: 'picture', drawn: 'drawing', gen: 'earlier result', note: 'your words' }

const capital = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)

function clip(s: string | undefined, n: number): string | undefined {
  const t = s?.replace(/\s+/g, ' ').trim()
  if (!t) return undefined
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

const defaultTime = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** The model's name and provider: "Gen-4 Image (runway)". */
function modelWords(provider: string, model: string | undefined): string {
  if (provider === 'mock') return 'the mock (no model)'
  return `${modelLabel(provider, model) ?? model ?? 'a model'} (${provider})`
}

/** Where a box sits on the picture, in words: "a box at the top left, about 40% × 25% of the picture". */
export function regionWords(r: Region): string {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const h = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : ''
  const v = cy < 1 / 3 ? 'top' : cy > 2 / 3 ? 'bottom' : ''
  const where = v || h ? [v, h].filter(Boolean).join(' ') : 'middle'
  return `a box at the ${where}, about ${Math.round(r.w * 100)}% × ${Math.round(r.h * 100)}% of the picture`
}

/** What the director told the model: its provider job's prompt, else its own words. */
export function directorPrompt(agent: AgentBlock | undefined): string | undefined {
  const out = agent?.output as { providerJob?: { prompt?: unknown }; prompt?: unknown } | undefined
  const p = out?.providerJob?.prompt ?? out?.prompt
  return typeof p === 'string' && p.trim() ? p.trim() : undefined
}

/** The card for one provenance arrow. */
export function arrowCard(doc: ProductionDocument, ui: Pick<UiState, 'jobs'>, link: ProvenanceOf, opts: CardOptions = {}): ArrowCard {
  const job: DocJob | undefined = doc.jobs[link.to]
  const request = ui.jobs[link.to]?.request
  const input = request?.input ?? {}
  const op = job?.op ?? request?.op ?? 'generate'
  const fmtTime = opts.fmtTime ?? defaultTime

  // Who and on what; a pick that ran elsewhere says so.
  const provider = job?.provider
  const agent = CAST[castOf(job?.crew)].given
  const who = provider ? `${agent} · ${modelWords(provider, job?.model)}` : `${agent} · model not known yet`
  const picked = request?.modelChoice
  const fallback = picked && provider && picked.provider !== provider
    ? `Made on ${providerName(provider)}: ${picked.provider} could not take ${modelLabel(picked.provider, picked.model) ?? picked.model}`
    : undefined

  // The inputs, by name where they have one; this arrow's own source marked.
  const named = (nodeId: string) => refsList(doc).find((r) => r.node === nodeId)
  const fromLabel = (nodeId: string): string => {
    const r = named(nodeId)
    if (r) return `@${nameOf(r)}`
    const k = opts.kindOf?.(nodeId)
    if (k?.kind === 'note') return k.text ? `“${clip(k.text, 40)}”` : NODE_KIND.note
    if (k) return NODE_KIND[k.kind]
    const ref = (input.refs ?? []).find((x) => x.id === nodeId)
    return ref ? REF_KIND[ref.kind] : 'a node'
  }
  const from: CardInput[] = []
  const seen = new Set<string>()
  const add = (label: string, here: boolean) => {
    if (seen.has(label)) {
      if (here) from.find((f) => f.label === label)!.here = true
      return
    }
    seen.add(label)
    from.push({ label, here })
  }
  if (op === 'view' || op === 'region_edit') add(fromLabel(link.from), true) // the image itself
  for (const r of input.refs ?? []) {
    const node = r.name ? doc.refs[r.id]?.node : r.id
    add(r.name ? `@${r.name}` : REF_KIND[r.kind], node === link.from)
  }
  if (!from.some((f) => f.here)) add(fromLabel(link.from), true)

  // What it changed.
  let changed: string | undefined
  let title = capital(jobWhat({ op }, (job && purposeOf(job)) ?? undefined))
  if (op === 'view' && input.view) {
    title = `The ${VIEW[input.view]} view`
    changed = `Turned ${fromLabel(link.from)} to the ${VIEW[input.view]} view`
  } else if (op === 'region_edit') {
    const region = input.region ?? job?.region
    const area = input.mask ? 'a brushed area' : region ? regionWords(region) : 'a part of the picture'
    const note = clip(input.text ?? job?.text, 160)
    changed = `Changed ${area} of ${fromLabel(link.from)}${note ? `: “${note}”` : ''}. A new version; the old one stays.`
  }

  const words = clip(input.text ?? job?.text, 400)
  const told = clip(directorPrompt(job?.director), 600)
  const passthrough = job && !job.director && (job.state === 'completed' || job.provider) ? 'No director: your words went to the model as written.' : undefined

  let state: string | undefined
  if (!job) state = 'No record of this step in the document.'
  else if (job.state === 'failed') state = 'This step did not come back.'
  else if (job.state === 'cancelled') state = 'This step was stopped.'
  else if (job.state !== 'completed') state = 'Still being made.'

  const whenParts = [job?.created_at && `Ran at ${fmtTime(job.created_at)}`]
  if (job?.created_at && job.updated_at && job.state === 'completed') {
    const s = Math.round((Date.parse(job.updated_at) - Date.parse(job.created_at)) / 1000)
    if (s > 0) whenParts.push(`took ${s < 90 ? `${s} s` : `${Math.round(s / 60)} min`}`)
  }
  const when = whenParts.filter(Boolean).join(' · ') || undefined

  const card: ArrowCard = { title, who, from }
  if (fallback) card.fallback = fallback
  if (state) card.state = state
  if (words && op !== 'region_edit') card.words = words
  if (changed) card.changed = changed
  if (told) card.told = told
  else if (passthrough) card.passthrough = passthrough
  if (when) card.when = when
  // No cost on the canvas (owner, 2026-10-13): each job's cost shows only in History.
  return card
}

/** The card as plain lines (for a screen reader label and the tests). */
export function cardLines(c: ArrowCard): string[] {
  return [
    c.title,
    c.who,
    c.fallback,
    c.state,
    `From: ${c.from.map((f) => f.label).join(', ')}`,
    c.words && `Your words: ${c.words}`,
    c.changed && `What it changed: ${c.changed}`,
    c.told && `What the model was told: ${c.told}`,
    c.passthrough,
    c.when,
  ].filter((l): l is string => !!l)
}
