// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// An SVG logo becomes a PNG in the browser at upload (owner 2026-11-24, "Go with your recommendations"): the tools take the PNG,
// so no server needs an SVG rasteriser. The canvas drawing itself is proved in Chromium (scratchpad proof); here its seam.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { BrandApi } from '../src/host/brandClans.ts'
import type { BrandClanView } from '../src/host/types.ts'
import { BrandClansController } from '../src/shell/nui/brandClans/controller.ts'
import { LOGO_H, LOGO_MAX_W, logoForUpload, pngName, pngSize, svgSize, type Draw } from '../src/shell/nui/brandClans/rasterise.ts'

const VIEW = JSON.parse(readFileSync(join(process.cwd(), '..', 'docs/contracts/examples/brand-clan', 'view.reply.json'), 'utf8')) as BrandClanView
const enc = (s: string) => new TextEncoder().encode(s)
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

test('an SVG says its proportions by viewBox, else by its width and height', () => {
  assert.deepEqual(svgSize(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 90" width="10" height="10">`), { w: 360, h: 90 })
  assert.deepEqual(svgSize(`<?xml version="1.0"?><svg width="200px" height='50'>`), { w: 200, h: 50 })
  assert.equal(svgSize('<svg width="100%" height="100%">'), null)
  assert.equal(svgSize('not a picture'), null)
})

test('the PNG is LOGO_H high, narrowed for a very wide logo, and named for the SVG', () => {
  assert.deepEqual(pngSize({ w: 360, h: 90 }), { w: LOGO_H * 4, h: LOGO_H })
  assert.deepEqual(pngSize({ w: 100, h: 100 }), { w: LOGO_H, h: LOGO_H })
  const wide = pngSize({ w: 2000, h: 100 })
  assert.equal(wide.w, LOGO_MAX_W)
  assert.equal(wide.h, LOGO_MAX_W / 20)
  assert.equal(pngName('Tidewell-dark.SVG'), 'Tidewell-dark.png')
})

test('an SVG upload is drawn to a PNG at that size; any other picture goes up as it is', async () => {
  const drawn: { type: string; size: { w: number; h: number } }[] = []
  const draw: Draw = async (blob, size) => { drawn.push({ type: blob.type, size }); return PNG }
  const out = await logoForUpload({ name: 'logo.svg', type: 'image/svg+xml', bytes: enc('<svg viewBox="0 0 40 10"></svg>') }, draw)
  assert.deepEqual(out, { name: 'logo.png', bytes: PNG })
  assert.deepEqual(drawn, [{ type: 'image/svg+xml', size: { w: LOGO_H * 4, h: LOGO_H } }])
  const jpg = { name: 'logo.jpg', type: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) }
  assert.deepEqual(await logoForUpload(jpg, draw), { name: 'logo.jpg', bytes: jpg.bytes })
  await assert.rejects(logoForUpload({ name: 'x.svg', bytes: enc('<svg></svg>') }, draw), /does not say its size/)
})

test('the client window puts the PNG, never the SVG, into the Brand Clan; a failure is said', async () => {
  const puts: unknown[][] = []
  const api = {
    putAsset: async (...a: unknown[]) => { puts.push(a); return { name: String(a[1]), path: `human/assets/abc-${String(a[1])}` } },
  } as unknown as BrandApi
  const c = new BrandClansController(api, 'cli_tidewell')
  ;(c as unknown as { state: unknown }).state = { ...c.snapshot(), view: VIEW }
  const got = await c.putLogo({ name: 'Tidewell.svg', type: 'image/svg+xml', bytes: enc('<svg viewBox="0 0 40 10"/>') }, async () => PNG)
  assert.deepEqual(got, { path: 'human/assets/abc-Tidewell.png', name: 'Tidewell.png' })
  assert.deepEqual(puts, [[VIEW.path, 'Tidewell.png', PNG]])
  assert.equal(await c.putLogo({ name: 'bad.svg', bytes: enc('<svg/>') }, async () => PNG), null)
  assert.match(String(c.snapshot().error), /does not say its size/)
})
