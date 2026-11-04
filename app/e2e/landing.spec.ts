// The landing, end to end: the real shell, the real napkin-web, real documents.
// Landing -> clients -> add a client -> reload -> open a client -> start work for
// it. Every client name here is a placeholder (Client A, Client B...).
//
//   npm run e2e            (in app/; starts the stack, see stack.mjs)

import { chromium, expect, test, type Page } from '@playwright/test'

interface Seeded { tenant: string; a: string; b: string }

/** Make two clients and one piece of work for each, through the tenant's own API. */
async function seed(page: Page): Promise<Seeded> {
  const { tenant } = await (await page.request.get('/api/session')).json() as { tenant: string }
  const api = `/api/t/${tenant}`
  const make = async (name: string) => {
    const r = await page.request.post(`${api}/clients`, { data: { name } })
    expect(r.status(), `create ${name}`).toBe(201)
    return (await r.json() as { id: string }).id
  }
  const a = await make('Client A')
  const b = await make('Client B')
  const apps = await (await page.request.get(`${api}/apps`)).json() as { app_id: string }[]
  expect(apps.map(x => x.app_id)).toContain('ie.napkin.brief-maker')
  for (const [client, title] of [[a, 'Spring brief for Client A'], [b, 'Launch brief for Client B']]) {
    const r = await page.request.post(`${api}/documents`, { data: { app_id: 'ie.napkin.brief-maker', title, client_id: client } })
    expect(r.status(), title).toBe(200)
    expect((await r.json() as { manifest: { client: { id: string } } }).manifest.client.id).toBe(client)
  }
  return { tenant, a, b }
}

test('landing, clients, add a client, reload, open a client, start work', async ({ page }) => {
  await page.goto('/')

  // The home is the landing, with nothing yet.
  await expect(page.getByTestId('landing')).toBeVisible()
  await expect(page.getByTestId('counts')).toHaveText('No clients yet')
  await expect(page).toHaveURL(/#agency$/)

  // Two clients and their work exist on the server; the landing says so from the server.
  const { a } = await seed(page)
  await page.reload()
  await expect(page.getByTestId('counts')).toHaveText('2 clients · 2 open')
  await expect(page.getByText('Nothing is waiting on you.')).toBeVisible()

  // The agency circle opens the clients page.
  await page.getByTestId('agency-circle').click()
  await expect(page).toHaveURL(/#clients$/)
  await expect(page.getByTestId('client-circle')).toHaveCount(2)
  await expect(page.getByRole('button', { name: /^Client A, 1 brief/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Client B, 1 brief/ })).toBeVisible()

  // Add a client: a real record, through the host.
  await page.getByRole('button', { name: 'Add client', exact: true }).first().click()
  await expect(page.getByTestId('add-form')).toBeVisible()
  await page.getByLabel('Client name').fill('Client C')
  await page.getByRole('button', { name: 'Add client', exact: true }).last().click()
  await expect(page.getByTestId('client-circle')).toHaveCount(3)
  await expect(page.getByRole('button', { name: /^Client C, No work yet, idle/ })).toBeVisible()

  // The same name again is refused in the host's words and makes nothing.
  await page.getByRole('button', { name: 'Add client', exact: true }).first().click()
  await page.getByLabel('Client name').fill('client  c')
  await page.getByRole('button', { name: 'Add client', exact: true }).last().click()
  await expect(page.getByRole('alert')).toContainText('already a client called')
  await expect(page.getByTestId('client-circle')).toHaveCount(3)
  await page.getByRole('button', { name: 'Cancel' }).click()

  // It survives a reload, in the same place.
  await page.reload()
  await expect(page).toHaveURL(/#clients$/)
  await expect(page.getByTestId('client-circle')).toHaveCount(3)

  // Open a client: its tools around it, Idea and Prod Soon, its work listed.
  await page.getByRole('button', { name: /^Client A,/ }).click()
  await expect(page).toHaveURL(new RegExp(`#client-${a}$`))
  const client = page.getByTestId('client-page')
  await expect(client.getByRole('heading', { name: 'Client A' })).toBeVisible()
  for (const t of ['brief', 'research', 'idea', 'deck', 'prod', 'ads']) await expect(page.getByTestId(`tool-${t}`)).toBeVisible()
  await expect(page.getByTestId('tool-idea')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByTestId('tool-prod')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByTestId('tool-brief')).not.toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByTestId('work-item')).toHaveCount(1)
  await expect(page.getByTestId('work-item')).toContainText('Spring brief for Client A')

  // The trail shows where we are, and goes back.
  const trail = page.getByRole('navigation', { name: 'Where you are' })
  await expect(trail.getByRole('button')).toHaveCount(3)
  await expect(trail.getByRole('button', { name: 'Client A' })).toHaveAttribute('aria-current', 'page')

  // Reload and back/forward land in the same place.
  await page.reload()
  await expect(page).toHaveURL(new RegExp(`#client-${a}$`))
  await expect(client.getByRole('heading', { name: 'Client A' })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/#clients$/)
  await expect(page.getByTestId('clients')).toBeVisible()
  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`#client-${a}$`))
  await trail.getByRole('button', { name: 'Clients' }).click()
  await expect(page).toHaveURL(/#clients$/)

  // Start work for a client: the tool's page, then a document that is already theirs.
  await page.getByRole('button', { name: /^Client C,/ }).click()
  await page.getByTestId('tool-brief').click()
  await expect(page.getByTestId('tool-page')).toBeVisible()
  await page.getByTestId('new-doc').click()
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 30_000 })
  const { tenant } = await (await page.request.get('/api/session')).json() as { tenant: string }
  const recent = await page.request.get(`/api/t/${tenant}/library?app=ie.napkin.brief-maker`)
  // A blank is not work yet: still only the two that were made.
  expect((await recent.json() as { items: unknown[] }).items).toHaveLength(2)
  // The trail in the bar is the way back: the client's circle goes to the client.
  await page.getByRole('navigation', { name: 'Where you are' }).getByRole('button', { name: 'Client C' }).click()
  await expect(page.getByTestId('client-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Client C' })).toBeVisible()
})

