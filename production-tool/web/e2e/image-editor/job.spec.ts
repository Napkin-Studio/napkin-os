// e2e 4 (features/image-editor-masks-layers.clan): a running job never covers the stage. The picture
// and the mask stay visible, a stroke during the job paints, the pending stripes cover the mask, and
// the job's status and Cancel sit in its Edits row.
import type { Page } from '@playwright/test'
import { at, expect, openEditor, overlay, session, jobState, stroke, test } from '../fixtures'

async function startFill(page: Page, words: string) {
  await page.keyboard.press('b')
  await stroke(page, [0.55, 0.2], [0.8, 0.3], 16)
  await page.locator('#ie-fill').fill(words)
  await page.locator('.ie-action').getByRole('button', { name: 'Fill area' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Fill area' }).click()
  await expect(page.locator('.ie-elist')).toContainText('Fill Mask 1: "')
}

async function fillJob(page: Page, frameId: string): Promise<string> {
  await expect.poll(async () => (await session(page, frameId)).edits.some((e: { kind: string }) => e.kind === 'fill')).toBe(true)
  return (await session(page, frameId)).edits.find((e: { kind: string }) => e.kind === 'fill').jobId
}

test('a running Fill leaves the stage visible and paintable, with Cancel in its row', async ({ page }) => {
  const seeded = await openEditor(page, { mockDelay: 20_000 })
  await startFill(page, 'add condensation drops')
  const jobId = await fillJob(page, seeded.frameId)
  expect(await jobState(page, jobId)).not.toBe('completed')

  // Nothing of the job sits over the picture.
  for (const [fx, fy] of [[0.1, 0.1], [0.5, 0.5], [0.9, 0.9], [0.65, 0.25], [0.3, 0.8]]) {
    const [x, y] = await at(page, fx, fy)
    const inJob = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py)
      return !!el?.closest('.ie-job, .pending:not(.ie-pending), .errnode, .askcard')
    }, [x, y])
    expect(inJob, `job element at ${fx},${fy}`).toBe(false)
  }
  await expect(page.locator('canvas.ie-pic')).toBeVisible()
  // The pending stripes cover the mask.
  await expect(page.locator('.ie-pending')).toBeVisible()

  // A stroke during the job paints.
  const before = (await overlay(page)).painted
  await stroke(page, [0.1, 0.6], [0.3, 0.7], 12)
  await expect.poll(async () => (await overlay(page)).painted).toBeGreaterThan(before)

  // Status and Cancel in the job's row; Cancel takes it to cancelled and adds no mask.
  const row = page.locator('.ie-elist > li', { hasText: 'Fill Mask 1: "' })
  await expect(row.locator('.ie-jobrow')).toBeVisible()
  const masks = (await session(page, seeded.frameId)).edits.filter((e: { kind: string }) => e.kind === 'mask').length
  await row.getByRole('button', { name: 'Cancel' }).click()
  const confirm = row.getByRole('button', { name: 'Stop it' })
  if (await confirm.count()) await confirm.click()
  await expect.poll(() => jobState(page, jobId)).toBe('cancelled')
  expect((await session(page, seeded.frameId)).edits.filter((e: { kind: string }) => e.kind === 'mask').length).toBe(masks)
  await expect(page.locator('.ie-pending')).toHaveCount(0)
})

test('a Fill that asks shows its question in the row, and answering lets it go on', async ({ page }) => {
  const seeded = await openEditor(page, { mockDelay: 1500 })
  await startFill(page, 'add drops [ask]')
  const jobId = await fillJob(page, seeded.frameId)
  await expect.poll(() => jobState(page, jobId), { timeout: 15_000 }).toBe('needs_input')
  const row = page.locator('.ie-elist > li', { hasText: 'Fill Mask 1: "' })
  const card = row.locator('.askcard')
  await expect(card).toBeVisible()
  // The stage is not covered while it waits either.
  const [x, y] = await at(page, 0.5, 0.5)
  expect(await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('.askcard, .ie-job'), [x, y])).toBe(false)
  await card.locator('.askcard-opt').first().click()
  await expect.poll(() => jobState(page, jobId), { timeout: 20_000 }).toBe('completed')
})
