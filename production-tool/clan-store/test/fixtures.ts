import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const wasmPath = join(here, '..', 'src', 'wasm', 'napkin_wasm_bg.wasm')

/** The real napkin-wasm, built by `npm run wasm`. */
export function wasmBytes(): Uint8Array {
  if (!existsSync(wasmPath)) throw new Error(`no ${wasmPath}: run \`npm run wasm\` first`)
  return new Uint8Array(readFileSync(wasmPath))
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A prefixed ULID-shaped id (common.schema.json#/$defs/id), deterministic. */
export function id(prefix: string, n: number): string {
  let tail = ''
  let x = n
  for (let i = 0; i < 6; i++) {
    tail = CROCKFORD[x % 32] + tail
    x = Math.floor(x / 32)
  }
  return `${prefix}_01K6XA7Q3M9V2D4R8T0B${tail}`
}

export function sha(n: number): string {
  return `sha256:${n.toString(16).padStart(64, '0')}`
}

export const AT = '2026-10-07T10:40:00Z'

export function shot(i: number) {
  return {
    id: id('shot', i),
    order: i + 1,
    duration_s: 2,
    composition: 'medium',
    action: `Shot ${i + 1}: our hero opens the umbrella as the rain starts, and smiles at the camera.`,
    camera_move: 'push_in',
    lead_view: 'front',
    status: 'planned',
  }
}

export function job(i: number) {
  return {
    id: id('job', i),
    op: i % 3 === 0 ? 'frame' : 'clip',
    state: 'completed',
    provider: 'mock',
    model: 'mock-1',
    parent_ids: [id('shot', i % 8)],
    input_hashes: [sha(i + 1000)],
    text: 'Keep the yellow raincoat, soft rim light from the left, rain streaks visible.',
    chips: ['keep character', 'rain'],
    outputs: [sha(i + 2000)],
    agent: {
      model: 'claude-haiku-4-5',
      promptVersion: 'director.v1',
      output: { prompt: 'medium shot, yellow raincoat, rain', ratio: '9:16' },
      rationale: 'Front view leads; push-in matches the action.',
      latencyMs: 812,
    },
    cost: { estimate: 0.05, reserved: 0.05, confirmed: 0.05, currency: 'USD', unknown: false },
    created_at: AT,
    updated_at: AT,
  }
}

export function asset(n: number) {
  return {
    sha256: sha(n),
    kind: 'image',
    mime: 'image/png',
    w: 1080,
    h: 1920,
    origin: 'generated',
    locations: [`idb://sha256/${sha(n).slice(7)}`],
  }
}
