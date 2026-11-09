// Needs you and Running, tool-neutral and live: a Brief job the (local stand-in)
// middleware reports, a Deck's own run, a failure, and a contest waiting on a
// person, all on the desk (Pick up, the circles, the dial) without a reload. Client names are placeholders.
// With NAPKIN_E2E_SHOTS=<dir> it also writes screenshots.
//
//   NAPKIN_E2E_SHOTS=/tmp/p3 npm run e2e -- running

import { expect, test, type Page } from '@playwright/test'

const BRIEF = 'ie.napkin.brief-maker'
const RESEARCH = 'ie.napkin.campaign-research'
const DECK = 'ie.napkin.deck-maker'
const shots = process.env.NAPKIN_E2E_SHOTS
const MW = `http://127.0.0.1:${process.env.NAPKIN_E2E_MW_PORT || '18081'}`
const CONTEST = { selection: { contested: [{ id: 'c1', key: 'headline', status: 'open', values: [{ value: 'One' }, { value: 'Two' }] }] } }

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true })
}

/** What the stand-in middleware says its one job is doing from now on. */
const job = async (page: Page, state: string, stage: string) => {
  expect((await page.request.post(`${MW}/control`, { data: { state, stage } })).status()).toBe(200)
}

test('a running job, a failure and a waiting question show on the landing and the circles, live', async ({ page }) => {
  await page.goto('/')
  const { tenant } = await (await page.request.get('/api/session')).json() as { tenant: string }
  const api = `/api/t/${tenant}`
  const client = async (name: string) => (await (await page.request.post(`${api}/clients`, { data: { name } })).json() as { id: string }).id
  const a = await client('Client A')
  const b = await client('Client B')
  const make = async (app: string, title: string, clientId: string, patch?: unknown) => {
    const r = await page.request.post(`${api}/documents`, { data: { app_id: app, title, client_id: clientId } })
    expect(r.status(), title).toBe(200)
    const { token } = await r.json() as { token: string }
    if (patch) expect((await page.request.post(`/s/${token}/patch-data`, { data: { patch } })).status(), title).toBe(200)
    return token
  }
  const briefToken = await make(BRIEF, 'Spring brief', a)
  await make(RESEARCH, 'Category scan', b)
  await make(DECK, 'Pitch deck', b, { run: { state: 'building', stage: 'Layout' } })

  // The job the app starts: the host settles the middleware's reply and remembers the job.
  const ask = async () => {
    const r = await page.request.post(`/s/${briefToken}/api-proxy`, { data: { request_kind: 'middleware', payload: { task: 'start_campaign', input: {} } } })
    expect(r.status(), await r.text()).toBe(200)
  }
  await job(page, 'running', 'research')
  await ask()
  await page.reload()

  // Working, from the middleware (Brief) and from the document's own run (Deck), in words: Pick up says what each is doing.
  const pick = page.getByTestId('pick-up')
  const row = (t: string) => pick.getByTestId('pick-row').filter({ hasText: t })
  await expect(row('Spring brief')).toContainText('Working: research (2 of 6)')
  await expect(row('Spring brief')).toContainText('Agents working')
  await expect(row('Pitch deck')).toContainText('Building: Layout')
  await expect(pick.getByTestId('pick-row').filter({ hasText: 'Agents working' })).toHaveCount(2)
  await expect(page.getByTestId('counts')).toHaveText('YOUR DESK · 2 CLIENTS · 3 OPEN · 2 RUNNING')
  await shot(page, 'p3-01-running')

  // The circles: each wears its own verb, and says it.
  await expect(page.getByRole('button', { name: /^Client A: Spring brief · agents working, reading\./ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Client B: Pitch deck · agents working, working\./ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Client A:/ })).toHaveAttribute('data-activity', 'read')
  await shot(page, 'p3-02-clients')
  await page.getByRole('button', { name: /^Client A:/ }).click()
  await expect(page.getByTestId('quadrant-brief')).toHaveAttribute('data-activity', 'read') // the dial says it too
  await page.getByTestId('dial-hub').click() // the dial's hub: the client's page
  await expect(page.getByTestId('tool-brief')).toHaveAttribute('data-activity', 'read')
  await shot(page, 'p3-03-client')
  await page.goto('/#agency')

  // The job needs the person: it moves on the desk with no reload, within a poll.
  await job(page, 'needs_input', 'select')
  await ask()
  await expect(row('Spring brief')).toContainText('Your answer', { timeout: 15_000 })
  await expect(page.getByTestId('news')).toHaveText('1 more needs you')
  await expect(page.getByRole('button', { name: /^Client A:/ })).toHaveAttribute('data-activity', 'human')
  await expect(page.getByTestId('decisions')).toHaveClass(/has-needs/)
  await shot(page, 'p3-04-needs-you')

  // It fails: the row says so, with the word.
  await job(page, 'failed', 'research')
  await ask()
  await expect(row('Spring brief')).toContainText('Failed: research', { timeout: 15_000 })
  await expect(row('Spring brief')).not.toContainText('Your answer')
  await expect(page.getByRole('button', { name: /^Client A:/ })).toHaveAttribute('data-activity', 'error')
  await shot(page, 'p3-05-failed')

  // A new run finishes: it stops running, and the failure does not come back.
  await job(page, 'running', 'extract')
  await ask()
  await expect(row('Spring brief')).not.toContainText('Failed', { timeout: 15_000 })
  await job(page, 'done', 'report')
  await ask()
  await expect(row('Spring brief')).not.toContainText('Working: extract', { timeout: 15_000 })
  await expect(pick.getByTestId('pick-row').filter({ hasText: 'Agents working' })).toHaveCount(1)
  await expect(row('Spring brief')).not.toContainText('Failed')
})

test('a document that needs the person shows on the landing and its client circle', async ({ page }) => {
  await page.goto('/')
  const { tenant } = await (await page.request.get('/api/session')).json() as { tenant: string }
  const api = `/api/t/${tenant}`
  const id = (await (await page.request.post(`${api}/clients`, { data: { name: 'Client A' } })).json() as { id: string }).id
  const r = await page.request.post(`${api}/documents`, { data: { app_id: BRIEF, title: 'Contested brief', client_id: id } })
  const { token } = await r.json() as { token: string }
  expect((await page.request.post(`/s/${token}/patch-data`, { data: { patch: CONTEST } })).status()).toBe(200)
  await page.reload()
  await expect(page.getByTestId('pick-row').filter({ hasText: 'Contested brief' })).toContainText('1 call')
  await expect(page.getByTestId('needs-count')).toHaveText('1')
  await expect(page.getByRole('button', { name: /^Client A:/ })).toHaveAttribute('data-activity', 'human')
  await expect(page.getByRole('button', { name: /^Client A: Contested brief · 1 needs you\./ })).toBeVisible()
  await expect(page.getByTestId('needs-badge')).toHaveText('1')
})