test('a hostile or unknown hash is the landing, and an unknown client shows the clients', async ({ page }) => {
  await page.goto('/#client-Ólafsson')
  await expect(page.getByTestId('landing')).toBeVisible()
  await expect(page).toHaveURL(/#agency$/)
  await page.goto('/#client-cli_00000000')
  await expect(page.getByTestId('clients')).toBeVisible()
})

test('beyond eight clients there is search and Show all, and the empty state is welcoming', async ({ page }) => {
  await page.goto('/#clients')
  await expect(page.getByTestId('empty')).toBeVisible()
  await page.getByRole('button', { name: 'Add your first client' }).click()
  await page.getByLabel('Client name').fill('Client A')
  await page.getByRole('button', { name: 'Add client', exact: true }).last().click()
  await expect(page.getByTestId('client-circle')).toHaveCount(1)

  const { tenant } = await (await page.request.get('/api/session')).json() as { tenant: string }
  for (const n of 'BCDEFGHIJK') {
    expect((await page.request.post(`/api/t/${tenant}/clients`, { data: { name: `Client ${n}` } })).status()).toBe(201)
  }
  await page.reload()
  await expect(page.getByTestId('client-circle')).toHaveCount(8)
  await expect(page.getByRole('button', { name: 'Show all 11' })).toBeVisible()
  await page.getByRole('button', { name: 'Show all 11' }).click()
  await expect(page.getByTestId('client-circle')).toHaveCount(11)
  await page.getByPlaceholder('Search clients').fill('client k')
  await expect(page.getByTestId('client-circle')).toHaveCount(1)
})

test('another tenant sees none of it', async ({ browser, page }) => {
  await page.goto('/')
  await seed(page)
  const other = await browser.newContext()
  const p2 = await other.newPage()
  await p2.goto('/')
  await expect(p2.getByTestId('counts')).toHaveText('No clients yet')
  await other.close()
})

test('a host with no library route keeps the Launcher as home', async ({ page }) => {
  await page.route('**/api/t/*/library**', r => r.fulfill({ status: 404, body: '' }))
  await page.goto('/')
  await expect(page.getByText('What shall we work on?')).toBeVisible()
  await expect(page.getByTestId('landing')).toHaveCount(0)
})

test('the keyboard reaches the circles and Enter opens one', async ({ page }) => {
  await page.goto('/')
  await seed(page)
  await page.reload()
  await page.getByTestId('agency-circle').focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#clients$/)
  await page.getByTestId('client-circle').first().focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('client-page')).toBeVisible()
})

