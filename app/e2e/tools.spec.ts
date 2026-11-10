// The tool level, end to end: a client's tools, each tool's own page, the trail
// in an open document's bar, Escape and Back, the keyboard, and a spin-off that
// stays the client's. Every client name is a placeholder (Client A, Client B).
//
//   npm run e2e            (in app/; starts the stack, see stack.mjs)

import { expect, test, type Page } from '@playwright/test'

interface Seeded { tenant: string; api: string; a: string; b: string }

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
  for (const [client, title] of [[a, 'Spring brief for Client A'], [a, 'Autumn brief for Client A'], [b, 'Launch brief for Client B']]) {
    const r = await page.request.post(`${api}/documents`, { data: { app_id: 'ie.napkin.brief-maker', title, client_id: client } })
    expect(r.status(), title).toBe(200)
  }
  return { tenant, api, a, b }
}

const trail = (page: Page) => page.getByRole('navigation', { name: 'Where you are' })
/** The document menu on the name: its tool's own page for its client is in it (the old trail's last crumb). */
const docMenu = async (page: Page) => { await page.getByTestId('doc-name').click(); return page.getByRole('menu', { name: 'Document' }) }

test('a tool for a client: its page lists that client’s documents only, and New makes one for them', async ({ page }) => {
  await page.goto('/')
  const { a, api } = await seed(page)
  await page.goto(`/#client-${a}`)
  await page.reload()

  // The count on the tool's door is this client's, from the library.
  await expect(page.getByTestId('tool-brief')).toHaveAccessibleName(/2 open/)
  await expect(page.getByTestId('tool-brief')).toContainText('2')
  await expect(page.getByTestId('tool-research')).toHaveAccessibleName(/none open, start one/)
  await page.getByTestId('tool-brief').click()
  await expect(page).toHaveURL(new RegExp(`#tool-${a}-brief$`))
  const tool = page.getByTestId('tool-page')
  await expect(tool.getByRole('heading', { name: 'Brief Maker' })).toBeVisible()
  await expect(tool).toContainText('Client: Client A')
  await expect(page.getByTestId('work-item')).toHaveCount(2)
  await expect(tool).not.toContainText('Client B')
  await expect(trail(page).getByRole('button')).toHaveCount(1) // the client's chip after the agency's pill
  await expect(trail(page).getByRole('button', { name: 'Client A' })).toHaveAttribute('title', 'Back to Client A')
  // The filled button is readable: its text is not its own ground.
  const [fg, bg] = await page.getByTestId('new-doc').evaluate(el => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor])
  expect(fg).not.toBe(bg)

  // The same list, from the server's own filter.
  const listed = await (await page.request.get(`${api}/library?client=${a}&app=ie.napkin.brief-maker`)).json() as { items: { title: string }[] }
  expect(listed.items.map(i => i.title).sort()).toEqual(['Autumn brief for Client A', 'Spring brief for Client A'])

  // Open one: the app runs, and the one OS bar carries the client's chip after the agency's pill.
  await page.getByTestId('work-item').first().click()
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 30_000 })
  await expect(trail(page).getByRole('button')).toHaveCount(1)
  await expect(trail(page).getByRole('button', { name: 'Client A' })).toBeVisible()
  await expect((await docMenu(page)).getByRole('menuitem', { name: /^Brief Maker for Client A/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('medallion')).toHaveCount(1) // the way home
  await expect(page.getByTestId('agency-pill')).toBeVisible()

  // Back leaves the document for the tool page it was opened from.
  await page.goBack()
  await expect(page.getByTestId('tool-page')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#tool-${a}-brief$`))

  // New: a document that is the client's from the start.
  await page.getByTestId('new-doc').click()
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 30_000 })
  await expect(trail(page).getByRole('button', { name: 'Client A' })).toBeVisible() // the new document's own manifest.client
  // The document menu goes back to the tool's page; the client's chip to the client.
  await (await docMenu(page)).getByRole('menuitem', { name: /^Brief Maker for Client A/ }).click()
  await expect(page.getByTestId('tool-page')).toBeVisible()
  await page.getByTestId('work-item').first().click()
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 30_000 })
  await trail(page).getByRole('button', { name: 'Client A' }).click()
  await expect(page.getByTestId('client-page')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#client-${a}$`))
})

test('a new document opens already the client’s: its chip names them, and a blank is not yet work', async ({ page }) => {
  await page.goto('/')
  const { a, api } = await seed(page)
  await page.goto(`/#tool-${a}-brief`)
  await page.reload()
  await page.getByTestId('new-doc').click()
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 30_000 })
  // The new document is the client's even though a blank is not yet "work".
  const all = await (await page.request.get(`${api}/library?client=${a}`)).json() as { items: unknown[] }
  expect(all.items).toHaveLength(2)
  await expect(trail(page).getByRole('button', { name: 'Client A' })).toBeVisible()
})

