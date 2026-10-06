// Who made what: the three kinds of author in a Production Tool decision chain.
//
//   participant   their handle (every patch the UI makes; the store's default)
//   director      `director · <model> · <promptVersion>`: the model that turned
//                 the participant's request into a provider job
//   provider      `<provider> · <model>`: the step that made the pixels
//
// The director and provider entries are written once per job, when the job
// reaches a terminal state, from the job's entry in the document (which
// mirrors the relay's Job: `agent` is its director block). Their action names
// the job, so `record(…, { once: true })` keeps them single across reloads and
// repeated polls.

/** The document's job entry (document.schema.json#/properties/jobs/items). */
export interface JobEntry {
  id: string
  op: string
  state: string
  provider?: string
  model?: string
  outputs?: string[]
  text?: string
  agent?: {
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

export interface ChainRecord {
  agent: string
  action: string
  rationale: string
}

export const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

export const AGENT_DIRECTOR = 'director'

/** The kind of author an entry's agent names (for icons and filters). */
export function agentKind(agent: string): 'participant' | 'director' | 'provider' {
  if (agent === AGENT_DIRECTOR || agent.startsWith(`${AGENT_DIRECTOR} · `)) return 'director'
  if (agent.includes(' · ')) return 'provider'
  return 'participant'
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

/** The director's entry: its rationale, which refs it used for what, and the
 * prompt it wrote (abbreviated). Null when the job had no director. */
export function directorRecord(job: JobEntry): ChainRecord | null {
  const a = job.agent
  if (!a) return null
  const out = (a.output ?? {}) as {
    providerJob?: { prompt?: string; refs?: { name: string; role: string; sha256: string }[]; firstFrame?: string; mask?: string }
    shots?: unknown[]
    needsUser?: { question?: string } | null
  }
  const parts: string[] = []
  if (a.rationale?.trim()) parts.push(clip(a.rationale, 300))
  const pj = out.providerJob
  if (pj?.refs?.length) parts.push(`refs: ${pj.refs.map((r) => `${r.name} as ${r.role} (${short(r.sha256)})`).join(', ')}`)
  if (pj?.firstFrame) parts.push(`first frame ${short(pj.firstFrame)}`)
  if (pj?.prompt) parts.push(`prompt: "${clip(pj.prompt, 240)}"`)
  if (Array.isArray(out.shots)) parts.push(`${out.shots.length} shots`)
  if (out.needsUser?.question) parts.push(`asked: ${clip(out.needsUser.question, 160)}`)
  if (typeof a.latencyMs === 'number') parts.push(`${(a.latencyMs / 1000).toFixed(1)} s`)
  return {
    agent: `${AGENT_DIRECTOR} · ${a.model} · ${a.promptVersion}`,
    action: `directed ${job.op} ${job.id}`,
    rationale: parts.join(' · '),
  }
}

/** The provider step's entry: cost confirmed, time, outputs (sha256), or the
 * error. Null until the job is terminal. */
export function providerRecord(job: JobEntry): ChainRecord | null {
  if (!TERMINAL.has(job.state)) return null
  const agent = `${job.provider ?? 'relay'} · ${job.model ?? 'unknown'}`
  const parts: string[] = []
  const c = job.cost
  if (c?.confirmed !== undefined) parts.push(`cost ${money(c.confirmed)} confirmed`)
  else if (c?.estimate !== undefined) parts.push(`cost ${money(c.estimate)} estimated, not confirmed`)
  else if (c) parts.push('cost unknown')
  const t = seconds(job.created_at, job.updated_at)
  if (t) parts.push(t)
  let action: string
  if (job.state === 'completed') {
    action = `made ${job.op} ${job.id}`
    for (const o of job.outputs ?? []) parts.push(`out ${o}`)
  } else if (job.state === 'failed') {
    action = `failed ${job.op} ${job.id}`
    if (job.error) parts.unshift(`${job.error.code}${job.error.providerCode ? ` (${job.error.providerCode})` : ''}: ${clip(job.error.message, 200)}`)
  } else {
    action = `cancelled ${job.op} ${job.id}`
  }
  return { agent, action, rationale: parts.join(' · ') }
}

/** What a store needs to write the job's entries. */
export interface Recorder {
  record(entry: { action: string; rationale?: string; agent?: string; pinned?: boolean }, opts?: { once?: boolean }): Promise<boolean>
}

/**
 * Write the director and provider entries for a job that has reached a
 * terminal state, at most once each. Resolves the number written (0 when the
 * job is still moving, or was recorded before).
 */
export async function recordJobOutcome(store: Recorder, job: JobEntry): Promise<number> {
  if (!TERMINAL.has(job.state)) return 0
  let n = 0
  const d = directorRecord(job)
  if (d && (await store.record(d, { once: true }))) n++
  const p = providerRecord(job)
  if (p && (await store.record(p, { once: true }))) n++
  return n
}
