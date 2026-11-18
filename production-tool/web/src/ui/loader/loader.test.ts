// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NapkinLoader } from './NapkinLoader'

// The working sign is the shell's Deep O (features/production-new-ui.clan), never the quadrant loader.
describe('the working sign', () => {
  it('draws the Deep O, turning while a job runs', () => {
    const html = renderToStaticMarkup(createElement(NapkinLoader, { work: 'plan', size: 20 }))
    expect(html).toContain('class="deep-o-static"')
    expect(html).toContain('data-state="working"')
    expect(html).toMatch(/deep-o-spin|deep-o-dash/)
    expect(html).not.toContain('nl-c0')
  })
  it('is still for queued, finish and flat', () => {
    for (const p of [{ state: 'queued' as const }, { state: 'finish' as const }, { flat: true }]) {
      const html = renderToStaticMarkup(createElement(NapkinLoader, p))
      expect(html).not.toMatch(/deep-o-spin|deep-o-dash/)
    }
    expect(renderToStaticMarkup(createElement(NapkinLoader, { state: 'queued' }))).toContain('data-state="queued"')
  })
})
