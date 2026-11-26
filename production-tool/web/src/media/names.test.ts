import { describe, expect, it } from 'vitest'
import type { DocAsset, Mime, ProductionDocument } from '../contracts/types'
import { emptyDocument } from '../doc/store'
import { newId } from '../lib/ulid'
import { mainStoryboard, mainVideo } from '../model/selectors'
import { MAYA } from '../test/model'
import { fileSafe, mediaItem, mediaItems, viewsOnCanvas, zipName } from './names'

const SHA = (c: string) => `sha256:${c.repeat(64)}`
/** An entity into its map, with what the bus keeps. */
const put = <T extends { id: string }>(m: Record<string, T>, e: Omit<T, 'v' | 'field_v'>) => { m[e.id] = { v: 1, field_v: {}, ...e } as unknown as T }
const asset = (c: string, mime = 'image/png', origin: DocAsset['origin'] = 'generated'): DocAsset =>
  ({ sha256: SHA(c), kind: mime.startsWith('video/') ? 'video' : 'image', mime: mime as Mime, origin, locations: [] })

/** Two named pictures, a view whose name was taken, an upload, a drawing, two shots with versions, two ad renders. */
function project(): ProductionDocument {
  const d = emptyDocument(MAYA)
  for (const a of [
    asset('a'), asset('b', 'image/jpeg', 'uploaded'), asset('c'), asset('d', 'image/webp', 'uploaded'), asset('e', 'image/png', 'drawn'),
    asset('f'), asset('9'), asset('1'),
    asset('2', 'video/mp4'), asset('3', 'video/mp4'), asset('4', 'image/png', 'mock'),
    asset('5', 'video/mp4'), asset('6', 'video/mp4'),
  ]) d.assets[a.sha256] = a
  const sb = mainStoryboard(d)!.id
  const video = mainVideo(d)!.id
  put(d.keys, { id: 'key_1', key: 'maya', role: 'character' })
  put(d.refs, { id: 'ref_1', key: 'maya', variant: 'front', role: 'character', asset: SHA('a'), node: 'node_front' })
  put(d.refs, { id: 'ref_2', key: 'maya', variant: 'red-coat', role: 'wardrobe', asset: SHA('b') })
  // Ranks, not ids, order the shots: shot_2 sorts first by id but is the second shot.
  put(d.shots, { id: 'shot_2', storyboard_id: sb, rank: 'a1', kind: 'shot', duration_s: 3, camera: { size: 'close', movement: 'push_in' }, status: 'locked' })
  put(d.shots, { id: 'shot_9', storyboard_id: sb, rank: 'a0', kind: 'shot', duration_s: 3, camera: { size: 'wide' }, status: 'locked' })
  const frame = (id: string, shot: string, version: number, c: string) => put(d.frames, { id, shot_id: shot, version, kind: 'generated', asset: SHA(c), crew: 'wren' })
  frame('frame_1', 'shot_9', 1, 'f')
  frame('frame_3', 'shot_2', 2, '1')
  frame('frame_2', 'shot_2', 1, '9')
  const take = (id: string, shot: string, version: number, c: string, kind: 'generated' | 'mock' = 'generated') =>
    put(d.generations, { id, kind: 'clip', shot_ids: [shot], asset: SHA(c), duration_s: 3, state: 'ready', job_id: `job_${id}`, crew: 'wren', provider: 'runway', inputs: { model: 'm' },
      ...(kind === 'mock' ? { mock: true as const } : {}), created_at: `2026-10-13T10:0${version}:00Z`, by: 'human:p_maya01' })
  take('take_1', 'shot_9', 1, '2')
  take('take_2', 'shot_2', 1, '3')
  take('take_3', 'shot_2', 2, '4', 'mock')
  put(d.renders, { id: 'render_1', video_id: video, version: 1, asset: SHA('5'), job_id: 'job_r1' })
  put(d.renders, { id: 'render_2', video_id: video, version: 2, asset: SHA('6'), job_id: 'job_r2' })
  return d
}

