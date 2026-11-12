// Phase 2 acceptance, record `one-bar-search` (features/j001-phase2-suite.clan): tests 26 and 27 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// The bar is the shell's one field (app/src/shell/bar): a combobox in the OS bar above a phone's width (Cmd K opens it), one 44 px button
// below it (data-testid bar-search-button) that opens a full-width sheet. Facts read through the API do not move with the screen and are
// the walls part of test 27 (the Rust suite crates/napkin-web/tests/search.rs checks every role and agency; this is the same wall through the real stack).
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/ and the bar calls none.

import { expect, test, type Page } from '@playwright/test'
import { open, SIZES, signIn } from './pilot'
import { PEOPLE, seedJ001 } from './seed/j001'
import { queryOf, scopeClan, scopeQueryOf } from './seed/j001/p2/one-bar-search.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

type Found = { total: number; groups: { kind: string; items: { id: string; title: string; kind: string; route: string; open: { action: string; target: string } }[] }[] }

/** What the bar finds for `q` as the person signed in to `page`, in their own agency's workspace. */
async function search(page: Page, q: string): Promise<Found> {
  const { tenant } = (await (await page.request.get('/api/session')).json()) as { tenant: string }
  const r = await page.request.get(`/api/t/${tenant}/search?q=${encodeURIComponent(q)}`)
  expect(r.status(), `search ${q}`).toBe(200)
  return (await r.json()) as Found
}
const titles = (f: Found) => f.groups.flatMap(g => g.items.map(i => i.title))

