import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import type { DocAsset, Mime, ProductionDocument } from '../contracts/types'
import { emptyDocument } from '../doc/store'
import { mainStoryboard, mainVideo } from '../model/selectors'
import { MAYA } from '../test/model'

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
  ({ sha256: SHA(c), kind: mime.startsWith('video/') ? 'video' : 'image', mime: mime as Mime, origin: 'generated', locations })

const e = { v: 1, field_v: {} }

function project(): ProductionDocument {
  const d = emptyDocument(MAYA)
  for (const a of [
    asset('a', 'image/png'),
    asset('b', 'image/png', ['idb://sha256/bbb', 'https://relay.example/out/b.png']),
    asset('c', 'image/png'),
    asset('d', 'video/mp4', ['https://relay.example/out/d.mp4']),
    asset('e', 'video/mp4'),
  ]) d.assets[a.sha256] = a
  d.keys.key_1 = { ...e, id: 'key_1', key: 'maya', role: 'character' }
  d.refs.ref_1 = { ...e, id: 'ref_1', key: 'maya', variant: 'front', role: 'character', asset: SHA('a') }
  d.shots.shot_1 = { ...e, id: 'shot_1', storyboard_id: mainStoryboard(d)!.id, rank: 'a0', kind: 'shot', duration_s: 3, camera: { size: 'wide' }, status: 'locked' }
  d.frames.frame_1 = { ...e, id: 'frame_1', shot_id: 'shot_1', version: 1, kind: 'generated', asset: SHA('b'), job_id: 'job_1', crew: 'wren' }
  d.generations.gen_1 = { ...e, id: 'gen_1', kind: 'clip', shot_ids: ['shot_1'], asset: SHA('d'), duration_s: 3, state: 'ready', job_id: 'job_2', crew: 'wren', provider: 'runway', inputs: { model: 'm' }, created_at: '2026-10-13T10:00:00Z', by: 'human:p_maya01' }
  d.renders.render_1 = { ...e, id: 'render_1', video_id: mainVideo(d)!.id, version: 1, asset: SHA('e'), job_id: 'job_3' }
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
    expect(events).toEqual([{ kind: 'download', name: 'ad', data: { which: 'render_1', ok: false } }])
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
    for (const a of Object.values(d.assets)) a.locations = []
    expect(await downloadAllMedia(d, 'P')).toEqual({ packed: 0, missing: 5 })
    expect(saved).toEqual([])
  })
})
