// Excalidraw scenes to napkin/1 (features/engine-import.clan): a fixture for
// every element type and customData tag the tool writes, shaped as
// web/src/canvas/adapter/excalidraw/adapter.ts and the controller make them.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { convertExcalidraw, NOTICES, type ExcalidrawLike } from '../src/import/excalidraw'
import { decodePoints } from '../src/model/points'
import { validateElement, type ElementRecord } from '../src/model/records'
import { SceneStore } from '../src/model/store'

const SHA = (c: string) => `sha256:${c.repeat(64)}`
const el = (o: Partial<ExcalidrawLike> & { id: string; type: string }): ExcalidrawLike => ({
  x: 0, y: 0, width: 100, height: 50, angle: 0, opacity: 100, locked: false, groupIds: [], frameId: null,
  strokeColor: '#1e1e1e', backgroundColor: 'transparent', strokeWidth: 2, strokeStyle: 'solid', fillStyle: 'solid', roughness: 0, isDeleted: false,
  ...o,
})

/** The tool's own scene: one of everything it makes, plus a person's drawing. */
const SCENE: ExcalidrawLike[] = [
  el({ id: 'board1', type: 'frame', x: -100, y: -100, width: 3200, height: 1800, name: 'Board 1', customData: { kind: 'board', id: 'board_1' } }),
  el({ id: 'drawn1', type: 'frame', x: 10, y: 10, width: 200, height: 120, name: 'Drawing', customData: { kind: 'drawn', id: 'node_d', asset: SHA('d') } }),
  el({ id: 'ink1', type: 'freedraw', x: 50, y: 60, frameId: 'drawn1', points: [[0, 0], [10.04, -5.02], [20, 3]], pressures: [0.2, 0.6, 1], strokeColor: '#a33b2b', strokeWidth: 3 }),
  el({ id: 'area1', type: 'rectangle', x: 400, y: 0, width: 320, height: 180, backgroundColor: '#ffffff', strokeColor: 'transparent', customData: { kind: 'sketch', id: 'sketch_1' } }),
  el({ id: 'pic1', type: 'image', x: 800, y: 0, width: 300, height: 400, fileId: 'f1', status: 'saved', customData: { kind: 'pic', id: 'node_p', asset: SHA('a') } }),
  el({ id: 'job_1', type: 'image', x: 1200, y: 0, width: 300, height: 400, fileId: null, status: 'pending', customData: { kind: 'gen', id: 'job_1', op: 'generate', parentIds: ['node_p'], state: 'queued' } }),
  el({ id: 'dropped', type: 'image', x: 0, y: 600, fileId: 'f9', status: 'saved' }),
  el({ id: 'arr1', type: 'arrow', x: 1100, y: 200, points: [[0, 0], [50, -20], [100, 0]], strokeStyle: 'dashed', strokeColor: '#FF4F2E', endArrowhead: 'arrow', startArrowhead: null, startBinding: { elementId: 'pic1' }, endBinding: { elementId: 'job_1' }, customData: { kind: 'provenance', from: 'node_p', to: 'job_1' } }),
  el({ id: 'note1', type: 'text', x: 20, y: 700, text: 'When\nhappy', originalText: 'When happy', fontSize: 24, fontFamily: 5, textAlign: 'center', customData: { kind: 'note', id: 'node_n' } }),
  el({ id: 'box1', type: 'rectangle', x: 0, y: 900, roughness: 1, fillStyle: 'hachure', backgroundColor: '#ffec99' }),
  el({ id: 'label1', type: 'text', x: 5, y: 905, text: 'inside', containerId: 'box1', fontFamily: 1 }),
  el({ id: 'oval', type: 'ellipse', x: 300, y: 900 }),
  el({ id: 'gem', type: 'diamond', x: 500, y: 900, strokeStyle: 'dotted' }),
  el({ id: 'line1', type: 'line', x: 700, y: 900, points: [[0, 0], [40, 40], [80, 0]] }),
  el({ id: 'script1', type: 'rectangle', x: 0, y: 1200, customData: { kind: 'script', id: 'script_1' } }),
  el({ id: 'sb1', type: 'rectangle', x: 300, y: 1200, customData: { kind: 'storyboard', id: 'storyboard_1' } }),
  el({ id: 'vid1', type: 'rectangle', x: 600, y: 1200, customData: { kind: 'video', id: 'video_1' } }),
  el({ id: 'doc1', type: 'rectangle', x: 900, y: 1200, customData: { kind: 'document', id: 'document_1' } }),
  el({ id: 'fmt1', type: 'rectangle', x: 1200, y: 1200, customData: { kind: 'format_set', id: 'format_set_1' } }),
  el({ id: 'sug1', type: 'rectangle', x: 1500, y: 1200, customData: { kind: 'suggestion', id: 'suggestion_1' } }),
  el({ id: 'lnk1', type: 'arrow', x: 0, y: 1300, points: [[0, 0], [300, 0]], startBinding: { elementId: 'script1' }, endBinding: { elementId: 'sb1' }, customData: { kind: 'link', id: 'link_1' } }),
  el({ id: 'mine', type: 'frame', x: 2000, y: 0, name: null }),
  el({ id: 'gone', type: 'rectangle', isDeleted: true }),
  el({ id: 'web', type: 'embeddable', x: 0, y: 1500 }),
]

const byId = (out: ReturnType<typeof convertExcalidraw>) => new Map<string, ElementRecord>(out.records.map((r) => [r.id as string, r]))

