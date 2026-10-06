import { describe, expect, it } from 'vitest'
import { controlsFor, effectiveConfig, routedProvider, type Controls } from './capabilities'
import { CONFIGS } from './contracts/load'

const every = (c: Controls) => Object.entries(c).filter(([, v]) => !v).map(([k]) => k)

describe('capability gating', () => {
  it('Mock with every flag on shows every control', () => {
    const c = controlsFor(effectiveConfig('allon', 'mock'))
    expect(every(c)).toEqual([])
  })

  it('Runway hides the mask brush, click-select, angles and the strength control', () => {
    const c = controlsFor(effectiveConfig('allon', 'runway'))
    expect(c.maskBrush).toBe(false)
    expect(c.clickSelect).toBe(false)
    expect(c.angles).toBe(false)
    expect(c.series).toBe(false)
    expect(c.feelStrength).toBe(false)
    // …but keeps the basics
    expect(c.generate && c.combine && c.views && c.storyboard && c.regionEditFrames && c.video).toBe(true)
    expect(c.videoRegionEdit).toBe(true) // aleph2 keyframe edit
    expect(c.feelEdit).toBe(true) // feelEdit: prompt
  })

  it('fal shows the mask brush, click-select, angles and the strength control', () => {
    const c = controlsFor(effectiveConfig('allon', 'fal'))
    expect(c.maskBrush && c.clickSelect && c.angles && c.feelStrength).toBe(true)
  })

  it('HeyGen-only video hides region edit and the feel box', () => {
    const cfg = effectiveConfig('allon', 'heygen')
    expect(routedProvider('clip', cfg)).toBe('heygen')
    const c = controlsFor(cfg)
    expect(c.video).toBe(true)
    expect(c.videoRegionEdit).toBe(false)
    expect(c.feelEdit).toBe(false)
    expect(c.feelStrength).toBe(false)
  })

  it('a flag that is off hides the control even when the provider can do it', () => {
    const cfg = effectiveConfig('testing', 'mock')
    expect(cfg.flags.clickSelect).toBe(false)
    const c = controlsFor(cfg)
    expect(c.clickSelect).toBe(false)
    expect(c.feelEdit).toBe(false)
    expect(c.videoRegionEdit).toBe(false)
    expect(c.maskBrush).toBe(true)
  })

  it('an empty routing list turns the op off', () => {
    const cfg = { ...CONFIGS.event, routing: { ...CONFIGS.event.routing, clip: [] } }
    expect(controlsFor(cfg).video).toBe(false)
    const c = controlsFor(CONFIGS.event)
    expect(c.stitch).toBe(true) // relay-internal: gated by the flag only
    expect(c.generate).toBe(true) // fal first
    expect(c.clickSelect).toBe(true) // fal segments and the event flag is on
  })

  it('the Wednesday cuts (D9) do not render with the event flags', () => {
    const c = controlsFor(effectiveConfig('event', 'mock'))
    expect(c.videoRegionEdit).toBe(false)
    expect(c.feelEdit).toBe(false)
    expect(c.feelStrength).toBe(false)
    expect(c.regionEditCanvas).toBe(false)
    expect(c.moreOptions).toBe(false)
    expect(c.generate && c.combine && c.views && c.storyboard && c.video && c.stitch).toBe(true)
  })

  it('reads only the first routed provider', () => {
    const cfg = { ...CONFIGS.event, routing: { ...CONFIGS.event.routing, region_edit: ['runway' as const, 'fal' as const] } }
    expect(controlsFor(cfg).maskBrush).toBe(false)
  })
})
