import { afterEach, describe, expect, it, vi } from 'vitest'
import { controlsFor, effectiveConfig, routedProvider } from '../capabilities'
import { CONFIGS, SHEETS } from '../contracts/load'
import type { Config, JobRequest } from '../contracts/types'
import { HttpRelay } from '../relay/http'
import { keyUse, OWN_KEYS_HEADER, OwnKeysStore, withOwnKeys, type OwnKeys } from './ownKeys'

const FAL = 'fal-own-key-123'
const HEYGEN = 'heygen-own-key-456'

function on(config: Config = CONFIGS.testing): Config {
  return { ...config, flags: { ...config.flags, ownKeys: true } }
}

class MemoryStorage {
  data = new Map<string, string>()
  getItem(k: string) { return this.data.get(k) ?? null }
  setItem(k: string, v: string) { this.data.set(k, v) }
  removeItem(k: string) { this.data.delete(k) }
}

describe('routing with own keys (the relay rule)', () => {
  const route = (keys: OwnKeys, config = on()) => {
    const c = withOwnKeys(config, keys, SHEETS)
    return { image: routedProvider('generate', c), clip: routedProvider('clip', c), clipEdit: routedProvider('clip_edit', c) }
  }

  it('changes nothing while flags.ownKeys is off', () => {
    expect(withOwnKeys(CONFIGS.testing, { fal: FAL }, SHEETS)).toBe(CONFIGS.testing)
  })

  it('a fal key takes pictures and clip edits; clips stay on the event', () => {
    expect(route({ fal: FAL })).toEqual({ image: 'fal', clip: 'runway', clipEdit: 'fal' })
  })

  it('a HeyGen key takes clips only', () => {
    expect(route({ heygen: HEYGEN })).toEqual({ image: 'runway', clip: 'heygen', clipEdit: 'runway' })
  })

  it('both keys: HeyGen first for clips, fal behind it, Runway always last', () => {
    // Runway, the event's routing, stays behind the keys: it makes the step when they cannot
    // (features/runway-fallback.clan, 2026-10-09).
    const c = withOwnKeys(on(), { fal: FAL, heygen: HEYGEN }, SHEETS)
    expect(c.routing.clip).toEqual(['heygen', 'fal', 'runway'])
    expect(c.routing.generate).toEqual(['fal', 'runway'])
    expect(withOwnKeys(on(CONFIGS.event), {}, SHEETS).routing.clip).toEqual(['runway'])
  })

  it('leaves an op the organisers switched off switched off', () => {
    const cfg = on({ ...CONFIGS.testing, routing: { ...CONFIGS.testing.routing, clip_edit: [] } })
    expect(withOwnKeys(cfg, { fal: FAL }, SHEETS).routing.clip_edit).toEqual([])
  })

  it('shows the own provider’s controls', () => {
    const c = controlsFor(withOwnKeys(on(effectiveConfig('allon', 'runway')), { fal: FAL }, SHEETS))
    expect(c.maskBrush && c.angles).toBe(true) // fal's sheet, not Runway's
  })

  it('tells the participant where each step runs', () => {
    expect(keyUse({ fal: FAL }, SHEETS).map((u) => u.on)).toEqual(
      ['your fal key, then Runway', "Runway, on the event's account", 'your fal key, then Runway'])
    expect(keyUse({ fal: FAL, heygen: HEYGEN }, SHEETS)[1].on).toBe('your HeyGen, then fal key, then Runway')
    expect(keyUse({}, SHEETS).every((u) => u.on === "Runway, on the event's account")).toBe(true)
  })
})

describe('OwnKeysStore', () => {
  it('keeps keys in this tab’s storage, trims them and forgets them', () => {
    const storage = new MemoryStorage()
    const store = new OwnKeysStore(storage as unknown as Storage)
    store.set({ fal: `  ${FAL} `, heygen: '' })
    expect(store.get()).toEqual({ fal: FAL })
    expect(JSON.parse(store.header()!)).toEqual({ fal: FAL })
    expect(new OwnKeysStore(storage as unknown as Storage).get()).toEqual({ fal: FAL })
    store.clear()
    expect(store.header()).toBeNull()
    expect(storage.data.size).toBe(0)
  })

  it('works with no storage at all', () => {
    const store = new OwnKeysStore(null)
    store.set({ heygen: HEYGEN })
    expect(store.get()).toEqual({ heygen: HEYGEN })
  })
})

describe('HttpRelay sends own keys on POST /jobs only', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('adds the header to createJob and nowhere else', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> })
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const relay = new HttpRelay('http://relay.test')
    relay.useToken('t')
    relay.ownKeys = () => JSON.stringify({ fal: FAL })
    await relay.createJob({ jobId: 'job_x' } as unknown as JobRequest)
    await relay.getJob('job_x')
    await relay.cancelJob('job_x')
    await relay.log({ level: 'info', message: 'hi' } as never)
    await relay.config()
    expect(calls[0].headers[OWN_KEYS_HEADER]).toBe(JSON.stringify({ fal: FAL }))
    expect(calls.slice(1).every((c) => !(OWN_KEYS_HEADER in c.headers))).toBe(true)
  })

  it('sends no header without keys', async () => {
    const seen: Record<string, string>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>)
      return new Response('{}', { status: 200 })
    }))
    const relay = new HttpRelay('http://relay.test')
    relay.ownKeys = () => null
    await relay.createJob({ jobId: 'job_y' } as unknown as JobRequest)
    expect(OWN_KEYS_HEADER in seen[0]).toBe(false)
  })
})
