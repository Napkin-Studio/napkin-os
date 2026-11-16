import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { excalidrawFontAssets, excalidrawFontsDir, OVERRIDES_DIR } from '../excalidraw-fonts'

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const pinned = JSON.parse(readFileSync(join(OVERRIDES_DIR, 'overrides.json'), 'utf8')).overrides as { target: string; sha256: string }[]

describe('excalidraw fonts we serve (features/licence-gate.clan)', () => {
  const assets = excalidrawFontAssets()

  it('replaces Liberation Sans and Cascadia Code with the pinned OFL releases', () => {
    expect(pinned.map((o) => o.target).sort()).toEqual([
      'fonts/Cascadia/CascadiaCode-Regular.woff2',
      'fonts/Liberation/LiberationSans-Regular.woff2',
    ])
    for (const o of pinned) {
      expect(sha(assets.get(o.target)!)).toBe(o.sha256)
      expect(sha(readFileSync(join(excalidrawFontsDir(), o.target.slice('fonts/'.length))))).not.toBe(o.sha256)
    }
    expect(assets.has('fonts/LICENSE-LiberationSans.txt') && assets.has('fonts/LICENSE-CascadiaCode.txt')).toBe(true)
  })

  it('serves every other Excalidraw font file unchanged', () => {
    const xiaolai = [...assets.keys()].filter((k) => k.startsWith('fonts/Xiaolai/'))
    expect(xiaolai.length).toBeGreaterThan(100)
    expect(assets.get('fonts/Virgil/Virgil-Regular.woff2')).toEqual(readFileSync(join(excalidrawFontsDir(), 'Virgil/Virgil-Regular.woff2')))
  })

  it('refuses a replacement whose bytes are not the pinned ones', () => {
    const fake = join(OVERRIDES_DIR, '..', '__nope__')
    expect(() => excalidrawFontAssets(excalidrawFontsDir(), fake)).toThrow()
  })
})
