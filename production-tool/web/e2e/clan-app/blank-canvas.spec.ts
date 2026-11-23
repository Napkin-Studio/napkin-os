// S1-6: a new project opens on the blank canvas and asks nothing; from a brief only the Brief node is
// placed (memory blank-canvas-entry). Stage 1 changes no screen: the paired screenshots at three laptop
// widths are attached for the lead to lay beside the previous build's.
import { readFileSync } from 'node:fs'
import { at, BRIEF_CLAN, createProject, dataOf, expect, haveFixture, nodeKinds, signIn, test, toolUrl } from './support'

const WIDTHS = [1024, 1280, 1440]

at(1)('S1-6 a new project opens blank and asks nothing', async ({ page }, info) => {
  const tenant = await signIn(page.request)
  const doc = await createProject(page.request, tenant, 'Blank walk')
  await page.goto(toolUrl(doc))
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[role=dialog], [role=alertdialog]')).toHaveCount(0)
  await expect(page.locator('input:visible, textarea:visible')).toHaveCount(0)
  expect(nodeKinds(await dataOf(page.request, tenant, doc)), 'no node on a new project').toEqual([])
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 800 })
    await info.attach(`blank-${w}`, { body: await page.screenshot(), contentType: 'image/png' })
  }
})

at(1)('S1-6 from a brief only the Brief node is placed', async ({ page }, info) => {
  test.skip(!haveFixture(BRIEF_CLAN), `no FX-BRIEF at ${BRIEF_CLAN}`)
  const tenant = await signIn(page.request)
  const up = await page.request.post(`/api/t/${tenant}/documents/upload`, { data: readFileSync(BRIEF_CLAN), headers: { 'Content-Type': 'application/octet-stream' } })
  expect(up.ok(), 'upload the brief').toBeTruthy()
  const brief = (await up.json()).path as string
  const sp = await page.request.post(`/api/t/${tenant}/d/${brief}/spinoff`, { data: { app_id: 'ie.napkin.production', title: 'From the brief' } })
  expect(sp.ok(), 'spin off to Production').toBeTruthy()
  const doc = (await sp.json()).path as string
  await page.goto(toolUrl(doc))
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  // the Brief node is placed by the page on open; a save puts it on the host
  await page.waitForTimeout(3000)
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(3000)
  const data = await dataOf(page.request, tenant, doc)
  const kinds = nodeKinds(data)
  expect(kinds, 'exactly the Brief').toContain('briefs')
  expect(kinds).not.toContain('scripts')
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 800 })
    await info.attach(`brief-${w}`, { body: await page.screenshot(), contentType: 'image/png' })
  }
})
