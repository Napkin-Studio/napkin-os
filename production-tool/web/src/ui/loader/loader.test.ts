import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NapkinLoader } from './NapkinLoader'

// The approved artboard (ui-behaviour 6.8): one SVG pattern, copied verbatim.
const ARTBOARD = readFileSync(new URL('../../../../../docs/production-tool/ui-mocks/Loader.dc.html', import.meta.url), 'utf8')
const CSS = readFileSync(new URL('./loader.css', import.meta.url), 'utf8')

describe('the Napkin loader', () => {
  it('draws the artboard\'s SVG, with only size, work and state changed', () => {
    const theirs = ARTBOARD.match(/<svg class="napkin-loader" data-work="\{\{k\.id\}\}" data-state="\{\{ui\.state\}\}" width="14" height="14"[^>]*>.*?<\/svg>/s)![0]
      .replace('{{k.id}}', 'plan').replace('{{ui.state}}', 'run').replace('width="14" height="14"', 'width="20" height="20"')
    expect(renderToStaticMarkup(createElement(NapkinLoader, { work: 'plan', size: 20 }))).toBe(theirs)
  })
  it('keeps the artboard\'s CSS block as it is', () => {
    const block = ARTBOARD.match(/\/\* napkin-loader \*\/.*?\/\* \/napkin-loader \*\//s)![0]
    expect(CSS).toContain(block)
  })
  it('is still for queued and finish, and for reduced motion', () => {
    expect(renderToStaticMarkup(createElement(NapkinLoader, { state: 'queued' }))).toContain('data-state="queued"')
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(CSS).toContain('[data-motion="still"] .napkin-loader')
  })
})
