// A participant's own fal and HeyGen keys (features/production-tool-own-keys.clan).
// Kept apart from UiState and the document on purpose: neither is ever
// persisted to IndexedDB, exported in the .clan, or mirrored to POST /clan.
// The keys live in this tab only (sessionStorage), so closing it forgets them.
// They go to the relay on POST /jobs alone, in the X-Own-Keys header.

import type { Config, Op, Provider } from '../contracts/types'
import { OPS } from '../contracts/types'

export type OwnProvider = 'fal' | 'heygen'
export type OwnKeys = Partial<Record<OwnProvider, string>>

export const OWN_KEYS_HEADER = 'X-Own-Keys'
/** Preference order, as the relay has it (relay/own_keys.py PROVIDERS). */
export const OWN_PROVIDERS: OwnProvider[] = ['heygen', 'fal']
const STORAGE_KEY = 'pt.ownKeys'

type Sheets = Partial<Record<Provider, { ops: Partial<Record<Op, unknown>> }>>

function clean(keys: OwnKeys): OwnKeys {
  const out: OwnKeys = {}
  for (const p of OWN_PROVIDERS) {
    const v = keys[p]?.trim()
    if (v) out[p] = v
  }
  return out
}

export class OwnKeysStore {
  private value: OwnKeys
  private readonly listeners = new Set<() => void>()
  private readonly storage: Storage | null

  constructor(storage: Storage | null = sessionStorageOrNull()) {
    this.storage = storage
    this.value = {}
    try {
      const raw = storage?.getItem(STORAGE_KEY)
      if (raw) this.value = clean(JSON.parse(raw) as OwnKeys)
    } catch { /* unreadable or blocked: start empty */ }
  }

  get = (): OwnKeys => this.value

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  set(keys: OwnKeys) {
    this.value = clean(keys)
    try {
      if (Object.keys(this.value).length) this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.value))
      else this.storage?.removeItem(STORAGE_KEY)
    } catch { /* blocked: keep them in memory only */ }
    for (const fn of this.listeners) fn()
  }

  clear() {
    this.set({})
  }

  /** The header value for POST /jobs, or null when there are no keys. */
  header(): string | null {
    return Object.keys(this.value).length ? JSON.stringify(this.value) : null
  }
}

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/** The providers a participant's keys run an op on, in order (the relay's rule). */
export function ownProvidersFor(op: Op, keys: OwnKeys, sheets: Sheets): OwnProvider[] {
  return OWN_PROVIDERS.filter((p) => keys[p] && sheets[p]?.ops[op])
}

/** The routing as this participant's jobs will see it, in the relay's chain order: own-key
 *  providers first where they apply, then the event's routing (Runway, the floor every job
 *  falls back to; features/runway-fallback.clan). Off unless flags.ownKeys. */
export function withOwnKeys(config: Config, keys: OwnKeys, sheets: Sheets): Config {
  if (!config.flags.ownKeys || !Object.keys(keys).length) return config
  const routing: Config['routing'] = { ...config.routing }
  for (const op of OPS) {
    const event = config.routing[op] ?? []
    if (!event.length) continue // switched off by the organisers
    const own = ownProvidersFor(op, keys, sheets)
    if (own.length) routing[op] = [...own, ...event.filter((p) => !(own as Provider[]).includes(p))]
  }
  return { ...config, routing }
}

export const OWN_NAMES: Record<OwnProvider, string> = { fal: 'fal', heygen: 'HeyGen' }
const STEPS: { label: string; op: Op }[] = [
  { label: 'Pictures and frames', op: 'generate' },
  { label: 'Clips', op: 'clip' },
  { label: 'Clip edits', op: 'clip_edit' },
]

/** Where each kind of step runs with these keys, for the keys panel: the key providers, then
 *  Runway on the event's account, which makes the step when they cannot. */
export function keyUse(keys: OwnKeys, sheets: Sheets): { label: string; on: string }[] {
  return STEPS.map(({ label, op }) => {
    const own = ownProvidersFor(op, keys, sheets)
    return { label, on: own.length ? `your ${own.map((p) => OWN_NAMES[p]).join(', then ')} key, then Runway` : "Runway, on the event's account" }
  })
}
