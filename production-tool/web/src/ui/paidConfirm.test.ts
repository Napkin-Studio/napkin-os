// The paid confirm's words, the slow-send line and canvas chips at zoom (UAT round 2 R2-3, R2-6, R2-11).
import { describe, expect, it } from 'vitest'
import { sendingLine } from './sending'
import { chipLook } from './finals/chipLook'
import { viewsWhat } from './viewsWhat'

describe('confirms, slow sends and chips', () => {
  it('Make the other views says how many and which', () => {
    expect(viewsWhat('marco', ['three-quarter', 'side', 'back'])).toBe('3 views of @marco: 3/4, side, back')
    expect(viewsWhat('marco', ['back'])).toBe('1 view of @marco: back')
  })

  it('a slow send says what is happening; chips shrink with the canvas and are dots far out', () => {
    expect(sendingLine(14)).toMatch(/^Uploading 14 pictures, then the Director agent reads them.*up to a minute\.$/)
    expect(sendingLine(1)).toMatch(/reads it and/)
    expect(sendingLine(0)).toMatch(/reading your words/)
    expect(chipLook(1.5)).toEqual({ dot: false, scale: 1 })
    expect(chipLook(0.6)).toEqual({ dot: false, scale: 0.6 })
    expect(chipLook(0.28).dot).toBe(true)
  })
})
