// Finals and rights (features/prod-assets-route.clan): the pictures a person marks final, by hash, and
// whether a client may see an asset. Written through the real store, so the bundled schema checks them.

import { describe, expect, it } from 'vitest'
import type { ProductionDocument, Size } from '../contracts/types'
import { asset, id, MAYA, modelStore, SHA } from '../test/model'
import { roots } from './gc'
import { asksRights, finalsOf, isFinal, landingRights, setFinal, setSizeFinal, sizeFinalAsset } from './finals'
import { emptyDocument, updateDoc } from './store'

const BY = `human:${MAYA.id}`
const e = <X extends object>(prefix: string, rest: X) => ({ id: id(prefix), v: 1, field_v: {}, ...rest })

function withSize(d: ProductionDocument, extra: Partial<Size> = {}): Size {
  d.assets[SHA('a')] = asset(SHA('a'), 'image', { rights: 'generated' })
  d.assets[SHA('b')] = asset(SHA('b'), 'image', { rights: 'generated' })
  const set = e('fset', { master: { kind: 'picture' as const, id: 'pic_master_01' }, pack: { pack_id: 'social', pack_version: '2026-10-13' } })
  d.format_sets[set.id] = set
  const size: Size = e('size', {
    set_id: set.id, rank: 'a0', format: { pack_id: 'social', pack_version: '2026-10-13', format_id: 'meta-feed-image-4x5' }, aspect: { w: 4, h: 5 },
    delivery: { width: 1440, height: 1800 }, method: 'crop' as const, media: 'image' as const, asset: SHA('a'), status: 'ready' as const, ...extra,
  })
  d.sizes[size.id] = size
  return size
}

describe('finals', () => {
  it('a size keeps one final: marking another picture of it replaces the first, unmarking removes it', () => {
    const d = emptyDocument(MAYA, 'Finals')
    const size = withSize(d)
    setSizeFinal(d, size.id, true, BY, 'social')
    const [first] = finalsOf(d, { kind: 'size', id: size.id })
    expect(first).toMatchObject({ of: { kind: 'size', id: size.id }, asset: SHA('a'), set_id: size.set_id, format: size.format, channel: 'social', by: BY })
    expect(first.id).toMatch(/^final_[0-9A-HJKMNP-TV-Z]{26}$/)
    setSizeFinal(d, size.id, true, BY, 'social') // marked again: still one
    expect(Object.keys(d.finals ?? {})).toEqual([first.id])
    size.asset = SHA('b') // remade: the final still names the picture that was marked
    expect(isFinal(d, { kind: 'size', id: size.id }, SHA('a'))).toBe(true)
    expect(isFinal(d, { kind: 'size', id: size.id }, SHA('b'))).toBe(false)
    setSizeFinal(d, size.id, true, BY, 'social')
    expect(finalsOf(d, { kind: 'size', id: size.id }).map((f) => f.asset)).toEqual([SHA('b')])
    setSizeFinal(d, size.id, false, BY)
    expect(d.finals).toEqual({})
  })

  it("a size's final is its delivery-size file when one was made for its picture", () => {
    const d = emptyDocument(MAYA, 'Full')
    const size = withSize(d, { full: { asset: SHA('c'), from: SHA('a') } })
    expect(sizeFinalAsset(size)).toBe(SHA('c'))
    size.full = { asset: SHA('c'), from: SHA('z') } // made for an earlier picture: out of date
    expect(sizeFinalAsset(size)).toBe(SHA('a'))
  })

  it('frames are versions: each may be final; a picture with no versions keeps one', () => {
    const d = emptyDocument(MAYA, 'Frames')
    setFinal(d, { kind: 'frame', id: 'frame_01K7C00000000000000000FR01' }, SHA('a'), true, BY, { version: 2 })
    setFinal(d, { kind: 'frame', id: 'frame_01K7C00000000000000000FR02' }, SHA('b'), true, BY, { version: 3 })
    expect(Object.values(d.finals ?? {}).map((f) => f.version).sort()).toEqual([2, 3])
    setFinal(d, { kind: 'picture', id: 'pic_still_01' }, SHA('c'), true, BY, { version: 1 })
    setFinal(d, { kind: 'picture', id: 'pic_still_01' }, SHA('d'), true, BY, { version: 1 })
    expect(finalsOf(d, { kind: 'picture', id: 'pic_still_01' }).map((f) => f.asset)).toEqual([SHA('d')])
  })

  it('Clean up keeps a final picture', () => {
    const d = emptyDocument(MAYA, 'Keep')
    d.assets[SHA('q')] = asset(SHA('q'))
    setFinal(d, { kind: 'picture', id: 'pic_still_01' }, SHA('q'), true, BY)
    expect(roots(d, []).has(SHA('q'))).toBe(true)
  })

  it('marking, rights and unmarking go through the store and its bundled schema', async () => {
    const store = modelStore()
    await store.create(MAYA, 'Through the store')
    let sizeId = ''
    await updateDoc(store, (d) => {
      sizeId = withSize(d).id
      d.assets[SHA('e')] = asset(SHA('e'), 'image', { origin: 'uploaded', rights: 'unknown' })
    }, 'seed')
    await updateDoc(store, (d) => setSizeFinal(d, sizeId, true, BY, 'social'), 'mark final')
    await store.flush()
    expect(finalsOf(store.get(), { kind: 'size', id: sizeId })).toHaveLength(1)
    expect(asksRights(store.get().assets[SHA('e')])).toBe(true)
    await updateDoc(store, (d) => { d.assets[SHA('e')].rights = 'licensed' }, 'rights')
    await updateDoc(store, (d) => setSizeFinal(d, sizeId, false, BY), 'unmark final')
    await store.flush()
    expect(store.get().assets[SHA('e')].rights).toBe('licensed')
    expect(asksRights(store.get().assets[SHA('e')])).toBe(false)
    expect(Object.keys(store.get().finals ?? {})).toEqual([])
  })
})

