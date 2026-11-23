// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Owner, 2026-11-23: at laptop widths the document bar must keep the title, Continue in (the only way into the other
// tools) and the primary button; what gives way is the Working chip, then the second button, then Share, in that order.
// This runs the real Toolbar and CSS in Chromium, so it needs the browser (`npx playwright install chromium`); without
// one it says so and skips rather than pass for nothing.

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const app = resolve(process.cwd())
const LONG = 'Harbour Bakes Oven Crisps launch plan'

test('the bar keeps the title, Continue in and Save at 1024, 1280 and 1440, with and without the Working chip', async t => {
  const { build } = await import('esbuild')
  const { chromium } = await import('playwright')
  let browser
  try { browser = await chromium.launch() } catch (e) { t.skip(`no Chromium here: ${(e as Error).message.split('\n')[0]}`); return }
  const dir = mkdtempSync(join(tmpdir(), 'topbar-'))
  try {
    await build({
      entryPoints: [join(app, 'tests/fixtures/topbarHarness.tsx')], outdir: dir, bundle: true, format: 'iife', platform: 'browser',
      jsx: 'automatic', logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env': '{}', 'import.meta.env.DEV': 'true', 'import.meta.env.BASE_URL': '"/"' },
      loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.jpg': 'dataurl' },
    })
    writeFileSync(join(dir, 'index.html'), `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><link rel="stylesheet" href="topbarHarness.css"></head><body><div id="root"></div><script src="topbarHarness.js"></script></body></html>`)
    assert.ok(readFileSync(join(dir, 'topbarHarness.css'), 'utf8').includes('tba-more'), 'the bar CSS is in the bundle')
    for (const width of [1024, 1280, 1440]) {
      for (const chip of [false, true]) {
        const page = await browser.newPage({ viewport: { width, height: 700 } })
        await page.goto(`file://${join(dir, 'index.html')}?chip=${chip ? 1 : 0}&title=${encodeURIComponent(LONG)}`)
        await page.waitForSelector('[data-testid="doc-name"]')
        await page.waitForTimeout(150)
        const at = `${width}px, chip ${chip}`
        const cont = page.getByRole('button', { name: /^Continue in/ })
        const box = await cont.boundingBox()
        assert.ok(box, `Continue in is drawn at ${at}`)
        // visible: wholly inside the slot it sits in, and not under anything: a real click lands on it
        const slot = (await page.locator('#tb-app').boundingBox())!
        assert.ok(box!.x >= slot.x - 1 && box!.x + box!.width <= slot.x + slot.width + 1, `Continue in is not clipped at ${at}`)
        await cont.click({ timeout: 2000 })
        assert.equal(await page.locator('[data-testid="continue-menu"]').count(), 1, `Continue in opens its menu at ${at}`)
        await page.keyboard.press('Escape')
        const name = (await page.locator('[data-testid="doc-name"] b').boundingBox())!
        assert.ok(name.width >= 150, `the title keeps room at ${at} (${Math.round(name.width)}px)`)
        const save = await page.getByRole('button', { name: 'Save · PDF' }).boundingBox()
        assert.ok(save && save.x + save.width <= width, `Save stays at ${at}`)
        if (chip) {
          const label = await page.locator('[data-testid="agent-working"]').innerText()
          if (width < 1440) assert.match(label, /^\s*4\/4\s*$/, `the chip shrinks to its step before anything else at ${at}`)
        }
        // whatever moved is in the ⋯ menu, and still works
        const more = page.getByTestId('bar-more')
        if (await more.count()) {
          await more.click()
          const items = await page.getByTestId('more-menu').getByRole('menuitem').allInnerTexts()
          const draftShown = (await page.getByRole('button', { name: 'Draft it again' }).count()) > 0
          const shareShown = (await page.getByRole('button', { name: 'Share', exact: true }).count()) > 0
          assert.equal(draftShown, false, `Draft it again moved into the menu at ${at}`)
          assert.ok(items.some(i => i.startsWith('Draft it again')), `...and is there (${items.join(' | ')}) at ${at}`)
          if (!shareShown) assert.ok(items.some(i => i.startsWith('Share')), `Share is in the menu once it left the bar at ${at}`)
          await page.keyboard.press('Escape')
        } else {
          assert.ok(await page.getByRole('button', { name: 'Draft it again' }).count(), `with room, Draft it again is in the bar at ${at}`)
          assert.ok(await page.getByRole('button', { name: 'Share', exact: true }).count(), `with room, Share is in the bar at ${at}`)
        }
        await page.close()
      }
    }
  } finally {
    await browser.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
