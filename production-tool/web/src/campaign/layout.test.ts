// Type as layers and Jude's per-format checks (features/campaign-formats.clan, phase 3): the one layout
// function over every format in the packs, and the checks on the design's fixtures (a logo in the
// Reels bottom 35%, a 12-word OOH line, a film with no end card).

import { describe, expect, it } from 'vitest'
import type { FormatSet, ProductionDocument, Region, Size } from '../contracts/types'
import { PACKS } from './formats'
import { brandKit, layoutPanel, panelCrop, CLEAR, layoutType, MIN_CAP, type LayoutIn } from './layout'
import { checksFor } from './checks'
import { rowFracs } from './rules'
import { channelOf } from './formats'

const LOGO = `sha256:${'a'.repeat(64)}`
const brand = { logo: { sha256: LOGO, w: 600, h: 200 }, colour: '#FFFFFF', field: '#141414' }
const copy = { line: 'First light. First sip.', legal: 'Enjoy responsibly. 18+ only.' }
const overlaps = (a: Region, b: Region) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9

describe('the type layout, every format', () => {
  for (const pack of PACKS) {
    for (const f of pack.formats) {
      it(`${f.id}: inside the safe area, the logo's clear space kept, type at its minimum`, () => {
        const fr = rowFracs({ format: f })
        const ch = channelOf(f) === 'film' ? 'social' : channelOf(f)
        const inp: LayoutIn = { w: f.delivery_px.width, h: f.delivery_px.height, channel: ch, fracs: fr, copy, brand }
        const laid = layoutType(inp)
        expect(laid.map((l) => l.kind).sort()).toEqual(['legal', 'line', 'logo'])
        for (const l of laid) {
          expect(l.box.x).toBeGreaterThanOrEqual(fr[0] - 1e-6)
          expect(l.box.y).toBeGreaterThanOrEqual(fr[1] - 1e-6)
          expect(l.box.x + l.box.w).toBeLessThanOrEqual(1 - fr[2] + 1e-6)
          expect(l.box.y + l.box.h).toBeLessThanOrEqual(1 - fr[3] + 1e-6)
        }
        const logo = laid.find((l) => l.kind === 'logo')!
        const padX = (CLEAR * logo.box.h * inp.h) / inp.w
        const zone = { x: logo.box.x - padX, y: logo.box.y - CLEAR * logo.box.h, w: logo.box.w + 2 * padX, h: logo.box.h * (1 + 2 * CLEAR) }
        for (const l of laid.filter((x) => x.kind !== 'logo')) expect(overlaps(l.box, zone)).toBe(false)
        const line = laid.find((l) => l.kind === 'line')!
        expect(line.capPx!).toBeGreaterThanOrEqual(Math.max(MIN_CAP[ch].frac * inp.h, MIN_CAP[ch].px) - 0.01)
      })
    }
  }
  it('a size\'s own words, a hidden layer and a bigger line', () => {
    const inp: LayoutIn = { w: 1080, h: 1080, channel: 'social', fracs: [0, 0, 0, 0], copy, brand, overrides: { line: { text: 'Sip.', scale: 1.5 }, legal: { hidden: true } } }
    const laid = layoutType(inp)
    expect(laid.find((l) => l.kind === 'line')?.text).toBe('Sip.')
    expect(laid.some((l) => l.kind === 'legal')).toBe(false)
    expect(laid.find((l) => l.kind === 'line')!.sizeFrac).toBeCloseTo(0.035 * 1.5)
  })
  it('the brand kit is the Brand board\'s logo, a light palette swatch (words), a dark one (a layout\'s field) and the font', () => {
    const d = { refs: {
      r1: { id: 'r1', role: 'logo', asset: LOGO, key: 'brand', variant: 'logo' },
      r2: { id: 'r2', role: 'palette', swatches: [{ hex: '#111111' }, { hex: '#F4E9D8' }], key: 'brand', variant: 'palette' },
      r3: { id: 'r3', role: 'typography', font: { family: 'Geist' }, key: 'brand', variant: 'type' },
    }, assets: { [LOGO]: { w: 300, h: 100 } } } as unknown as ProductionDocument
    expect(brandKit(d)).toEqual({ logo: { sha256: LOGO, w: 300, h: 100 }, colour: '#F4E9D8', field: '#111111', font: 'Geist' })
  })
})