test('Escape goes up one level, and Back and Forward walk the same levels', async ({ page }) => {
  await page.goto('/')
  const { a } = await seed(page)
  await page.goto('/#agency')
  await page.reload()
  await page.getByRole('button', { name: /^Client A:/ }).click()
  await page.getByTestId('dial-hub').click() // the dial's hub: the client's page
  await page.getByTestId('tool-brief').click()
  await expect(page.getByTestId('tool-page')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('client-page')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#client-${a}$`))
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('desk')).toBeVisible() // up from a client is the desk (#agency and #clients are one)
  await expect(page).toHaveURL(/#agency$/)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('desk')).toBeVisible() // the top stays the top
  await expect(page).toHaveURL(/#agency$/)

  // The browser's own history: every level was a step.
  await page.goBack()
  await expect(page.getByTestId('client-page')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('tool-page')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('client-page')).toBeVisible()
  await page.goForward()
  await expect(page.getByTestId('tool-page')).toBeVisible()
})

test('Escape in the add-client field closes the form and does not leave the page', async ({ page }) => {
  await page.goto('/#clients')
  await page.getByRole('button', { name: /^Add your first client/ }).click()
  await expect(page.getByTestId('add-form')).toBeVisible()
  await page.getByLabel('Client name').press('Escape')
  await expect(page.getByTestId('add-form')).toHaveCount(0)
  await expect(page).toHaveURL(/#clients$/)
})

test('the keyboard: Tab to the tools, arrows move, 1 to 4 pick, Enter opens, Soon is said and goes nowhere', async ({ page }) => {
  await page.goto('/')
  const { a } = await seed(page)
  await page.goto(`/#client-${a}`)
  await page.reload()
  const live = page.getByTestId('live')
  await expect(live).toContainText('Client A opened with 4 tools')

  // One tab stop for the tools: only the first is in the tab order.
  await expect(page.getByTestId('tool-brief')).toHaveAttribute('tabindex', '0')
  await expect(page.getByTestId('tool-research')).toHaveAttribute('tabindex', '-1')
  await page.getByTestId('tool-brief').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('tool-research')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('tool-brief')).toBeFocused() // wraps round
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('tool-research')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(page.getByTestId('tool-brief')).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.getByTestId('tool-research')).toBeFocused()

  // 4 is Production: Soon, said in the live region, and the page does not move.
  await page.keyboard.press('4')
  await expect(live).toContainText('Production Tool is coming soon')
  await expect(page).toHaveURL(new RegExp(`#client-${a}$`))

  // 1 is Brief: its page, with its arrival said.
  await page.keyboard.press('1')
  await expect(page).toHaveURL(new RegExp(`#tool-${a}-brief$`))
  await expect(live).toContainText('Brief Maker for Client A. 2 open.')
  await page.keyboard.press('Escape')
  // Enter on the focused tool opens it too.
  await page.getByTestId('tool-brief').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('tool-page')).toBeVisible()
})

test('every tool says its name, its count and its state to a screen reader', async ({ page }) => {
  await page.goto('/')
  const { a } = await seed(page)
  await page.goto(`/#client-${a}`)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Brief Maker for Client A, 2 open (1 of 4)' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Research Tool for Client A, none open, start one \(2 of 4\)/ })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Tools for Client A' })).toBeVisible()
  // On the desk's dial, each quadrant says the same, Production Soon and disabled.
  await page.goto('/#agency')
  await page.getByRole('button', { name: /^Client A:/ }).click()
  await expect(page.getByRole('button', { name: 'Brief Maker for Client A, 2 briefs (1 of 4)' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Production Tool for Client A, coming soon (4 of 4)' })).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByRole('group', { name: 'Client A: its tools' })).toBeVisible()
})

test('deep links: a tool of a client, a Soon tool, an unknown client, and a tool of an unknown client', async ({ page }) => {
  await page.goto('/')
  const { a } = await seed(page)
  await page.goto(`/#tool-${a}-brief`)
  await page.reload()
  await expect(page.getByTestId('tool-page')).toBeVisible()
  await page.goto(`/#tool-${a}-prod`)
  await page.reload()
  await expect(page.getByTestId('client-page')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#client-${a}$`))
  await page.goto('/#tool-cli_00000000-brief')
  await page.reload()
  await expect(page.getByTestId('desk')).toBeVisible()
  await expect(page).toHaveURL(/#clients$/)
})

test('a spin-off of a client’s document stays that client’s and the bar follows it to the new tool', async ({ page }) => {
  await page.goto('/')
  const { a } = await seed(page)
  await page.goto(`/#tool-${a}-brief`)
  await page.reload()
  await page.getByTestId('work-item').first().click()
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 30_000 })
  await expect((await docMenu(page)).getByRole('menuitem', { name: /^Brief Maker for Client A/ })).toBeVisible()
  await page.keyboard.press('Escape')

  // Continue in ▾ is in the app slot.
  await page.getByRole('button', { name: /^Continue in/ }).click()
  await page.getByRole('menuitem', { name: /^Deck/ }).click()
  await expect(page.locator('.tba-name.tba-deck')).toBeVisible({ timeout: 30_000 })
  await expect(trail(page).getByRole('button', { name: 'Client A' })).toBeVisible()
  await expect((await docMenu(page)).getByRole('menuitem', { name: /^Deck Maker for Client A/ })).toBeVisible()
})
