// The "N out of date" bar rides in the Storyboard's band, never floating over its sheet, where it covered a frame's
// editor button (Tidewell UAT, S4).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('the update bar on the Storyboard', () => {
  it('is in the editor band, and the app no longer floats one over the stage', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    const sb = readFileSync(new URL('./Storyboard.tsx', import.meta.url), 'utf8')
    expect(app).not.toMatch(/<RemakeBar/)
    expect(sb).toMatch(/<RemakeBar dock="inline" \/>/)
  })
})