describe('convertExcalidraw', () => {
  const out = convertExcalidraw({ elements: SCENE, files: { f1: { id: 'f1', dataURL: 'data:' } } })
  const r = byId(out)

  it('keeps every live id in order, drops the deleted, and every record is napkin/1', () => {
    expect(out.records.map((x) => x.id)).toEqual(SCENE.filter((e) => !e.isDeleted).map((e) => e.id))
    expect(new Set(out.records.map((x) => x.z)).size).toBe(out.records.length)
    expect([...out.records.map((x) => x.z)].sort()).toEqual(out.records.map((x) => x.z))
    for (const x of out.records) expect(validateElement(x)).toBe(x)
  })

  it('maps each tag and type to its kind', () => {
    const kinds = Object.fromEntries(out.records.map((x) => [x.id, x.kind]))
    expect(kinds).toEqual({
      board1: 'board', drawn1: 'frame', ink1: 'stroke', area1: 'sketch', pic1: 'image', job_1: 'image', dropped: 'image',
      arr1: 'arrow', note1: 'text', box1: 'shape', label1: 'text', oval: 'shape', gem: 'shape', line1: 'arrow',
      script1: 'node', sb1: 'node', vid1: 'node', doc1: 'node', fmt1: 'node', sug1: 'node', lnk1: 'link', mine: 'frame', web: 'shape',
    })
    expect([r.get('oval')!.props.geo, r.get('gem')!.props.geo, r.get('box1')!.props.geo]).toEqual(['ellipse', 'diamond', 'rect'])
    expect(['script1', 'sb1', 'vid1', 'doc1', 'fmt1', 'sug1'].map((id) => r.get(id)!.props.nodeKind)).toEqual(['script', 'storyboard', 'video', 'document', 'format_set', 'suggestion'])
  })

  it('keeps the customData tags exactly', () => {
    for (const e of SCENE.filter((x) => !x.isDeleted)) expect(r.get(e.id)!.customData).toEqual(e.customData ?? null)
  })

  it('frameId becomes parentId, containerId becomes boundTo', () => {
    expect(r.get('ink1')!.parentId).toBe('drawn1')
    expect(r.get('label1')!.props.boundTo).toBe('box1')
    expect(r.get('note1')!.props.boundTo).toBeNull()
  })

  it('a freedraw becomes a stroke at its top-left with quantised points and pressures', () => {
    const s = r.get('ink1')!
    expect([s.x, s.y, s.w, s.h]).toEqual([50, 60 - 5.02, 20, 3 + 5.02].map((n) => expect.closeTo(n, 6)) as never)
    const pts = decodePoints(out.points.ink1, { x: s.x, y: s.y })
    expect(pts.map((p) => [p.x, p.y])).toEqual([[50, 60], [60.04, 54.98], [70, 63]].map(([x, y]) => [expect.closeTo(x, 1), expect.closeTo(y, 1)]))
    expect(pts.map((p) => Math.round(p.pressure * 10) / 10)).toEqual([0.2, 0.6, 1])
    expect(s.style).toMatchObject({ stroke: '#a33b2b', width: 3 })
  })

  it('arrows keep their route, bindings, dash and arrowheads; links too', () => {
    const a = r.get('arr1')!
    expect(a.props).toEqual({ route: [0, 0, 50, -20, 100, 0], start: { elementId: 'pic1' }, end: { elementId: 'job_1' } })
    expect(a.style).toMatchObject({ dash: 'dashed', stroke: '#FF4F2E', arrowheadEnd: 'arrow' })
    expect(a.style.arrowheadStart).toBeUndefined()
    expect(r.get('lnk1')!.props).toMatchObject({ start: { elementId: 'script1' }, end: { elementId: 'sb1' } })
  })

  it('text keeps its words unwrapped, as plain and as a Tiptap doc, in Geist', () => {
    const t = r.get('note1')!
    expect(t.props.plain).toBe('When happy')
    expect(t.props.doc).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'When happy' }] }] })
    expect(t.style).toMatchObject({ fontFamily: 'Geist', fontSize: 24, align: 'center' })
  })

  it('images take their sha256 from customData; the rest are listed for the caller to hash', () => {
    expect(r.get('pic1')!.props).toEqual({ assetSha: SHA('a'), status: 'saved' })
    expect(r.get('job_1')!.props).toEqual({ assetSha: null, status: 'pending' })
    expect(out.unresolvedImages).toEqual([{ elementId: 'dropped', fileId: 'f9' }])
  })

  it('frames keep their names; boards are boards', () => {
    expect(r.get('drawn1')!.props.name).toBe('Drawing')
    expect(r.get('board1')!.props.name).toBe('Board 1')
    expect(r.get('mine')!.props.name).toBe('')
  })

  it('says each kind of loss once, and makes unknown types a dashed box', () => {
    expect(out.notices).toEqual([NOTICES.fonts, NOTICES.rough, NOTICES.fills, NOTICES.unknown('embeddable')])
    expect(r.get('web')!.style).toMatchObject({ dash: 'dashed' })
  })

  it('is deterministic and seeds a scene store', () => {
    expect(convertExcalidraw({ elements: SCENE })).toEqual(convertExcalidraw({ elements: SCENE }))
    const s = new SceneStore(new Y.Doc())
    s.seed(out.records, out.points)
    expect(s.all()).toHaveLength(out.records.length)
    expect(s.points('ink1')).toEqual(out.points.ink1)
  })

  it('reads nothing it should not: an empty or missing scene is empty', () => {
    expect(convertExcalidraw(null).records).toEqual([])
    expect(convertExcalidraw({ elements: [null, 3, { type: 'x' }] }).records).toEqual([])
  })
})
