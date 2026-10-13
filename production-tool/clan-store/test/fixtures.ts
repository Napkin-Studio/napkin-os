import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClanDocumentStore, memoryPersistence, type Person } from '../src/index'

const here = dirname(fileURLToPath(import.meta.url))
const wasmPath = join(here, '..', 'src', 'wasm', 'napkin_wasm_bg.wasm')
export const CONTRACTS = join(here, '..', '..', 'contracts')

/** The real napkin-wasm, built by `npm run wasm`. */
export function wasmBytes(): Uint8Array {
  if (!existsSync(wasmPath)) throw new Error(`no ${wasmPath}: run \`npm run wasm\` first`)
  return new Uint8Array(readFileSync(wasmPath))
}

export function example<T = Record<string, unknown>>(rel: string): T {
  return JSON.parse(readFileSync(join(CONTRACTS, 'examples', rel), 'utf8')) as T
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A prefixed ULID-shaped id (common id), deterministic. */
export function id(prefix: string, n: number): string {
  let tail = ''
  let x = n
  for (let i = 0; i < 6; i++) {
    tail = CROCKFORD[x % 32] + tail
    x = Math.floor(x / 32)
  }
  return `${prefix}_01K6XA7Q3M9V2D4R8T0B${tail}`
}

/** A counter of ids, so a store's new entities are deterministic. */
export function idMaker(start = 1000) {
  let n = start
  return (prefix: string) => id(prefix, n++)
}

export function sha(n: number): string {
  return `sha256:${n.toString(16).padStart(64, '0')}`
}

export const AT = '2026-10-13T10:40:00Z'
export const TENANT = '5b6f3c1e-9d2a-5c4b-8e7f-0a1b2c3d4e5f'
export const MAYA: Person = { id: 'p_maya001', handle: 'maya', tenant_id: TENANT }
export const SAI: Person = { id: 'p_sai0001', handle: 'sai', tenant_id: TENANT }

const wasm = wasmBytes()

export function store(opts: { persistence?: ReturnType<typeof memoryPersistence> | null; person?: Person } = {}) {
  return new ClanDocumentStore({
    wasm, persistence: opts.persistence === undefined ? memoryPersistence() : opts.persistence, saveDebounceMs: 20,
    person: opts.person ?? MAYA, newId: idMaker(), now: () => AT,
  })
}

export function asset(n: number, kind: 'image' | 'video' = 'image') {
  return {
    sha256: sha(n),
    kind,
    mime: kind === 'image' ? 'image/png' : 'video/mp4',
    w: 1080,
    h: 1920,
    origin: 'generated',
    locations: [`idb://sha256/${sha(n).slice(7)}`],
  }
}

/** A shot's fields with no text (text comes from its fragment). */
export function shotValue(storyboard: string, rank: string, extra: Record<string, unknown> = {}) {
  return { storyboard_id: storyboard, rank, kind: 'shot', duration_s: 3, camera: { size: 'medium', movement: 'static' }, status: 'planned', ...extra }
}

export function jobValue(i: number, extra: Record<string, unknown> = {}) {
  return {
    op: 'frame', state: 'completed', node: { kind: 'storyboard', id: id('storyboard', 1) }, started_by: `human:${MAYA.id}`, tenant_id: TENANT,
    nonce: `n_job${String(i).padStart(6, '0')}`, crew: 'wren', parent_ids: [], input_hashes: [sha(i + 1000)], outputs: [sha(i + 2000)],
    provider: 'mock', model: 'mock-1', text: 'Keep the yellow raincoat, soft rim light from the left, rain streaks visible.',
    chips: ['keep character', 'rain'], cost: { estimate: 0.05, reserved: 0.05, confirmed: 0.05, currency: 'USD', unknown: false },
    director: { model: 'claude-sonnet-5-5', promptVersion: 'director.v6', output: { prompt: 'medium shot, yellow raincoat, rain' }, rationale: 'Front view leads.', latencyMs: 812 },
    created_at: AT, updated_at: AT, ...extra,
  }
}

/** The ids create() made for the default script, storyboard and video. */
export function defaults(s: ClanDocumentStore) {
  const d = s.get()
  return { script: Object.keys(d.scripts)[0], storyboard: Object.keys(d.storyboards)[0], video: Object.keys(d.videos)[0] }
}
