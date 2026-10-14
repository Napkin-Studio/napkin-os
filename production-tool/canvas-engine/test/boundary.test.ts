// The engine's boundary (features/engine-foundation.clan): its lint refuses
// React, the tldraw SDK and editor, the document store and the web app; and the
// lockfile holds no tldraw editor package. Names are built at runtime so this
// file holds none of them.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: ROOT })

async function refused(from: string): Promise<number> {
  const [r] = await eslint.lintText(`import { x } from '${from}'\nexport const y = x\n`, { filePath: resolve(ROOT, 'src/model/x.ts') })
  return r.messages.filter((m) => m.ruleId === '@typescript-eslint/no-restricted-imports').length
}

describe('the engine imports', () => {
  it.each([
    ['react', 're' + 'act'],
    ['react-dom/client', 're' + 'act-dom/client'],
    ['the tldraw SDK', 'tl' + 'draw'],
    ['the tldraw editor', '@tl' + 'draw/editor'],
    ['the document store', '../../../clan' + '-store/src'],
    ['the web app', '../../../web/src/canvas/scene'],
  ])('refuse %s', async (_what, from) => {
    expect(await refused(from)).toBe(1)
  })

  it('allow @tldraw/store and yjs', async () => {
    expect(await refused('@tl' + 'draw/store')).toBe(0)
    expect(await refused('y' + 'js')).toBe(0)
  })
})

describe('the installed tree', () => {
  it('has no tldraw SDK or editor package', () => {
    const lock = JSON.parse(readFileSync(resolve(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, unknown> }
    const names = Object.keys(lock.packages).map((p) => p.replace(/^.*node_modules\//, ''))
    expect(names.filter((n) => n === 'tl' + 'draw' || n === '@tl' + 'draw/editor' || n === '@tl' + 'draw/tldraw')).toEqual([])
    expect(names.filter((n) => n.startsWith('@tl' + 'draw/')).sort()).toEqual(['@tldraw/state', '@tldraw/store', '@tldraw/utils'])
  })
})
