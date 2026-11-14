import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSaveStore } from './useSave'

// One save state (features/topbar-declutter.clan): the canvas bar's status and More's "Save now"
// read the same store, and Ctrl/Cmd+S is bound once.

describe('the save store', () => {
  it('saving, then saved', async () => {
    const s = createSaveStore()
    const me = {}
    let seen = ''
    s.subscribe(() => { seen += s.get(me).kind + ' ' })
    const r = await s.run(me, async () => {})
    expect(r.kind).toBe('saved')
    expect(seen.trim()).toBe('saving saved')
  })
  it('a failure keeps its reason', async () => {
    const s = createSaveStore()
    const me = {}
    const r = await s.run(me, async () => { throw new Error('the relay is down') })
    expect(r).toEqual({ kind: 'failed', why: 'the relay is down' })
    expect(s.get(me)).toEqual(r)
  })
  it('one save at a time, and another project starts idle', async () => {
    const s = createSaveStore()
    const me = {}
    let runs = 0
    let done!: () => void
    const first = s.run(me, () => { runs++; return new Promise<void>((r) => { done = r }) })
    expect((await s.run(me, async () => { runs++ })).kind).toBe('saving')
    done()
    await first
    expect(runs).toBe(1)
    expect(s.get({}).kind).toBe('idle')
    expect(s.get({})).toBe(s.get({}))
  })
})

describe('Ctrl+S is bound once', () => {
  const SRC = fileURLToPath(new URL('../', import.meta.url))
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : []
  })
  it("only SaveKeys listens for it, and App mounts it", () => {
    const binders = files(SRC).filter((p) => /key\.toLowerCase\(\) === 's'/.test(readFileSync(p, 'utf8')))
    expect(binders.map((p) => p.slice(SRC.length))).toEqual(['ui/SaveButton.tsx'])
    expect(readFileSync(join(SRC, 'App.tsx'), 'utf8')).toContain('<SaveKeys />')
  })
})
