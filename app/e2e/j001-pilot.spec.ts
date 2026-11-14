// The Phase 1 acceptance suite for the J001 pilot job (features/j001-pilot-suite.clan):
// tests 1 to 18 of docs/napkin-os-build-prompt-v3.1.md section 9 (1 to 12 as written in
// docs/napkin-os-build-prompt-v2.md section 10, 13 to 18 added in v3.1), each run at 390 and
// 1440 px on the real shell and the real server, against the de-identified seed in seed/j001/.
//
// Phase 1 is done when `node e2e/phase1-fixme.mjs` prints a count of 0 and this file passes.
//
// A test whose feature is not built yet is written in full and marked `test.fixme(t(N), ...)`:
// TESTS below names the feature record that turns it on, and each feature removes its own
// fixme when it lands (the selectors and routes in a fixme body are that design's proposal;
// the owning feature adjusts them to what it builds). A test that can pass today really runs.
//
// No model, no paid provider: the stack unsets every provider key (stack.mjs), and the
// stand-in middleware answers every task. Clients and people are placeholders.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { CANARY } from './seed/j001/canary.mjs'
import { noticesOf, openMe } from './needs'
import { barCommand, barOffers } from './boothFolds'
import { asMe, gateOf, INTERNAL_WORDS, lockBrief, PEOPLE, READY_BRIEF, recordClientConfirmation, seedJ001, signBrief } from './seed/j001'

const HERE = dirname(fileURLToPath(import.meta.url))

type Size = { tag: string; width: number; height: number }
const SIZES: Size[] = [{ tag: '390', width: 390, height: 844 }, { tag: '1440', width: 1440, height: 900 }]

/** Each test: its title, and the feature record that turns it on (null: it runs now). */
const TESTS: Record<number, { title: string; slug: string | null }> = {
  1: { title: 'each live role lands on the desk and sees its own page doors', slug: null },
  2: { title: 'Planning gets 403 on Scope and estimates', slug: null },
  3: { title: 'the creative director signs the brief with one approve decision', slug: null },
  4: { title: 'editing after approval makes a new version and a Changed brief alert', slug: null },
  5: { title: 'the dashboard shows a J001 stage change within 10 seconds', slug: null },
  6: { title: 'five agencies repaint from palette.ts and the ink passes contrast in light and dark', slug: null },
  7: { title: 'axe finds nothing serious on every Phase 1 page in light and dark', slug: null },
  8: { title: 'a canary key set on the server never reaches the browser', slug: null },
  9: { title: 'each confirmed timesheet line links to its sessions', slug: null },
  10: { title: 'the brief passes the gate and the client confirms it before Territories open', slug: null },
  11: { title: 'every write in the J001 documents is attributed', slug: null },
  12: { title: 'the J001 brief retrieval trace has no source cannes hit', slug: null },
  13: { title: 'a failed save keeps the text, Try again saves it, and reopening shows it', slug: null },
  14: { title: 'restoring v2 keeps v3 and the approved version locked', slug: null },
  15: { title: 'a provider error shows one line, returns credits, keeps inputs, and Try again works', slug: null },
  16: { title: 'Cmd Z undoes the last brief edit and the text comes back', slug: null },
  17: { title: 'the client confirms the brief link on a phone with no account', slug: null },
  18: { title: 'no consent means no captured sessions', slug: null },
}

// The v2 doors table, split as the desk draws it: the page doors in the "Your pages" row, and the tools the Dial offers.
const DOORS = {
  planning: { pages: ['Client brains'], tools: ['brief', 'research', 'idea', 'deck', 'territories'] },
  creativeDirector: { pages: ['Ready for review', 'Judge scores', 'Approved work', 'Direction notes'], tools: ['brief', 'idea', 'deck'] },
  accountService: { pages: ['Live jobs', 'Approvals', 'Scope and estimates'], tools: ['deck'] },
  management: { pages: ['Agency dashboard', 'Live jobs', 'Time and money', 'Traffic board'], tools: ['deck'] },
} as const
const THEMES = ['light', 'dark'] as const

type Decision = { id?: string; kind?: string; agent?: string; action?: string; version?: string; actor?: string; source?: string }

/**
 * The role tests sign people in, and a server has one auth mode per process: the existing specs run on
 * anonymous sessions (NAPKIN_E2E_PORT), so stack.mjs also starts a roster server (NAPKIN_E2E_ROSTER_PORT)
 * with the placeholder people and their roles. A test that signs in opens its context with `roster: true`.
 */
const rosterURL = `http://127.0.0.1:${process.env.NAPKIN_E2E_ROSTER_PORT || '18082'}`

async function open(browser: Browser, size: Size, mode: string = 'white', opts: { roster?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, ...(opts.roster ? { baseURL: rosterURL } : {}) })
  await ctx.addInitScript(m => { try { localStorage.setItem('napkin.theme', m) } catch { /* not kept */ } }, mode)
  return { ctx, page: await ctx.newPage() }
}

/** Sign in as a placeholder person (the context must be the roster server's: `open(..., { roster: true })`). */
async function signIn(page: Page, who: { username: string }) {
  const r = await page.request.post('/api/auth/sign-in', { data: { username: who.username } })
  expect(r.status(), `sign in as ${who.username}`).toBe(200)
}

/**
 * The agency signs the brief with the Brief gate on: the planner first, then the creative director's lock
 * (features/brief-gate.clan). Leaves the creative director signed in.
 */
async function signOff(page: Page, job: Awaited<ReturnType<typeof seedJ001>>) {
  await signIn(page, PEOPLE.planning)
  expect((await signBrief(page, job.brief)).status()).toBe(200)
  await signIn(page, PEOPLE.creativeDirector)
  expect((await lockBrief(page, await asMe(page, job.api, job.brief))).status()).toBe(200)
}

const chainOf = async (page: Page, token: string): Promise<Decision[]> =>
  ((await (await page.request.get(`/s/${token}/chain`)).json()) as { decisions: Decision[] }).decisions

const sessionOf = async (page: Page) =>
  (await (await page.request.get('/api/session')).json()) as { tenant: string; quota: { used: number; cap: number } }

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))

/**
 * A client with a brief in it, in the signed-in agency's workspace, so the pages have something to show.
 * The J001 seed is not used here: its brief patch is refused on this branch (j001-seed.spec.ts fails the
 * same way), and an agency's workspace outlives a test, so a client that is already there is reused.
 */
