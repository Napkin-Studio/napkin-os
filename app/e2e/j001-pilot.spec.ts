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
import { lockBrief, PEOPLE, READY_BRIEF, seedJ001 } from './seed/j001'

const HERE = dirname(fileURLToPath(import.meta.url))

type Size = { tag: string; width: number; height: number }
const SIZES: Size[] = [{ tag: '390', width: 390, height: 844 }, { tag: '1440', width: 1440, height: 900 }]

/** Each test: its title, and the feature record that turns it on (null: it runs now). */
const TESTS: Record<number, { title: string; slug: string | null }> = {
  1: { title: 'each live role sees its own doors', slug: 'roles-and-homes' },
  2: { title: 'Planning gets 403 on Scope and estimates', slug: 'roles-and-homes' },
  3: { title: 'the creative director signs the brief with one approve decision', slug: 'brief-gate' },
  4: { title: 'editing after approval makes a new version and a Changed brief alert', slug: 'brief-gate' },
  5: { title: 'the dashboard shows a J001 stage change within 10 seconds', slug: 'job-index-dashboard' },
  6: { title: 'five logos repaint the accent and it passes contrast in all three modes', slug: null },
  7: { title: 'axe finds nothing serious on every Phase 1 page in all three modes', slug: null },
  8: { title: 'a canary key set on the server never reaches the browser', slug: null },
  9: { title: 'each confirmed timesheet line links to its sessions', slug: 'timesheet-sessions' },
  10: { title: 'the brief passes the gate and the client confirms it before Territories open', slug: 'brief-gate' },
  11: { title: 'every write in the J001 documents is attributed', slug: null },
  12: { title: 'the J001 brief retrieval trace has no source cannes hit', slug: null },
  13: { title: 'a failed save keeps the text, Try again saves it, and reopening shows it', slug: null },
  14: { title: 'restoring v2 keeps v3 and the approved version locked', slug: 'brief-versions-undo' },
  15: { title: 'a provider error shows one line, returns credits, keeps inputs, and Try again works', slug: 'screen-states' },
  16: { title: 'Cmd Z undoes the last brief edit and the text comes back', slug: 'brief-versions-undo' },
  17: { title: 'the client confirms the brief link on a phone with no account', slug: 'client-confirm-link' },
  18: { title: 'no consent means no captured sessions', slug: 'timesheet-sessions' },
}

const DOORS = {
  planning: ['Brief', 'Research', 'Territories', 'Client brains', 'Presentations'],
  creativeDirector: ['Ideas', 'Ready for review', 'Judge scores', 'Approved work', 'Direction notes'],
  accountService: ['Clients', 'Live jobs', 'Approvals', 'Scope and estimates', 'Presentations'],
  management: ['Agency dashboard', 'Live jobs', 'Time and money', 'Clients', 'Traffic board'],
} as const
const MODES = ['white', 'grey', 'black'] as const

type Decision = { kind?: string; agent?: string; action?: string; edited_by?: string; version?: string; actor?: string; source?: string }

async function open(browser: Browser, size: Size, mode: string = 'white'): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 })
  await ctx.addInitScript(m => { try { localStorage.setItem('napkin.theme', m) } catch { /* not kept */ } }, mode)
  return { ctx, page: await ctx.newPage() }
}

/** Sign in as a placeholder person (needs the roster stack, NAPKIN_E2E_ROSTER=1). */
async function signIn(page: Page, who: { username: string }) {
  const r = await page.request.post('/api/auth/sign-in', { data: { username: who.username } })
  expect(r.status(), `sign in as ${who.username}`).toBe(200)
}

const chainOf = async (page: Page, token: string): Promise<Decision[]> =>
  ((await (await page.request.get(`/s/${token}/chain`)).json()) as { decisions: Decision[] }).decisions

const sessionOf = async (page: Page) =>
  (await (await page.request.get('/api/session')).json()) as { tenant: string; quota: { used: number; cap: number } }

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))

/** WCAG contrast of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

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

/** The three papers the page really draws, as #rrggbb: what --desk, --paper and --card resolve to. */
async function papers(page: Page): Promise<string[]> {
  const rgb = await page.evaluate(() => ['--desk', '--paper', '--card'].map(v => {
    const probe = document.createElement('div')
    probe.style.background = `var(${v})`
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).backgroundColor
    probe.remove()
    // Chrome writes a mixed colour as color(srgb r g b) with 0 to 1 channels, a plain one as rgb(r, g, b).
    const n = (c.match(/-?[\d.]+/g) ?? []).slice(0, 3).map(Number)
    return c.startsWith('color(') ? n.map(x => Math.round(x * 255)) : n
  }))
  return rgb.map(c => '#' + c.map(x => x.toString(16).padStart(2, '0')).join(''))
}

