// The engine boundary's lint rules fire where they should (features/canvas-core.clan).
// This runs the real ESLint with the app's eslint.config.js on snippets. The
// package names are built at runtime, so this file holds none of them itself.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const RULE = '@typescript-eslint/no-restricted-imports'
const PKG = '@' + 'excalidraw/' + 'excalidraw'
const eslint = new ESLint({ cwd: ROOT })

async function restricted(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, file) })
  return result.messages.filter((m) => m.ruleId === RULE).map((m) => m.message)
}

describe('the engine stays behind src/canvas/adapter', () => {
  it('a value import in a stage is refused', async () => {
    const msgs = await restricted(`import { thing } from '${PKG}'\nexport const x = thing\n`, 'src/stages/X.tsx')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toContain('Engine code lives in src/canvas/adapter (features/canvas-core.clan)')
  })

  it('an import type from the engine’s types path is refused too', async () => {
    const msgs = await restricted(`import type { T } from '${PKG}/element/types'\nexport type X = T\n`, 'src/canvas/scene.ts')
    expect(msgs).toHaveLength(1)
  })

  it('a re-export from the engine is refused', async () => {
    expect(await restricted(`export { thing } from '${PKG}'\n`, 'src/canvas/scene.ts')).toHaveLength(1)
  })

  it('inside the adapter the engine is allowed', async () => {
    expect(await restricted(`import { thing } from '${PKG}'\nexport const x = thing\n`, 'src/canvas/adapter/excalidraw/x.ts')).toEqual([])
  })
})

describe('src/canvas/core imports no engine, no sync library and no adapter', () => {
  const core = 'src/canvas/core/x.ts'
  it.each([
    ['yjs', 'yjs'],
    ['a tldraw package', '@' + 'tldraw/store'],
    ['a y- package', 'y-' + 'indexeddb'],
    ['the engine', PKG],
    ['an adapter, one level up', '../adapter/excalidraw'],
    ['an adapter, by a longer path', '../../canvas/adapter/excalidraw/x'],
  ])('%s is refused', async (_what, from) => {
    expect(await restricted(`import { thing } from '${from}'\nexport const x = thing\n`, core)).toHaveLength(1)
  })

  it('the core’s own interface file is not mistaken for an adapter', async () => {
    expect(await restricted(`import type { CanvasAdapter } from './canvasAdapter'\nexport type X = CanvasAdapter<never>\n`, core)).toEqual([])
  })
})
