// A fuller library for the landing: needs-you and running come from the documents
// themselves (an open contest in a brief's data, a Deck run), so the strips, the
// counts and the rings are checked against what the server computed. With
// NAPKIN_E2E_SHOTS=<dir> it also writes screenshots of every screen.
//
//   NAPKIN_E2E_SHOTS=/tmp/landing-shots npm run e2e -- shots

import { expect, test, type Page } from '@playwright/test'

const BRIEF = 'ie.napkin.brief-maker'
const DECK = 'ie.napkin.deck-maker'
const shots = process.env.NAPKIN_E2E_SHOTS

const CONTEST = {
  selection: { contested: [{ id: 'c1', key: 'headline', status: 'open', values: [{ value: 'One' }, { value: 'Two' }] }] },
}

async function setup(page: Page, names: string[]) {
  await page.goto('/')
  const { tenant } = await (await page.request.get('/api/session')).json() as { tenant: string }
  const api = `/api/t/${tenant}`
  const ids: Record<string, string> = {}
  for (const n of names) {
    const r = await page.request.post(`${api}/clients`, { data: { name: n } })
    expect(r.status()).toBe(201)
    ids[n] = (await r.json() as { id: string }).id
  }
  const work = async (app: string, title: string, client: string | null, patch?: unknown) => {
    const r = await page.request.post(`${api}/documents`, { data: { app_id: app, title, ...(client ? { client_id: ids[client] } : {}) } })
    expect(r.status(), title).toBe(200)
    const v = await r.json() as { token: string }
    if (patch) {
      const p = await page.request.post(`/s/${v.token}/patch-data`, { data: { patch } })
      expect(p.status(), `patch ${title}: ${await p.text()}`).toBe(200)
    }
  }
  return { tenant, ids, work }
}

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true })
}

test('what needs you and what is running come from the documents', async ({ page }) => {
  const { work, ids } = await setup(page, ['Client A', 'Client B', 'Client C', 'Client D', 'Client E', 'Client F'])
  await work(BRIEF, 'Spring brief', 'Client A', CONTEST)
  await work(BRIEF, 'Autumn brief', 'Client A')
  await work(BRIEF, 'Launch brief', 'Client B')
  await work(DECK, 'Pitch deck', 'Client C', { run: { state: 'building', stage: 'Layout' } })
  await work(BRIEF, 'Review brief', 'Client D', CONTEST)
  await work(DECK, 'Board deck', 'Client E', { run: { state: 'failed' } })
  await work(BRIEF, 'Loose brief', null)
  await page.reload()

  const counts = page.getByTestId('counts')
  await expect(counts).toHaveText('6 clients · 7 open · 2 need you · 1 running · 1 failed')
  await expect(page.getByText('1 piece of work is not attached to a client yet.')).toBeVisible()
  const needs = page.getByRole('region', { name: 'Needs you' })
  await expect(needs.getByRole('button')).toHaveCount(2)
  await expect(needs).toContainText('Brief · Client A')
  await expect(needs).toContainText('Brief · Client D')
  const running = page.getByRole('region', { name: 'Running' })
  await expect(running.getByRole('button')).toHaveCount(1)
  await expect(running).toContainText('Deck · Client C')
  await expect(running).toContainText('Building: Layout')
  await shot(page, 'p1-01-landing')

  await page.getByTestId('agency-circle').click()
  await expect(page.getByTestId('client-circle')).toHaveCount(6)
  // urgency first: needs you (A, D), then failed (E), then running (C), then the rest
  const order = await page.getByTestId('client-circle').evaluateAll(els => els.map(e => e.getAttribute('data-client')))
  expect(order.slice(0, 5)).toEqual([ids['Client A'], ids['Client D'], ids['Client E'], ids['Client C'], ids['Client B']])
  await expect(page.getByRole('button', { name: /^Client A, 2 briefs · needs you/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Client E, 1 piece of work · 1 failed/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Client C, 1 piece of work · 1 running/ })).toBeVisible()
  await shot(page, 'p1-02-clients')

  await page.getByRole('button', { name: /^Client A,/ }).click()
  await shot(page, 'p1-02b-dial')
  await page.getByTestId('dial-open-client').click() // the dial's hub: the client's page
  await expect(page.getByTestId('work-item')).toHaveCount(2)
  await expect(page.getByTestId('work-item').first()).toContainText(/brief/i)
  await expect(page.getByTestId('tool-brief')).toHaveAccessibleName(/Brief Maker for Client A, 2 open, needs you/)
  await shot(page, 'p1-03-client')
})

