import { describe, expect, it } from 'vitest'
import type { El } from '../canvas/scene'
import { emptyDocument } from '../doc/store'
import { MAYA } from '../test/model'
import { hasWork, showStartCard } from './startCard'

const el = (o: Partial<El> & Record<string, unknown>): El => ({ id: 'e', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, isDeleted: false, customData: {}, ...o }) as unknown as El

describe('the first-run Start card', () => {
  it('shows on a blank canvas', () => {
    expect(showStartCard([], { dismissed: false, refs: 0 })).toBe(true)
  })
  it('hides once the canvas has any node, so it never covers one', () => {
    expect(showStartCard([el({ customData: { kind: 'storyboard', id: 'storyboard_1' } })], { dismissed: false, refs: 0 })).toBe(false)
  })
  it('hides when dismissed or a picture is named', () => {
    expect(showStartCard([], { dismissed: true, refs: 0 })).toBe(false)
    expect(showStartCard([], { dismissed: false, refs: 1 })).toBe(false)
  })
  it('never on a document with nodes, even before the canvas has its scene (re-test N-E)', () => {
    const blank = emptyDocument(MAYA, 'Blank')
    expect(hasWork(blank)).toBe(false) // its empty Script, Storyboard and Film are not work
    expect(hasWork({ ...blank, shots: { shot_1: {} as never } })).toBe(true)
    expect(hasWork({ ...blank, briefs: { brief_1: {} as never } })).toBe(true)
  })
})
