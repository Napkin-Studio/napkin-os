// No file under src outside src/canvas/adapter/ names the engine's packages:
// not an import, a type import, a re-export, a dynamic import(), a CSS import
// or a vi.mock string (features/canvas-core.clan). Lint catches the imports;
// this catches the rest. The name is built at runtime, so there are no exemptions.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ADAPTER = join(SRC, 'canvas', 'adapter') + sep
const NEEDLE = '@' + 'excalidraw'

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name)
    return d.isDirectory() ? files(p) : [p]
  })
}

describe('the engine boundary', () => {
  const all = files(SRC)

  it('only src/canvas/adapter/ names the engine', () => {
    const leaks = all.filter((f) => !f.startsWith(ADAPTER) && readFileSync(f, 'utf8').includes(NEEDLE)).map((f) => relative(SRC, f))
    expect(leaks).toEqual([])
  })

  it('the adapter does (so the check above is looking at the right thing)', () => {
    expect(all.some((f) => f.startsWith(ADAPTER) && readFileSync(f, 'utf8').includes(NEEDLE))).toBe(true)
  })
})
