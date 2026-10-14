import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../../doc/store'
import type { Board, KeyEntry, NamedRef, ProductionDocument } from '../../contracts/types'
import { boardKey, boardRows, rowLabel } from './boards'
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
  it('prefers the project\'s own boards, by rank', () => {
    const d = doc()
    d.boards = {
      b2: { id: 'b2', v: 1, field_v: {}, title: 'Locations', purpose: 'location', rank: 'b' } as Board,
      b1: { id: 'b1', v: 1, field_v: {}, title: 'Script', purpose: 'script', rank: 'a' } as Board,
    }
    expect(boardRows(d).map((r) => [r.title, r.target])).toEqual([['Script', { kind: 'board', id: 'b1' }], ['Locations', { kind: 'board', id: 'b2' }]])
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