// Phase 4 (3D circles): reduced motion alone no longer means flat (the approved mock shows still
// 3D spheres; circles.spec.ts covers that). This test is about its other half, no WebGL at all, so
// it starts its own browser without WebGL, as its name says. The assertions are unchanged.
test('reduced motion and no WebGL: the circles are flat SVG, nothing animates', async () => {
  const browser = await chromium.launch({ args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis', '--disable-gpu'] })
  const ctx = await browser.newContext({ reducedMotion: 'reduce', baseURL: test.info().project.use.baseURL })
  const page = await ctx.newPage()
  await page.goto('/')
  await expect(page.getByTestId('landing')).toBeVisible()
  expect(await page.locator('canvas').count()).toBe(0)
  expect(await page.locator('svg.lc-cir').count()).toBeGreaterThan(0)
  await ctx.close()
  await browser.close()
})

// ── layout and names at the widths that broke ───────────────────────────────

const noSideScroll = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.lc')!
    return { page: document.documentElement.scrollWidth - window.innerWidth, lc: el.scrollWidth - el.clientWidth }
  })

test('on a phone every crumb has a name and a 44px target', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/')
  const { a } = await seed(page)
  await page.goto(`/#client-${a}`)
  await page.reload()
  const trail = page.getByRole('navigation', { name: 'Where you are' })
  await expect(trail.getByRole('button')).toHaveCount(3)
  for (const name of ['Clients', 'Client A']) await expect(trail.getByRole('button', { name })).toBeVisible()
  for (const b of await trail.getByRole('button').all()) {
    const box = (await b.boundingBox())!
    expect(box.width, 'crumb width').toBeGreaterThanOrEqual(43.5)
    expect(box.height, 'crumb height').toBeGreaterThanOrEqual(43.5)
    expect(((await b.getAttribute('aria-label')) ?? '').length, 'crumb has a name').toBeGreaterThan(0)
  }
  // None is clipped by the bar: every crumb lies inside the window, and the one you are on shows its name.
  for (const b of await trail.getByRole('button').all()) {
    const box = (await b.boundingBox())!
    expect(box.x, 'crumb left edge').toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, 'crumb right edge').toBeLessThanOrEqual(390 + 0.5)
  }
  const here = trail.getByRole('button', { name: 'Client A' })
  const label = here.locator('.lc-cn')
  expect((await label.boundingBox())!.width, 'the current level shows its name').toBeGreaterThan(20)
  const bar = (await page.locator('header.studio-top').boundingBox())!
  expect((await here.boundingBox())!.y + 44, 'inside the bar').toBeLessThanOrEqual(bar.y + bar.height + 0.5)
})

test('no sideways scroll at 320, 390 and 760 on the clients and client pages', async ({ page }) => {
  await page.goto('/')
  const { a } = await seed(page)
  for (const width of [320, 390, 760]) {
    await page.setViewportSize({ width, height: 900 })
    for (const hash of ['#agency', '#clients', `#client-${a}`]) {
      await page.goto(`/${hash}`)
      await page.reload()
      await expect(page.getByTestId('landing').or(page.getByTestId('clients')).or(page.getByTestId('client-page'))).toBeVisible()
      const o = await noSideScroll(page)
      expect(o.page, `${width}px ${hash} page`).toBeLessThanOrEqual(0)
      expect(o.lc, `${width}px ${hash} .lc`).toBeLessThanOrEqual(0)
    }
  }
})

test('a client route for a client that is not here is corrected to the clients page', async ({ page }) => {
  await page.goto('/#client-cli_00000000')
  await expect(page.getByTestId('clients')).toBeVisible()
  await expect(page).toHaveURL(/#clients$/)
  await page.goto('/')
  const { a } = await seed(page)
  // A tool that is Soon is its client's page; a live one is the tool's own page.
  await page.goto(`/#tool-${a}-idea`)
  await page.reload()
  await expect(page.getByTestId('client-page')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#client-${a}$`))
  await expect(page.getByRole('navigation', { name: 'Where you are' }).getByRole('button', { name: 'Tool' })).toHaveCount(0)
  await page.goto(`/#tool-${a}-brief`)
  await page.reload()
  await expect(page.getByTestId('tool-page')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#tool-${a}-brief$`))
})
