import { describe, expect, it, vi } from 'vitest'
import { startUp, takeNewFilm } from './startup'

describe('start up after the first render (Tidewell UAT: ~15 s on "Opening Napkin Studio…")', () => {
  it('opens the linked film first, then tidies the drafts; Home when none opens', async () => {
    const order: string[] = []
    const shell = { goHome: vi.fn(async () => { order.push('home') }), pruneDrafts: vi.fn(async () => { order.push('prune') }) }
    await startUp(shell as never, {} as never, async () => { order.push('open'); return true }, () => false)
    expect(order).toEqual(['open', 'prune'])
    order.length = 0
    await startUp(shell as never, {} as never, async () => { order.push('open'); return false }, () => false)
    expect(order).toEqual(['open', 'home', 'prune'])
  })
})

describe('the shell\'s "+" on a client\'s Production row starts a film (UAT acceptance A40: it did nothing)', () => {
  it('?new=1 starts one film, before the tidy-up, and opens no link', async () => {
    const order: string[] = []
    const shell = { goHome: vi.fn(async () => { order.push('home') }), pruneDrafts: vi.fn(async () => { order.push('prune') }), newProject: vi.fn(async () => { order.push('new') }) }
    await startUp(shell as never, {} as never, async () => { order.push('open'); return true }, () => true)
    expect(order).toEqual(['new', 'prune'])
    // It could not start: Home, as with no link.
    order.length = 0
    shell.newProject.mockImplementationOnce(async () => { throw new Error('offline') })
    await startUp(shell as never, {} as never, async () => { order.push('open'); return true }, () => true)
    expect(order).toEqual(['home', 'prune'])
  })

  it('is read once: ?new=1 leaves the address and the client stays, so a reload makes no second film', () => {
    const went: string[] = []
    expect(takeNewFilm({ pathname: '/production/', search: '?client=cli_e8711bc5&new=1', hash: '' }, (u) => went.push(u))).toBe(true)
    expect(went).toEqual(['/production/?client=cli_e8711bc5'])
    expect(takeNewFilm({ pathname: '/production/', search: '?client=cli_e8711bc5', hash: '' }, (u) => went.push(u))).toBe(false)
    expect(went).toHaveLength(1)
  })
})
