// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { endsTyping, finishesTyping } from './textTool'

describe('finishing a text on the frame (QA 2026-11-17)', () => {
  it('a click while a text is being typed finishes it instead of adding "Your words" again', () => {
    const t = document.createElement('div')
    t.className = 'ie-text'
    expect(finishesTyping(t)).toBe(true)
    expect(finishesTyping(document.body)).toBe(false)
    expect(finishesTyping(null)).toBe(false)
  })
  it('Enter and Escape finish; Shift+Enter is a new line', () => {
    expect(endsTyping({ key: 'Enter', shiftKey: false })).toBe(true)
    expect(endsTyping({ key: 'Escape', shiftKey: false })).toBe(true)
    expect(endsTyping({ key: 'Enter', shiftKey: true })).toBe(false)
  })
})
