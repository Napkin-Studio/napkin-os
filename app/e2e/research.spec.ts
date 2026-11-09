// Research on the new UI (features/research-new-ui.clan), on the real shell and the real server:
// the SDK's packed example document is uploaded and opened from its link. The report body as the
// mock draws it, the evidence map in the widened inspector beside it, a finding opened in the
// inspector with its trail and back, a gap put into Ask the research, the record filtered, and
// the same document at 390 px with the inspector as a bottom sheet. No model and no middleware
// call: nothing here presses Ask, Refresh or Run research. The example is invented (EXAMPLE).

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
let example: Buffer
let work: string

test.beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'napkin-e2e-research-'))
  execFileSync('cargo', ['run', '-q', '-p', 'clan-sdk', '--example', 'make_campaign_research', '--', join(work, 'app.clan'), join(work, 'example.clan')], { cwd: root, stdio: 'ignore' })
  example = readFileSync(join(work, 'example.clan'))
})
test.afterAll(() => { if (work) rmSync(work, { recursive: true, force: true }) })

async function openExample(page: Page) {
  await page.goto('/')
  const { tenant } = await (await page.request.get('/api/session')).json() as { tenant: string }
  const r = await page.request.post(`/api/t/${tenant}/documents/upload`, { data: example, headers: { 'content-type': 'application/octet-stream' } })
  expect(r.status()).toBe(200)
  const { path } = await r.json() as { path: string }
  await page.goto(`/?open=${encodeURIComponent(path)}`)
  const app = page.frameLocator('iframe').first()
  await expect(app.locator('.rp-band')).toBeVisible({ timeout: 30_000 })
  return app
}

test('the report reads as the mock, the map widens the inspector beside it, a finding opens with its trail', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const app = await openExample(page)

  // The band, the stat row and 00 the ask, with Read the ask again under it.
  await expect(app.locator('.rp-band h1')).toContainText('Lúnasa 0.0 launch')
  await expect(app.locator('.rp-stats')).toContainText('18 pins')
  await expect(app.locator('.rp-stats .rp-need')).toContainText('need')
  await expect(app.locator('#rp-ask .rs-h > span')).toHaveText('00 — The ask')
  await expect(app.locator('#rp-ask .rp-af')).toHaveCount(8)
  await expect(app.locator('#rp-ask [data-act="extract"]')).toHaveText('Read the ask again')
  // Lens × market sections are numbered from 01; the record follows as report sections.
  await expect(app.locator('#rp-body .rp-sec .rs-h > span').first()).toHaveText(/^01 — Market structure/)
  for (const id of ['rp-confirm', 'rp-notr', 'rp-contests', 'rp-gaps', 'rp-pins', 'rp-cov', 'rp-excl', 'rp-ran', 'rp-rec'])
    await expect(app.locator(`#${id}`)).toBeVisible()
  // Summary figures are the OS's fields; Everything recorded is still there.
  await expect(app.locator('.rep-sum clan-field').first()).toBeVisible()
  await expect(app.locator('details#records')).toHaveCount(1)

  // The OS bar carries the report's state; Lock and accept is the Report box's.
  await expect(app.locator('#rbox #lockBtn')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Lock and accept/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Continue in/ })).toBeVisible()

  // The evidence map widens the inspector; the report stays beside it.
  const before = (await app.locator('#insp').boundingBox())!.width
  await app.locator('[data-view="map"]').click()
  await expect(app.locator('#mapview svg')).toBeVisible()
  const after = (await app.locator('#insp').boundingBox())!.width
  expect(after).toBeGreaterThan(before)
  expect((await app.locator('#report').boundingBox())!.width).toBeGreaterThanOrEqual(340)

  // A summary line traces to what it rests on; a crumb goes deeper, Back comes out.
  await app.locator('#mapview [data-map="sum:0"]').click()
  const sel = app.locator('#insp-sel')
  await expect(sel.locator('.crumbs [data-crumb]')).toHaveCount(1)
  await sel.locator('[data-sel],[data-clf-go]').first().click()
  await expect(sel.locator('.crumbs [data-crumb]')).toHaveCount(2)
  await sel.locator('[data-sel-back]').click()
  await expect(sel.locator('.crumbs [data-crumb]')).toHaveCount(1)

  // A finding sentence in the report opens its source card in the inspector.
  await app.locator('[data-view="report"]').click()
  await app.locator('#rp-body .rp-fs').first().click()
  await expect(sel.locator('#insp-card')).toBeVisible()
  await expect(sel.locator('.crumbs [data-crumb]')).toHaveCount(1)

  // Research this puts the gap into the one Ask the research box, about its lens; nothing is sent.
  await app.locator('#rp-gaps [data-act="gap-ask"]').first().click()
  await expect(app.locator('#rqin-_new')).toHaveValue(/^Look again: /)
  await expect(app.locator('#rqlens-_new')).toHaveValue('effectiveness_evidence')
  await expect(app.locator('.rq-box')).toHaveCount(1)

  // On the record filters by kind.
  await app.locator('#rp-rec [data-act="rec-filter"][data-kind="verify"]').click()
  const rows = app.locator('#rp-rec .rp-dec')
  expect(await rows.count()).toBeGreaterThan(0)
  expect(await app.locator('#rp-rec .rp-dec:not(.k-verify)').count()).toBe(0)
})

test('at 390 px the report fits and the inspector is a bottom sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await openExample(page)
  const frame = page.frames().find(f => f.url().includes('/s/'))!
  expect(await frame.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  const insp = app.locator('#insp')
  expect(await insp.evaluate(el => getComputedStyle(el).position)).toBe('fixed')
  await app.locator('#insp-grab').click()
  await expect(insp).toHaveClass(/\bopen\b/)
  await expect(app.locator('#rbox #lockBtn')).toBeVisible()
})
