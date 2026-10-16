// Who made what (contract 3): people are human:<personId>; the work is the
// crew's (dex, skye, wren, rhea, edie, ellis, jude), named the same way in
// every chain (contracts/collab.md §8).
//
// A job's result lands as one batch: one decision, agent the crew member,
// citing <doc>#jobs[<id>], whose rationale says what the director decided and
// what the provider made (landingWhy). A job that ends without a result (failed,
// cancelled) is one decision of its own (recordJobOutcome), written once.

/** The document's job entry (document.schema.json#/$defs/job), as far as attribution reads it. */
export interface JobEntry {
  id: string
  op: string
  state: string
  crew: string
  provider?: string
  model?: string
  outputs?: string[]
  text?: string
  director?: {
    model: string
    promptVersion: string
    rationale: string
    output: Record<string, unknown>
    latencyMs?: number
  }
  cost?: { estimate?: number; reserved?: number; confirmed?: number; currency: 'USD'; unknown: boolean }
  error?: { code: string; message: string; retryable?: boolean; providerCode?: string }
  created_at: string
  updated_at?: string
}

/** One character card the director was given (the relay's agent block `cards`). */
export interface DirectorCard {
  tag: string
  sha256: string
  kind: 'character' | 'object' | 'setting' | 'style' | 'other'
  card: string
}

/** A card as read back from a rationale. */
export interface SeenCard {
  tag: string
  kind: string
  lines: string[]
}

export const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
export const CREW = ['dex', 'skye', 'wren', 'rhea', 'edie', 'ellis', 'jude'] as const

/** The kind of author an entry's agent names (for avatars and filters). */
export function agentKind(agent: string): 'person' | 'crew' | 'other' {
  if (agent.startsWith('human:')) return 'person'
  if ((CREW as readonly string[]).includes(agent)) return 'crew'
  return 'other'
}

/** The collab.md verb a job's landing records, by op. */
export function opVerb(op: string): string {
  switch (op) {
    case 'shot_list': return 'plan'
    case 'write': return 'write'
    case 'read': case 'transcribe': return 'read'
    case 'check': return 'check'
    case 'cutout': case 'upscale': case 'region_edit': return 'retouch'
    case 'clip_patch': case 'stitch': return 'edit'
    default: return 'render'
  }
}

/** Who works an op (ui-behaviour 5.1). */
export function crewFor(op: string): (typeof CREW)[number] {
  switch (op) {
    case 'shot_list': case 'frame_edit': case 'bridge': return 'dex'
    case 'write': return 'skye'
    case 'cutout': case 'upscale': case 'region_edit': return 'rhea'
    case 'clip_patch': case 'stitch': return 'edie'
    case 'read': case 'transcribe': return 'ellis'
    case 'check': return 'jude'
    default: return 'wren'
  }
}

const short = (sha: string) => sha.replace(/^sha256:/, '').slice(0, 10)

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

function seconds(from: string, to?: string): string | null {
  if (!to) return null
  const ms = Date.parse(to) - Date.parse(from)
  if (!Number.isFinite(ms) || ms < 0) return null
  return ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
}

function money(n: number): string {
  return `$${n < 1 ? n.toFixed(3).replace(/0$/, '') : n.toFixed(2)}`
}

/** What the rationale puts before the cards the director was given (always its last part). */
export const SAW = ' · saw: '
const CARD_SEP = ' ¦ '
const LINE_SEP = ' / '

/** The cards as the last part of a rationale: ` · saw: @tag (kind): line / line ¦ @tag …`. */
export function sawPart(cards: DirectorCard[]): string {
  const clean = (t: string) => t.replace(/[·¦]/g, ',').split('\n').map((l) => l.replace(/ \/ /g, ', ').trim()).filter(Boolean).join(LINE_SEP)
  return SAW + cards.map((c) => `@${c.tag} (${c.kind}): ${clean(c.card)}`).join(CARD_SEP)
}

/** The cards a rationale carries (sawPart's inverse), and the rationale before them. */
export function cardsFromRationale(rationale: string): { rest: string; cards: SeenCard[] } {
  const at = rationale.lastIndexOf(SAW)
  if (at < 0) return { rest: rationale, cards: [] }
  const cards: SeenCard[] = []
  for (const part of rationale.slice(at + SAW.length).split(CARD_SEP)) {
    const m = /^@([a-z0-9_]+) \(([a-z]+)\): (.+)$/s.exec(part.trim())
    if (m) cards.push({ tag: m[1], kind: m[2], lines: m[3].split(LINE_SEP).filter(Boolean) })
  }
  return cards.length ? { rest: rationale.slice(0, at), cards } : { rest: rationale, cards: [] }
}

