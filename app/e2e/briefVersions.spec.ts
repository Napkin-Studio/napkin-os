// Version history and undo on the brief (features/brief-versions-undo.clan), beyond the two pilot
// tests (14 and 16 in j001-pilot.spec.ts): the key belongs to a field being typed in, two versions
// are read side by side, and someone else's later edit stops an undo. Screenshots of the new
// screens go to docs/design/brief-versions-undo/ at both widths.

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { asMe, lockBrief, PEOPLE, seedJ001, signBrief } from './seed/j001'

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'design', 'brief-versions-undo')
mkdirSync(SHOTS, { recursive: true })
const SIZES = [{ tag: '390', width: 390, height: 844 }, { tag: '1440', width: 1440, height: 900 }]
const rosterURL = `http://127.0.0.1:${process.env.NAPKIN_E2E_ROSTER_PORT || '18082'}`

async function signIn(page: Page, who: { username: string }) {
  const r = await page.request.post('/api/auth/sign-in', { data: { username: who.username } })
  expect(r.status(), `sign in as ${who.username}`).toBe(200)
}

async function roster(browser: Browser, width: number, height: number) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, baseURL: rosterURL })
  await ctx.addInitScript(() => { try { localStorage.setItem('napkin.theme', 'white') } catch { /* not kept */ } })
  return { ctx, page: await ctx.newPage() }
}

for (const size of SIZES) {
  test(`brief versions: two signed versions read side by side and the draft shows its restore, ${size.tag} px`, async ({ browser }) => {
    const { ctx, page } = await roster(browser, size.width, size.height)
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await page.goto('about:blank')
    const as = async (who: { username: string }) => { await signIn(page, who); return (await asMe(page, job.api, job.brief)).token }
    const write = (token: string, patch: object) => page.request.post(`/s/${token}/patch-data`, { data: { patch, agent: 'human', action: 'edit the brief' } })
    const sign = async (patch: object) => {
      const planner = await as(PEOPLE.planning)
      expect((await write(planner, patch)).status()).toBe(200)
      expect((await signBrief(page, { token: planner })).status()).toBe(200)
      const director = await as(PEOPLE.creativeDirector)
      expect((await lockBrief(page, { token: director })).status()).toBe(200)
      return director
    }
    const director = await sign({ audience: 'Drinkers aged 25 to 34 who think Irish whiskey is for someone else.', insight: 'The first pour is the hard one.' })
    expect((await page.request.post(`/s/${director}/unapprove`, { data: { rationale: 'A new version.' } })).status()).toBe(200)
    await sign({ audience: 'Drinkers aged 25 to 34 who go out midweek.', insight: 'The first pour is the hard one.' })

    await page.goto(`/#tool-${job.client}-brief`)
    await page.reload()
    await page.getByTestId('work-item').first().click()
    await page.getByRole('button', { name: 'Version history' }).click()
    const rows = page.getByTestId('version-row')
    await expect(rows).toHaveCount(3) // the draft, v2, v1
    await expect(rows.nth(1)).toContainText('Signed by dara@wk') // each version shows its signer and date
    await expect(rows.nth(1)).toContainText('Locked')
    await expect(rows.nth(2)).not.toContainText('Locked')
    await rows.filter({ hasText: 'v1' }).getByRole('button', { name: 'Compare' }).click()
    await rows.filter({ hasText: 'v2' }).getByRole('button', { name: 'Compare' }).click()
    const compare = page.getByTestId('version-compare')
    await expect(compare).toBeVisible()
    await expect(compare.getByTestId('compare-part')).toHaveCount(1) // only the part that differs
    await expect(compare).toContainText('someone else')
    await expect(compare).toContainText('go out midweek')
    await page.screenshot({ path: join(SHOTS, `versions-compare-${size.tag}.png`) })

    await rows.filter({ hasText: 'v1' }).getByRole('button', { name: 'Restore' }).click()
    await expect(rows.first()).toContainText('Restored from v1')
    await page.screenshot({ path: join(SHOTS, `versions-restored-${size.tag}.png`) })
    await ctx.close()
  })
}

test('brief undo: Cmd Z in a field is the field\'s, and a later edit by someone else is not overwritten', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(() => { try { localStorage.setItem('napkin.theme', 'white') } catch { /* not kept */ } })
  const page = await ctx.newPage()
  const job = await seedJ001(page)
  await page.goto(`/#tool-${job.client}-brief`)
  await page.getByTestId('work-item').first().click()
  const app = page.frameLocator('iframe').first()
  const row = app.locator('#fields .row[data-clan-part="audience"]')
  await row.dblclick()
  const field = app.getByRole('textbox', { name: /^Write / })
  await field.fill('Typed, then undone by the field itself.')
  await field.press('Meta+z') // the field owns this key: the shell does nothing
  await page.waitForTimeout(400)
  const chainOf = async () => ((await (await page.request.get(`/s/${job.brief.token}/chain`)).json()) as { decisions: { action?: string }[] }).decisions
  expect((await chainOf()).filter(d => d.action?.startsWith('undo'))).toHaveLength(0)
  await field.fill('My edit.')
  await field.press('Control+Enter')
  await expect(app.locator('#fields')).toContainText('My edit.')
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled()
  // Someone else changes the same part after me: undo says so and writes nothing.
  const other = await page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: { audience: 'Their edit.' }, agent: 'human', action: 'edit the audience' } })
  expect(other.status()).toBe(200)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByTestId('undo-note')).toContainText('changed after you wrote it')
  expect((await chainOf()).filter(d => d.action?.startsWith('undo'))).toHaveLength(0)
  await page.screenshot({ path: join(SHOTS, 'undo-stopped-1440.png') })
  await ctx.close()
})