const SET: FormatSet = { id: 'fset_01K7C00000000000000000CF01', v: 1, field_v: {}, master: { kind: 'picture', id: 'pic_0001xx', asset: `sha256:${'5'.repeat(64)}`, w: 1536, h: 864 }, pack: { pack_id: 'campaign-launch', pack_version: 'x' }, copy }
const DOC = { refs: { r1: { id: 'r1', role: 'logo', asset: LOGO, key: 'brand', variant: 'logo' } }, assets: { [LOGO]: { w: 600, h: 200 } } } as unknown as ProductionDocument
const size = (format_id: string, w: number, h: number, over: Partial<Size> = {}): Size => ({
  id: 'size_01K7C00000000000000000CS01', v: 1, field_v: {}, set_id: SET.id, rank: 'a0', format: { pack_id: 'x', pack_version: 'x', format_id },
  aspect: { w, h }, delivery: { width: w, height: h }, method: 'crop', media: 'image', ...over,
})

describe('Jude on the fixtures', () => {
  it('a clean Reels size passes; a logo moved into its bottom 35% is flagged', () => {
    const ok = checksFor(size('meta-reels-9x16', 1440, 2560), SET, DOC)
    expect(ok.logo_safe?.result).toBe('pass')
    expect(ok.clear_space?.result).toBe('pass')
    expect(ok.line_present?.result).toBe('pass')
    const low = checksFor(size('meta-reels-9x16', 1440, 2560, { layers: { logo: { box: { x: 0.4, y: 0.8, w: 0.2, h: 0.05 } } } }), SET, DOC)
    expect(low.logo_safe?.result).toBe('flag')
  })
  it('a 12-word line on a 48-sheet is flagged; this size\'s own short line passes', () => {
    const long = { ...SET, copy: { line: 'Every single morning starts somewhere and ours starts with the first light sip' } }
    expect(checksFor(size('uk-48-sheet', 7200, 3600), long, DOC).ooh_words?.result).toBe('flag')
    expect(checksFor(size('uk-48-sheet', 7200, 3600, { layers: { line: { text: 'First light. First sip.' } } }), long, DOC).ooh_words?.result).toBe('pass')
  })
  it('a hidden line is flagged as missing', () => {
    expect(checksFor(size('iab-300x250', 300, 250, { layers: { line: { hidden: true } } }), SET, DOC).line_present?.result).toBe('flag')
  })
  it('a film with no end card, and a social film with no supers, are flagged', () => {
    const film = size('film-9x16', 1080, 1920, { media: 'video', method: 'reedit', length_s: 15, edl: [{ shot_id: 'shot_01K7C00000000000000000CH01', in_s: 0, out_s: 6 }] })
    const c = checksFor(film, SET, DOC)
    expect(c.end_card?.result).toBe('flag')
    expect(c.sound_off?.result).toBe('flag')
    expect(c.brand_first_3s?.result).toBe('pass')
    const withCard = checksFor({ ...film, edl: [...film.edl!, { shot_id: 'shot_01K7C00000000000000000CH09', in_s: 0, out_s: 2, end_card: true }] }, { ...SET, copy: { ...copy, supers: ['Every morning starts somewhere.'] } }, DOC)
    expect(withCard.end_card?.result).toBe('pass')
    expect(withCard.sound_off?.result).toBe('pass')
  })
})

describe('layout: the picture in a panel on the brand colour field', () => {
  const M = { w: 1536, h: 864 }
  it('a banner strip puts the picture at its left end, at most 40%, the type beside it', () => {
    const p = layoutPanel({ w: 728, h: 90 }, M)
    expect(p.x).toBe(0)
    expect(p.w * 728).toBeCloseTo(160, 0)
    expect(layoutPanel({ w: 320, h: 50 }, M).w).toBeLessThanOrEqual(0.4)
    const tall = layoutPanel({ w: 160, h: 600 }, M)
    expect(tall.w).toBe(1)
    expect(tall.h * 600).toBeCloseTo(160 / (4 / 3), 0)
  })
  it('the panel crop keeps the subject and has the panel\'s shape', () => {
    const c = panelCrop(M, { w: 728, h: 90 }, [{ role: 'subject', x: 690, y: 140, w: 160, h: 360 }])
    expect(c.w / c.h).toBeCloseTo(160 / 90, 1)
    expect(c.x).toBeLessThanOrEqual(690)
    expect(c.x + c.w).toBeGreaterThanOrEqual(850)
  })
})
