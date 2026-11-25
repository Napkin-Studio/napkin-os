// The save queue of the open project (features/production-in-library.clan): one save at a time, each on the version
// the one before left, a refusal kept as a choice for the person, never an overwrite.
import { describe, expect, it, vi } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { ServerCopy } from './serverCopy'
import { memoryStorage } from './storage'

function setup() {
  const storage = memoryStorage()
  const server = {
    signedIn: true,
    save: vi.fn(async () => ({ etag: 'e1', savedAt: '2026-11-16T12:00:00Z' })),
    version: vi.fn(async () => null as { etag: string; savedAt: string } | null),
  }
  const index = { get: () => ({ id: 'p1', name: 'Ad' }), setServer: vi.fn(async () => {}) }
  const copy = new ServerCopy({
    id: 'p1', server: server as never, index: index as never, storage,
    doc: () => ({ assets: {} }) as unknown as ProductionDocument, upload: async () => undefined,
    base: { mark: null, unsaved: false },
  })
  return { storage, server, copy }
}

describe('saves at the same moment (UAT 2026-11-21, F1)', () => {
  it('go one after the other, each on the base the one before left; no conflict', async () => {
    const { copy, server } = setup()
    const marks = ['e1', 'e2']
    const seen: (string | undefined)[] = []
    let n = 0
    server.save.mockImplementation((async (_id: string, _b: Uint8Array, o: { ifMatch?: string }) => {
      seen.push(o.ifMatch)
      await new Promise((r) => setTimeout(r, 5))
      return { etag: marks[n++], savedAt: '2026-11-21T12:00:00Z' }
    }) as never)
    // A base is known (the project was on the relay when it opened).
    ;(copy as unknown as { base: unknown }).base = { etag: 'e0', savedAt: '2026-11-21T11:00:00Z' }
    await Promise.all([copy.post(new Uint8Array([1]), { reason: 'landing' }), copy.post(new Uint8Array([2]), { reason: 'interval' })])
    expect(seen).toEqual(['e0', 'e1'])
    expect(copy.get()).toBeNull()
  })

  it('a refusal whose newer copy is our own save is taken as the base and sent again', async () => {
    const { copy, server } = setup()
    const { SaveConflict } = await import('./server')
    const { sha256Hex } = await import('../lib/hash')
    const first = new Uint8Array([7])
    const ours = await sha256Hex(first)
    ;(copy as unknown as { base: unknown }).base = { etag: 'e0', savedAt: '2026-11-21T11:00:00Z' }
    // The first save landed but its answer was lost: the relay now holds it.
    server.save.mockImplementationOnce((async () => { throw new Error('network') }) as never)
    await copy.post(first, { reason: 'landing' }).catch(() => {})
    server.version.mockImplementation((async () => ({ etag: ours, savedAt: '2026-11-21T12:00:00Z' })) as never)
    server.save.mockImplementationOnce((async () => { throw new SaveConflict('saved elsewhere') }) as never)
    server.save.mockImplementationOnce((async (_i: string, _b: Uint8Array, o: { ifMatch?: string }) => ({ etag: `after-${o.ifMatch}`, savedAt: '2026-11-21T12:01:00Z' })) as never)
    await copy.post(new Uint8Array([8]), { reason: 'interval' })
    expect(copy.get()).toBeNull()
    expect(copy.basedOn()?.etag).toBe(`after-${ours}`)
  })
})

