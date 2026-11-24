import { describe, expect, it, vi } from 'vitest'
import { startUp } from './startup'

describe('start up after the first render (Tidewell UAT: ~15 s on "Opening Napkin Studio…")', () => {
  it('opens the linked film first, then tidies the drafts; Home when none opens', async () => {
    const order: string[] = []
    const shell = { goHome: vi.fn(async () => { order.push('home') }), pruneDrafts: vi.fn(async () => { order.push('prune') }) }
    await startUp(shell, {} as never, async () => { order.push('open'); return true })
    expect(order).toEqual(['open', 'prune'])
    order.length = 0
    await startUp(shell, {} as never, async () => { order.push('open'); return false })
    expect(order).toEqual(['open', 'home', 'prune'])
  })
})
