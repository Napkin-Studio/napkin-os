// Make all sizes (features/campaign-formats.clan): the crop case table shared with the relay, the rule
// table over every format in the packs, the Campaign board's grid, the purpose round trip, the free
// request, and the export's names and manifest (no cost).

import { describe, expect, it, vi } from 'vitest'

vi.mock('../export', () => ({ assetBytes: async () => new Uint8Array([137, 80, 78, 71]) }))
import { unzipSync, strFromU8 } from 'fflate'
import cases from '../../../contracts/examples/crop-cases.json'
import type { DeliveryPx, FormatSet, ProductionDocument, ProtectBox, SafeArea, Size } from '../contracts/types'
import { purposeOf, purposeWords } from '../model/purpose'
import { isFreeRequest } from '../jobs/runner'
import { boardLayout, tileSize } from './board'
import { cropBox, previewSize, protectedInside, safeFracs, panCrop, zoomCrop } from './crop'
import { channelOf, PACKS, planChoices, rowsOf } from './formats'
import { availableMethods, methodFor, REGENERATE_BELOW, filled } from './rules'
import { checksFor, flagged } from './checks'
import { applySize } from './make'
import { exportSizes, fileName } from './exportZip'

describe('the subject-aware crop', () => {
  for (const c of (cases as { cases: { name: string; master: { w: number; h: number }; aspect: { w: number; h: number }; protect: ProtectBox[]; safeArea?: SafeArea; delivery?: DeliveryPx; crop: unknown; fits: boolean }[] }).cases) {
    it(`matches the relay: ${c.name}`, () => {
      const got = cropBox(c.master, c.aspect, c.protect, safeFracs(c.safeArea, c.delivery))
      expect(got.crop).toEqual(c.crop)
      expect(got.fits).toBe(c.fits)
    })
  }
  it('reads mm safe areas from the format\'s physical size', () => {
    const fr = safeFracs({ type: 'box', width: 5946, height: 2948, unit: 'mm', basis: 'full_size', anchor: 'centre' }, undefined, { width: 6096, height: 3048, unit: 'mm' })
    expect(fr[0]).toBeCloseTo(75 / 6096)
    expect(fr[1]).toBeCloseTo(50 / 3048)
  })
  it('previews keep the delivery shape at most 2048 px', () => {
    expect(previewSize({ width: 14400, height: 3600 })).toEqual({ width: 2048, height: 512 })
    expect(previewSize({ width: 320, height: 50 })).toEqual({ width: 320, height: 50 })
  })
  it('Adjust crop stays inside the master and keeps its shape', () => {
    const m = { w: 1536, h: 864 }
    const c = { x: 500, y: 0, w: 486, h: 864 }
    expect(panCrop(c, -900, 50, m)).toEqual({ x: 0, y: 0, w: 486, h: 864 })
    const z = zoomCrop(c, 0.5, m)
    expect(z.w / z.h).toBeCloseTo(486 / 864, 2)
    expect(z.x + z.w).toBeLessThanOrEqual(1536)
  })
})

const MASTER = { w: 1536, h: 864, media: 'image' as const }
const SUBJECT: ProtectBox[] = [{ role: 'subject', x: 690, y: 140, w: 160, h: 360 }]