test('screens: empty, many clients, phone, dark', async ({ page }) => {
  test.skip(!shots, 'set NAPKIN_E2E_SHOTS=<dir> to write screenshots')
  await page.goto('/#clients')
  await expect(page.getByTestId('empty')).toBeVisible()
  await shot(page, 'p1-04-empty-clients')
  await page.goto('/#agency')
  await shot(page, 'p1-05-empty-landing')

  const names = Array.from({ length: 20 }, (_, i) => `Client ${String.fromCharCode(65 + i)}`)
  const { work } = await setup(page, names)
  for (const n of names.slice(0, 6)) await work(BRIEF, `Brief for ${n}`, n)
  await work(BRIEF, 'Needs brief', 'Client B', CONTEST)
  await page.goto('/#clients')
  await page.reload()
  await expect(page.getByTestId('client-circle')).toHaveCount(8)
  await shot(page, 'p1-06-clients-20-first-page')
  await page.getByRole('button', { name: 'Show all 20' }).click()
  await expect(page.getByTestId('client-circle')).toHaveCount(20)
  await shot(page, 'p1-07-clients-20-show-all')

  await page.getByRole('button', { name: 'Add client', exact: true }).first().click()
  await page.getByLabel('Client name').fill('client a')
  await page.getByRole('button', { name: 'Add client', exact: true }).last().click()
  await expect(page.getByRole('alert')).toBeVisible()
  await shot(page, 'p1-08-add-client-refused')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#agency'); await page.reload()
  await shot(page, 'p1-09-phone-landing')
  await page.goto('/#clients'); await page.reload()
  await shot(page, 'p1-10-phone-clients')
  await page.getByRole('button', { name: /^Client B,/ }).click()
  await page.getByTestId('dial-open-client').click() // the dial's hub: the client's page
  await shot(page, 'p1-11-phone-client')

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.evaluate(() => localStorage.setItem('napkin.theme', 'dark'))
  await page.goto('/#agency'); await page.reload()
  await shot(page, 'p1-12-dark-landing')
  await page.goto('/#clients'); await page.reload()
  await shot(page, 'p1-13-dark-clients')
  await page.getByRole('button', { name: /^Client B,/ }).click()
  await page.getByTestId('dial-open-client').click() // the dial's hub: the client's page
  await shot(page, 'p1-14-dark-client')
})

test('phase 2 screens: the wheel, a tool page, the trail in a document', async ({ page }) => {
  test.skip(!shots, 'set NAPKIN_E2E_SHOTS=<dir> to write screenshots')
  const { work, ids } = await setup(page, ['Client A', 'Client B'])
  await work(BRIEF, 'Spring brief for Client A', 'Client A')
  await work(BRIEF, 'Autumn brief for Client A', 'Client A', CONTEST)
  await work(DECK, 'Pitch deck for Client A', 'Client A')
  const a = ids['Client A']
  const trail = page.getByRole('navigation', { name: 'Where you are' })

  await page.goto(`/#client-${a}`); await page.reload()
  await expect(page.getByTestId('tool-brief')).toBeVisible()
  await page.getByTestId('tool-brief').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await shot(page, 'p2-01-wheel-focus-idea')
  await page.keyboard.press('3')
  await shot(page, 'p2-02-wheel-soon-said')

  await page.goto(`/#tool-${a}-brief`); await page.reload()
  await expect(page.getByTestId('tool-page')).toBeVisible()
  await shot(page, 'p2-03-tool-page')
  await page.goto(`/#tool-${a}-research`); await page.reload()
  await shot(page, 'p2-04-tool-page-empty')

  await page.goto(`/#tool-${a}-brief`); await page.reload()
  await page.getByTestId('work-item').first().click()
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 30_000 })
  await expect(trail.getByRole('button')).toHaveCount(3) // the agency is the bar's pill
  await page.waitForTimeout(800)
  await shot(page, 'p2-05-document-trail-in-bar')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  await shot(page, 'p2-06-phone-document-bar')
  await page.goto(`/#tool-${a}-deck`); await page.reload()
  await expect(page.getByTestId('tool-page')).toBeVisible()
  await shot(page, 'p2-07-phone-tool-page')
  await page.goto(`/#client-${a}`); await page.reload()
  await shot(page, 'p2-08-phone-wheel')

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.evaluate(() => localStorage.setItem('napkin.theme', 'dark'))
  await page.goto(`/#tool-${a}-brief`); await page.reload()
  await shot(page, 'p2-09-dark-tool-page')
  await page.goto(`/#client-${a}`); await page.reload()
  await shot(page, 'p2-10-dark-wheel')
})
