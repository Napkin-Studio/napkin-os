import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocAsset } from '../contracts/types'
import { putBlobAs } from '../lib/blobs'
import { forgetMedia, setMediaBase } from '../lib/media'
import { assetRef, logoRef } from './assets'

// Render ad uploaded every clip again from the browser, and said "A picture is missing" when the
// browser no longer had a clip the relay itself had made (2026-10-09).
const sha = (c: string) => 'sha256:' + c.repeat(64)

function relay() {
  return { upload: vi.fn(async (blob: Blob, mime: string) => ({ sha256: sha('9'), url: 'https://cdn.test/in/x', mime, exists: false, bytes: blob.size })) }
}

const clip = (s: string, locations?: string[]): DocAsset => ({ sha256: s, kind: 'video', mime: 'video/mp4', origin: 'generated', ...(locations ? { locations } : {}) })
const assets = (...list: DocAsset[]) => Object.fromEntries(list.map((a) => [a.sha256, a]))

describe('an asset the relay already has', () => {
  // The media base answers for what the relay holds, by hash; HEAD tells which key (out/ for made things).
  let heads: string[]
  beforeEach(() => {
    heads = []
    setMediaBase('https://cdn.test')
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      heads.push(`${init?.method} ${url}`)
      return { ok: url === `https://cdn.test/out/sha256:${'a'.repeat(64)}` } as Response
    }))
  })
  afterEach(() => { vi.unstubAllGlobals(); forgetMedia() })

  it('a relay-made clip goes by its address at the media base, not uploaded again, even with no bytes here', async () => {
    const r = relay()
    const s = sha('a')
    const doc = { assets: assets(clip(s)) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await assetRef(r as any, s, doc)).toEqual({ sha256: s, url: `https://cdn.test/out/sha256:${'a'.repeat(64)}`, mime: 'video/mp4' })
    expect(r.upload).not.toHaveBeenCalled()
  })

  it('a clip only in this browser is uploaded as before', async () => {
    const r = relay()
    const s = sha('b')
    await putBlobAs(s, new Blob(['mp4'], { type: 'video/mp4' }))
    const doc = { assets: assets(clip(s)) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ref = await assetRef(r as any, s, doc)
    expect(r.upload).toHaveBeenCalledTimes(1)
    expect(ref.url).toBe('https://cdn.test/in/x')
  })

  it('a picture asked for twice at once is uploaded once (QA 2026-11-17: Update sizes raced its new master)', async () => {
    const r = relay()
    const s = sha('d')
    await putBlobAs(s, new Blob(['png'], { type: 'image/png' }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const refs = await Promise.all([assetRef(r as any, s), assetRef(r as any, s), assetRef(r as any, s)])
    expect(r.upload).toHaveBeenCalledTimes(1)
    expect(new Set(refs.map((x) => x.url)).size).toBe(1)
  })

  it('an address the document names is never asked for (S1-16)', async () => {
    const r = relay()
    const s = sha('e')
    await putBlobAs(s, new Blob(['mp4'], { type: 'video/mp4' }))
    const doc = { assets: assets(clip(s, ['https://evil.test/out/e'])) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await assetRef(r as any, s, doc)
    expect(heads.every((h) => h.includes('cdn.test'))).toBe(true)
    expect(r.upload).toHaveBeenCalledTimes(1)
  })
})

describe('a logo (the end card, a size) goes as it is', () => {
  it('its own bytes and type, uploaded once, never fitted for a provider (a wide wordmark was padded onto a white box)', async () => {
    const r = relay()
    const s = sha('f')
    const png = new Blob(['wide-logo-bytes'], { type: 'image/png' })
    await putBlobAs(s, png)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const refs = await Promise.all([logoRef(r as any, s), logoRef(r as any, s)])
    expect(r.upload).toHaveBeenCalledTimes(1)
    const [sent, mime] = r.upload.mock.calls[0]
    expect(mime).toBe('image/png')
    expect(await (sent as Blob).text()).toBe('wide-logo-bytes')
    expect(refs[0]).toEqual({ sha256: sha('9'), url: 'https://cdn.test/in/x', mime: 'image/png' })
  })

  it('a logo not in this browser is said, and asked for again next time', async () => {
    const r = relay()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(logoRef(r as any, sha('0'))).rejects.toThrow(/logo is missing/)
    await putBlobAs(sha('0'), new Blob(['x'], { type: 'image/png' }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await logoRef(r as any, sha('0'))).url).toBe('https://cdn.test/in/x')
  })
})
