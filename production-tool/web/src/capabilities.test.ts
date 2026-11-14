import { describe, expect, it } from 'vitest'
import { controlsFor, effectiveConfig, routedProvider, type Controls } from './capabilities'
import { CONFIGS, SHEETS } from './contracts/load'

const every = (c: Controls) => Object.entries(c).filter(([, v]) => !v).map(([k]) => k)

describe('capability gating', () => {
  it('Mock with every flag on shows every control', () => {
    const c = controlsFor(effectiveConfig('allon', 'mock'))
    expect(every(c)).toEqual([])
  })

  it('Runway hides click-select, angles and the strength control, and takes a mask on Ideogram', () => {
    const c = controlsFor(effectiveConfig('allon', 'runway'))
    // region_edit runs on ideogram_4_5, which takes a mask (features/image-editor.clan)
    expect(c.maskBrush).toBe(true)
    expect(c.upscale).toBe(true)
    expect(c.clickSelect).toBe(false)
    expect(c.angles).toBe(false)
    expect(c.series).toBe(false)
    expect(c.feelStrength).toBe(false)
    // …but keeps the basics
    expect(c.generate && c.generateMax > 0 && c.views && c.storyboard && c.regionEditFrames && c.video).toBe(true)
    expect(c.videoRegionEdit).toBe(true) // aleph2 keyframe edit
    expect(c.feelEdit).toBe(true) // feelEdit: prompt
  })

  it('the dev switch routes every op to Mock or Runway, or keeps the config\'s routing', () => {
    expect(routedProvider('clip', effectiveConfig('allon', 'runway'))).toBe('runway')
    expect(routedProvider('generate', effectiveConfig('allon', 'mock'))).toBe('mock')
    expect(effectiveConfig('live', 'config').routing).toEqual(CONFIGS.live.routing)
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
    const cfg = { ...CONFIGS.live, routing: { ...CONFIGS.live.routing, clip: [] } }
    expect(controlsFor(cfg).video).toBe(false)
    const c = controlsFor(CONFIGS.live)
    expect(c.stitch).toBe(true) // relay-internal: gated by the flag only
    expect(c.generate).toBe(true) // Runway, the only provider routed (features/runway-fallback.clan)
    expect(c.clickSelect).toBe(false) // Runway does not segment
  })

  it('the Wednesday cuts (D9) do not render with the live flags', () => {
    const c = controlsFor(effectiveConfig('live', 'mock'))
    expect(c.videoRegionEdit).toBe(false)
    expect(c.feelEdit).toBe(false)
    expect(c.feelStrength).toBe(false)
    expect(c.regionEditCanvas).toBe(false)
    expect(c.moreOptions).toBe(false)
    expect(c.generate && c.generateMax > 0 && c.views && c.storyboard && c.video && c.stitch).toBe(true)
  })

  it('Fix it in the shot shows with the live flags on every provider, whatever its video region support', () => {
    // Decided 2026-10-07: the box on the paused clip edits the storyboard frame, not the video,
    // so it is gated on frame region edits (regionEditFrames), not on videoRegionEdit.
    for (const p of ['mock', 'runway'] as const) {
      const c = controlsFor(effectiveConfig('live', p))
      expect(c.videoRegionEdit).toBe(false)
      expect(c.fixInShot, p).toBe(true)
    }
    const off = { ...CONFIGS.live, flags: { ...CONFIGS.live.flags, regionEditFrames: false } }
    expect(controlsFor(off).fixInShot).toBe(false)
  })

  it('reads only the first routed provider', () => {
    const cfg = { ...CONFIGS.live, routing: { ...CONFIGS.live.routing, region_edit: ['runway' as const, 'mock' as const] } }
    expect(controlsFor(cfg).clickSelect).toBe(false)
    expect(controlsFor({ ...cfg, routing: { ...cfg.routing, region_edit: ['mock' as const, 'runway' as const] } }).clickSelect).toBe(true)
  })
  it("reads an op's own mask over the sheet's", () => {
    const sheets = structuredClone(SHEETS)
    delete sheets.runway.ops.region_edit!.mask
    expect(controlsFor(effectiveConfig('allon', 'runway'), sheets).maskBrush).toBe(false)
  })
})