const canvas = [
  { customData: { kind: 'gen', id: 'job_v', op: 'view', parentIds: ['node_front'], state: 'completed', asset: SHA('c'), view: 'side' } },
  { customData: { kind: 'gen', id: 'job_x', op: 'view', parentIds: ['node_gone'], state: 'completed', asset: SHA('d'), view: 'back' } },
  { customData: { kind: 'gen', id: 'job_y', op: 'view', parentIds: ['node_front'], state: 'completed', asset: SHA('d'), view: 'back' }, isDeleted: true },
]

describe('media names (features/media-download.clan)', () => {
  it('a project name is made safe for every system', () => {
    expect(fileSafe('Summer ad: "Maya" / take 2?')).toBe('Summer-ad-Maya-take-2')
    expect(fileSafe('  a\\b*c<d>e|f\u0007g  ')).toBe('abcdef-g')
    expect(fileSafe('many    spaces\tand\nlines')).toBe('many-spaces-and-lines')
    expect(fileSafe('x'.repeat(80))).toHaveLength(40)
    // A name taken from the script keeps no full stops (the extension is added after it).
    expect(fileSafe('A razor on a marble sink. A hand picks it up...')).toBe('A-razor-on-a-marble-sink-A-hand-picks-it')
    expect(fileSafe(`${'y'.repeat(39)} z`)).toBe('y'.repeat(39))
    expect(fileSafe('..hidden..')).toBe('hidden')
    expect(fileSafe('???')).toBe('napkin')
    expect(fileSafe(undefined)).toBe('napkin')
    expect(zipName('Summer ad')).toBe('Summer-ad-media.zip')
  })

  it('every kind gets its name, folder and extension from its mime', () => {
    const d = project()
    const items = mediaItems(d, 'Summer ad', viewsOnCanvas(d, canvas))
    expect(items.map((m) => `${m.folder}/${m.name}`)).toEqual([
      'pictures/Summer-ad-maya_front.png',
      'pictures/Summer-ad-maya_red-coat.jpg',
      'pictures/Summer-ad-maya-side.png',
      'pictures/Summer-ad-picture-1.webp',
      'storyboard/Summer-ad-shot1-frame-v1.png',
      'storyboard/Summer-ad-shot2-frame-v1.png',
      'storyboard/Summer-ad-shot2-frame-v2.png',
      'clips/Summer-ad-shot1-clip-v1.mp4',
      'clips/Summer-ad-shot2-clip-v1.mp4',
      'clips/Summer-ad-shot2-clip-v2.png',
      'ad/Summer-ad-ad-v1.mp4',
      'ad/Summer-ad-ad-v2.mp4',
    ])
    expect(items.map((m) => m.kind)).toEqual(['picture', 'picture', 'view', 'picture', 'frame', 'frame', 'frame', 'clip', 'clip', 'clip', 'ad', 'ad'])
    // What the beta record names each by: never bytes.
    expect(items.find((m) => m.kind === 'view')?.which).toBe('maya_side')
    expect(items.find((m) => m.name.endsWith('frame-v2.png'))?.which).toBe('frame_3')
  })

  it('a drawing is left out unless it is named; one ad has no number', () => {
    const d = project()
    delete d.renders.render_2
    expect(mediaItems(d, 'P').some((m) => m.sha256 === SHA('e'))).toBe(false)
    expect(mediaItems(d, 'P').filter((m) => m.kind === 'ad').map((m) => m.name)).toEqual(['P-ad.mp4'])
    put(d.refs, { id: 'ref_3', key: 'maya', variant: 'sketch', role: 'character', asset: SHA('e') })
    expect(mediaItem(d, 'P', SHA('e'))?.name).toBe('P-maya_sketch.png')
  })

  it('without the canvas, a view is a numbered picture; the single download names it the same as the zip', () => {
    const d = project()
    expect(mediaItem(d, 'P', SHA('c'))?.name).toBe('P-picture-1.png')
    expect(mediaItem(d, 'P', SHA('d'))?.name).toBe('P-picture-2.webp')
    const views = viewsOnCanvas(d, canvas)
    expect(views.size).toBe(1)
    expect(mediaItem(d, 'P', SHA('c'), undefined, views)?.name).toBe('P-maya-side.png')
    expect(mediaItem(d, 'P', SHA('1'), 'frame')?.name).toBe('P-shot2-frame-v2.png')
    expect(mediaItem(d, 'P', SHA('3'), 'clip')?.name).toBe('P-shot2-clip-v1.mp4')
    expect(mediaItem(d, 'P', SHA('6'), 'ad')?.name).toBe('P-ad-v2.mp4')
    expect(mediaItem(d, 'P', SHA('6'), 'ad')?.which).toBe('render_2')
    expect(mediaItem(d, 'P', undefined)).toBeUndefined()
    expect(mediaItem(d, 'P', SHA('0'))).toBeUndefined()
  })

  it('a canvas picture\'s versions are files of their own, named after it (UAT round 1 IMG-16: no Download for v3)', () => {
    const d = project()
    for (const c of '78') d.assets[SHA(c)] = asset(c, 'image/png', 'edited')
    // @maya_front edited twice: v1 as it was, then v2 and v3 (the ref follows the newest).
    put(d.frames, { id: 'pv_1', node: 'node_front', version: 1, kind: 'original', asset: SHA('a') })
    put(d.frames, { id: 'pv_2', node: 'node_front', version: 2, kind: 'edited', asset: SHA('7') })
    put(d.frames, { id: 'pv_3', node: 'node_x', version: 2, kind: 'edited', asset: SHA('8') })
    expect(mediaItem(d, 'P', SHA('7'))).toMatchObject({ name: 'P-maya_front-v2.png', folder: 'pictures', which: 'pv_2' })
    expect(mediaItem(d, 'P', SHA('8'))?.name).toMatch(/^P-picture-\d+-v2\.png$/)
    expect(mediaItem(d, 'P', SHA('a'))?.name).toBe('P-maya_front.png') // v1 is the named picture already
  })

  it('a result made from a sketch area has a file before any Apply (UAT round 2, IMG-16)', () => {
    const d = project()
    d.assets[SHA('9')] = asset('9', 'image/png', 'generated')
    put(d.frames, { id: 'fr_s1', sketch_id: 'sketch_1', version: 1, kind: 'generated', asset: SHA('9') })
    expect(mediaItem(d, 'P', SHA('9'))).toMatchObject({ name: 'P-sketch-1-v1.png', folder: 'pictures', which: 'fr_s1' })
  })
})

