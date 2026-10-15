// The selection bar's rows (ui-behaviour 3.9) and the running-job question (3.3).

import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../../doc/store'
import { mainStoryboard } from '../../model/selectors'
import { addShots, job, MAYA } from '../../test/model'
import { barFor, busyQuestion, hasMore, moreFor, type SelInfo } from './selbar'

const sel = (s: Partial<SelInfo>): SelInfo => ({ cards: [], links: 0, group: null, units: 1, locked: false, ...s })
const ids = (s: Partial<SelInfo>) => barFor(sel(s)).map((a) => a.id)

describe('barFor (3.9)', () => {
  it('follows the table', () => {
    expect(ids({ cards: ['script', 'storyboard'], units: 2 })).toEqual(['make-video', 'plan-shots', 'group'])
    expect(ids({ cards: ['script'] })).toEqual(['open', 'plan-shots', 'make-video'])
    expect(ids({ cards: ['storyboard'] })).toEqual(['open', 'make-clips', 'make-video'])
    expect(ids({ cards: ['video'] })).toEqual(['open', 'render-ad', 'make-sizes'])
    expect(ids({ group: { ink: true } })).toEqual(['convert', 'ungroup', 'move-to-board', 'delete'])
    expect(ids({ group: { ink: false } })).toEqual(['ungroup', 'move-to-board', 'delete'])
    expect(ids({ cards: ['video'], units: 3 })).toEqual(['group', 'move-to-board', 'delete'])
    expect(ids({ links: 1 })).toEqual(['delete'])
    expect(ids({ units: 0 })).toEqual([])
  })

  it('a key group (owner 2026-10-15): Stack or Spread, never Ungroup (its names make it)', () => {
    expect(ids({ group: { ink: false, key: { label: 'Samurai · 3 views', stacked: false } } })).toEqual(['stack', 'move-to-board', 'delete'])
    expect(ids({ group: { ink: false, key: { label: 'Samurai · 3 views', stacked: true } } })).toEqual(['spread', 'move-to-board', 'delete'])
    expect(barFor(sel({ group: { ink: false, key: { label: 'Samurai · 3 views', stacked: false } } }))[0]).toMatchObject({ label: 'Stack' })
    expect(barFor(sel({ group: { ink: false, key: { label: 'Samurai · 3 views', stacked: true } } }))[0]).toMatchObject({ label: 'Spread' })
  })

  it('at most one primary, and only where it makes something; what is not built is greyed with why', () => {
    const rows: Partial<SelInfo>[] = [{ cards: ['script', 'storyboard'], units: 2 }, { cards: ['video'] }, { group: { ink: true } }, { units: 3 }]
    for (const r of rows) expect(barFor(sel(r)).filter((a) => a.primary).length).toBeLessThanOrEqual(1)
    expect(barFor(sel({ cards: ['script', 'storyboard'], units: 2 }))[0]).toMatchObject({ id: 'make-video', primary: true })
    expect(barFor(sel({ group: { ink: true } }))[0].off).toMatch(/Ellis/)
    expect(barFor(sel({ group: { ink: true } })).find((a) => a.id === 'ungroup')!.off).toBeUndefined()
  })

  it('Make video and Plan shots are built (3.5, 3.10): no "for now" placeholder; a reason only when this selection cannot', () => {
    for (const r of [{ cards: ['script', 'storyboard'], units: 2 }, { cards: ['script'] }, { cards: ['storyboard'] }] as Partial<SelInfo>[]) {
      for (const a of barFor(sel(r)).filter((x) => x.id === 'make-video' || x.id === 'plan-shots')) expect(a.off).toBeUndefined()
    }
    const off = barFor(sel({ cards: ['script'], off: { 'plan-shots': 'Write the script first' } }))
    expect(off.find((a) => a.id === 'plan-shots')!.off).toBe('Write the script first')
    expect(off.find((a) => a.id === 'make-video')!.off).toBeUndefined()
  })

  it('two scripts or two storyboards offer Make video (Dex asks which one drives), never with a video in the selection', () => {
    expect(ids({ cards: ['script', 'script'], units: 2 })).toEqual(['make-video', 'group', 'move-to-board', 'delete'])
    expect(ids({ cards: ['script', 'storyboard', 'storyboard'], units: 3 })).toEqual(['make-video', 'group', 'move-to-board', 'delete'])
    expect(ids({ cards: ['script', 'script', 'video'], units: 3 })).toEqual(['group', 'move-to-board', 'delete'])
  })

  it('More holds Copy link, Duplicate, Lock and Delete; rows ending in Delete have no More', () => {
    expect(moreFor(sel({ cards: ['script'] })).map((m) => m.id)).toEqual(['copy-link', 'duplicate', 'lock', 'delete'])
    expect(moreFor(sel({ cards: ['script'], locked: true })).map((m) => m.id)).toContain('unlock')
    expect(hasMore(barFor(sel({ cards: ['script'] })))).toBe(true)
    expect(hasMore(barFor(sel({ group: { ink: true } })))).toBe(false)
  })
})

describe('busyQuestion (3.3 Delete)', () => {
  it('names the agent and the work: "Wren is still making clip 4. Stop it and delete?"', () => {
    const d = emptyDocument(MAYA, 'Ad')
    const shots = addShots(d, 4)
    const clip = job(d, 'clip', [], null, { state: 'submitted', node: { kind: 'shot', id: shots[3].id } })
    expect(busyQuestion(d, clip)).toBe('Wren is still making clip 4. Stop it and delete?')
    const plan = job(d, 'shot_list', [], null, { state: 'submitted', crew: 'dex', node: { kind: 'storyboard', id: mainStoryboard(d)!.id } })
    expect(busyQuestion(d, plan)).toBe('Dex is still planning the shots. Stop it and delete?')
    const draft = job(d, 'write', [], null, { state: 'submitted', crew: 'skye' })
    expect(busyQuestion(d, draft)).toBe('Skye is still writing a draft. Stop it and delete?')
  })
})
