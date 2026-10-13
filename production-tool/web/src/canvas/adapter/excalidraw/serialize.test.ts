// serializeScene writes canvas.excalidraw exactly as export.ts did before the
// adapter: serializeAsJSON(elements, {}, files, 'local').

import { describe, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => [] as unknown[][])
vi.mock('@excalidraw/excalidraw', () => ({
  serializeAsJSON: (...args: unknown[]) => {
    seen.push(args)
    return 'json'
  },
}))

import { serializeScene } from './serialize'

describe('serializeScene', () => {
  it('passes the elements and files through unchanged, with no app state and the source local', () => {
    const elements = [{ id: 'a' }] as never[]
    const files = { f: { id: 'f' } } as never
    expect(serializeScene(elements, files)).toBe('json')
    expect(seen).toEqual([[elements, {}, files, 'local']])
    expect(seen[0][0]).toBe(elements)
    expect(seen[0][2]).toBe(files)
  })
})
