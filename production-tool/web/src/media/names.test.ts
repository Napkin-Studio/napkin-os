import { describe, expect, it } from 'vitest'
import type { DocAsset, ProductionDocument } from '../contracts/types'
import { emptyDocument } from '../doc/store'
import { fileSafe, mediaItem, mediaItems, viewsOnCanvas, zipName } from './names'

const SHA = (c: string) => `sha256:${c.repeat(64)}`
const asset = (c: string, mime = 'image/png', origin: DocAsset['origin'] = 'generated'): DocAsset =>
  ({ sha256: SHA(c), kind: mime.startsWith('video/') ? 'video' : 'image', mime, origin, locations: [] })

/** Two named pictures, a view whose name was taken, an upload, a drawing, two shots with versions, two ads. */
function project(): ProductionDocument {
  const d = emptyDocument()
  d.assets = [
    asset('a'), asset('b', 'image/jpeg', 'uploaded'), asset('c'), asset('d', 'image/webp', 'uploaded'), asset('e', 'image/png', 'drawn'),
    asset('f'), asset('9'), asset('1'),
    asset('2', 'video/mp4'), asset('3', 'video/mp4'), asset('4', 'image/png', 'mock'),
    asset('5', 'video/mp4'), asset('6', 'video/mp4'),
  ]
  d.keys = [{ key: 'maya', role: 'character' }]
  d.refs = [
    { id: 'ref_1', key: 'maya', variant: 'front', asset: SHA('a'), node: 'node_front' },
    { id: 'ref_2', key: 'maya', variant: 'red-coat', asset: SHA('b') },
  ]
  d.shots = [
    { id: 'shot_1', order: 1, duration_s: 3, composition: 'wide', action: 'walks', camera_move: 'static' },
    { id: 'shot_2', order: 2, duration_s: 3, composition: 'close', action: 'laughs', camera_move: 'push_in' },
  ]
  d.frames = [
    { id: 'frame_1', shot_id: 'shot_1', asset: SHA('f'), job_id: 'job_1', selected: true, kind: 'generated' },
    { id: 'frame_2', shot_id: 'shot_2', asset: SHA('9'), job_id: 'job_2', selected: false, kind: 'generated' },
    { id: 'frame_3', shot_id: 'shot_2', asset: SHA('1'), job_id: 'job_3', selected: true, kind: 'generated' },
  ]
  d.takes = [
    { id: 'take_1', shot_id: 'shot_1', asset: SHA('2'), job_id: 'job_4', kind: 'generated', provider: 'runway', selected: true },
    { id: 'take_2', shot_id: 'shot_2', asset: SHA('3'), job_id: 'job_5', kind: 'generated', provider: 'runway', selected: false },
    { id: 'take_3', shot_id: 'shot_2', asset: SHA('4'), job_id: 'job_6', kind: 'mock', provider: 'mock', selected: true },
  ]
  d.exports = [
    { id: 'exp_1', kind: 'ad_mp4', asset: SHA('5'), created_at: '2026-10-09T10:00:00Z' },
    { id: 'exp_2', kind: 'ad_mp4', asset: SHA('6'), created_at: '2026-10-09T11:00:00Z' },
  ]
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
      'ad/Summer-ad-ad-1.mp4',
      'ad/Summer-ad-ad-2.mp4',
    ])
    expect(items.map((m) => m.kind)).toEqual(['picture', 'picture', 'view', 'picture', 'frame', 'frame', 'frame', 'clip', 'clip', 'clip', 'ad', 'ad'])
    // What the beta record names each by: never bytes.
    expect(items.find((m) => m.kind === 'view')?.which).toBe('maya_side')
    expect(items.find((m) => m.name.endsWith('frame-v2.png'))?.which).toBe('frame_3')
  })

  it('a drawing is left out unless it is named; one ad has no number', () => {
    const d = project()
    d.exports = d.exports!.slice(0, 1)
    expect(mediaItems(d, 'P').some((m) => m.sha256 === SHA('e'))).toBe(false)
    expect(mediaItems(d, 'P').filter((m) => m.kind === 'ad').map((m) => m.name)).toEqual(['P-ad.mp4'])
    d.refs.push({ id: 'ref_3', key: 'maya', variant: 'sketch', asset: SHA('e') })
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
    expect(mediaItem(d, 'P', SHA('6'), 'ad')?.name).toBe('P-ad-2.mp4')
    expect(mediaItem(d, 'P', undefined)).toBeUndefined()
    expect(mediaItem(d, 'P', SHA('0'))).toBeUndefined()
  })
})
