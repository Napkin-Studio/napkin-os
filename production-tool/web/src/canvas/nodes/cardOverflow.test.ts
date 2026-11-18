// A node card can never be scrolled (live test 2026-11-16): with overflow hidden, focus inside an empty
// node's PromptStart (and scrollIntoView) scrolled the Script and Video cards 251/187 px sideways after an
// editor's return, so they showed shifted or blank. overflow: clip cannot be scrolled at all.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./nodes.css', import.meta.url), 'utf8')
const prompt = readFileSync(new URL('../../ui/prompt/PromptStart.tsx', import.meta.url), 'utf8')

describe('node cards', () => {
  it('clip their overflow instead of hiding it', () => {
    const rule = css.slice(css.indexOf(':where(.node-layer) :where(.bl-card) {'), css.indexOf('}', css.indexOf(':where(.node-layer) :where(.bl-card) {')))
    expect(rule).toMatch(/overflow:\s*clip/)
    expect(rule).not.toMatch(/overflow:\s*hidden/)
  })
  it('PromptStart moves focus without scrolling what holds it', () => {
    expect(prompt).not.toMatch(/\.focus\(\)/)
  })
})
