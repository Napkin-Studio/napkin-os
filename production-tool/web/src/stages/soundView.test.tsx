// The Sound view's controls that are not in this version say so and stay readable in dark mode
// (live test 2026-11-16: '+ Line', '+ Effect' and the loudness chips were near-invisible).
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SoundViewOf as SoundView } from './SoundView'

describe('the Sound view', () => {
  it('says why its later controls are off, beside them', () => {
    const html = renderToStaticMarkup(<SoundView shots={[]} sounds={[]} lines={[]} />)
    expect(html).toContain('Picking a loudness target comes in a later version.')
    expect(html).toContain('Adding lines and effects here comes in a later version')
    expect((html.match(/class="btn[^"]*snd-later"/g) ?? []).length).toBe(5)
  })
  it('draws them in the readable ink, not at the faded disabled opacity', () => {
    const css = readFileSync(new URL('./video.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.btn\.snd-later:disabled \{ opacity: 1; color: var\(--ink3\)/)
  })
})
