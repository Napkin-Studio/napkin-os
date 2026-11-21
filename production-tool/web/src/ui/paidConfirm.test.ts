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

// UAT round 3 R3-10: Make the other views offered "back" although @ruby_back-three-quarter was there.
describe('views already made count near angles (pt-canvas-r3)', () => {
  it('a back three-quarter covers the back; a profile covers the side', async () => {
    const { missingViews, viewsCovered } = await import('./viewsWhat')
    expect(viewsCovered('back-three-quarter')).toEqual(['back'])
    expect(viewsCovered('front-three-quarter')).toEqual(['three-quarter'])
    expect(viewsCovered('profile-left')).toEqual(['side'])
    expect(viewsCovered('laughing')).toEqual([])
    expect(missingViews([{ variant: 'front' }, { variant: 'side' }, { variant: 'back-three-quarter' }], ['three-quarter', 'side', 'back'])).toEqual(['three-quarter'])
    expect(missingViews([{ variant: 'front' }, { variant: '3q' }], ['three-quarter', 'side', 'back'])).toEqual(['side', 'back'])
  })
})
