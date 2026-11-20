// The price on a paid confirm and the slow-send line (UAT round 2 R2-3, R2-6, R2-10, R2-11).
import { describe, expect, it, vi } from 'vitest'
import { priceWords } from './historyItems'
import { estimateOnce } from './usePrice'
import { sendingLine } from './sending'
import { chipLook } from './finals/chipLook'
import { viewsWhat } from './viewsWhat'
import type { EstimateRequest } from '../contracts/types'

describe('a paid confirm says what it costs', () => {
  it('formats count × price, nothing when free or unknown', () => {
    expect(priceWords(0.2, 3)).toBe('about $0.60')
    expect(priceWords(0.25)).toBe('about $0.25')
    expect(priceWords(0.007)).toBe('about $0.007')
    expect(priceWords(0)).toBeUndefined()
    expect(priceWords(undefined, 3)).toBeUndefined()
  })

  it('asks the relay once per kind of request; an unknown or failed price is no price', async () => {
    const req: EstimateRequest = { contractVersion: '3', op: 'view', input: { view: 'side' } }
    const estimate = vi.fn(async () => ({ usd: 0.2, unknown: false }))
    expect(await estimateOnce(estimate, req)).toBe(0.2)
    expect(await estimateOnce(estimate, req)).toBe(0.2)
    expect(estimate).toHaveBeenCalledTimes(1)
    expect(await estimateOnce(async () => ({ usd: 1, unknown: true }), { ...req, op: 'generate' })).toBeUndefined()
    expect(await estimateOnce(async () => { throw new Error('404') }, { ...req, op: 'upscale' })).toBeUndefined()
    expect(await estimateOnce(undefined, req)).toBeUndefined()
    expect(viewsWhat('marco', ['three-quarter', 'side', 'back'])).toBe('3 views of @marco: 3/4, side, back')
  })

  it('a slow send says what is happening; chips shrink with the canvas and are dots far out', () => {
    expect(sendingLine(14)).toMatch(/^Uploading 14 pictures, then the Director agent reads them.*up to a minute\.$/)
    expect(sendingLine(0)).toMatch(/reading your words/)
    expect(chipLook(1.5)).toEqual({ dot: false, scale: 1 })
    expect(chipLook(0.6)).toEqual({ dot: false, scale: 0.6 })
    expect(chipLook(0.28).dot).toBe(true)
  })
})