describe('the rule table', () => {
  it('picks a method for every format of every pack, and only crop runs now', () => {
    for (const choice of planChoices()) {
      for (const row of rowsOf(choice)) {
        const m = methodFor(row, MASTER, SUBJECT)
        if (row.media === 'video') expect(m.unavailable).toBeTruthy()
        else {
          expect(m.now).toBe('crop')
          if (m.method !== 'crop') expect(m.waits).toMatch(/needs phase 4/)
        }
      }
    }
  })
  it('crops when the subject fits, extends when it does not, regenerates when an extend leaves it small', () => {
    const rows = rowsOf({ kind: 'plan', id: 'campaign-launch' })
    const by = (id: string) => rows.find((r) => r.format.id === id)!
    expect(methodFor(by('meta-feed-image-4x5'), MASTER, SUBJECT).method).toBe('crop')
    const wide: ProtectBox[] = [{ role: 'subject', x: 100, y: 100, w: 300, h: 600 }, { role: 'product', x: 1200, y: 400, w: 200, h: 300 }]
    expect(methodFor(by('meta-feed-image-1x1'), MASTER, wide).method).toBe('extend')
    expect(filled(MASTER, { w: 9, h: 16 })).toBeLessThan(REGENERATE_BELOW)
    expect(methodFor(by('meta-reels-9x16'), MASTER, wide).method).toBe('regenerate')
    expect(methodFor(by('iab-728x90'), MASTER, SUBJECT).method).toBe('layout')
    expect(methodFor(by('iab-300x250'), MASTER, SUBJECT).method).toBe('crop')
  })
  it('reads the paid methods from the sheet: no Flash regenerate, extend and regenerate offered', () => {
    const m = availableMethods()
    expect(m.has('extend') && m.has('regenerate') && m.has('crop')).toBe(true)
  })
  it('films need the ad; from the ad, a same-shape length is a re-edit and another shape a reframe', () => {
    const film = rowsOf({ kind: 'pack', id: 'film' }, [30, 15])
    const ad = { w: 1920, h: 1080, media: 'video' as const }
    expect(methodFor(film.find((r) => r.format.id === 'film-16x9' && r.length_s === 15)!, ad, []).method).toBe('reedit')
    expect(methodFor(film.find((r) => r.format.id === 'film-9x16')!, ad, []).method).toBe('reframe')
    expect(methodFor(film[0], ad, [], undefined, 30).waits).toBe('The ad itself')
  })
  it('the Campaign launch plan is 17 stills and 7 films, every one in a lane', () => {
    const rows = rowsOf({ kind: 'plan', id: 'campaign-launch' })
    expect(rows.filter((r) => r.media === 'image')).toHaveLength(17)
    expect(rows.filter((r) => r.media === 'video')).toHaveLength(7)
    for (const p of PACKS) for (const f of p.formats) expect(['film', 'social', 'ooh', 'print', 'display']).toContain(channelOf(f))
  })
})

describe('the Campaign board', () => {
  it('lays tiles out at true proportion in lane order, none overlapping', () => {
    const rows = rowsOf({ kind: 'plan', id: 'campaign-launch' })
    const L = boardLayout(rows.map((r) => ({ id: r.key, channel: r.channel, aspect: { w: r.format.delivery_px.width, h: r.format.delivery_px.height } })))
    expect(L.lanes.map((l) => l.channel)).toEqual(['film', 'social', 'ooh', 'print', 'display'])
    const boxes = Object.entries(L.tiles)
    for (const [id, b] of boxes) {
      const r = rows.find((x) => x.key === id)!
      const s = tileSize({ w: r.format.delivery_px.width, h: r.format.delivery_px.height })
      if (s.w > 90) expect(b.w / b.h).toBeCloseTo(r.format.delivery_px.width / r.format.delivery_px.height, 1)
      expect(b.x + b.w).toBeLessThanOrEqual(L.w)
      for (const [id2, c] of boxes) if (id2 !== id) expect(b.x < c.x + c.w && c.x < b.x + b.w && b.y < c.y + c.h && c.y < b.y + b.h).toBe(false)
    }
  })
})

const SET: FormatSet = { id: 'fset_01K7C00000000000000000CF01', v: 1, field_v: {}, master: { kind: 'picture', id: 'pic_0001xx', asset: `sha256:${'5'.repeat(64)}`, w: 1536, h: 864 }, pack: { pack_id: 'campaign-launch', pack_version: 'x' }, protect: { boxes: SUBJECT } }
function size(over: Partial<Size> = {}): Size {
  return { id: 'size_01K7C00000000000000000CS01', v: 1, field_v: {}, set_id: SET.id, rank: 'a0', format: { pack_id: 'social', pack_version: 'x', format_id: 'meta-reels-9x16' }, aspect: { w: 1440, h: 2560 }, delivery: { width: 1440, height: 2560 },
    safe_area: { type: 'insets', top: 14, right: 6, bottom: 35, left: 6, unit: '%' }, method: 'crop', media: 'image', crop: { x: 525, y: 0, w: 486, h: 864 }, status: 'making', job_id: 'job_01K7C00000000000000000CJ01', ...over }
}
const doc = (sizes: Size[]): ProductionDocument => ({ format_sets: { [SET.id]: SET }, sizes: Object.fromEntries(sizes.map((s) => [s.id, s])), assets: {}, jobs: {}, project: { title: 'First Light' } } as unknown as ProductionDocument)

