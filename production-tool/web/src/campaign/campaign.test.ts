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
import { availableMethods, methodFor, methodModels, methodWords, REGENERATE_BELOW, filled } from './rules'
import { deliveryInput, deliveryScale, fullPlan } from './delivery'
import { checksFor, flagged } from './checks'
import { applySize, placeBoard } from './make'
import { keepsPick, onScreen, tilePick } from './pick'
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
  it('picks a method for every format of every pack, and every still method runs now', () => {
    for (const choice of planChoices()) {
      for (const row of rowsOf(choice)) {
        const m = methodFor(row, MASTER, SUBJECT)
        if (row.media === 'video') expect(m.unavailable).toBeTruthy()
        else {
          expect(m.now).toBe(m.method)
          expect(m.waits).toBeUndefined()
        }
      }
    }
  })
  it('an agency with Ideogram off regenerates on Gemini 3 Pro where it would extend', () => {
    const rows = rowsOf({ kind: 'plan', id: 'campaign-launch' })
    const wide: ProtectBox[] = [{ role: 'subject', x: 100, y: 100, w: 300, h: 600 }, { role: 'product', x: 1200, y: 400, w: 200, h: 300 }]
    const all = methodModels({ routing: { resize: ['runway'] }, allow: { claude: true, makers: ['runway', 'google', 'ideogram'] } } as never)
    expect(all.extend?.label).toBe('Ideogram 4.5')
    expect(all.regenerate?.label).toBe('Gemini 3 Pro')
    const noIdeogram = methodModels({ routing: { resize: ['runway'] }, allow: { claude: true, makers: ['runway', 'google'] } } as never)
    expect(noIdeogram.extend).toBeUndefined()
    const row = rows.find((r) => r.format.id === 'meta-feed-image-1x1')!
    expect(methodFor(row, MASTER, wide, availableMethods(all)).method).toBe('extend')
    expect(methodFor(row, MASTER, wide, availableMethods(noIdeogram)).method).toBe('regenerate')
    // The tray and the tile name the method and the model, never a price.
    expect(methodWords('extend', all)).toBe('Extend · Ideogram 4.5')
    expect(methodWords('regenerate', all)).toBe('Regenerate · Gemini 3 Pro')
    expect(methodWords('crop', all)).toBe('Crop · free')
    expect(methodWords('extend', noIdeogram)).toBe('Extend · off for your agency')
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
  it('at full size: the upscaled file at the delivery size, labelled with the model and the scale', async () => {
    const sha = `sha256:${'7'.repeat(64)}`
    const big = `sha256:${'8'.repeat(64)}`
    const ooh = size({ id: 'size_01K7C00000000000000000CS02', format: { pack_id: 'ooh-uk-ie', pack_version: 'x', format_id: 'uk-48-sheet' }, delivery: { width: 7200, height: 3600 }, asset: sha, plate: sha, status: 'ready', full: { from: sha, asset: big, scale: 4, job_id: 'job_01K7C00000000000000000UP01' } })
    const banner = size({ id: 'size_01K7C00000000000000000CS03', format: { pack_id: 'display', pack_version: 'x', format_id: 'iab-300x250' }, delivery: { width: 300, height: 250 }, asset: sha, status: 'ready', method: 'layout' })
    const d = doc([ooh, banner])
    d.assets = { [sha]: { sha256: sha, kind: 'image', mime: 'image/png', w: 2048, h: 1024, origin: 'generated', locations: [] }, [big]: { sha256: big, kind: 'image', mime: 'image/png', w: 7200, h: 3600, origin: 'generated', locations: [] } } as never
    const out = await exportSizes(d, SET.id, 'First Light', undefined, { model: 'Magnific Precision Upscaler v2' })
    const files = unzipSync(new Uint8Array(await out.blob.arrayBuffer()))
    expect(out.name).toBe('first-light_campaign_full-size.zip')
    expect(Object.keys(files)).toContain('first-light_uk-48-sheet_7200x3600.png')
    const m = JSON.parse(strFromU8(files['manifest.json']))
    expect(m.files.find((f: { format_id: string }) => f.format_id === 'uk-48-sheet')).toMatchObject({ delivery: 'upscaled', upscale: { model: 'Magnific Precision Upscaler v2', scale: 4 }, preview: false })
    expect(m.files.find((f: { format_id: string }) => f.format_id === 'iab-300x250')).toMatchObject({ delivery: 'exact', method: 'layout' })
    expect(JSON.stringify(m)).not.toMatch(/cost|usd|\$|credit/i)
  })
})