/** Open the bar the way this width does: Cmd K above a phone's width, the bar's button at 390. */
async function openBar(page: Page, phone: boolean) {
  if (phone) await page.getByTestId('bar-search-button').click()
  else await page.keyboard.press('Meta+k')
  await expect(page.getByTestId('bar-search-input')).toBeFocused()
}

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`
  const phone = size.width <= 720

  test(t(26), async ({ browser }) => {
    test.setTimeout(150_000)
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    for (const from of ['/', '/#clients', `/#client-${job.client}`, '/#map', '/#timesheet', `/#job-${job.job}`]) { // from any screen
      await page.goto('/'); await page.goto(from); await page.reload()
      await expect(page.getByTestId('os-bar')).toBeVisible()
      await page.waitForLoadState('networkidle') // a page moves focus to its own heading when its data lands: the person types after that
      const field = phone ? page.getByTestId('bar-search-button') : page.getByTestId('bar-search-input')
      await expect(field).toBeVisible()
      await expect(field).toHaveAccessibleName('Search or type a command') // the same name on every screen
      // Esc puts focus back where it was: the medallion with a keyboard (Cmd K), the bar's own button at 390 (what was pressed).
      await page.getByTestId('medallion').focus()
      await openBar(page, phone)
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('bar-panel')).toHaveCount(0)
      await expect(phone ? page.getByTestId('bar-search-button') : page.getByTestId('medallion')).toBeFocused()
      // Cmd K (the bar's button at 390), type "J001 brief", Enter: the brief opens.
      await openBar(page, phone)
      const input = page.getByTestId('bar-search-input')
      await input.fill(queryOf(job))
      await expect(page.getByTestId('bar-result').first()).toBeVisible()
      await expect(page.getByTestId('bar-result').first()).toHaveAttribute('data-kind', 'brief') // the J001 brief is the first result
      await input.press('Enter')
      await expect(page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 }) // the brief opens
      await expect(page.getByTestId('os-bar')).toContainText('brief', { ignoreCase: true })
    }
    // Inside the brief: the key works with focus in the tool's frame; Esc returns focus to the frame.
    await expect(page.locator('[data-where="document"]')).toBeVisible()
    if (!phone) {
      // The frame's bridge listens once it has loaded (a document's page is never network-idle: it listens for events): try until it does.
      await expect(async () => {
        await page.frameLocator('iframe').first().locator('body').click({ position: { x: 5, y: 5 } })
        await page.keyboard.press('Meta+k')
        await expect(page.getByTestId('bar-search-input')).toBeFocused({ timeout: 2_000 })
      }).toPass({ timeout: 40_000 })
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('bar-panel')).toHaveCount(0)
    }
    // The ? key lists the shortcuts (a keyboard); at 390 the list is on the bar's own panel.
    if (!phone) {
      await page.getByTestId('medallion').focus() // a key typed in the tool's frame stays the frame's: the shell's own page takes the question mark
      await page.keyboard.press('?')
    } else {
      await openBar(page, phone)
      await page.getByTestId('bar-shortcuts-link').click()
    }
    const sheet = page.getByTestId('shortcuts')
    await expect(sheet).toBeVisible()
    for (const words of [/Search or type a command/, /Undo/, /Redo/, /Keyboard shortcuts/]) await expect(sheet).toContainText(words)
    await expect(sheet).toContainText(/Ctrl K|⌘K/)
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    // A question mark typed in a text field is a question mark: the sheet stays shut.
    await page.goto('/'); await page.goto('/#agency'); await page.reload()
    if (!phone) {
      await page.getByTestId('bar-search-input').click()
      await page.keyboard.type('what?')
      await expect(page.getByTestId('shortcuts')).toHaveCount(0)
      await expect(page.getByTestId('bar-search-input')).toHaveValue('what?')
    }
    await ctx.close()
  })

  test(t(27), async ({ browser }) => {
    test.setTimeout(120_000)
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    // A Scope document for J001 (Phase 3's Scope tool makes these; the fixture is its manifest, filed by its app id).
    const up = await page.request.post(`${job.api}/documents/upload`, { data: scopeClan(job, { id: job.client, name: job.clientName }), headers: { 'content-type': 'application/octet-stream' } })
    expect(up.status(), await up.text()).toBe(200)
    const QUERY = queryOf(job)
    const SCOPE_QUERY = scopeQueryOf(job)
    expect(titles(await search(page, QUERY)).length).toBeGreaterThan(0)
    // The bar's own results carry no document's words: an allow list of fields, and nothing else.
    const allowed = ['client_id', 'id', 'job', 'jobs', 'kind', 'line', 'open', 'route', 'title']
    for (const g of (await search(page, QUERY)).groups) for (const i of g.items) expect(Object.keys(i).filter(k => !allowed.includes(k))).toEqual([])
    // A person in a second agency finds nothing of J001 (their own workspace is another tenant).
    await signIn(page, PEOPLE.otherAgency)
    const other = (await (await page.request.get('/api/session')).json()) as { tenant: string }
    expect(other.tenant).not.toBe(job.api.split('/').pop())
    for (const q of [QUERY, job.job, job.clientName, SCOPE_QUERY]) {
      const found = (await (await page.request.get(`/api/t/${other.tenant}/search?q=${encodeURIComponent(q)}`)).json()) as Found
      expect(found.total, `the other agency finds nothing of ${job.job} for ${q}`).toBe(0)
      expect(found.groups).toEqual([])
    }
    // and cannot read the first agency's search by naming its tenant
    const named = await page.request.get(`${job.api}/search?q=${encodeURIComponent(QUERY)}`)
    expect(named.status()).toBe(403)
    // A role that cannot open money gets no Scope result: planning has no Scope and estimates; account service has.
    await signIn(page, PEOPLE.planning)
    expect(titles(await search(page, SCOPE_QUERY)).filter(x => /scope/i.test(x))).toEqual([])
    await signIn(page, PEOPLE.accountService)
    const scoped = await search(page, SCOPE_QUERY)
    expect(titles(scoped).some(x => /scope/i.test(x))).toBe(true)
    // the count says the same: the planner's total is one less than account service's for the same words
    await signIn(page, PEOPLE.planning)
    expect((await search(page, SCOPE_QUERY)).total).toBe(0)
    expect(scoped.total).toBeGreaterThan(0)
    // a result opens if and only if its route is not refused: the scope's route is a 403 for the planner, a non-403 for account service
    const scope = scoped.groups.flatMap(g => g.items).find(i => /scope/i.test(i.title))!
    expect((await page.request.get(`${job.api}${scope.route}`)).status()).toBe(403)
    await signIn(page, PEOPLE.accountService)
    expect((await page.request.get(`${job.api}${scope.route}`)).status()).not.toBe(403)
    await ctx.close()
  })
}