describe('a joined take in the zip (UAT 2026-11-21, F15)', () => {
  it('is one file, named for its shots', () => {
    const d = project()
    d.assets[SHA('7')] = asset('7', 'video/mp4')
    put(d.generations, { id: 'take_j', kind: 'together', shot_ids: ['shot_9', 'shot_2'], asset: SHA('7'), duration_s: 6, state: 'ready', job_id: 'job_j', crew: 'wren', provider: 'runway', inputs: { model: 'm' }, created_at: '2026-10-13T11:00:00Z', by: 'human:p_maya01' } as never)
    const clips = mediaItems(d, 'Ad').filter((m) => m.sha256 === SHA('7'))
    // The Bin's number: v1 of the shots it was made of (UAT round 3, F15: the zip said v2 for the Bin's v1).
    expect(clips.map((m) => m.name)).toEqual(['Ad-shots1-2-clip-v1.mp4'])
  })

  it('a take of one shot made after a joined one is v1 of that shot, as the Bin and the note say (UAT round 3, F15)', () => {
    const d = project()
    for (const g of Object.keys(d.generations)) delete d.generations[g]
    d.assets[SHA('7')] = asset('7', 'video/mp4')
    d.assets[SHA('8')] = asset('8', 'video/mp4')
    const gen = (id: string, shots: string[], c: string, at: string) => put(d.generations, { id, kind: shots.length > 1 ? 'together' : 'clip', shot_ids: shots, asset: SHA(c), duration_s: 3, state: 'ready', job_id: `job_${id}`, crew: 'wren', provider: 'runway', inputs: { model: 'm' }, created_at: at, by: 'human:p_maya01' } as never)
    gen('take_j', ['shot_9', 'shot_2'], '7', '2026-10-13T11:00:00Z')
    gen('take_1', ['shot_9'], '8', '2026-10-13T12:00:00Z')
    expect(mediaItems(d, 'Ad').filter((m) => m.kind === 'clip').map((m) => m.name)).toEqual(['Ad-shots1-2-clip-v1.mp4', 'Ad-shot1-clip-v1.mp4'])
  })
})

