import { describe, expect, it } from 'vitest'
import type { DocAsset, Mime, ProductionDocument } from '../contracts/types'
import { emptyDocument } from '../doc/store'
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
})
