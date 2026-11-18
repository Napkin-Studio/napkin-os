// The Assets library's layout (live test 2026-11-16; features/production-new-ui.clan): the From Napkin tab was
// clipped at the panel's edge, and a lone Clean up button floated under the last group with nothing saying
// what it does. Now it is a library in the canvas's Booth, with the crumb back to the canvas.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./assets.css', import.meta.url), 'utf8')
const tsx = readFileSync(new URL('./AssetsDrawer.tsx', import.meta.url), 'utf8')

describe('the Assets library', () => {
  it('its tabs shrink to fit the row, each titled in full', () => {
    expect(css).toMatch(/\.ad-tabs button \{ flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;/)
    expect(tsx).toContain('title={t.label}')
  })
  it('Clean up sits in its own labelled section that says what it removes', () => {
    expect(tsx).toContain('<section className="ad-clean bsec" aria-label="Unused pictures">')
    expect(tsx).toContain('Pictures nothing uses any more stay in this browser until you clean them up.')
  })
  it('is in the Booth: a crumb back to the canvas, no drawer of its own over the canvas', () => {
    expect(tsx).toContain('← Canvas')
    expect(css).not.toContain('position: absolute')
  })
})