describe('the film\'s sizes in Download all media (UAT round 3, R3-F12)', () => {
  it('each made size is in the ad folder, named by its length and shape; two alike are numbered; one not made is not', () => {
    const d = project()
    delete d.renders.render_2
    d.assets[SHA('7')] = asset('7', 'video/mp4')
    d.assets[SHA('8')] = asset('8', 'video/mp4')
    const size = (id: string, set: string, format: string, w: number, h: number, length: number, sha?: string) => put(d.sizes, {
      id, set_id: set, rank: 'm', format: { pack_id: 'film', pack_version: '1', format_id: format }, aspect: { w, h }, delivery: { width: w, height: h },
      method: 'reframe', media: 'video', length_s: length, ...(sha ? { asset: SHA(sha), status: 'ready' as const } : { status: 'making' as const }),
    } as never)
    size('size_1', 'fset_1', 'film-9x16', 1080, 1920, 6, '7')
    size('size_2', 'fset_2', 'film-9x16', 1080, 1920, 6, '8')
    size('size_3', 'fset_1', 'film-16x9', 1920, 1080, 15)
    const ad = mediaItems(d, 'P').filter((m) => m.folder === 'ad')
    expect(ad.map((m) => `${m.folder}/${m.name}`)).toEqual(['ad/P-ad.mp4', 'ad/P-ad-6s-9x16.mp4', 'ad/P-ad-6s-9x16-v2.mp4'])
    expect(ad.map((m) => m.kind)).toEqual(['ad', 'cutdown', 'cutdown'])
    expect(mediaItem(d, 'P', SHA('8'))?.which).toBe('size_2')
  })
})

