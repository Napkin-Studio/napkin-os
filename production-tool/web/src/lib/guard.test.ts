import { describe, expect, it } from 'vitest'
import { clipText, oneAtATime } from './guard'

// Double clicks paid twice, and a note cut inside an emoji failed as "uncertain" (2026-10-09).
describe('one at a time', () => {
  it('drops a second call made before the first settles', async () => {
    const g = oneAtATime()
    let sent = 0
    let release!: () => void
    const first = g.run(() => new Promise<void>((r) => { sent++; release = r }))
    const second = g.run(async () => { sent++ })
    expect(g.busy).toBe(true)
    expect(await second).toBeUndefined()
    release()
    await first
    expect(sent).toBe(1)
    expect(g.busy).toBe(false)
  })

  it('frees itself when the call throws, so the button comes back', async () => {
    const g = oneAtATime()
    await expect(g.run(async () => { throw new Error('no') })).rejects.toThrow('no')
    expect(g.busy).toBe(false)
    expect(await g.run(async () => 'again')).toBe('again')
  })
})

describe('clipping text by code points', () => {
  it('never cuts inside an emoji', () => {
    const text = 'a'.repeat(999) + '😀😀'
    const out = clipText(text, 1000)
    expect(Array.from(out)).toHaveLength(1000)
    expect(out.endsWith('😀')).toBe(true)
    expect(/[\uD800-\uDBFF]$/.test(out)).toBe(false)
  })

  it('leaves text within the limit as it is', () => {
    expect(clipText('hello 👋', 1000)).toBe('hello 👋')
    // 600 emoji are 1200 UTF-16 units but 600 characters to the relay: kept whole
    const emoji = '😀'.repeat(600)
    expect(clipText(emoji, 1000)).toBe(emoji)
  })
})