async function somethingToRead(page: Page): Promise<{ client: string }> {
  await page.goto('/')
  const { tenant } = await sessionOf(page)
  const api = `/api/t/${tenant}`
  let list = (await (await page.request.get(`${api}/clients`)).json()) as { id: string }[]
  if (!list.length) {
    expect((await page.request.post(`${api}/clients`, { data: { name: 'Client A' } })).status()).toBe(201)
    list = (await (await page.request.get(`${api}/clients`)).json()) as { id: string }[]
  }
  const client = list[0].id
  const made = await page.request.post(`${api}/documents`, { data: { app_id: 'ie.napkin.brief-maker', title: 'J001 brief, Client A', client_id: client } })
  expect(made.status(), 'a brief to open').toBe(200)
  return { client }
}

for (const size of SIZES) {
  const t = (n: number) => `${n} ${TESTS[n].title}, ${size.tag} px`

  // 1 to 12: as written in v2 section 10.

  test(t(1), async ({ browser }) => {
    for (const [role, door] of Object.entries(DOORS)) {
      const { ctx, page } = await open(browser, size, 'light', { roster: true })
      await signIn(page, PEOPLE[role as keyof typeof PEOPLE])
      await page.goto('/')
      // everyone lands on the desk: the circles row is there, and no role home is drawn
      await expect(page.getByTestId('desk')).toBeVisible()
      await expect(page.locator('#cl-row')).toBeVisible()
      await expect(page.getByTestId('home')).toHaveCount(0)
      // the role adds one row of page doors under the greeting, and filters the tools the server offers
      const shown = page.getByTestId('page-door')
      await expect(shown).toHaveCount(door.pages.length)
      expect(await shown.allInnerTexts(), role).toEqual([...door.pages])
      const { tenant } = await sessionOf(page)
      const view = (await (await page.request.get(`/api/t/${tenant}/doors`)).json()) as { pages: { name: string }[]; tools: string[] }
      expect(view.pages.map(p => p.name), `${role} pages from the server`).toEqual([...door.pages])
      expect(view.tools, `${role} tools`).toEqual([...door.tools])
      await ctx.close()
    }
  })

  test(t(2), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true })
    const r = await page.request.get(`${job.api}/jobs/J001/scope`)
    expect(r.status()).toBe(403)
    await ctx.close()
  })

  // The Brief gate (features/brief-gate.clan). The planner signs first, then the creative director: the
  // creative director's signature is the one approve decision that locks the version. People sign in
  // on the roster server (every run starts it); the stack turns the gate on (NAPKIN_BRIEF_GATE=on).
  // The gate lives in the brief's Booth (features/align-booth.clan): the items the host lists as blocking the lock
  // are rows of the one Needs you list (#lockList), the sign-offs are rows addressed to the signer, and the Booth's
  // Lock is the one button that locks. Opening the brief is enough: there is no band to unfold.
  const openBrief = async (page: Page, job: Awaited<ReturnType<typeof seedJ001>>, via: 'tool' | 'job' = 'tool') => {
    if (via === 'job') { // account service has no brief tool: the brief opens from the job page
      await page.goto('/'); await page.goto(`/#job-${job.job}`); await page.reload()
      await page.locator('[data-testid="job-document"][data-app="ie.napkin.brief-maker"]').getByTestId('job-open-document').click()
    } else {
      await page.goto(`/#tool-${job.client}-brief`)
      await page.reload()
      await page.getByTestId('work-item').first().click()
    }
    const booth = page.frameLocator('iframe').first().locator('#stab')
    await expect(booth.locator('#statusPill')).toBeVisible()
    return booth
  }
  /** The rows of Needs you the host's gate gave (gate:<item>, signoff:<role>). */
  const gateRows = (booth: ReturnType<Page['locator']>) => booth.locator('#lockList [data-code^="gate:"], #lockList [data-code^="signoff:"]')
  /** Share, Send the client copy: the shell's own form for the client's link, for the brief open in the frame. */
  const sendClientCopy = async (page: Page) => {
    await page.getByRole('button', { name: /^Share/ }).click()
    await page.getByRole('menu', { name: 'Share' }).getByRole('menuitem', { name: /Send the client copy/ }).click()
    const form = page.getByTestId('client-link-form')
    await expect(form.getByRole('button', { name: 'Make the link' })).toBeVisible()
    return form
  }

  test(t(3), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    expect((await signBrief(page, job.brief, 'Gate passed.')).status()).toBe(200) // the planner signs first
    await signIn(page, PEOPLE.creativeDirector)
    const booth = await openBrief(page, job)
    // The planner's `sign` decision is a kind the format knows: the bar shows no file error.
    await expect(page.getByTestId('os-bar')).toBeVisible()
    await expect(page.getByText('Something’s wrong with this file')).toHaveCount(0)
    // Nothing the gate wants is left: no gate row in Needs you, the pill and Lock agree, and Lock is the one button.
    await expect(booth.locator('#statusPill')).toHaveText('Ready to lock')
    await expect(gateRows(booth)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Sign and lock this version' })).toHaveCount(0)
    await expect(booth.getByRole('button', { name: 'Sign and lock this version' })).toHaveCount(0)
    await expect(booth.locator('#lockBtn')).toBeEnabled()
    await booth.locator('#lockBtn').click() // the creative director's signature is the Booth's Lock
    await expect.poll(async () => (await gateOf(page, job.brief)).signed).toBe(true)
    await expect(booth.locator('#statusPill')).toHaveText('Locked')
    const chain = await chainOf(page, job.brief.token)
    const approvals = chain.filter(d => d.kind === 'approve')
    expect(approvals).toHaveLength(1)
    expect(approvals[0].actor ?? '').toContain(PEOPLE.creativeDirector.username)
    expect(chain.filter(d => d.kind === 'sign')).toHaveLength(1) // the planner's, not a second lock
    await ctx.close()
  })

  test(t(4), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signBrief(page, job.brief)
    await signIn(page, PEOPLE.creativeDirector)
    const locked = await lockBrief(page, await asMe(page, job.api, job.brief))
    expect(locked.status(), await locked.text()).toBe(200)
    const signed = (await chainOf(page, job.brief.token)).find(d => d.kind === 'approve')!.version
    expect((await gateOf(page, job.brief)).changed_since_lock).toBe(false)
    const edit = await page.request.post(`/s/${job.brief.token}/patch-data`, {
      data: { patch: { single_minded_proposition: 'A new line.' }, agent: 'human', action: 'edit the proposition' },
    })
    expect(edit.status()).toBe(200)
    const after = await chainOf(page, job.brief.token) // newest first
    const lock = after.findIndex(d => d.kind === 'approve')
    expect(after[lock].version).toBe(signed) // the signed version stays as it was
    const edited = after.findIndex(d => d.kind === 'edit' && d.action === 'edit the proposition')
    expect(edited, 'the edit is a newer decision than the lock').toBeGreaterThanOrEqual(0)
    expect(edited).toBeLessThan(lock)
    expect((await gateOf(page, job.brief)).changed_since_lock).toBe(true)
    await page.goto('/')
    await page.reload()
    // a changed brief is a notice on the brief like any other item (needs-you-full): for everyone on the job, on the desk's Me rows
    expect(await noticesOf(page, job.api, job.brief, ['brief-changed'])).toHaveLength(1)
    await openMe(page)
    const showAll = page.getByTestId('me-show-all') // five rows show; this person's list may hold more by now
    if (await showAll.isVisible()) await showAll.click()
    await expect(page.getByTestId('me-row').filter({ hasText: job.clientName })).toBeVisible()
    await ctx.close()
  })

  // The dashboard is a door on Management's home (features/job-index-dashboard.clan). A job's stage is read from
  // its documents' decisions, never typed in: the stage changes here are the Brief gate's own (the gate passed,
  // the planner and the creative director signed, the client confirmed), written by the planner's browser while
  // Management's page, open on the dashboard, is left alone. Each change must show on it within 10 seconds.
  test(t(5), async ({ browser }) => {
    const mgr = await open(browser, size, 'white', { roster: true })
    const planner = await open(browser, size, 'white', { roster: true })
    await signIn(planner.page, PEOPLE.planning)
    const job = await seedJ001(planner.page, { fresh: true }) // the messy brief: it has not passed the gate
    await signIn(mgr.page, PEOPLE.management)
    await mgr.page.goto('/')
    await mgr.page.goto('/#door-agency-dashboard')
    await mgr.page.reload()
    await expect(mgr.page.getByTestId('dashboard')).toBeVisible()
    await expect(mgr.page.getByTestId(/^tile-(stage|risk|hours|waiting|scores|results)$/)).toHaveCount(6)
    const row = mgr.page.getByTestId('tile-stage').locator(`[data-job="${job.job}"]`)
    await expect(row).toHaveAttribute('data-stage', 'client-brief')
    // the number on the tile is a link, and it opens the job page (or Live jobs, for several jobs)
    await expect(mgr.page.getByTestId('tile-stage').getByTestId('tile-number').first()).toHaveAttribute('href', /^#(job-J\d{3,6}|door-live-jobs)$/)

    // the gate passes: Brief check
    const patched = await planner.page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: READY_BRIEF, agent: 'human', action: 'answer the gate items' } })
    expect(patched.status()).toBe(200)
    await expect(row).toHaveAttribute('data-stage', 'brief-check', { timeout: 10_000 })
    // the planner signs, then the creative director locks: the brief is signed and waits for the client
    expect((await signBrief(planner.page, job.brief)).status()).toBe(200)
    await expect(row).toContainText('The planner has signed', { timeout: 10_000 })
    await signIn(planner.page, PEOPLE.creativeDirector)
    expect((await lockBrief(planner.page, await asMe(planner.page, job.api, job.brief))).status()).toBe(200)
    await expect(row).toContainText('Waiting for the client to confirm', { timeout: 10_000 })
    await expect(mgr.page.getByTestId('tile-waiting')).toContainText('The longest wait')
    // the client confirms: the job moves on
    expect((await recordClientConfirmation(planner.page, await asMe(planner.page, job.api, job.brief))).status()).toBe(200)
    await expect(row).toHaveAttribute('data-stage', 'scope-estimate', { timeout: 10_000 })

    // the stage is read, never written: a write to the index answers 405
    const stage = await mgr.page.request.get(`${job.api}/jobs/${job.job}/stage`)
    expect((await stage.json()).stage.label).toBe('Scope and estimate')
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      expect((await mgr.page.request[method](`${job.api}/jobs/${job.job}/stage`, { data: { stage: 'Ideas' } })).status(), method).toBe(405)
    }
    // Management and an admin open the dashboard; Planning gets 403 from the server
    expect((await mgr.page.request.get(`${job.api}/dashboard`)).status()).toBe(200)
    await signIn(planner.page, PEOPLE.planning)
    expect((await planner.page.request.get(`${job.api}/dashboard`)).status()).toBe(403)
    await planner.page.goto('/#door-agency-dashboard')
    await planner.page.reload()
    await expect(planner.page.locator('[data-state="missing-access"]')).toBeVisible()
    await mgr.ctx.close()
    await planner.ctx.close()
  })

  test(t(6), async ({ browser }) => {
    // The look is palette.ts alone: five agencies, three from the code registry (wk, the default; catapult, an outline accent
    // on a base pill with mono surfaces; pluto, an ink of its own on the accent) and two added from the People page with a
    // base and an accent. Each is read from what the page draws: the --agency tokens on the root, and the agency pill's own
    // computed colours, checked with palette.ts contrast(), in light and in dark.
    const { contrast: ratio, coloursOf, paletteOf } = await import('../src/shell/agency/palette')
    const ADDED = [
      { id: 'acme', name: 'Acme', base: '#0F6B5C', accent: '#9FE6D8' },
      { id: 'kiln', name: 'Kiln', base: '#16181D', accent: '#C6F432' },
    ]
    const admin = await open(browser, size, 'light', { roster: true })
    await signIn(admin.page, PEOPLE.peopleAdmin)
    for (const a of ADDED) {
      // develop (#234): an added agency takes name, base and accent; its id is made from the name, and it is a draft until published.
      const r = await admin.page.request.post('/api/admin/agencies', { data: { name: a.name, base: a.base, accent: a.accent } })
      expect([201, 409], `${a.id} added: ${await r.text()}`).toContain(r.status()) // 409: a run at the other width added it already
      if (r.status() === 201) {
        // publishing names the rev it makes live: the one on the row the add answered with
        const p = await admin.page.request.post(`/api/admin/agencies/${a.id}/publish`, { data: { rev: (await r.json()).rev } })
        expect(p.status(), `${a.id} published: ${await p.text()}`).toBe(200)
      }
    }
    await admin.ctx.close()
    const AGENCIES = [
      { id: 'wk', who: PEOPLE.planning, colours: coloursOf('wk')! },
      { id: 'catapult', who: PEOPLE.lookCatapult, colours: coloursOf('catapult')! },
      { id: 'pluto', who: PEOPLE.lookPluto, colours: coloursOf('pluto')! },
      { id: 'acme', who: PEOPLE.lookAcme, colours: { name: ADDED[0].name, base: ADDED[0].base.toUpperCase(), accent: ADDED[0].accent.toUpperCase() } },
      { id: 'kiln', who: PEOPLE.lookKiln, colours: { name: ADDED[1].name, base: ADDED[1].base.toUpperCase(), accent: ADDED[1].accent.toUpperCase() } },
    ]
    const hex = (c: string) => {
      // Chrome writes a mixed colour as color(srgb r g b) with 0 to 1 channels, a plain one as rgb(r, g, b).
      const n = (c.match(/-?[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const v = c.startsWith('color(') ? n.map(x => Math.round(x * 255)) : n
      return '#' + v.map(x => x.toString(16).padStart(2, '0')).join('')
    }
    for (const ag of AGENCIES) {
      expect(ag.colours, `${ag.id} is in the registry`).toBeTruthy()
      for (const theme of THEMES) {
        const { ctx, page } = await open(browser, size, theme, { roster: true })
        await signIn(page, ag.who)
        await page.goto('/')
        await expect(page.getByTestId('os-bar')).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.locator('html')).not.toHaveAttribute('data-mode', /.*/)
        const want = paletteOf(ag.colours)[theme]
        const token = (name: string) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)
        await expect.poll(() => token('--agency'), { message: `--agency for ${ag.id} in ${theme}` }).toBe(want.agency)
        expect(await token('--agency-fg'), `${ag.id} ${theme} --agency-fg`).toBe(want.fg)
        expect(await token('--ag-base'), `${ag.id} ${theme} --ag-base`).toBe(ag.colours.base.toUpperCase())
        expect(await token('--ag-acc'), `${ag.id} ${theme} --ag-acc`).toBe(ag.colours.accent.toUpperCase())
        // ink on the agency colour: the tokens and the pill the person sees
        expect(ratio(want.agency, want.fg), `${ag.id} ${theme}: ink on the agency colour`).toBeGreaterThanOrEqual(4.5)
        // the pill's colours ease in for a moment on arrival: read them once they have settled
        await expect.poll(async () => {
          const pill = await page.getByTestId('agency-pill').evaluate(el => { const s = getComputedStyle(el); return { bg: s.backgroundColor, ink: s.color } })
          return ratio(hex(pill.bg), hex(pill.ink))
        }, { message: `${ag.id} ${theme}: ink on the agency pill`, timeout: 8000 }).toBeGreaterThanOrEqual(4.5)
        // nothing samples a logo any more: there is no accent token of its own
        expect(await token('--agency-accent'), `${ag.id} ${theme}`).toBe('')
        await ctx.close()
      }
    }
  })

  test(t(7), async ({ browser }) => {
    // Three modes, each seeding and signing off a job and scanning six pages: measured 46 to 52 s alone, so the default 60 s is too close
    // and times out when the machine is busy. The scan is unchanged; only the time it is given.
    test.setTimeout(240_000)
    const { default: AxeBuilder } = await import('@axe-core/playwright')
    // The Phase 1 pages that exist on this branch: the desk, the clients page, a client, its Brief
    // page, Territories (the visual brief's choose-a-territory form), a page door's SoonCard, and View as. The pages other records build (gate, dashboard, timesheet,
    // visual brief) join this list when they land. The app frame is a document with its own paper
    // (the apps are restyled in their own records), so it is left out of the scan.
    const problems: string[] = []
    for (const mode of THEMES) {
      const { ctx, page } = await open(browser, size, mode, { roster: true })
      await signIn(page, { username: 'ann@napkin' })
      const job = await somethingToRead(page)
      // Territories open only for a brief that has passed the gate, been signed and been confirmed by the client (the
      // roster stack has the Brief gate on), so the page scanned is the open one with its choose-a-territory form. The
      // admin cannot sign a brief, so the agency "wk" does it (planner, creative director, client) and the page is read as
      // its planner, who has the Territories tool; every other page is read as the admin, whose View as it is.
      await signIn(page, PEOPLE.planning)
      const signed = await seedJ001(page, { ready: true, fresh: true })
      await signOff(page, signed)
      expect((await recordClientConfirmation(page, await asMe(page, signed.api, signed.brief))).status()).toBe(200)
      const pages: [string, () => Promise<void>][] = [
        ['desk', async () => { await page.goto('/#agency'); await page.reload(); await expect(page.getByTestId('os-bar')).toBeVisible() }],
        ['clients', async () => { await page.goto('/#clients'); await page.reload(); await expect(page.getByTestId('os-bar')).toBeVisible() }],
        ['client', async () => { await page.goto(`/#client-${job.client}`); await page.reload(); await expect(page.getByTestId('os-bar')).toBeVisible() }],
        ['brief page', async () => { await page.goto(`/#tool-${job.client}-brief`); await page.reload(); await expect(page.getByTestId('work-item').first()).toBeVisible() }],
        ['territories', async () => { await page.goto(`/#tool-${signed.client}-territories`); await page.reload(); await expect(page.getByTestId('choose-territory')).toBeVisible() }],
        ['view as', async () => {
          await page.goto('/#agency'); await page.reload()
          await page.getByTestId('account-button').click()
          await page.getByRole('menuitem', { name: /View as/ }).click()
          await expect(page.getByTestId('view-as')).toBeVisible()
        }],
        ['page door', async () => {
          await page.goto('/#door-client-brains'); await page.reload()
          await expect(page.getByTestId('door-page')).toBeVisible()
        }],
      ]
      for (const [name, show] of pages) {
        await signIn(page, name === 'territories' ? PEOPLE.planning : { username: 'ann@napkin' })
        await page.goto('/'); await page.reload() // the page is loaded again as this person: its tenant is read at load
        await show()
        await page.waitForTimeout(700) // the page's own entrance finishes before it is read
        const found = (await new AxeBuilder({ page }).exclude('iframe').analyze()).violations
          .filter(v => v.impact === 'serious' || v.impact === 'critical')
        problems.push(...found.map(v => `${name} ${mode}: ${v.id} ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`))
      }
      await ctx.close()
    }
    expect(problems).toEqual([])
  })

  test(t(8), async ({ browser }) => {
    // The stack sets NAPKIN_CANARY_KEY on the server. It must be in no response the browser
    // gets (the shell, the app frame, the API) and in no file of the built bundle.
    const { ctx, page } = await open(browser, size)
    const bodies: string[] = []
    page.on('response', async r => {
      try {
        if (/text|json|javascript|css|xml|html/.test(r.headers()['content-type'] ?? '')) bodies.push(await r.text())
      } catch { /* a body that is gone is not a leak */ }
    })
    const job = await seedJ001(page)
    await page.goto(`/#tool-${job.client}-brief`)
    await page.reload()
    await page.getByTestId('work-item').first().click()
    await expect(page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.frameLocator('iframe').first().locator('#fields')).toBeVisible({ timeout: 30_000 }) // the app frame has loaded
    for (const url of ['/api/session', '/api/healthz', `${job.api}/home`, `${job.api}/apps`, `${job.api}/clients`, `/s/${job.brief.token}/chain`]) {
      bodies.push(await (await page.request.get(url)).text())
    }
    expect(bodies.length, 'the page loaded its bundle and data').toBeGreaterThan(10)
    expect(bodies.filter(b => b.includes(CANARY))).toHaveLength(0)
    const dist = fileURLToPath(new URL('../dist', import.meta.url))
    const built = walk(dist).filter(f => /\.(js|css|html|json|map)$/.test(f))
    expect(built.length).toBeGreaterThan(0)
    expect(built.filter(f => readFileSync(f, 'utf8').includes(CANARY))).toEqual([])
    await ctx.close()
  })

  // A person who says yes keeps that answer on the roster stack, so this one is not the planner test 18 needs unanswered.
  test(t(9), async ({ browser }) => {
    // Seeds a job, opens the brief and waits for a work session to be captured before the confirm button enables: 8 to 13 s alone,
    // but the click retries until the session is in, which under load runs past the default 60 s.
    test.setTimeout(150_000)
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planningAndCreative)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await page.request.delete(`${job.api}/timesheet/mine`) // the other width's day, if it ran first
    await page.request.post(`${job.api}/timesheet/consent`, { data: { consent: true } })
    await page.goto(`/#tool-${job.client}-brief`)
    await page.reload() // the shell reads the person's answer when it loads
    await page.getByTestId('work-item').first().click()
    await expect(page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 }) // the document is open
    await page.waitForTimeout(3000) // a work session while the brief is open and in focus
    await page.goto('/#timesheet')
    await page.getByRole('button', { name: /^Confirm today/ }).click()
    await expect(page.getByTestId('timesheet-confirmed')).toBeVisible()
    const lines = page.getByTestId('timesheet-line')
    await expect(lines.first()).toBeVisible()
    for (const line of await lines.all()) await expect(line.getByTestId('line-sessions')).toHaveCount(1) // each confirmed line links to its sessions
    const day = await (await page.request.get(`${job.api}/timesheet/day?date=${await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })}`)).json()
    expect(day.status).toBe('confirmed')
    for (const l of day.lines) expect(l.session_ids.length).toBeGreaterThan(0)
    await ctx.close()
  })

  test(t(10), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await page.goto(`/#tool-${job.client}-territories`)
    await page.reload()
    await expect(page.getByTestId('territories-closed')).toBeVisible() // not signed, not confirmed
    // Two gate items missing: the insight and what would make it famous.
    expect((await page.request.post(`/s/${job.brief.token}/patch-data`, {
      data: { patch: { insight: '', famous: '' }, agent: 'human', action: 'take out two gate items' },
    })).status()).toBe(200)
    let booth = await openBrief(page, job)
    // The Booth lists the two gate rows and the planner's own sign-off (the host lists it while the planner has
    // not signed this content), and Lock waits on all of them; the pill agrees.
    await expect(booth.locator('#lockList [data-code="gate:insight"]')).toBeVisible()
    await expect(booth.locator('#lockList [data-code="gate:famous"]')).toBeVisible()
    await expect(booth.locator('#lockList [data-code="signoff:planner"]')).toContainText('For you')
    await expect(gateRows(booth)).toHaveCount(3)
    await expect(booth.locator('#lockBtn')).toBeDisabled()
    await expect(booth.locator('#lockWhy')).toHaveText('Settle 3 first')
    await expect(booth.locator('#statusPill')).toHaveText('Draft')
    // A row opens its part: the insight is selected on the sheet.
    await booth.locator('#lockList [data-code="gate:insight"]').click()
    await expect(page.frameLocator('iframe').first().locator('#fields .row.sel')).toHaveAttribute('data-clan-part', 'insight')
    expect((await page.request.post(`/s/${job.brief.token}/patch-data`, {
      data: { patch: { insight: READY_BRIEF.insight }, agent: 'human', action: 'write the insight' },
    })).status()).toBe(200)
    booth = await openBrief(page, job)
    await expect(gateRows(booth)).toHaveCount(2)
    // The brief has no part for "famous": its row opens the line in the Booth.
    await booth.locator('#lockList [data-code="gate:famous"]').click()
    await booth.locator('#gateBox').getByLabel('What would make this famous?').fill(READY_BRIEF.famous)
    await booth.locator('#gateBox').getByRole('button', { name: 'Add to the brief' }).click()
    await expect(gateRows(booth)).toHaveCount(1)
    // The planner's sign-off row opens Sign this version, in the Booth.
    await booth.locator('#lockList [data-code="signoff:planner"]').click()
    await booth.locator('#gateBox').getByRole('button', { name: 'Sign this version' }).click()
    await expect.poll(async () => (await gateOf(page, job.brief)).passed).toBe(true)
    await expect(gateRows(booth)).toHaveCount(0)
    await signIn(page, PEOPLE.creativeDirector)
    booth = await openBrief(page, job)
    await expect(booth.locator('#statusPill')).toHaveText('Ready to lock')
    await booth.locator('#lockBtn').click()
    await expect.poll(async () => (await gateOf(page, job.brief)).signed).toBe(true)
    await expect(booth.locator('#statusPill')).toHaveText('Locked')
    await page.goto(`/#tool-${job.client}-territories`)
    await page.reload()
    await expect(page.getByTestId('territories-closed')).toBeVisible() // passed and signed, the client has not confirmed
    // The client's confirmation, through their own link on a phone with no account (test 17): account
    // service makes it from the signed brief with Share, Send the client copy, and the client confirms it.
    await signIn(page, PEOPLE.accountService)
    await openBrief(page, job, 'job')
    const form = await sendClientCopy(page)
    await form.getByLabel('Who it is for').fill('Client A contact')
    await form.getByLabel('Their email').fill('contact@client-a.example')
    await form.getByRole('button', { name: 'Make the link' }).click()
    const url = await form.getByLabel('The client link').first().inputValue()
    const phone = await browser.newContext({ baseURL: rosterURL, viewport: { width: size.width, height: size.height } })
    const cp = await phone.newPage()
    await cp.goto(new URL(url).pathname)
    await cp.getByRole('button', { name: 'Confirm' }).click()
    await expect(cp.getByTestId('client-link-done')).toBeVisible()
    await phone.close()
    await signIn(page, PEOPLE.planning)
    await page.goto(`/#tool-${job.client}-territories`)
    await page.reload()
    await expect(page.getByTestId('territories-closed')).toHaveCount(0)
    await expect(page.getByTestId('territories-open')).toBeVisible()
    await ctx.close()
  })

  test(t(11), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    const job = await seedJ001(page, { ready: true })
    // Only the brief is written to by the seed; the research and the deck are made and left empty, so their
    // chains hold nothing to check yet. Whatever any of them holds must be attributed.
    expect((await chainOf(page, job.brief.token)).length, 'the seed left a chain on the brief').toBeGreaterThan(0)
    // A person's own edit, so the chain holds a human decision to check (the seed's writes are the seed agent's).
    const edit = await page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: { famous: 'A bar that closes its doors for one song, once a night.' }, agent: 'human', action: 'edit the famous line' } })
    expect(edit.status()).toBe(200)
    const humans: Decision[] = []
    for (const doc of [job.brief, job.research, job.deck]) {
      const chain = await chainOf(page, doc.token)
      for (const d of chain) {
        expect(d.agent, 'a write with no agent').toBeTruthy()
        expect(d.action, 'a write with no action').toBeTruthy()
        // What the host records for a person's edit: agent `human`, kind `edit`, and the person as its actor.
        if (d.agent === 'human') {
          expect(d.kind).toBe('edit')
          expect(d.actor ?? '', 'a human edit names the person who made it').toMatch(/^human:.+/)
          humans.push(d)
        }
      }
    }
    expect(humans.map(d => d.action), 'the chain holds the human edit').toContain('edit the famous line')
    // The host refuses an unattributed write.
    const bare = await page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: { audience: 'x' }, agent: '' } })
    expect(bare.status()).toBe(400)
    await ctx.close()
  })

  test(t(12), async () => {
    // The retrieval trace is the engine's (engine/rag/brief_context.py), and no route of the stack serves it:
    // the stack has no engine and no index, and must not. So the engine's own mix path is run over stand-in
    // rows (retrievalTrace.py): four of them tagged cannes, no corpus text, no model, no network.
    const dir = mkdtempSync(join(tmpdir(), 'j001-trace-'))
    try {
      const brief = join(dir, 'brief.json')
      writeFileSync(brief, JSON.stringify(READY_BRIEF))
      const trace = (...extra: string[]) => JSON.parse(execFileSync('uv', [
        'run', '-q', '--no-project', '--python', '3.12', ...['numpy', 'requests', 'httpx', 'pypdf', 'pdfplumber', 'python-docx', 'PyYAML', 'python-dotenv'].flatMap(d => ['--with', d]),
        'python', join(HERE, 'seed/j001/retrievalTrace.py'), brief, ...extra,
      ], { cwd: join(HERE, '../../engine/rag'), encoding: 'utf8', env: { ...process.env, BRIEF_TESTS_OFFLINE: '1' } })) as {
        source_of: Record<string, Record<string, string>>; egress: { on: string }[]
      }
      const served = (t: ReturnType<typeof trace>) => Object.values(t.source_of).flatMap(f => Object.values(f))
      const clean = trace()
      expect(served(clean).length, 'the trace records each hit with its source').toBeGreaterThan(0)
      expect(served(clean).filter(s => /^cannes$/i.test(s))).toEqual([])
      expect(clean.egress, 'the filter held, so nothing was caught on the way out').toEqual([])
      // A store that ignores the filter still serves no cannes hit: the engine's own check removes it and records it.
      const leaky = trace('--ignore-filter')
      expect(served(leaky).filter(s => /^cannes$/i.test(s))).toEqual([])
      expect(leaky.egress.map(e => e.on)).toContain('source')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // 13 to 18: added in v3.1, so the gate proves recovery and reopening, not only the happy path.

  test(t(13), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    const job = await seedJ001(page)
    await page.goto(`/#tool-${job.client}-brief`)
    await page.getByTestId('work-item').first().click()
    const app = page.frameLocator('iframe').first()
    // A double click opens a part for writing in the brief's own editor; Ctrl+Enter is Done.
    await app.locator('#fields .row[data-clan-part="audience"]').dblclick()
    const field = app.getByRole('textbox', { name: /^Write / })
    await field.fill('Typed while the network is cut.')
    await ctx.setOffline(true)
    await field.press('Control+Enter')
    const failed = page.locator('[data-state="failed-save"]')
    await expect(failed).toBeVisible()
    if (process.env.NAPKIN_E2E_SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.NAPKIN_E2E_SHOTS}/bands-state-failed-save-${size.width}.png`, mask: [page.getByTestId('agency-pill')], maskColor: '#C8CBFF' }) }
    await expect(field).toHaveText('Typed while the network is cut.') // the typed text stays on screen
    await ctx.setOffline(false)
    await failed.getByRole('button', { name: 'Try again' }).click()
    await expect(failed).toHaveCount(0)
    await page.goto('/')
    await page.goto(`/#tool-${job.client}-brief`)
    await page.getByTestId('work-item').first().click()
    await expect(page.frameLocator('iframe').first().locator('#fields')).toContainText('Typed while the network is cut.')
    await ctx.close()
  })

  // Three signed versions, each signed the way the gate asks: the planner signs, then the creative director's
  // approve locks it; a new version starts with an unlock (features/brief-versions-undo.clan).
  test(t(14), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    // The shell's own page stays off the document while the signatures are written: a read that opens it
    // while a write lands can leave the host's open copy one write behind (a note in the report, not this record's).
    await page.goto('about:blank')
    const as = async (who: { username: string }) => { await signIn(page, who); return (await asMe(page, job.api, job.brief)).token }
    const edit = (token: string, audience: string) => page.request.post(`/s/${token}/patch-data`, {
      data: { patch: { audience }, agent: 'human', action: 'edit audience' },
    })
    const sign = async (words: string) => {
      const planner = await as(PEOPLE.planning)
      expect((await edit(planner, words)).status()).toBe(200)
      expect((await signBrief(page, { token: planner })).status()).toBe(200)
      const director = await as(PEOPLE.creativeDirector)
      expect((await lockBrief(page, { token: director })).status()).toBe(200)
      return director
    }
    let director = await sign('Version one audience.')
    for (const words of ['Version two audience.', 'Version three audience.']) {
      const unlock = await page.request.post(`/s/${director}/unapprove`, { data: { rationale: 'A new version.' } })
      expect(unlock.status(), await unlock.text()).toBe(200)
      director = await sign(words)
    }
    const lockOf = async () => (await chainOf(page, director)).filter(d => d.kind === 'approve')
    const signed = await lockOf()
    expect(signed).toHaveLength(3)

    await page.goto(`/#tool-${job.client}-brief`)
    await page.reload()
    await page.getByTestId('work-item').first().click()
    const rows = page.frameLocator('iframe').first().getByTestId('version-row') // the Versions fold in the Booth
    await page.frameLocator('iframe').first().locator('[data-testid="versions-fold"] > summary').click()
    await expect(rows.filter({ hasText: 'v1' })).toHaveCount(1)
    await expect(rows.filter({ hasText: 'v3' })).toContainText('Signed by')
    await rows.filter({ hasText: 'v2' }).getByRole('button', { name: 'Restore' }).click()
    await expect(rows.first()).toContainText('Restored from v2') // restore made a new version of the draft
    await expect(rows.filter({ hasText: 'v3' })).toHaveCount(1) // v3 is still in the history
    await expect(rows.filter({ hasText: 'locked' })).not.toHaveCount(0) // an approved version stays locked
    await expect(rows.filter({ hasText: 'v3' })).toContainText('Locked')
    expect(await lockOf()).toEqual(signed) // not one signature was touched
    const read = async (n: number | string) => ((await (await page.request.get(`/s/${director}/version?n=${n}`)).json()) as { parts: { audience: string } }).parts.audience
    expect(await read(3)).toBe('Version three audience.') // the signed words are as they were
    expect(await read('draft')).toBe('Version two audience.') // the draft has v2's
    const gate = await gateOf(page, { token: director })
    expect(gate.signed).toBe(true)
    expect(gate.changed_since_lock).toBe(true) // the restored draft is a new version to sign
    const restored = (await chainOf(page, director))[0]
    expect(restored.action).toBe('restore v2')
    expect(restored.actor ?? '').toContain(PEOPLE.creativeDirector.username) // restoring is attributed
    await ctx.close()
  })

  // A provider error: one plain line, the charge returned (crates/napkin-web/src/meter.rs), inputs kept, Try again works.
  test(t(15), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    const job = await seedJ001(page)
    // A brief with nothing in it opens on the ask, so a run can be started from it.
    const blank = await page.request.post(`${job.api}/documents`, { data: { app_id: 'ie.napkin.brief-maker', title: 'J001 blank brief', client_id: job.client } })
    expect(blank.status()).toBe(200)
    const before = (await sessionOf(page)).quota.used
    // The stand-in middleware (stack.mjs, port NAPKIN_E2E_MW_PORT) is told to fail the run, as a provider error would.
    const mw = `http://127.0.0.1:${process.env.NAPKIN_E2E_MW_PORT || '18081'}/control`
    await page.request.post(mw, { data: { state: 'failed', stage: 'provider error' } })
    try {
      await page.goto(`/#tool-${job.client}-brief`)
      await page.getByTestId('work-item').filter({ hasText: 'J001 blank brief' }).click()
      const app = page.frameLocator('iframe').first()
      const ask = 'Client A, an Irish whiskey, wants to reach drinkers aged 25 to 34.'
      await app.locator('#prompt').fill(ask)
      await app.getByRole('button', { name: 'Write the brief' }).click()
      const failed = app.locator('[data-state="run-failed"]') // said in the Booth
      await expect(failed).toBeVisible()
      expect((await failed.locator('.bs-line').allInnerTexts()).filter(Boolean)).toHaveLength(1) // one plain line
      await expect(failed).not.toContainText(/exception|stack|[{}]/i)
      await expect(failed).toContainText('The reserved estimate is returned')
      await expect.poll(async () => (await sessionOf(page)).quota.used).toBe(before) // the credits come back
      await expect(app.locator('body')).toContainText(ask) // the inputs stay
      // The provider is back: Try again runs it again, and that run is charged.
      await page.request.post(mw, { data: { state: 'running', stage: 'research' } })
      await failed.getByRole('button', { name: 'Try again' }).click()
      await expect(failed).toHaveCount(0)
      await expect.poll(async () => (await sessionOf(page)).quota.used).toBe(before + 1)
    } finally {
      await page.request.post(mw, { data: { state: 'running', stage: 'research' } })
    }
    await ctx.close()
  })

  test(t(16), async ({ browser }) => {
    test.skip(size.width < 1000, 'Cmd Z is the desktop width (v3.1, test 16)')
    const { ctx, page } = await open(browser, size)
    const job = await seedJ001(page)
    await page.goto(`/#tool-${job.client}-brief`)
    await page.getByTestId('work-item').first().click()
    const app = page.frameLocator('iframe').first()
    // A double click opens a part for writing in the brief's own editor; Ctrl+Enter is Done.
    await app.locator('#fields .row[data-clan-part="audience"]').dblclick()
    const field = app.getByRole('textbox', { name: /^Write / })
    await field.fill('An edit to undo.')
    await field.press('Control+Enter')
    await expect(app.locator('#fields')).toContainText('An edit to undo.')
    await expect.poll(() => barOffers(page, 'Undo')).toBe(true) // the shell took the edit: the bar offers Undo
    await app.locator('body').evaluate(() => window.focus()) // the key is pressed in the page again, not in the bar's field
    await page.keyboard.press('Meta+z')
    await expect(app.locator('#fields')).not.toContainText('An edit to undo.')
    await barCommand(page, 'Redo') // the undone text can be brought back
    await expect(app.locator('#fields')).toContainText('An edit to undo.')
    // Undo is itself attributed: the chain holds an edit by this person, not a missing entry.
    const chain = await chainOf(page, job.brief.token)
    const undone = chain.find(d => d.action?.startsWith('undo edit'))
    expect(undone?.kind).toBe('edit')
    expect(undone?.actor ?? '').not.toBe('')
    await ctx.close()
  })

  test(t(17), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signOff(page, job)
    await signIn(page, PEOPLE.accountService)
    // The agency's side: Share, Send the client copy opens the shell's own form, which makes the signed link for the
    // brief open in the frame and lists the links with Withdraw; the brief's Booth shows them under Record the client's answer.
    const booth = await openBrief(page, job, 'job')
    const form = await sendClientCopy(page)
    await form.getByLabel('Who it is for').fill('Someone else')
    await form.getByLabel('Their email').fill('someone@client-a.example')
    await form.getByRole('button', { name: 'Make the link' }).click()
    const first = new URL(await form.getByLabel('The client link').first().inputValue()).pathname
    await expect(booth.locator('#clientLinks [data-link-state="open"]')).toContainText('Someone else')
    await form.locator('li[data-state="open"]').getByRole('button', { name: 'Withdraw' }).click()
    await expect(form.locator('li[data-state="withdrawn"]')).toContainText('Withdrawn')
    await form.getByLabel('Who it is for').fill('Client A contact')
    await form.getByLabel('Their email').fill('contact@client-a.example')
    await form.getByRole('button', { name: 'Make the link' }).click()
    await expect(form.locator('li[data-state="open"]')).toContainText('Client A contact')
    const path = new URL(await form.getByLabel('The client link').first().inputValue()).pathname
    expect(path).not.toBe(first)
    await expect(booth.locator('#clientLinks [data-link-state="withdrawn"]')).toContainText('Someone else')
    const brief = await asMe(page, job.api, job.brief)
    const phone = await browser.newContext({ baseURL: rosterURL, viewport: { width: size.width, height: size.height } }) // no cookies, no account
    const cp = await phone.newPage()
    await cp.goto(path)
    await expect(cp.getByRole('heading', { name: 'Please confirm this brief' })).toBeVisible()
    // phone-sized, and the primary buttons are at least 44 px tall (the screen's one exception to the shell's heights)
    expect(await cp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    for (const name of ['Confirm this brief', 'Ask for changes']) {
      expect((await cp.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    // a clean copy: the brief's own words, no agent context, no decision but the one it answers
    const seen = await (await phone.request.get(`/c/${path.replace('/c/', '')}/view`)).json() as Record<string, unknown>
    expect(Object.keys(seen).sort()).toEqual(['agency', 'client', 'expires', 'html', 'ok', 'signed_by', 'state', 'summary', 'title', 'version'])
    const everything = JSON.stringify(seen)
    expect(everything).toContain(READY_BRIEF.single_minded_proposition)
    expect(everything, 'the planner\'s raw notes are not the client\'s to read').not.toContain(READY_BRIEF.brief_input)
    // the allow list: what the brief also keeps for the agency (capture, review, passages) is not shown
    expect(everything).toContain(READY_BRIEF.insight)
    for (const w of INTERNAL_WORDS) expect(everything, `the agency's ${w} is not the client's to read`).not.toContain(w)
    for (const d of await chainOf(page, brief.token)) expect(everything).not.toContain(d.id ?? 'no id')
    await cp.getByRole('button', { name: 'Confirm' }).click()
    await expect(cp.getByText('Thank you')).toBeVisible()
    expect(await phone.cookies(), 'the client was given no session').toHaveLength(0)
    const chain = await chainOf(page, brief.token)
    const reviews = chain.filter(d => d.kind === 'client_review' && d.action === 'client_answer')
    expect(reviews).toHaveLength(1)
    expect(reviews[0].version).toBe(chain.find(d => d.kind === 'approve')!.version) // that exact version
    expect(reviews[0].actor).toBe('client:contact@client-a.example') // the client, not staff
    expect((await gateOf(page, brief)).confirmed).toBe(true)
    // the link is used up: opening it again shows no brief, and no second decision lands
    await cp.reload()
    await expect(cp.getByTestId('client-link-gone')).toBeVisible()
    expect((await chainOf(page, brief.token)).filter(d => d.action === 'client_answer')).toHaveLength(1)
    // the withdrawn link opens nothing either
    await cp.goto(first)
    await expect(cp.getByTestId('client-link-gone')).toBeVisible()
    await phone.close()
    // and the Booth says the client confirmed
    const after = await openBrief(page, job, 'job')
    await expect(after.locator('#clientLinks [data-link-state="answered"]')).toContainText('confirmed')
    await ctx.close()
  })

  test(t(18), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning) // has not answered the consent question
    const job = await seedJ001(page, { ready: true, fresh: true })
    // The question is the first item of the desk's Worth a look list, once, and it covers nothing.
    await page.goto('/')
    await expect(page.getByTestId('desk')).toBeVisible()
    const worth = page.getByTestId('worth-a-look')
    await expect(worth.getByTestId('timesheet-ask')).toHaveCount(1)
    expect(await worth.locator('> *').first().getAttribute('data-testid'), 'the first item of the list').toBe('timesheet-ask')
    await expect(page.getByTestId('timesheet-ask')).toBeVisible()
    expect(await page.getByTestId('timesheet-ask').evaluate(el => getComputedStyle(el).position), 'in the flow, not over the page').toBe('static')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('#cl-row')).toBeVisible()
    await page.goto(`/#tool-${job.client}-brief`)
    await page.getByTestId('work-item').first().click()
    await page.waitForTimeout(3000) // long enough for a session, if one were being kept
    const { tenant } = await sessionOf(page)
    const r = await page.request.get(`/api/t/${tenant}/timesheet/sessions`)
    expect(r.status()).toBe(200)
    expect(await r.json()).toEqual([])
    await ctx.close()
  })
}
