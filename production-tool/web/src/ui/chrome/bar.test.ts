import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HomeMark, MarkTile } from './Bar'
import { StudioMark } from '../Mark'

const TRIANGLE = 'M2 11 L7 3 L12 11 Z'

describe('the top bar\'s Home is the Napkin logo, as the shell draws it', () => {
  it('HomeMark is a button with the StudioMark at 20px, never the triangle tile', () => {
    const html = renderToStaticMarkup(createElement(HomeMark, { onClick: () => {} }))
    expect(html).toContain('aria-label="Home: your projects"')
    expect(html).toContain(renderToStaticMarkup(createElement(StudioMark, { size: 20 })).replace(/:r\w*:|«r\w*»|_r_\w*_/g, '').slice(0, 60))
    expect(html).toContain('width="20" height="20" viewBox="0 0 22 22"')
    expect(html).not.toContain(TRIANGLE)
  })
  it('MarkTile (Home, signed out, the phone) draws the logo too', () => {
    const html = renderToStaticMarkup(createElement(MarkTile))
    expect(html).toContain('viewBox="0 0 22 22"')
    expect(html).not.toContain(TRIANGLE)
  })
  it('the canvas bar uses HomeMark, and no source draws the triangle', () => {
    expect(readFileSync(new URL('./TopBars.tsx', import.meta.url), 'utf8')).toContain('<HomeMark')
    expect(readFileSync(new URL('./Bar.tsx', import.meta.url), 'utf8')).not.toContain(TRIANGLE)
  })
})
