// A project card's placeholder must not take the page's own stage class (Tidewell UAT: `.character` is position: absolute;
// inset: 0 in styles.css, so the placeholder covered the whole card and its Delete button could not be clicked).
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Placeholder } from './Home'

describe('a project card\'s placeholder', () => {
  it.each(['character', 'storyboard', 'video'] as const)('does not carry the %s stage as a class', (stage) => {
    const html = renderToStaticMarkup(<Placeholder stage={stage} />)
    expect(html).toContain('class="pp-ph"')
    expect(html).toContain(`data-stage="${stage}"`)
  })
})
