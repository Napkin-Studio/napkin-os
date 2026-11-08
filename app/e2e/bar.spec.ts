// The one OS bar (features/new-ui-shell.clan) against the real stack: the
// owner's 9 Nov decisions. Decisions is the bar's one needs signal (amber with
// the count); its call card sets a need aside and brings it back; the desk's
// Decisions lists every document across clients that needs a call; Share holds
// the link, the download and what is not built yet; and the glass insets the
// app is told about follow the Decisions drawer open and closed.

import { expect, test, type Page } from '@playwright/test'

const BRIEF = 'ie.napkin.brief-maker'
const CONTEST = {
  selection: { contested: [{ id: 'c1', key: 'headline', status: 'open', values: [{ value: 'One' }, { value: 'Two' }] }] },
}

async function seed(page: Page) {
  await page.goto('/')
  const { tenant } = await (await page.request.get('/api/session')).json() as { tenant: string }
  const api = `/api/t/${tenant}`
  const ids: string[] = []
  for (const n of ['Client A', 'Client B']) {
    const r = await page.request.post(`${api}/clients`, { data: { name: n } })
    ids.push((await r.json() as { id: string }).id)
  }
  const work = async (title: string, client: string, patch?: unknown) => {
    const r = await page.request.post(`${api}/documents`, { data: { app_id: BRIEF, title, client_id: client } })
    const v = await r.json() as { token: string }
    if (patch) expect((await page.request.post(`/s/${v.token}/patch-data`, { data: { patch } })).status()).toBe(200)
  }
  await work('Spring brief', ids[0], CONTEST)
  await work('Autumn brief', ids[1], CONTEST)
  await work('Launch brief', ids[1])
  await page.goto('/#clients')
  await page.reload()
}

async function openFromDesk(page: Page, title: string) {
  await page.getByTestId('decisions').click()
  const drawer = page.getByTestId('desk-decisions')
  await expect(drawer).toBeVisible()
  await drawer.getByTestId('desk-call').filter({ hasText: title }).getByRole('button', { name: 'Open' }).click()
  await expect(page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 })
}

test('desk: Decisions is amber with the count across clients and opens the documents that need a call', async ({ page }) => {
  await seed(page)
  const decisions = page.getByTestId('decisions')
  await expect(decisions).toHaveClass(/ch-decisions-needs/)
  await expect(page.getByTestId('needs-count')).toHaveText('2')
  await expect(page.getByTestId('medallion-mark')).toHaveAttribute('data-state', 'awake') // the desk never lights it
  await decisions.click()
  const drawer = page.getByTestId('desk-decisions')
  await expect(drawer.getByTestId('desk-call')).toHaveCount(2)
  await expect(drawer).toContainText('Client A')
  await expect(drawer).toContainText('Client B')
  await expect(drawer).not.toContainText('Launch brief') // nothing to call there
  await decisions.click()
  await expect(drawer).toHaveCount(0)
  // Open… sits in the desk's More too.
  await page.getByRole('button', { name: /^More/ }).click()
  await expect(page.getByRole('menuitem', { name: /Open…/ })).toBeVisible()
})

test('document: the call card sets a need aside (out of the count, still a need) and brings it back', async ({ page }) => {
  await seed(page)
  await openFromDesk(page, 'Spring brief')
  await expect(page.getByTestId('needs-count')).toHaveText('1')
  await expect(page.getByTestId('state-pill')).not.toContainText('Needs you') // one needs indicator
  await expect(page.getByTestId('medallion-mark')).toHaveAttribute('data-state', 'needs')
  await page.getByTestId('decisions').click()
  const card = page.getByTestId('call-card')
  await expect(card.getByTestId('need')).toHaveCount(1)
  await expect(card.getByRole('button', { name: 'Open' })).toBeVisible()
  await expect(card.getByTestId('looks-right')).toHaveCount(0) // a contest needs a pick, not a yes
  await card.getByTestId('set-aside').click()
  await expect(page.getByTestId('needs-count')).toHaveText('0')
  await expect(page.getByTestId('decisions')).not.toHaveClass(/ch-decisions-needs/)
  await expect(page.getByTestId('medallion-mark')).toHaveAttribute('data-state', 'awake')
  const aside = page.getByTestId('set-aside-list')
  await expect(aside.getByTestId('need')).toHaveCount(1)
  await expect(page.locator('.dp-lock')).toContainText('once this is settled') // it still stops the lock
  // It holds when the document is opened again (this person's own, in this browser).
  await page.getByTestId('medallion').click()
  await expect(page.locator('[data-where="desk"]')).toBeVisible()
  await openFromDesk(page, 'Spring brief')
  await expect(page.getByTestId('needs-count')).toHaveText('0')
  await page.getByTestId('decisions').click()
  await page.getByTestId('set-aside-list').getByTestId('bring-back').click()
  await expect(page.getByTestId('needs-count')).toHaveText('1')
  await expect(page.getByTestId('set-aside-list')).toHaveCount(0)
})

test('document: Share holds Copy link, Download a copy, and says what is not built yet', async ({ page }) => {
  await seed(page)
  await openFromDesk(page, 'Spring brief')
  await page.getByRole('button', { name: /^Share/ }).click()
  const menu = page.getByRole('menu', { name: 'Share' })
  for (const l of ['Copy link', 'Download a copy', 'Send the client copy', 'Invite to the crew']) {
    await expect(menu.getByRole('menuitem', { name: new RegExp(l) })).toBeVisible()
  }
  await expect(menu.getByRole('menuitem', { name: /Send the client copy/ })).toHaveAttribute('aria-disabled', 'true')
  await expect(menu.getByRole('menuitem', { name: /Send the client copy/ })).toContainText('Lock it first')
  await expect(menu.getByRole('menuitem', { name: /Invite to the crew/ })).toHaveAttribute('aria-disabled', 'true')
  // The bar's three groups: who and where, the document, the tools; the crew sits before Decisions.
  for (const g of ['.ch-bar-l', '.ch-bar-c', '.ch-bar-r']) await expect(page.locator(`[data-where="document"] ${g}`)).toBeVisible()
})

test('glass: the inset the app is told follows the Decisions drawer open and closed', async ({ page }) => {
  await seed(page)
  await openFromDesk(page, 'Spring brief')
  await expect(page.locator('.ch-doc-glass')).toBeVisible({ timeout: 30_000 }) // Brief Maker asks for glass
  const frame = page.frames().find(f => f !== page.mainFrame())!
  await frame.evaluate(() => {
    const w = window as unknown as { __insets: number[] }
    w.__insets = []
    window.addEventListener('message', e => { if (e.data?.type === 'clan:insets') w.__insets.push(e.data.right) })
  })
  const last = () => frame.evaluate(() => (window as unknown as { __insets: number[] }).__insets.at(-1) ?? null)
  await page.getByTestId('decisions').click()
  const panel = page.locator('.ch-work > .dp-panel')
  await expect(panel).toBeVisible()
  const width = Math.round((await panel.boundingBox())!.width)
  await expect.poll(last).toBe(width)
  await page.getByTestId('decisions').click()
  await expect(panel).toHaveCount(0)
  await expect.poll(last).toBe(0)
})
