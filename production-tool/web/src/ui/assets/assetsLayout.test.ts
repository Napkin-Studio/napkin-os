// The Assets panel's layout (live test 2026-11-16): the From Napkin tab was clipped at the panel's edge, and
// a lone Clean up button floated under the last group with nothing saying what it does.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./assets.css', import.meta.url), 'utf8')
const tsx = readFileSync(new URL('./AssetsDrawer.tsx', import.meta.url), 'utf8')

describe('the Assets panel', () => {
  it('its tabs shrink to fit the row, each titled in full', () => {
    expect(css).toMatch(/\.ad-tabs button \{ flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;/)
    expect(tsx).toContain('title={t.label}')
  })
  it('Clean up sits in its own labelled section that says what it removes', () => {
    expect(tsx).toContain('<section className="ad-clean" aria-label="Unused pictures">')
    expect(tsx).toContain('Pictures nothing uses any more stay in this browser until you clean them up.')
  })
})
