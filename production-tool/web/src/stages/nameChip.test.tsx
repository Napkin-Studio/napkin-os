// A picture's name never runs past its picture (live test: "@mira_three-quarter@mira_side").
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NameChip } from './Character'

describe('a picture name under it', () => {
  it('is at most the picture wide, and says itself in full in its title', () => {
    const r = { id: 'ref_1', v: 1, field_v: {}, key: 'mira', variant: 'three-quarter', role: 'character', asset: 'sha256:x' } as never
    const html = renderToStaticMarkup(<NameChip r={r} at={{ x: 10, y: 20 }} width={102.4} />)
    expect(html).toContain('max-width:102px')
    expect(html).toContain('title="@mira_three-quarter: its name')
    expect(html).toContain('>@mira_three-quarter</span>')
  })
})