describe('landing and Jude', () => {
  it('a crop lands as the size\'s picture; one cutting the subject needs a look', () => {
    const d = doc([size()])
    const out = { sha256: `sha256:${'6'.repeat(64)}`, url: 'https://x/y', mime: 'image/png', w: 1152, h: 2048 }
    applySize(d, { jobId: 'job_01K7C00000000000000000CJ01', outputs: [out] } as never, 'size_01K7C00000000000000000CS01')
    const s = d.sizes['size_01K7C00000000000000000CS01']
    expect(s.asset).toBe(out.sha256)
    // The subject (y 120..480) runs into Reels' bottom 35% (y > 561)? No: it fits the height; x 690..850 in 525..1011 with 6% sides.
    expect(s.checks?.subject_safe?.result).toBe('pass')
    expect(s.status).toBe('ready')
    const cut = doc([size({ crop: { x: 0, y: 0, w: 486, h: 864 } })])
    applySize(cut, { jobId: 'job_01K7C00000000000000000CJ01', outputs: [out] } as never, 'size_01K7C00000000000000000CS01')
    expect(cut.sizes['size_01K7C00000000000000000CS01'].status).toBe('look')
  })
  it('a job the size no longer names lands nowhere', () => {
    const d = doc([size({ job_id: 'job_01K7C00000000000000000CJ02' })])
    expect(applySize(d, { jobId: 'job_01K7C00000000000000000CJ01', outputs: [{ sha256: 'x' }] } as never, 'size_01K7C00000000000000000CS01')).toBeUndefined()
  })
  it('an Ignore is kept while the result stands', () => {
    const s = size({ crop: { x: 0, y: 0, w: 486, h: 864 }, checks: { subject_safe: { result: 'flag', note: 'x', ignored: { by: 'human:p_a', at: '2026-10-16T00:00:00Z' } } } })
    const c = checksFor(s, SET, doc([s]))
    expect(c.subject_safe?.ignored).toBeTruthy()
    expect(flagged({ checks: c })).toBe(false)
    expect(protectedInside({ x: 0, y: 0, w: 486, h: 864 }, SUBJECT)).toBe(false)
  })
})

describe('jobs', () => {
  it('a size job keeps its set and size in its purpose', () => {
    const p = { for: 'size' as const, setId: SET.id, sizeId: 'size_01K7C00000000000000000CS01' }
    expect(purposeOf({ purpose: purposeWords(p), node: { kind: 'format_set', id: SET.id }, inputs: [] })).toEqual(p)
  })
  it('only a crop is a free request', () => {
    expect(isFreeRequest({ op: 'resize', input: { resize: { method: 'crop', masterSize: { w: 1, h: 1 } } } })).toBe(true)
    expect(isFreeRequest({ op: 'resize', input: { resize: { method: 'extend', masterSize: { w: 1, h: 1 } } } })).toBe(false)
    expect(isFreeRequest({ op: 'generate', input: {} })).toBe(false)
  })
})

describe('Export zip', () => {
  it('names files <project>_<format-id>_<w>x<h> and the manifest says Confirm with the media owner, with no cost', async () => {
    const sha = `sha256:${'7'.repeat(64)}`
    const ooh = size({ id: 'size_01K7C00000000000000000CS02', format: { pack_id: 'ooh-uk-ie', pack_version: 'x', format_id: 'uk-48-sheet' }, delivery: { width: 7200, height: 3600 }, asset: sha, status: 'ready', locked: true })
    const d = doc([ooh])
    d.assets = { [sha]: { sha256: sha, kind: 'image', mime: 'image/png', w: 2048, h: 1024, origin: 'generated', locations: [] } }
    expect(fileName('First Light', ooh, 2048, 1024)).toBe('first-light_uk-48-sheet_2048x1024.png')
    const out = await exportSizes(d, SET.id, 'First Light')
    const files = unzipSync(new Uint8Array(await out.blob.arrayBuffer()))
    expect(Object.keys(files).sort()).toEqual(['first-light_uk-48-sheet_2048x1024.png', 'manifest.json'])
    const text = strFromU8(files['manifest.json'])
    expect(JSON.parse(text).files[0]).toMatchObject({ format_id: 'uk-48-sheet', method: 'crop', preview: true, locked: true, confirm: 'Confirm with the media owner' })
    expect(text).not.toMatch(/cost|usd|\$|credit/i)
  })
})
