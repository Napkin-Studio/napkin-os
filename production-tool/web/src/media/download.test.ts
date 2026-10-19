import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import type { DocAsset, ProductionDocument } from '../contracts/types'
import { emptyDocument } from '../doc/store'

const blobs = new Map<string, Blob>()
vi.mock('../lib/blobs', () => ({ getBlob: vi.fn(async (sha: string) => blobs.get(sha)) }))
const saved: { name: string; blob: Blob }[] = []
vi.mock('../export', () => ({ download: vi.fn((blob: Blob, name: string) => saved.push({ name, blob })) }))
const events: { kind: string; name: string; data?: Record<string, unknown> }[] = []
vi.mock('../dogfood/recorder', () => ({ record: vi.fn((kind: string, name: string, data?: Record<string, unknown>) => events.push({ kind, name, data })) }))

const { downloadAllMedia, downloadItem, mediaBytes, mediaZip } = await import('./download')
const { mediaItem } = await import('./names')

const SHA = (c: string) => `sha256:${c.repeat(64)}`
const asset = (c: string, mime: string, locations: string[] = []): DocAsset =>
  ({ sha256: SHA(c), kind: mime.startsWith('video/') ? 'video' : 'image', mime, origin: 'generated', locations })

function project(): ProductionDocument {
  const d = emptyDocument()
  d.assets = [
    asset('a', 'image/png'),
    asset('b', 'image/png', ['idb://sha256/bbb', 'https://relay.example/out/b.png']),
    asset('c', 'image/png'),
    asset('d', 'video/mp4', ['https://relay.example/out/d.mp4']),
    asset('e', 'video/mp4'),
  ]
  d.keys = [{ key: 'maya', role: 'character' }]
  d.refs = [{ id: 'ref_1', key: 'maya', variant: 'front', asset: SHA('a') }]
  d.shots = [{ id: 'shot_1', order: 1, duration_s: 3, composition: 'wide', action: 'walks', camera_move: 'static' }]
  d.frames = [{ id: 'frame_1', shot_id: 'shot_1', asset: SHA('b'), job_id: 'job_1', selected: true, kind: 'generated' }]
  d.takes = [{ id: 'take_1', shot_id: 'shot_1', asset: SHA('d'), job_id: 'job_2', kind: 'generated', provider: 'runway', selected: true }]
  d.exports = [{ id: 'exp_1', kind: 'ad_mp4', asset: SHA('e'), created_at: '2026-10-09T10:00:00Z' }]
  return d
}

const fetchMock = vi.fn(async (url: string) => {
  if (url.endsWith('/b.png')) return new Response(new Blob(['relay b'], { type: 'image/png' }))
  if (url.endsWith('/d.mp4')) return new Response(new Blob(['relay d'], { type: 'video/mp4' }))
  return new Response('gone', { status: 404 })
})

beforeEach(() => {
  blobs.clear()
  saved.length = 0
  events.length = 0
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('media bytes: this browser, else the relay, else nothing', () => {
  it('this browser first: the relay is not asked', async () => {
    blobs.set(SHA('b'), new Blob(['local b'], { type: 'image/png' }))
    const got = await mediaBytes(project(), SHA('b'))
    expect(got?.from).toBe('browser')
    expect(await got?.blob.text()).toBe('local b')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('not in this browser: the first https location', async () => {
    const got = await mediaBytes(project(), SHA('b'))
    expect(got?.from).toBe('relay')
    expect(await got?.blob.text()).toBe('relay b')
    expect(fetchMock).toHaveBeenCalledWith('https://relay.example/out/b.png')
  })

  it('neither: null, and a failed fetch is the same', async () => {
    expect(await mediaBytes(project(), SHA('c'))).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('offline') })
    expect(await mediaBytes(project(), SHA('d'))).toBeNull()
  })
})

describe('one download', () => {
  it('saves the file by its name, with one beta event and no bytes', async () => {
    const d = project()
    blobs.set(SHA('a'), new Blob(['front'], { type: 'image/png' }))
    expect(await downloadItem(d, mediaItem(d, 'Summer ad', SHA('a'))!)).toBe(true)
    expect(saved.map((s) => s.name)).toEqual(['Summer-ad-maya_front.png'])
    expect(events).toEqual([{ kind: 'download', name: 'picture', data: { which: 'maya_front', ok: true, from: 'browser' } }])
  })

  it('a file nowhere saves nothing (never an empty file) and says so', async () => {
    const d = project()
    expect(await downloadItem(d, mediaItem(d, 'P', SHA('e'), 'ad')!)).toBe(false)
    expect(saved).toEqual([])
    expect(events).toEqual([{ kind: 'download', name: 'ad', data: { which: SHA('e'), ok: false } }])
  })
})

describe('the media zip', () => {
  it('lays the media out in folders by the same names; what is nowhere is counted, not packed', async () => {
    const d = project()
    blobs.set(SHA('a'), new Blob(['front'], { type: 'image/png' }))
    blobs.set(SHA('c'), new Blob(['other'], { type: 'image/png' }))
    const steps: string[] = []
    const { blob, name, packed, missing } = await mediaZip(d, 'Summer ad', undefined, (done, total) => steps.push(`${done}/${total}`))
    expect(name).toBe('Summer-ad-media.zip')
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(files).sort()).toEqual([
      'clips/Summer-ad-shot1-clip-v1.mp4',
      'pictures/Summer-ad-maya_front.png',
      'pictures/Summer-ad-picture-1.png',
      'storyboard/Summer-ad-shot1-frame-v1.png',
    ])
    expect(new TextDecoder().decode(files['clips/Summer-ad-shot1-clip-v1.mp4'])).toBe('relay d')
    expect(packed).toBe(4)
    expect(missing.map((m) => m.name)).toEqual(['Summer-ad-ad.mp4'])
    expect(steps.at(-1)).toBe('5/5')
  })

  it('Download all media saves the zip with one event', async () => {
    const d = project()
    blobs.set(SHA('a'), new Blob(['front'], { type: 'image/png' }))
    expect(await downloadAllMedia(d, 'P')).toEqual({ packed: 3, missing: 2 })
    expect(saved.map((s) => s.name)).toEqual(['P-media.zip'])
    expect(events).toEqual([{ kind: 'download', name: 'media-zip', data: { which: 'P-media.zip', packed: 3, missing: 2 } }])
  })

  it('nothing anywhere: no zip is saved', async () => {
    const d = project()
    d.assets = d.assets.map((a) => ({ ...a, locations: [] }))
    expect(await downloadAllMedia(d, 'P')).toEqual({ packed: 0, missing: 5 })
    expect(saved).toEqual([])
  })
})