describe('a reload in one tab while a save went (UAT round 5, R5-F7)', () => {
  function reloaded(unanswered: { etag: string; edited: boolean }[]) {
    const storage = memoryStorage()
    const server = {
      signedIn: true,
      save: vi.fn(async () => ({ etag: 'e9', savedAt: '2026-11-21T05:30:00Z' })),
      version: vi.fn(async () => null as { etag: string; savedAt: string } | null),
    }
    const index = { get: () => ({ id: 'p1', name: 'Ad' }), setServer: vi.fn(async () => {}) }
    // The page that sent the save reloaded before its answer: the new page opens on the old base, the save noted.
    const copy = new ServerCopy({
      id: 'p1', server: server as never, index: index as never, storage,
      doc: () => ({ assets: {} }) as unknown as ProductionDocument, upload: async () => undefined,
      base: { mark: { etag: 'e0', savedAt: '2026-11-21T05:28:23Z' }, unsaved: true, unanswered },
    })
    return { copy, server, index }
  }

  it('the same bytes again: the relay has them (05:28:52), so they are the base; nothing is sent, nothing refused', async () => {
    const { sha256Hex } = await import('../lib/hash')
    const bytes = new Uint8Array([5, 5])
    const x = await sha256Hex(bytes)
    const { copy, server, index } = reloaded([{ etag: x, edited: false }])
    server.version.mockImplementation((async () => ({ etag: x, savedAt: '2026-11-21T05:28:52Z' })) as never)
    await copy.post(bytes, { reason: 'interval' })
    expect(server.save).not.toHaveBeenCalled()
    expect(copy.get()).toBeNull()
    expect(copy.basedOn()).toEqual({ etag: x, savedAt: '2026-11-21T05:28:52Z' })
    expect(index.setServer).toHaveBeenCalledWith('p1', { etag: x, savedAt: '2026-11-21T05:28:52Z' })
  })

  it('new work on top of the earlier page\'s save: refused on the old base, taken as ours, sent again on it', async () => {
    const { SaveConflict } = await import('./server')
    const { copy, server } = reloaded([{ etag: 'x-earlier', edited: true }])
    server.version.mockImplementation((async () => ({ etag: 'x-earlier', savedAt: '2026-11-21T05:28:52Z' })) as never)
    const seen: (string | undefined)[] = []
    server.save.mockImplementationOnce((async () => { throw new SaveConflict('This project was saved from somewhere else at 05:28:52Z') }) as never)
    server.save.mockImplementationOnce((async (_i: string, _b: Uint8Array, o: { ifMatch?: string }) => { seen.push(o.ifMatch); return { etag: 'e2', savedAt: '2026-11-21T05:29:53Z' } }) as never)
    await copy.post(new Uint8Array([6]), { reason: 'interval' })
    expect(seen).toEqual(['x-earlier'])
    expect(copy.get()).toBeNull()
    expect(copy.basedOn()?.etag).toBe('e2')
  })

  it('a save from somewhere else really is a conflict: the box shows and the bar says not saved', async () => {
    const { SaveConflict } = await import('./server')
    const { merged } = await import('../ui/useSave')
    const { copy, server } = reloaded([{ etag: 'x-earlier', edited: false }])
    server.version.mockImplementation((async () => ({ etag: 'someone-else', savedAt: '2026-11-21T05:28:52Z' })) as never)
    server.save.mockImplementationOnce((async () => { throw new SaveConflict('This project was saved from somewhere else at 05:28:52Z') }) as never)
    await expect(copy.post(new Uint8Array([6]), { reason: 'interval' })).rejects.toBeInstanceOf(SaveConflict)
    expect(copy.get()?.message).toContain('somewhere else')
    expect(merged({ kind: 'idle' }, '2026-11-21T05:28:23Z', copy.get()!.message).kind).toBe('failed')
  })
})

describe('a save the server refuses (UAT acceptance A24: 37 refused saves, and the bar kept "saved 03:57 AM")', () => {
  it('is kept as refused, in the server\'s words, holds nothing back, and clears when a save lands', async () => {
    const { copy, server } = setup()
    const { RelayError } = await import('../relay')
    const { merged } = await import('../ui/useSave')
    ;(copy as unknown as { base: unknown }).base = { etag: 'e0', savedAt: '2026-11-24T03:57:00Z' }
    server.save.mockImplementationOnce((async () => { throw new RelayError({ code: 'invalid_input', message: 'Only a Production project can be saved this way.', retryable: false }, 422) }) as never)
    await expect(copy.post(new Uint8Array([1]), { reason: 'interval' })).rejects.toThrow('Only a Production project')
    expect(copy.refused()).toBe('Only a Production project can be saved this way.')
    expect(copy.get()).toBeNull() // not a conflict: the next save is not held back
    // The bar: not "saved 03:57", but not saved, with the reason.
    expect(merged({ kind: 'idle' }, '2026-11-24T03:57:00Z', `The server did not take the last save: ${copy.refused()}`)).toEqual({ kind: 'failed', why: 'The server did not take the last save: Only a Production project can be saved this way.' })
    await copy.post(new Uint8Array([2]), { reason: 'manual' })
    expect(copy.refused()).toBeNull()
  })
})
