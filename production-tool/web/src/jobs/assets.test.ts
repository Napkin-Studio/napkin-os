import { describe, expect, it, vi } from 'vitest'
import type { DocAsset } from '../contracts/types'
import { putBlobAs } from '../lib/blobs'
import { assetRef, remoteUrl } from './assets'

// Render ad uploaded every clip again from the browser, and said "A picture is missing" when the
// browser no longer had a clip the relay itself had made (2026-10-09).
const sha = (c: string) => 'sha256:' + c.repeat(64)

function relay() {
  return { upload: vi.fn(async (blob: Blob, mime: string) => ({ sha256: sha('9'), url: 'https://cdn.test/in/x', mime, exists: false, bytes: blob.size })) }
}

const clip = (s: string, locations: string[]): DocAsset => ({ sha256: s, kind: 'video', mime: 'video/mp4', origin: 'generated', locations })

describe('an asset the relay already has', () => {
  it('a relay-made clip goes by its https location, not uploaded again, even with no bytes here', async () => {
    const r = relay()
    const s = sha('a')
    const doc = { assets: [clip(s, [`idb://sha256/${'a'.repeat(64)}`, 'https://cdn.test/out/a'])] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await assetRef(r as any, s, doc)).toEqual({ sha256: s, url: 'https://cdn.test/out/a', mime: 'video/mp4' })
    expect(r.upload).not.toHaveBeenCalled()
  })

  it('a clip only in this browser is uploaded as before', async () => {
    const r = relay()
    const s = sha('b')
    await putBlobAs(s, new Blob(['mp4'], { type: 'video/mp4' }))
    const doc = { assets: [clip(s, [`idb://sha256/${'b'.repeat(64)}`])] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ref = await assetRef(r as any, s, doc)
    expect(r.upload).toHaveBeenCalledTimes(1)
    expect(ref.url).toBe('https://cdn.test/in/x')
  })

  it('remoteUrl is the first https location', () => {
    const s = sha('c')
    expect(remoteUrl({ assets: [clip(s, ['idb://x', 'https://cdn.test/out/c'])] }, s)).toBe('https://cdn.test/out/c')
    expect(remoteUrl({ assets: [clip(s, ['idb://x'])] }, s)).toBeUndefined()
    expect(remoteUrl({ assets: [] }, undefined)).toBeUndefined()
  })
})