describe('phase 4: paid sizes, plates and full size', () => {
  const PLATE = `sha256:${'7'.repeat(64)}`
  const out = { sha256: `sha256:${'6'.repeat(64)}`, url: 'https://x/y', mime: 'image/png', w: 1152, h: 2048 }
  it('a paid size lands with its plate, which Edit type draws on again', () => {
    const d = doc([size({ method: 'extend' })])
    const plate = { sha256: PLATE, kind: 'image', mime: 'image/png', origin: 'generated', locations: [], w: 1152, h: 2048 } as never
    applySize(d, { jobId: 'job_01K7C00000000000000000CJ01', op: 'resize', outputs: [out], resize: { method: 'extend', crop: { x: 0, y: 0, w: 1536, h: 864 }, previewPx: { width: 1152, height: 2048 } } } as never, 'size_01K7C00000000000000000CS01', plate)
    const s = d.sizes['size_01K7C00000000000000000CS01']
    expect(s.plate).toBe(PLATE)
    expect(d.assets[PLATE]).toBeTruthy()
    // The crop the size had is kept: a paid size's job says the whole master.
    expect(s.crop).toEqual({ x: 525, y: 0, w: 486, h: 864 })
  })
  it('an upscale lands as the size\'s full file only for the picture it was made for', () => {
    const d = doc([size({ asset: out.sha256, plate: PLATE, full: { from: out.sha256, job_id: 'job_01K7C00000000000000000UP01', scale: 4 } })])
    applySize(d, { jobId: 'job_01K7C00000000000000000UP01', op: 'upscale', outputs: [{ ...out, sha256: `sha256:${'8'.repeat(64)}` }] } as never, 'size_01K7C00000000000000000CS01')
    const s = d.sizes['size_01K7C00000000000000000CS01']
    expect(s.full?.asset).toBe(`sha256:${'8'.repeat(64)}`)
    expect(s.asset).toBe(out.sha256)
    expect(fullPlan(s)).toEqual({ kind: 'ready', scale: 4 })
    // A new picture (Redo, Edit type) puts it out of date: the next Export at full size upscales again.
    expect(fullPlan({ ...s, asset: `sha256:${'9'.repeat(64)}` })).toEqual({ kind: 'upscale', scale: 4 })
  })
  it('Export at full size: x4, else x8, under Magnific\'s 25.3 MP (the relay\'s vectors)', () => {
    expect(deliveryScale([2048, 1024], [6096, 3048])).toBe(4)
    expect(deliveryInput([2048, 1024], [6096, 3048], 4)).toEqual([1524, 762])
    expect(deliveryScale([1024, 1024], [5000, 5000])).toBe(8)
    expect(deliveryScale([2048, 512], [14400, 3600])).toBe(8)
    expect(deliveryInput([2048, 512], [14400, 3600], 8)).toEqual([1257, 314])
    expect(deliveryScale([300, 250], [300, 250])).toBeNull()
    expect(deliveryScale([728, 90], [1456, 180])).toBeNull()
    expect(fullPlan(size({ asset: out.sha256, delivery: { width: 300, height: 250 } }))).toEqual({ kind: 'exact' })
    expect(fullPlan(size({ asset: out.sha256 }))).toEqual({ kind: 'preview' }) // no plate yet
    expect(fullPlan(size({ asset: out.sha256, plate: PLATE }))).toEqual({ kind: 'upscale', scale: 4 })
  })
  it('a layout is free like a crop; extend and regenerate are not', () => {
    const req = (method: string) => ({ op: 'resize', input: { resize: { method } } }) as never
    expect(isFreeRequest(req('layout'))).toBe(true)
    expect(isFreeRequest(req('extend'))).toBe(false)
    expect(isFreeRequest(req('regenerate'))).toBe(false)
  })
})

describe('one tile bar at a time, boards placed clear (owner bug 2026-10-16)', () => {
  it('picking a tile on another board closes the first; its flags close with it; clear closes all', () => {
    tilePick.clear()
    tilePick.pick('fset_a', 'size_1')
    tilePick.toggleFlags('fset_a', 'size_1')
    expect(tilePick.get()).toEqual({ setId: 'fset_a', sizeId: 'size_1', flags: true })
    tilePick.pick('fset_b', 'size_9')
    expect(tilePick.get()).toEqual({ setId: 'fset_b', sizeId: 'size_9', flags: false })
    tilePick.toggleFlags('fset_b', 'size_9')
    tilePick.toggleFlags('fset_b', 'size_9')
    expect(tilePick.get()?.flags).toBe(false)
    tilePick.clear()
    expect(tilePick.get()).toBeNull()
  })
  it('a click outside the tiles, bars, trays and menus clears it; the tile panned off screen too', () => {
    const at = (cls: string) => ({ closest: (sel: string) => (sel.split(', ').some((c) => c === `.${cls}`) ? {} : null) }) as unknown as Element
    expect(keepsPick(at('cb-tile'))).toBe(true)
    expect(keepsPick(at('cb-float'))).toBe(true)
    expect(keepsPick(at('excalidraw'))).toBe(false)
    expect(keepsPick(null)).toBe(false)
    expect(onScreen({ left: -300, top: 10, right: -20, bottom: 200 }, { w: 1200, h: 800 })).toBe(false)
    expect(onScreen({ left: 1100, top: 10, right: 1300, bottom: 200 }, { w: 1200, h: 800 })).toBe(true)
  })
  it('a second board from another master lands clear of the first and of every picture', () => {
    const el = (id: string, x: number, y: number, width: number, height: number, kind?: string) => ({ id, x, y, width, height, type: 'rectangle', isDeleted: false, customData: kind ? { kind, id } : undefined }) as never
    const first = el('b1', 600, 0, 1800, 1400, 'board')
    const masterA = el('m1', 0, 0, 500, 280)
    const masterB = el('m2', 0, 400, 500, 280)
    const box = placeBoard([first, masterA, masterB], masterB as never, 1800, 1400)
    const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.w && a.y < b.y + b.height && b.y < a.y + a.h
    for (const e of [first, masterA, masterB] as { x: number; y: number; width: number; height: number }[]) expect(overlap(box, e)).toBe(false)
    expect(box.y).toBe(400)
  })
})
