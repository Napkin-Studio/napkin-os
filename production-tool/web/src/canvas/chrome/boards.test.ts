import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../../doc/store'
import type { Board, KeyEntry, NamedRef, ProductionDocument } from '../../contracts/types'
import { boardFrames, boardRows, rowLabel } from './boards'
import { boardKey } from '../boards/boards'
import { nextZoom, scrollForZoom } from './controls'

const person = { id: 'p1', handle: 'shrey', tenant_id: 't1' }
const doc = (): ProductionDocument => emptyDocument(person)

function named(d: ProductionDocument, key: string, variant: string, role: KeyEntry['role'], node: string) {
  if (!Object.values(d.keys).some((k) => k.key === key)) d.keys[`k_${key}`] = { id: `k_${key}`, v: 1, field_v: {}, key, role } as KeyEntry
  d.refs[`r_${key}_${variant}`] = { id: `r_${key}_${variant}`, v: 1, field_v: {}, key, variant, node } as unknown as NamedRef
}

describe('the board rail (ui-behaviour 3.2)', () => {
  it('lists the Ad template with today\'s counts until the project has boards', () => {
    const d = doc()
    named(d, 'maya', 'front', 'character', 'n1')
    named(d, 'maya', 'side', 'character', 'n2')
    named(d, 'beach', 'wide', 'location', 'n3')
    named(d, 'golden', 'hour', 'lighting', 'n4')
    const rows = boardRows(d)
    expect(rows.map(rowLabel)).toEqual(['Script', 'Characters · 2', 'Locations · 1', 'References · 1', 'Products', 'Storyboard', 'Video'])
    expect(rows[1].target).toEqual({ kind: 'refs', nodes: ['n1', 'n2'] })
    expect(rows[4].off).toBe('No products named yet')
    expect(rows[0].target).toEqual({ kind: 'open', editor: 'script' })
    expect(rows[5].target).toEqual({ kind: 'open', editor: 'storyboard' })
  })
  it('lists the project\'s own boards by rank when they are frames on the canvas', () => {
    const d = doc()
    d.boards = {
      b2: { id: 'b2', v: 1, field_v: {}, title: 'Locations', purpose: 'location', rank: 'b' } as Board,
      b1: { id: 'b1', v: 1, field_v: {}, title: 'Script', purpose: 'script', rank: 'a' } as Board,
    }
    const rows = boardRows(d, true, { b2: 2 })
    expect(rows.map((r) => [r.title, r.target])).toEqual([['Script', { kind: 'board', id: 'b1' }], ['Locations', { kind: 'board', id: 'b2' }]])
    expect(rows.map((r) => r.count)).toEqual([undefined, 2])
  })
  it('on the own engine lists the loose nodes first, then the boards by rank; a new project lists only its nodes', () => {
    const d = doc()
    const nodes = [{ card: 'script' as const, elId: 'e1' }, { card: 'storyboard' as const, elId: 'e2' }, { card: 'video' as const, elId: 'e3' }]
    expect(boardRows(d, true, {}, nodes).map((r) => [r.title, r.target])).toEqual([
      ['Script', { kind: 'node', id: 'e1' }], ['Storyboard', { kind: 'node', id: 'e2' }], ['Video', { kind: 'node', id: 'e3' }],
    ])
    expect(boardRows(d, true)).toEqual([])
    d.boards = { b1: { id: 'b1', v: 1, field_v: {}, title: 'Characters', purpose: 'character', rank: 'a' } as Board }
    expect(boardRows(d, true, { b1: 3 }, nodes).map(rowLabel)).toEqual(['Script', 'Storyboard', 'Video', 'Characters · 3'])
  })
  it('keeps the template rows on a canvas without board frames (Excalidraw), whatever doc.boards holds', () => {
    const d = doc()
    d.boards = { b1: { id: 'b1', v: 1, field_v: {}, title: 'Script', purpose: 'script', rank: 'a' } as Board }
    expect(boardRows(d).map((r) => r.title)).toEqual(['Script', 'Characters', 'Locations', 'References', 'Products', 'Storyboard', 'Video'])
  })
  it('jumps with ⌥1…⌥9 read from event.code, fits with ⌥0, and never while typing', () => {
    const k = (code: string, extra: Partial<KeyboardEvent> = {}, target: unknown = null) =>
      boardKey({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code, target, ...extra } as KeyboardEvent)
    expect(k('Digit1')).toBe(0)
    expect(k('Digit9')).toBe(8)
    expect(k('Digit0')).toBe('fit')
    expect(k('KeyA')).toBeNull()
    expect(k('Digit2', { altKey: false })).toBeNull()
    expect(k('Digit2', { ctrlKey: true })).toBeNull()
    expect(k('Digit2', {}, { closest: () => ({}) })).toBeNull()
  })
})

describe('the zoom pill', () => {
  it('steps through the house zoom levels and keeps the middle still', () => {
    expect(nextZoom(1, 1)).toBe(1.25)
    expect(nextZoom(1, -1)).toBe(0.9)
    expect(nextZoom(3, 1)).toBe(3)
    expect(nextZoom(0.1, -1)).toBe(0.1)
    // The scene point at the middle of a 1000px view stays there.
    const mid = (scroll: number, z: number) => 500 / z - scroll
    expect(mid(scrollForZoom(-100, 1000, 1, 2), 2)).toBeCloseTo(mid(-100, 1))
  })
})

describe('the boards drawn on today\'s canvas (mock Main)', () => {
  it('wraps each picture board round its pictures; Script left of them, Storyboard below, Video to its right', () => {
    const f = boardFrames([
      { id: 'characters', title: 'Characters', box: { minX: 400, minY: 100, maxX: 760, maxY: 250 } },
      { id: 'locations', title: 'Locations', box: { minX: 800, minY: 100, maxX: 1150, maxY: 250 } },
    ])
    expect(f.map((x) => x.id)).toEqual(['script', 'characters', 'locations', 'storyboard', 'video'])
    expect(f[1].rect).toEqual({ x: 384, y: 78, w: 392, h: 206 })
    expect(f[0].rect).toEqual({ x: 384 - 32 - 340, y: 78, w: 340, h: 440 })
    expect(f[3].rect).toMatchObject({ x: 12, y: 78 + 440 + 48, w: 752 })
    expect(f[4].rect).toMatchObject({ x: 12 + 752 + 24, y: 566 })
  })
  it('an empty project still shows its Script, Storyboard and Video boards', () => {
    expect(boardFrames([]).map((x) => x.holds)).toEqual(['script', 'storyboard', 'video'])
  })
})