/** Five flat logos in five hues, and one black and white (the fixtures of test 6). */
const LOGOS = [
  ...['#d6402f', '#2f6fd6', '#2fa36b', '#8a3fd1', '#d19a1f'].map(c => ({ name: c, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="${c}"/></svg>`, accent: true })),
  { name: 'black and white', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#fff"/><circle cx="32" cy="32" r="28" fill="#000"/></svg>', accent: false },
]

for (const size of SIZES) {
  const t = (n: number) => `${n} ${TESTS[n].title}, ${size.tag} px`

  // 1 to 12: as written in v2 section 10.

  test.fixme(t(1), async ({ browser }) => {
    for (const [role, doors] of Object.entries(DOORS)) {
      const { ctx, page } = await open(browser, size)
      await signIn(page, PEOPLE[role as keyof typeof PEOPLE])
      await page.goto('/')
      const shown = page.getByTestId('door')
      await expect(shown).toHaveCount(doors.length)
      expect(await shown.allInnerTexts()).toEqual([...doors])
      await ctx.close()
    }
  })

  test.fixme(t(2), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true })
    const r = await page.request.get(`${job.api}/jobs/J001/scope`)
    expect(r.status()).toBe(403)
    await ctx.close()
  })

  test.fixme(t(3), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    await signIn(page, PEOPLE.creativeDirector)
    const job = await seedJ001(page, { ready: true })
    expect((await lockBrief(page, job.brief, 'Signed.')).status()).toBe(200)
    const approvals = (await chainOf(page, job.brief.token)).filter(d => d.kind === 'approve')
    expect(approvals).toHaveLength(1)
    expect(approvals[0].actor ?? '').toContain(PEOPLE.creativeDirector.username)
    await ctx.close()
  })

  test.fixme(t(4), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    await signIn(page, PEOPLE.creativeDirector)
    const job = await seedJ001(page, { ready: true })
    await lockBrief(page, job.brief)
    const signed = (await chainOf(page, job.brief.token)).find(d => d.kind === 'approve')!.version
    const edit = await page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: { single_minded_proposition: 'A new line.' } } })
    expect(edit.status()).toBe(200)
    const after = await chainOf(page, job.brief.token)
    expect(after.find(d => d.kind === 'approve')!.version).toBe(signed) // the signed version stays as it was
    expect(after.some(d => d.kind === 'edit' && d.version !== signed)).toBe(true) // a new version, in the chain
    await page.goto('/')
    await expect(page.getByTestId('alert').filter({ hasText: 'Changed brief' })).toBeVisible()
    await ctx.close()
  })

  test.fixme(t(5), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    await signIn(page, PEOPLE.management)
    const job = await seedJ001(page, { ready: true })
    await page.goto('/#dashboard')
    await expect(page.getByTestId('tile-stage')).toContainText('Brief')
    const moved = await page.request.post(`${job.api}/jobs/J001/stage`, { data: { stage: 'Ideas' } })
    expect(moved.status()).toBe(200)
    await expect(page.getByTestId('tile-stage')).toContainText('Ideas', { timeout: 10_000 })
    await ctx.close()
  })

  test(t(6), async ({ browser }) => {
    // The accent is sampled in the browser from the uploaded logo (Agency look, in the account
    // menu), saved for the agency, and set per mode. Each mode is checked on the papers the page
    // really draws (--desk, --paper, --card), not on a table kept in this file.
    for (const logo of LOGOS) {
      const up = await open(browser, size, 'white')
      await signIn(up.page, { username: 'ann@napkin' }) // an admin
      await up.page.goto('/')
      await up.page.getByTestId('account-button').click()
      await up.page.getByRole('menuitem', { name: /Agency look/ }).click()
      await up.page.getByTestId('look-file').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(logo.svg) })
      await expect(up.page.getByTestId('look-note'), logo.name).toContainText('Saved')
      await expect(up.page.getByTestId(logo.accent ? 'look-accents' : 'look-no-accent'), logo.name).toBeVisible()
      await up.ctx.close()

      for (const mode of MODES) {
        const { ctx, page } = await open(browser, size, mode)
        await signIn(page, { username: 'ann@napkin' })
        await page.goto('/')
        await expect(page.getByTestId('os-bar')).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('data-mode', mode)
        const token = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--agency-accent').trim())
        if (logo.accent) {
          await expect.poll(token, { message: `accent for ${logo.name} in ${mode}` }).toMatch(/^#[0-9a-f]{6}$/i)
          const accent = await token()
          for (const paper of await papers(page)) {
            expect(contrast(accent, paper), `${accent} on ${paper} in ${mode}`).toBeGreaterThanOrEqual(4.5)
          }
        } else {
          // The saved look has been read once the signed-in desk has settled; give it a moment, then check it stayed empty.
          await page.waitForLoadState('networkidle')
          expect(await token(), `the black and white logo gives no accent in ${mode}`).toBe('')
        }
        await ctx.close()
      }
    }
  })

  test(t(7), async ({ browser }) => {
    const { default: AxeBuilder } = await import('@axe-core/playwright')
    // The Phase 1 pages that exist on this branch: the desk, the clients page, a client, its Brief
    // page, and the Agency look panel. The pages other records build (gate, dashboard, timesheet,
    // visual brief) join this list when they land. The app frame is a document with its own paper
    // (the apps are restyled in their own records), so it is left out of the scan.
    const problems: string[] = []
    for (const mode of MODES) {
      const { ctx, page } = await open(browser, size, mode)
      await signIn(page, { username: 'ann@napkin' })
      const job = await somethingToRead(page)
      const pages: [string, () => Promise<void>][] = [
        ['desk', async () => { await page.goto('/#agency'); await page.reload(); await expect(page.getByTestId('os-bar')).toBeVisible() }],
        ['clients', async () => { await page.goto('/#clients'); await page.reload(); await expect(page.getByTestId('os-bar')).toBeVisible() }],
        ['client', async () => { await page.goto(`/#client-${job.client}`); await page.reload(); await expect(page.getByTestId('os-bar')).toBeVisible() }],
        ['brief page', async () => { await page.goto(`/#tool-${job.client}-brief`); await page.reload(); await expect(page.getByTestId('work-item').first()).toBeVisible() }],
        ['agency look', async () => {
          await page.goto('/#agency'); await page.reload()
          await page.getByTestId('account-button').click()
          await page.getByRole('menuitem', { name: /Agency look/ }).click()
          await expect(page.getByTestId('agency-look')).toBeVisible()
        }],
      ]
      for (const [name, show] of pages) {
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

  test.fixme(t(9), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true })
    await page.request.post(`${job.api}/timesheet/consent`, { data: { consent: true } })
    await page.goto(`/#tool-${job.client}-brief`)
    await page.getByTestId('work-item').first().click()
    await page.waitForTimeout(3000) // a work session while the brief is open and in focus
    await page.goto('/#timesheet')
    await page.getByRole('button', { name: 'Confirm my day' }).click()
    const lines = page.getByTestId('timesheet-line')
    await expect(lines.first()).toBeVisible()
    for (const line of await lines.all()) await expect(line.getByTestId('line-sessions')).not.toHaveCount(0)
    await ctx.close()
  })

  test.fixme(t(10), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true })
    await page.goto(`/#tool-${job.client}-territories`)
    await expect(page.getByTestId('territories-closed')).toBeVisible() // not passed, not confirmed
    await page.goto(`/#tool-${job.client}-brief`)
    await page.getByTestId('work-item').first().click()
    await page.getByRole('button', { name: 'Check the brief' }).click()
    await expect(page.getByTestId('gate-item')).toHaveCount(6)
    await expect(page.getByTestId('gate-item').filter({ hasText: 'missing' })).toHaveCount(0)
    await signIn(page, PEOPLE.creativeDirector)
    expect((await lockBrief(page, job.brief)).status()).toBe(200)
    await page.goto(`/#tool-${job.client}-territories`)
    await expect(page.getByTestId('territories-closed')).toBeVisible() // passed, signed, not yet confirmed by the client
    const link = (await (await page.request.post(`${job.api}/d/${job.brief.id}/client-link`)).json() as { url: string }).url
    const client = await browser.newContext()
    const cp = await client.newPage()
    await cp.goto(link)
    await cp.getByRole('button', { name: 'Confirm' }).click()
    await client.close()
    await page.goto(`/#tool-${job.client}-territories`)
    await expect(page.getByTestId('territories-closed')).toHaveCount(0)
    await ctx.close()
  })

  test(t(11), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    const job = await seedJ001(page, { ready: true })
    // Only the brief is written to by the seed; the research and the deck are made and left empty, so their
    // chains hold nothing to check yet. Whatever any of them holds must be attributed.
    expect((await chainOf(page, job.brief.token)).length, 'the seed left a chain on the brief').toBeGreaterThan(0)
    for (const doc of [job.brief, job.research, job.deck]) {
      const chain = await chainOf(page, doc.token)
      for (const d of chain) {
        expect(d.agent, 'a write with no agent').toBeTruthy()
        expect(d.action, 'a write with no action').toBeTruthy()
        if (d.agent === 'human') expect(d.edited_by).toBe('human')
      }
    }
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

  test.fixme(t(14), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    await signIn(page, PEOPLE.creativeDirector)
    const job = await seedJ001(page, { ready: true })
    const edit = (v: string) => page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: { audience: v } } })
    await edit('Version two audience.')
    await edit('Version three audience.')
    await page.goto(`/#tool-${job.client}-brief`)
    await page.getByTestId('work-item').first().click()
    await page.getByRole('button', { name: 'Version history' }).click()
    await page.getByTestId('version-row').filter({ hasText: 'v2' }).getByRole('button', { name: 'Restore' }).click()
    const rows = page.getByTestId('version-row')
    await expect(rows.filter({ hasText: 'v3' })).toHaveCount(1) // v3 is still in the history
    await expect(rows.first()).toContainText('Restored from v2') // restore made a new version
    await lockBrief(page, job.brief)
    await expect(rows.filter({ hasText: 'locked' })).not.toHaveCount(0) // an approved version stays locked
    expect((await edit('Edit after the lock.')).status()).toBe(409)
    await ctx.close()
  })

  // Waits on screen-states and the server: the shell says "the reserved estimate is returned", but nothing
  // returns it. The web meter (crates/napkin-web/src/meter.rs) charges a run when it is sent and never gives the
  // charge back, so quota.used stays up after a failed run. Everything else in this test passes today and runs in
  // runFailed.spec.ts; this one keeps the credit line and comes on when the meter returns a failed run's charge.
  test.fixme(t(15), async ({ browser }) => {
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
      await app.locator('#prompt').fill('Client A, an Irish whiskey, wants to reach drinkers aged 25 to 34.')
      await app.getByRole('button', { name: 'Write the brief' }).click()
      const failed = page.locator('[data-state="run-failed"]')
      await expect(failed).toBeVisible()
      expect((await sessionOf(page)).quota.used).toBe(before) // the credits come back
    } finally {
      await page.request.post(mw, { data: { state: 'running', stage: 'research' } })
    }
    await ctx.close()
  })

  test.fixme(t(16), async ({ browser }) => {
    test.skip(size.width < 1000, 'Cmd Z is the desktop width (v3.1, test 16)')
    const { ctx, page } = await open(browser, size)
    const job = await seedJ001(page)
    await page.goto(`/#tool-${job.client}-brief`)
    await page.getByTestId('work-item').first().click()
    const app = page.frameLocator('iframe').first()
    const field = app.locator('#fields .row[data-clan-part="audience"] [contenteditable]').first()
    await field.fill('An edit to undo.')
    await field.blur()
    await page.keyboard.press('Meta+z')
    await expect(app.locator('#fields')).not.toContainText('An edit to undo.')
    await page.getByRole('button', { name: 'Redo' }).click() // the undone text can be brought back
    await expect(app.locator('#fields')).toContainText('An edit to undo.')
    await ctx.close()
  })

  test.fixme(t(17), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    await signIn(page, PEOPLE.accountService)
    const job = await seedJ001(page, { ready: true })
    await signIn(page, PEOPLE.creativeDirector)
    await lockBrief(page, job.brief)
    await signIn(page, PEOPLE.accountService)
    const link = (await (await page.request.post(`${job.api}/d/${job.brief.id}/client-link`)).json() as { url: string }).url
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } }) // no cookies, no account
    const cp = await phone.newPage()
    await cp.goto(link)
    await cp.getByRole('button', { name: 'Confirm' }).click()
    await expect(cp.getByText('Thank you')).toBeVisible()
    const reviews = (await chainOf(page, job.brief.token)).filter(d => d.kind === 'client_review')
    expect(reviews).toHaveLength(1)
    expect(reviews[0].version).toBe((await chainOf(page, job.brief.token)).find(d => d.kind === 'approve')!.version) // that exact version
    await phone.close()
    await ctx.close()
  })

  test.fixme(t(18), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    await signIn(page, PEOPLE.planning) // has not answered the consent question
    const job = await seedJ001(page, { ready: true })
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
