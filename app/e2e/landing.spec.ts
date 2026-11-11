// The desk, end to end: the real shell, the real napkin-web, real documents.
// Desk -> add a client -> reload -> the dial -> open a client -> start work for
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

test('the desk, add a client, reload, open a client, start work', async ({ page }) => {
  await page.goto('/')

  // The home is the desk (#agency and #clients are the one desk now), with nothing yet.
  await expect(page.getByTestId('desk')).toBeVisible()
  await expect(page.getByTestId('counts')).toHaveText('YOUR DESK · NO CLIENTS YET')
  await expect(page).toHaveURL(/#agency$/)

  // Two clients and their work exist on the server; the desk says so from the server.
  const { a } = await seed(page)
  await page.reload()
  await expect(page.getByTestId('counts')).toHaveText('YOUR DESK · 2 CLIENTS · 2 OPEN')
  await expect(page.getByTestId('needs-count')).toHaveText('0') // nothing is waiting on you

  // The clients are circles on the desk itself, each saying its work in words.
  await page.goto('/#clients')
  await expect(page.getByTestId('desk')).toBeVisible()
  await expect(page.getByTestId('client-circle')).toHaveCount(2)
  await expect(page.getByRole('button', { description: /^Client A: Spring brief for Client A · draft/ })).toBeVisible()
  await expect(page.getByRole('button', { description: /^Client B: Launch brief for Client B · draft/ })).toBeVisible()

  // Add a client: a real record, through the host.
  await page.getByTestId('add-client').click()
  await expect(page.getByTestId('add-form')).toBeVisible()
  await page.getByLabel('Client name').fill('Client C')
  await page.getByRole('button', { name: 'Add client', exact: true }).click()
  await expect(page.getByTestId('client-circle')).toHaveCount(3)
  await expect(page.getByRole('button', { description: /^Client C: No work yet, idle/ })).toBeVisible()

  // The same name again is refused in the host's words and makes nothing.
  await page.getByTestId('add-client').click()
  await page.getByLabel('Client name').fill('client  c')
  await page.getByRole('button', { name: 'Add client', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('already a client called')
  await expect(page.getByTestId('client-circle')).toHaveCount(3)
  await page.getByRole('button', { name: 'Cancel' }).click()

  // It survives a reload, in the same place.
  await page.reload()
  await expect(page).toHaveURL(/#clients$/)
  await expect(page.getByTestId('client-circle')).toHaveCount(3)

  // A client's circle opens the dial in place: four apps round the client's hub; the URL stays.
  await page.getByRole('button', { description: /^Client A:/ }).click()
  await expect(page.getByTestId('dial-hub')).toBeVisible()
  await expect(page).toHaveURL(/#clients$/)
  for (const t of ['brief', 'research', 'deck', 'prod']) await expect(page.getByTestId(`quadrant-${t}`)).toBeVisible()
  await expect(page.getByTestId('quadrant-prod')).toHaveAttribute('aria-disabled', 'true')
  // Open a client: its tools are its groups' headings, Idea and Prod Soon, its work listed.
  await page.getByTestId('dial-hub').click() // the dial's hub: the client's page
  await expect(page).toHaveURL(new RegExp(`#client-${a}$`))
  const client = page.getByTestId('client-page')
  await expect(client.getByRole('heading', { name: 'Client A', level: 1 })).toBeVisible()
  for (const t of ['brief', 'research']) await expect(page.getByTestId(`tool-${t}`)).toBeVisible()
  await expect(page.getByTestId('tool-brief')).not.toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('4') // Production: Soon, said, and the page stays
  await expect(page.getByTestId('live')).toContainText('Production Tool is coming soon')
  await expect(page).toHaveURL(new RegExp(`#client-${a}$`))
  await expect(page.getByTestId('work-item')).toHaveCount(1)
  await expect(page.getByTestId('work-item')).toContainText('Spring brief for Client A')

  // The bar shows where we are after the agency's pill: the client's chip, a switcher, this page.
  const trail = page.getByRole('navigation', { name: 'Where you are' })
  await expect(trail.getByRole('button')).toHaveCount(1)
  await expect(trail.getByRole('button', { name: 'Client A' })).toHaveAttribute('aria-current', 'page')

  // Reload and back/forward land in the same place.
  await page.reload()
  await expect(page).toHaveURL(new RegExp(`#client-${a}$`))
  await expect(client.getByRole('heading', { name: 'Client A', level: 1 })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/#clients$/)
  await expect(page.getByTestId('desk')).toBeVisible()
  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`#client-${a}$`))
  // The switcher goes to another client; the medallion goes back to the desk.
  await trail.getByRole('button', { name: 'Client A' }).click()
  await page.getByRole('menuitem', { name: /^Client B/ }).click()
  await expect(client.getByRole('heading', { name: 'Client B', level: 1 })).toBeVisible()
  await page.getByTestId('medallion').click()
  await expect(page).toHaveURL(/#agency$/)
  await expect(page.getByTestId('desk')).toBeVisible()

  // Start work for a client: the tool's page, then a document that is already theirs.
  await page.getByRole('button', { description: /^Client C:/ }).click()
  await page.getByTestId('quadrant-brief').click() // straight from the dial to the tool
  await expect(page.getByTestId('tool-page')).toBeVisible()
  await page.getByTestId('new-doc').click()
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 30_000 })
  const { tenant } = await (await page.request.get('/api/session')).json() as { tenant: string }
  const recent = await page.request.get(`/api/t/${tenant}/library?app=ie.napkin.brief-maker`)
  // A blank is not work yet: still only the two that were made.
  expect((await recent.json() as { items: unknown[] }).items).toHaveLength(2)
  // The client's chip in the bar is the way back to the client.
  await page.getByRole('navigation', { name: 'Where you are' }).getByRole('button', { name: 'Client C' }).click()
  await expect(page.getByTestId('client-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Client C', level: 1 })).toBeVisible()
})

test('a hostile or unknown hash is the desk, and an unknown client is corrected to it', async ({ page }) => {
  await page.goto('/#client-Ólafsson')
  await expect(page.getByTestId('desk')).toBeVisible()
  await expect(page).toHaveURL(/#agency$/)
  await page.goto('/#client-cli_00000000')
  await expect(page.getByTestId('desk')).toBeVisible()
  await expect(page).toHaveURL(/#clients$/)
})

test('beyond eight clients there is search and Show all, and the empty state is welcoming', async ({ page }) => {
  await page.goto('/#clients')
  await expect(page.getByTestId('desk')).toBeVisible()
  await expect(page.getByTestId('greeting')).toContainText('Add your first client to start their desk.')
  await expect(page.getByTestId('client-circle')).toHaveCount(0)
  await page.getByRole('button', { name: /^Add your first client/ }).click()
  await page.getByLabel('Client name').fill('Client A')
  await page.getByRole('button', { name: 'Add client', exact: true }).click()
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
  await page.getByPlaceholder('Find a client').fill('client k')
  await expect(page.getByTestId('client-circle')).toHaveCount(1)
})

test('another tenant sees none of it', async ({ browser, page }) => {
  await page.goto('/')
  await seed(page)
  const other = await browser.newContext()
  const p2 = await other.newPage()
  await p2.goto('/')
  await expect(p2.getByTestId('counts')).toHaveText('YOUR DESK · NO CLIENTS YET')
  await other.close()
})

test('a host with no library route keeps the Launcher as home', async ({ page }) => {
  await page.route('**/api/t/*/library**', r => r.fulfill({ status: 404, body: '' }))
  await page.goto('/')
  await expect(page.getByText('What shall we work on?')).toBeVisible()
  await expect(page.getByTestId('desk')).toHaveCount(0)
})

test('the keyboard reaches the circles and Enter opens one', async ({ page }) => {
  await page.goto('/')
  await seed(page)
  await page.reload()
  // One tab stop for the circles: the arrows move between them.
  await expect(page.getByTestId('client-circle').first()).toHaveAttribute('tabindex', '0')
  await expect(page.getByTestId('client-circle').nth(1)).toHaveAttribute('tabindex', '-1')
  await page.getByTestId('client-circle').first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('client-circle').nth(1)).toBeFocused()
  await page.keyboard.press('ArrowRight') // wraps round
  await expect(page.getByTestId('client-circle').first()).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.getByTestId('client-circle').nth(1)).toBeFocused()
  await page.keyboard.press('Home')
  await expect(page.getByTestId('client-circle').first()).toBeFocused()
  await page.keyboard.press('Enter')
  // Enter opens the dial with the focus on its first quadrant; Escape closes it and gives the focus back.
  await expect(page.getByTestId('quadrant-brief')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('quadrant-research')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('dial')).toHaveCount(0)
  await expect(page.getByTestId('client-circle').first()).toBeFocused()
  await expect(page).toHaveURL(/#agency$/)
  await page.keyboard.press('Enter')
  await page.keyboard.press('1') // the number keys pick a quadrant: Brief
  await expect(page.getByTestId('tool-page')).toBeVisible()
})

// The circles are always flat (owner, 2026-11-11). This test starts its own browser with reduced
// motion and no WebGL, as its name says, so nothing could draw a sphere or animate if it tried.
test('reduced motion and no WebGL: the circles are flat SVG, nothing animates', async () => {
  const browser = await chromium.launch({ args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis', '--disable-gpu'] })
  const ctx = await browser.newContext({ reducedMotion: 'reduce', baseURL: test.info().project.use.baseURL })
  const page = await ctx.newPage()
  await page.goto('/')
  await seed(page)
  await page.reload()
  await expect(page.getByTestId('desk')).toBeVisible()
  expect(await page.locator('canvas').count()).toBe(0)
  // the flat circle: the client's colour disc and its monogram, drawn by CSS
  expect(await page.locator('[data-testid="client-circle"] .cl-disc > b').count()).toBe(2)
  expect(await page.evaluate(() => document.getAnimations().filter(a => a instanceof CSSAnimation).length)).toBe(0)
  await ctx.close()
  await browser.close()
})

// ── layout and names at the widths that broke ───────────────────────────────

const noSideScroll = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.nui-home')!
    return { page: document.documentElement.scrollWidth - window.innerWidth, lc: el.scrollWidth - el.clientWidth }
  })

test('on a phone the client chip has a name and a 44px target', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/')
  const { a } = await seed(page)
  await page.goto(`/#client-${a}`)
  await page.reload()
  const trail = page.getByRole('navigation', { name: 'Where you are' })
  await expect(trail.getByRole('button')).toHaveCount(1)
  // the way back up is the medallion, and it is a target too
  for (const b of [trail.getByRole('button', { name: 'Client A' }), page.getByTestId('medallion'), page.getByTestId('agency-pill')]) {
    await expect(b).toBeVisible()
    const box = (await b.boundingBox())!
    expect(box.width, 'target width').toBeGreaterThanOrEqual(43.5)
    expect(box.height, 'target height').toBeGreaterThanOrEqual(43.5)
    await expect(b, 'it has a name').toHaveAccessibleName(/\S/)
    // None is clipped by the bar: it lies inside the window.
    expect(box.x, 'left edge').toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, 'right edge').toBeLessThanOrEqual(390 + 0.5)
  }
  const here = trail.getByRole('button', { name: 'Client A' })
  expect((await here.locator('.tb-cname').boundingBox())!.width, 'the client shows its name').toBeGreaterThan(20)
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
      await expect(page.getByTestId('desk').or(page.getByTestId('client-page'))).toBeVisible()
      const o = await noSideScroll(page)
      expect(o.page, `${width}px ${hash} page`).toBeLessThanOrEqual(0)
      expect(o.lc, `${width}px ${hash} .nui-home`).toBeLessThanOrEqual(0)
      // and the bar keeps every piece inside the window
      const right = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.tb-locked > *')].map(e => e.getBoundingClientRect().right)))
      expect(right, `${width}px ${hash} bar`).toBeLessThanOrEqual(width + 0.5)
    }
  }
})

test('a client route for a client that is not here is corrected to the desk', async ({ page }) => {
  await page.goto('/#client-cli_00000000')
  await expect(page.getByTestId('desk')).toBeVisible()
  await expect(page).toHaveURL(/#clients$/)
  await page.goto('/')
  const { a } = await seed(page)
  // A tool that is Soon is its client's page; a live one is the tool's own page.
  await page.goto(`/#tool-${a}-idea`)
  await page.reload()
  await expect(page.getByTestId('client-page')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#client-${a}$`))
  await expect(page.getByRole('navigation', { name: 'Where you are' }).getByRole('button')).toHaveCount(1) // the client's chip, no tool
  await page.goto(`/#tool-${a}-brief`)
  await page.reload()
  await expect(page.getByTestId('tool-page')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#tool-${a}-brief$`))
})