/** What the director decided and what the provider made, in one line: the
 * director's rationale, the refs it used for what, the prompt (abbreviated),
 * the model, cost and time, the outputs or the error, then the cards. */
export function jobRationale(job: JobEntry, cards?: DirectorCard[]): string {
  const parts: string[] = []
  const a = job.director
  if (a) {
    const out = (a.output ?? {}) as {
      providerJob?: { prompt?: string; refs?: { name: string; role: string; sha256: string }[]; firstFrame?: string }
      shots?: unknown[]
      question?: { text?: string } | null
      added?: { name: string; why: string }[]
    }
    if (a.rationale?.trim()) parts.push(clip(a.rationale, 300))
    const pj = out.providerJob
    if (pj?.refs?.length) parts.push(`refs: ${pj.refs.map((r) => `${r.name} as ${r.role} (${short(r.sha256)})`).join(', ')}`)
    // What Dex sent beyond what the shot asked for, and why (owner 2026-10-15, features/canvas-nodes.clan).
    for (const a of out.added ?? []) parts.push(`Added by Dex: @${a.name}, ${clip(a.why, 120)}`)
    if (pj?.firstFrame) parts.push(`first frame ${short(pj.firstFrame)}`)
    if (pj?.prompt) parts.push(`prompt: "${clip(pj.prompt, 240)}"`)
    if (Array.isArray(out.shots)) parts.push(`${out.shots.length} shots`)
    if (out.question?.text) parts.push(`asked: ${clip(out.question.text, 160)}`)
    parts.push(`director ${a.model} · ${a.promptVersion}${typeof a.latencyMs === 'number' ? ` · ${(a.latencyMs / 1000).toFixed(1)} s` : ''}`)
  }
  if (job.provider || job.model) parts.push(`${job.model ?? 'unknown'} on ${job.provider ?? 'the relay'}`)
  const c = job.cost
  if (c?.confirmed !== undefined) parts.push(`cost ${money(c.confirmed)} confirmed`)
  else if (c?.estimate !== undefined) parts.push(`cost ${money(c.estimate)} estimated, not confirmed`)
  const t = seconds(job.created_at, job.updated_at)
  if (t) parts.push(t)
  for (const o of job.outputs ?? []) parts.push(`out ${o}`)
  if (job.error) parts.push(`${job.error.code}${job.error.providerCode ? ` (${job.error.providerCode})` : ''}: ${clip(job.error.message, 200)}`)
  // patch.schema.json caps a rationale at 2000 characters, and a longer one refuses the whole landing:
  // keep the cards whole (cardsFromRationale reads them back) and shorten what comes before them.
  const head = parts.join(' · ')
  const tail = cards?.length ? sawPart(cards) : ''
  if (head.length + tail.length <= RATIONALE_MAX) return head + tail
  const room = RATIONALE_MAX - tail.length
  return room >= 200 ? clip(head, room) + tail : clip(head + tail, RATIONALE_MAX)
}

/** patch.schema.json Why.rationale maxLength. */
const RATIONALE_MAX = 2000

/** The why of a job's landing: the verb of its op, agent its crew, citing the job. */
export function landingWhy(docId: string, job: JobEntry, what: string, cards?: DirectorCard[]): { action: string; agent: string; rationale: string; cites: string[] } {
  return { action: `${opVerb(job.op)} ${what}`.slice(0, 300), agent: job.crew, rationale: jobRationale(job, cards), cites: [`${docId}#jobs[${job.id}]`] }
}

/** What a store needs to write a job's own entry. */
export interface Recorder {
  record(entry: { action: string; rationale?: string; agent?: string; targets?: string[]; cites?: string[] }, opts?: { once?: boolean }): Promise<boolean>
  documentId(): string
}

/**
 * The decision of a job that ended without a result (failed or cancelled),
 * written once (a completed job's decision is its landing). Resolves whether
 * it was written.
 */
export async function recordJobOutcome(store: Recorder, job: JobEntry, cards?: DirectorCard[]): Promise<boolean> {
  if (job.state !== 'failed' && job.state !== 'cancelled') return false
  const docId = store.documentId()
  return store.record({
    agent: job.crew,
    action: `${opVerb(job.op)} ${job.state} ${job.op} ${job.id}`,
    rationale: jobRationale(job, cards),
    targets: [`${docId}#jobs[${job.id}]`],
  }, { once: true })
}