describe('rights a picture lands with', () => {
  it('generated for a provider output, own for a drawing, unknown for an upload, nothing for an edit or a mock', () => {
    expect(landingRights('generated')).toBe('generated')
    expect(landingRights('drawn')).toBe('own')
    expect(landingRights('uploaded')).toBe('unknown')
    expect(landingRights('edited')).toBeUndefined()
    expect(landingRights('mock')).toBeUndefined()
  })
})

describe('un-marking a picture that has versions (UAT 2026-11-22)', () => {
  const NODE = { kind: 'picture' as const, id: 'pic_still_01' }
  const FRAME = { kind: 'frame' as const, id: 'frame_01K7C00000000000000000FR01' }
  const FRAME2 = { kind: 'frame' as const, id: 'frame_01K7C00000000000000000FR02' }

  it('Final switched off on a frame removes the final marked on the picture node of the same asset', () => {
    const d = emptyDocument(MAYA, 'Frames')
    setFinal(d, NODE, SHA('a'), true, BY) // marked on the canvas before it had versions
    expect(isFinal(d, FRAME, SHA('a'))).toBe(false) // the editor, on the frame, does not see it by its own name alone
    expect(isFinal(d, FRAME, SHA('a'), [NODE, FRAME])).toBe(true)
    setFinal(d, FRAME, SHA('a'), false, BY, {}, undefined, [NODE, FRAME])
    expect(Object.values(d.finals ?? {})).toEqual([])
  })
  it('without the other names the node final stays (the bug)', () => {
    const d = emptyDocument(MAYA, 'Frames')
    setFinal(d, NODE, SHA('a'), true, BY)
    setFinal(d, FRAME, SHA('a'), false, BY)
    expect(Object.values(d.finals ?? {})).toHaveLength(1)
  })
  it('only this asset goes: another version stays final', () => {
    const d = emptyDocument(MAYA, 'Frames')
    setFinal(d, FRAME2, SHA('b'), true, BY, { version: 2 })
    setFinal(d, NODE, SHA('a'), true, BY)
    setFinal(d, FRAME, SHA('a'), false, BY, {}, undefined, [NODE, FRAME, FRAME2])
    expect(Object.values(d.finals ?? {}).map((f) => f.asset)).toEqual([SHA('b')])
  })
  it('marking a frame final retires the picture node\'s own final, so one picture is not final twice', () => {
    const d = emptyDocument(MAYA, 'Frames')
    setFinal(d, NODE, SHA('a'), true, BY)
    setFinal(d, FRAME, SHA('a'), true, BY, { version: 1 }, undefined, [NODE, FRAME])
    expect(Object.values(d.finals ?? {}).map((f) => f.of)).toEqual([FRAME])
  })
})