describe('every film\'s media, not only the first (live 3-route run, 2026-11-26)', () => {
  /** The project, plus a second film made after it (a second route): its own storyboard, a frame, a take and a render. */
  function twoFilms() {
    const d = project()
    for (const a of [asset('7'), asset('8', 'video/mp4'), asset('0', 'video/mp4')]) d.assets[a.sha256] = a
    const sb = newId('storyboard')
    const video = newId('video')
    put(d.storyboards, { id: sb, title: 'Route 2', ratio: '9:16', target_s: 15 })
    put(d.videos, { id: video, title: 'Route 2', ratio: '9:16', target_s: 15, timeline: {} })
    put(d.links, { id: newId('link'), from: { kind: 'storyboard', id: sb }, to: { kind: 'video', id: video }, role: 'renders' })
    put(d.shots, { id: 'shot_r2', storyboard_id: sb, rank: 'a0', kind: 'shot', duration_s: 3, camera: { size: 'wide' }, status: 'locked' })
    put(d.frames, { id: 'frame_r2', shot_id: 'shot_r2', version: 1, kind: 'generated', asset: SHA('7'), crew: 'wren' })
    put(d.generations, { id: 'take_r2', kind: 'clip', shot_ids: ['shot_r2'], asset: SHA('8'), duration_s: 3, state: 'ready', job_id: 'job_take_r2', crew: 'wren', provider: 'runway', inputs: { model: 'm' }, created_at: '2026-11-26T10:00:00Z', by: 'human:p_maya01' } as never)
    put(d.renders, { id: 'render_r2', video_id: video, version: 1, asset: SHA('0'), job_id: 'job_rr2' })
    return { d, video }
  }

  it('both films\' renders are ads with names of their own, the first film\'s unchanged', () => {
    const { d } = twoFilms()
    const items = mediaItems(d, 'P')
    const ads = items.filter((m) => m.kind === 'ad')
    expect(ads.map((m) => `${m.folder}/${m.name}`)).toEqual(['ad/P-ad-v1.mp4', 'ad/P-ad-v2.mp4', 'ad/P-film2-ad.mp4'])
    expect(ads.map((m) => m.which)).toEqual(['render_1', 'render_2', 'render_r2'])
    expect(new Set(items.map((m) => m.name)).size).toBe(items.length)
    // The first film's frames and clips keep their names.
    expect(items.filter((m) => m.kind === 'frame' && !m.name.includes('film2')).map((m) => m.name)).toEqual(['P-shot1-frame-v1.png', 'P-shot2-frame-v1.png', 'P-shot2-frame-v2.png'])
    expect(items.filter((m) => m.kind === 'clip' && !m.name.includes('film2')).map((m) => m.name)).toEqual(['P-shot1-clip-v1.mp4', 'P-shot2-clip-v1.mp4', 'P-shot2-clip-v2.png'])
  })

  it('the second film\'s frame and clip are in Download all media', () => {
    const { d } = twoFilms()
    const items = mediaItems(d, 'P')
    expect(items.find((m) => m.sha256 === SHA('7'))).toMatchObject({ kind: 'frame', name: 'P-film2-shot1-frame-v1.png', folder: 'storyboard', which: 'frame_r2' })
    expect(items.find((m) => m.sha256 === SHA('8'))).toMatchObject({ kind: 'clip', name: 'P-film2-shot1-clip-v1.mp4', folder: 'clips', which: 'take_r2' })
  })

  it('the Edit room finds the second film\'s render, so it has Download', () => {
    const { d } = twoFilms()
    expect(mediaItem(d, 'P', SHA('0'), 'ad')).toMatchObject({ name: 'P-film2-ad.mp4', folder: 'ad', which: 'render_r2' })
    expect(mediaItem(d, 'P', SHA('6'), 'ad')?.name).toBe('P-ad-v2.mp4')
  })

  it('a size made from the second film is named for it; one from the first is not', () => {
    const { d, video } = twoFilms()
    delete d.renders.render_2
    for (const c of 'AB') d.assets[SHA(c)] = asset(c, 'video/mp4')
    put(d.format_sets, { id: 'fset_1', master: { kind: 'video', id: mainVideo(d)!.id }, pack: { pack_id: 'film', pack_version: '1' } })
    put(d.format_sets, { id: 'fset_2', master: { kind: 'video', id: video }, pack: { pack_id: 'film', pack_version: '1' } })
    const size = (id: string, set: string, sha: string) => put(d.sizes, {
      id, set_id: set, rank: 'm', format: { pack_id: 'film', pack_version: '1', format_id: 'film-9x16' }, aspect: { w: 9, h: 16 }, delivery: { width: 1080, height: 1920 },
      method: 'reframe', media: 'video', length_s: 6, asset: SHA(sha), status: 'ready',
    } as never)
    size('size_1', 'fset_1', 'A')
    size('size_2', 'fset_2', 'B')
    expect(mediaItem(d, 'P', SHA('A'))?.name).toBe('P-ad-6s-9x16.mp4')
    expect(mediaItem(d, 'P', SHA('B'))?.name).toBe('P-film2-ad-6s-9x16.mp4')
  })

  it('a storyboard no video renders still has its frames, once', () => {
    const d = project()
    d.assets[SHA('7')] = asset('7')
    const sb = newId('storyboard')
    put(d.storyboards, { id: sb, title: 'Loose', ratio: '9:16', target_s: 15 })
    put(d.shots, { id: 'shot_l', storyboard_id: sb, rank: 'a0', kind: 'shot', duration_s: 3, camera: { size: 'wide' }, status: 'locked' })
    put(d.frames, { id: 'frame_l', shot_id: 'shot_l', version: 1, kind: 'generated', asset: SHA('7'), crew: 'wren' })
    const frames = mediaItems(d, 'P').filter((m) => m.kind === 'frame')
    expect(frames.map((m) => m.name)).toEqual(['P-shot1-frame-v1.png', 'P-shot2-frame-v1.png', 'P-shot2-frame-v2.png', 'P-film2-shot1-frame-v1.png'])
  })
})
