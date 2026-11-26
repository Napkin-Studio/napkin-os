// Marking a Final is a save moment (UAT 5-tool run, track A, 2026-11-26): a route's frame was marked Final at 15:29 and
// the person went straight to the deck, so the library copy (saved once a minute) never had it; the deck's
// "Update from Production" never showed, because the host compared against a copy without the new Final.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { FINAL_SAVE_MS, finalsKey, soonTimer } from './saveMoments'

const doc = (finals?: Record<string, unknown>) => ({ finals }) as unknown as ProductionDocument

describe('finalsKey: what the deck reads of a project', () => {
  it('changes when a Final is marked, unmarked or its rights change', () => {
    const none = finalsKey(doc())
    const one = finalsKey(doc({ f1: { of: 'frame', asset: 'sha256:a', rights: 'generated' } }))
    const other = finalsKey(doc({ f1: { of: 'frame', asset: 'sha256:a', rights: 'licensed' } }))
    expect(one).not.toBe(none)
    expect(other).not.toBe(one)
    expect(finalsKey(doc({}))).toBe(none)
  })

  it('does not change for the same Finals in another key order', () => {
    const a = finalsKey(doc({ f1: { of: 'frame', asset: 'sha256:a' }, f2: { of: 'video', asset: 'sha256:b' } }))
    const b = finalsKey(doc({ f2: { asset: 'sha256:b', of: 'video' }, f1: { asset: 'sha256:a', of: 'frame' } }))
    expect(a).toBe(b)
  })
})

describe('soonTimer: one save, at the earliest moment asked for', () => {
  afterEach(() => { vi.useRealTimers() })

  it('a Final marked after a landing is saved in seconds, not when the landing wait ends', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const soon = soonTimer(save)
    soon(10_000) // a landed generation
    soon(FINAL_SAVE_MS) // then a Final
    vi.advanceTimersByTime(FINAL_SAVE_MS)
    expect(save).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('a later, longer ask never pushes an earlier save back', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const soon = soonTimer(save)
    soon(FINAL_SAVE_MS)
    vi.advanceTimersByTime(500)
    soon(10_000)
    vi.advanceTimersByTime(FINAL_SAVE_MS - 500)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('cancel drops the pending save and says whether one was waiting', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const soon = soonTimer(save)
    expect(soon.cancel()).toBe(false)
    soon(1_000)
    expect(soon.cancel()).toBe(true)
    vi.advanceTimersByTime(2_000)
    expect(save).not.toHaveBeenCalled()
  })

  it('a Final is saved within two seconds', () => {
    expect(FINAL_SAVE_MS).toBeLessThanOrEqual(2_000)
  })
})
