// The visual brief (features/visual-brief.clan; build prompt v2 section 6): the creative director chooses a
// territory, a one-page visual brief is spun off from the signed, confirmed brief, and the creative director
// approves one exact version of it. Run at 390 and 1440 px on the real shell and the real server, with the
// Brief gate on (the roster stack). No model, no paid provider, no generated image: the frames are plain
// gradients made here, and nothing in this file calls a provider.
//
//   done_when 1  a territory chosen spins off a visual brief whose lineage names the brief and its version
//   done_when 2  the creative director approves one version and it locks: one approve, then a write is a 409
//   done_when 3  a later change is a new version, and the approved one stays
//   done_when 4  every image sits in a rectangle (no border-radius above 2 px on an img or video)
//   done_when 5  Territories uses no Cannes, Effie or WARC material (the engine's retrieval trace)
//
// Screenshots: set VISUAL_BRIEF_SHOTS=/some/dir to write a PNG of each new screen (docs/design/visual-brief/).

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { expect as baseExpect, test, type Browser, type BrowserContext, type FrameLocator, type Page } from '@playwright/test'
import { asMe, lockBrief, PEOPLE, READY_BRIEF, recordClientConfirmation, seedJ001, signBrief } from './seed/j001'

// Every step is a real round trip to the host and the page draws after it; a busy machine needs more than ten seconds.
const expect = baseExpect.configure({ timeout: 20_000 })

const HERE = dirname(fileURLToPath(import.meta.url))
const VISUAL_BRIEF = 'ie.napkin.visual-brief'
const SHOTS = process.env.VISUAL_BRIEF_SHOTS

type Size = { tag: string; width: number; height: number }
const SIZES: Size[] = [{ tag: '390', width: 390, height: 844 }, { tag: '1440', width: 1440, height: 900 }]
const rosterURL = `http://127.0.0.1:${process.env.NAPKIN_E2E_ROSTER_PORT || '18082'}`

type Decision = { id?: string; kind?: string; agent?: string; action?: string; actor?: string; version?: string; targets?: string[]; rationale?: string }
type Job = Awaited<ReturnType<typeof seedJ001>>

async function open(browser: Browser, size: Size): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, baseURL: rosterURL })
  await ctx.addInitScript(() => { try { localStorage.setItem('napkin.theme', 'white') } catch { /* not kept */ } })
  return { ctx, page: await ctx.newPage() }
}

async function signIn(page: Page, who: { username: string }) {
  expect((await page.request.post('/api/auth/sign-in', { data: { username: who.username } })).status(), `sign in as ${who.username}`).toBe(200)
}

const chainOf = async (page: Page, token: string): Promise<Decision[]> =>
  ((await (await page.request.get(`/s/${token}/chain`)).json()) as { decisions: Decision[] }).decisions

/** A plain gradient PNG, made here: no photograph, no product, no person, no brand. */
function gradientPng(w: number, h: number, from: [number, number, number], to: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const t = (x / (w - 1) + y / (h - 1)) / 2
      for (let c = 0; c < 3; c++) raw[y * (w * 3 + 1) + 1 + x * 3 + c] = Math.round(from[c] + (to[c] - from[c]) * t)
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/**
 * A brief that has passed the gate, been signed by the planner and the creative director and confirmed by the
 * client, in a client of its own. Leaves the creative director signed in.
 */
async function signedBrief(page: Page): Promise<Job & { brief: Job['brief'] & { token: string } }> {
  await signIn(page, PEOPLE.planning)
  const job = await seedJ001(page, { ready: true, fresh: true })
  expect((await signBrief(page, job.brief)).status()).toBe(200)
  await signIn(page, PEOPLE.creativeDirector)
  const mine = await asMe(page, job.api, job.brief)
  expect((await lockBrief(page, mine)).status()).toBe(200)
  // A token holds the version its document had when it was opened: open it again to answer the locked one.
  const locked = await asMe(page, job.api, job.brief)
  const confirmed = await recordClientConfirmation(page, locked)
  expect(confirmed.status(), await confirmed.text()).toBe(200)
  return { ...job, brief: locked }
}

/** The territory chosen on the Territories page, as the creative director does it. Lands on the visual brief. */
async function chooseTerritory(page: Page, job: Job, name = 'Permission to stop', line = 'The evening does not start until something says the day is over.') {
  await page.goto(`/#tool-${job.client}-territories`)
  await page.reload()
  await expect(page.getByTestId('territories-open')).toBeVisible()
  const form = page.getByTestId('choose-territory')
  await form.getByLabel('Territory', { exact: true }).fill(name)
  await form.getByLabel('In one line').fill(line)
  await form.getByRole('button', { name: 'Make the visual brief' }).click()
  await expect(frameOf(page).locator('[data-where="visual-brief"]')).toBeVisible({ timeout: 30_000 })
}

const frameOf = (page: Page): FrameLocator => page.frameLocator('iframe').first()

/** The visual brief the client has now: its path, its sandbox token and its manifest. */
async function visualBriefOf(page: Page, job: Job) {
  const listing = (await (await page.request.get(`${job.api}/library`)).json()) as { items: { path: string; app_id: string | null; client: { id: string } | null }[] }
  const item = listing.items.find(i => i.app_id === VISUAL_BRIEF && i.client?.id === job.client)
  expect(item, 'the visual brief is in the client\'s library').toBeTruthy()
  const view = (await (await page.request.get(`${job.api}/d/${encodeURIComponent(item!.path)}`)).json()) as {
    token: string; manifest: { id: string; document_id?: string }
  }
  // The lineage is the host's own view of it: what the page carried from its parent, and the parent's version.
  const up = (await (await page.request.get(`/s/${view.token}/upstream`)).json()) as {
    document_id: string
    carried: { document_id: string; last_decision?: string } | null
    upstream: { document_id: string; direct: boolean; title?: string; app_id?: string; version?: string; path?: string }[]
  }
  return { path: item!.path, token: view.token, manifest: view.manifest, docId: up.document_id, carried: up.carried, parent: up.upstream.find(u => u.direct) }
}

const approvalsOf = (chain: Decision[], docId: string) => chain.filter(d => d.kind === 'approve' && (d.targets ?? []).includes(docId))

async function shot(page: Page, name: string, size: Size) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  if (await page.locator('iframe').count()) await frameOf(page).locator('body').evaluate(() => window.scrollTo(0, 0))
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(SHOTS, `${name}-${size.tag}.png`), fullPage: size.width < 1000 })
}

for (const size of SIZES) {
  const t = (title: string) => `${title}, ${size.tag} px`

  // done_when 1
  test(t('choosing a territory spins off a visual brief whose lineage names the brief version and the territory'), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    await signIn(page, PEOPLE.planning)
    const job = await signedBrief(page)

    // Closed until the client has confirmed: a brief that has not passed the gate cannot be spun off.
    const early = await seedJ001(page, { ready: true, fresh: true })
    const refused = await page.request.post(`${early.api}/d/${encodeURIComponent(early.brief.path)}/spinoff`, { data: { app_id: VISUAL_BRIEF, title: 'Too early' } })
    expect(refused.status(), 'a brief that has not passed the gate makes no visual brief').toBe(409)

    await page.goto(`/#tool-${job.client}-territories`)
    await page.reload()
    await expect(page.getByTestId('territories-open')).toBeVisible()
    await shot(page, 'territories-choose', size)
    await chooseTerritory(page, job)
    const app = frameOf(page)
    await expect(app.locator('#tname')).toHaveText('Permission to stop')
    await expect(app.locator('.row[data-key="proposition"] .val')).toHaveText(READY_BRIEF.single_minded_proposition)
    await expect(app.locator('.row[data-key="tone"] li')).toHaveText(READY_BRIEF.tone_and_world)
    await expect(app.locator('.row[data-key="must_show"]')).toBeVisible()
    await expect(app.locator('.row[data-key="never_show"]')).toBeVisible()
    await shot(page, 'visual-brief-draft', size)

    // The lineage names the brief it answers and its version; the territory is attributed and names that version.
    const vb = await visualBriefOf(page, job)
    const carried = vb.carried
    expect(vb.parent?.app_id, 'the direct parent is the brief').toBe('ie.napkin.brief-maker')
    expect(vb.parent?.path, 'the brief it came from').toBe(job.brief.path)
    expect(carried?.document_id, 'what it carried is that brief').toBe(vb.parent?.document_id)
    expect(carried?.last_decision, 'the brief version it was at').toBeTruthy()
    const chain = await chainOf(page, vb.token)
    const chosen = chain.find(d => d.action === 'choose the territory')
    expect(chosen, 'the territory is one attributed decision').toBeTruthy()
    expect(chosen!.agent).toBe('human')
    expect(chosen!.rationale).toContain('Permission to stop')
    expect(chosen!.rationale).toContain(carried!.last_decision!.slice(0, 8))
    const data = await (await page.request.get(`${job.api}/d/${encodeURIComponent(vb.path)}/entry/data`)).text()
    expect(data).toContain('Permission to stop')
    expect(data).toContain('source: typed')
    expect(data).toContain(READY_BRIEF.single_minded_proposition)
    // Every write names an agent and an action.
    for (const d of chain.filter(x => x.id && x.targets?.includes(vb.docId))) {
      expect(d.agent, 'a write with no agent').toBeTruthy()
      expect(d.action, 'a write with no action').toBeTruthy()
    }
    await ctx.close()
  })

  // done_when 2 and 3
  test(t('the creative director approves one version and it locks; a change is a new version and the approved one stays'), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    const job = await signedBrief(page)
    await chooseTerritory(page, job)
    const vb = await visualBriefOf(page, job)
    const app = frameOf(page)

    // The planner is not the creative director: the button says why, and the host refuses.
    {
      const other = await browser.newContext({ viewport: { width: size.width, height: size.height }, baseURL: rosterURL })
      const op = await other.newPage()
      await signIn(op, PEOPLE.planning)
      const mine = await asMe(op, job.api, { path: vb.path, id: vb.manifest.id })
      const denied = await op.request.post(`/s/${mine.token}/approve`, { data: { rationale: 'Trying.' } })
      expect(denied.status()).toBe(403)
      await other.close()
    }
    expect(approvalsOf(await chainOf(page, vb.token), vb.docId)).toHaveLength(0)

    // One approve decision, naming the version, and the page locks.
    await expect(app.locator('#vnum')).toHaveText('1')
    await shot(page, 'visual-brief-approve', size)
    await app.getByRole('button', { name: 'Approve version 1' }).click()
    await expect(app.getByTestId('locked-stamp')).toContainText('Locked · version 1')
    await expect(app.getByRole('button', { name: /^Edit / })).toHaveCount(0)
    await shot(page, 'visual-brief-locked', size)
    const first = approvalsOf(await chainOf(page, vb.token), vb.docId)
    expect(first).toHaveLength(1)
    expect(first[0].actor ?? '').toContain(PEOPLE.creativeDirector.username)
    expect(first[0].version, 'the approve names the version it locked').toBeTruthy()

    // A write after it returns 409, for data and for an upload.
    const write = (patch: object) => page.request.post(`/s/${vb.token}/patch-data`, { data: { patch, agent: 'human', action: 'edit the proposition' } })
    expect((await write({ proposition: 'Changed after the lock.' })).status()).toBe(409)
    const up = await page.request.post(`/s/${vb.token}/upload-asset?name=late.png&agent=human`, { data: gradientPng(8, 8, [10, 20, 30], [200, 210, 220]) })
    expect(up.status()).toBe(409)

    // Reopen, edit, approve: both versions are in the history and the first is unchanged.
    await app.getByRole('button', { name: 'Start version 2' }).click()
    await expect(app.locator('#vnum')).toHaveText('2')
    await app.getByRole('button', { name: 'Edit Proposition' }).click()
    const ed = app.getByRole('textbox', { name: 'Write Proposition' })
    await ed.fill('The whiskey that waits.')
    await ed.press('Control+Enter')
    await expect(app.locator('.row[data-key="proposition"] .val')).toHaveText('The whiskey that waits.')
    await app.getByRole('button', { name: 'Approve version 2' }).click()
    await expect(app.getByTestId('locked-stamp')).toContainText('Locked · version 2')
    const both = approvalsOf(await chainOf(page, vb.token), vb.docId)
    expect(both).toHaveLength(2)
    const oldest = both.find(d => d.id === first[0].id)
    expect(oldest, 'the first approval is still in the history').toBeTruthy()
    expect(oldest).toEqual(first[0])
    const newest = both.find(d => d.id !== first[0].id)!
    expect(newest.version).not.toBe(first[0].version)
    await ctx.close()
  })

  // done_when 4
  test(t('every image on the page sits in a rectangle'), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    const job = await signedBrief(page)
    await chooseTerritory(page, job)
    const app = frameOf(page)
    const slots: [string, Buffer][] = [
      ['a', gradientPng(320, 180, [32, 36, 52], [244, 160, 96])],
      ['b', gradientPng(320, 180, [210, 220, 200], [60, 90, 70])],
      ['c', gradientPng(180, 320, [250, 240, 220], [150, 60, 40])],
    ]
    for (const [slot, buffer] of slots) {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), app.locator(`[data-add="${slot}"]`).click()])
      await chooser.setFiles({ name: `gradient-${slot}.png`, mimeType: 'image/png', buffer })
      await expect(app.locator(`.frame[data-slot="${slot}"] img`)).toBeVisible()
    }
    await app.locator('[data-cap="a"]').click()
    await app.getByRole('textbox', { name: 'Write caption for frame 1' }).fill('Warm light across a plain table')
    await app.locator('[data-capdone="a"]').click()
    await expect(app.locator('.frame[data-slot="a"] .cap')).toHaveText('Warm light across a plain table')
    await expect(app.locator('.frame img')).toHaveCount(3)
    await expect.poll(() => app.locator('.frame img').evaluateAll(imgs => imgs.every(i => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)), { message: 'the three images load' }).toBe(true)
    const radii = await app.locator('body').evaluate(() => [...document.querySelectorAll('img, video, .frame .box')].map(el => {
      const cs = getComputedStyle(el)
      return { tag: el.tagName, tl: parseFloat(cs.borderTopLeftRadius), tr: parseFloat(cs.borderTopRightRadius), bl: parseFloat(cs.borderBottomLeftRadius), br: parseFloat(cs.borderBottomRightRadius), loaded: el instanceof HTMLImageElement ? el.naturalWidth > 0 : true }
    }))
    expect(radii.length).toBeGreaterThanOrEqual(6)
    for (const r of radii) {
      expect(Math.max(r.tl, r.tr, r.bl, r.br), `${r.tag} corner`).toBeLessThanOrEqual(2)
      expect(r.loaded, 'the image loaded').toBe(true)
    }
    await shot(page, 'visual-brief-frames', size)
    // They are kept: reopening shows them, and a frame can be removed again.
    await page.goto('/')
    await page.goto(`/#tool-${job.client}-territories`)
    await page.reload()
    await page.getByTestId('visual-briefs').getByRole('button').first().click()
    await expect(frameOf(page).locator('.frame img')).toHaveCount(3)
    await frameOf(page).locator('[data-drop="c"]').click()
    await expect(frameOf(page).locator('.frame img')).toHaveCount(2)
    await ctx.close()
  })

  // The Changed brief state: the brief moved on after the visual brief was made from it.
  test(t('a brief that changes after the visual brief was made says so, and the approved version keeps what it was made from'), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    const job = await signedBrief(page)
    await chooseTerritory(page, job)
    const vb = await visualBriefOf(page, job)
    const app = frameOf(page)
    await app.getByRole('button', { name: 'Approve version 1' }).click()
    await expect(app.getByTestId('locked-stamp')).toBeVisible()

    // The brief is reopened by the creative director and changed: version 2 of the brief.
    expect((await page.request.post(`/s/${job.brief.token}/unapprove`, { data: { rationale: 'The client moved the line.' } })).status()).toBe(200)
    expect((await page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: { single_minded_proposition: 'A new line from the client.' }, agent: 'human', action: 'edit the proposition' } })).status()).toBe(200)

    await page.goto('/')
    await page.goto(`/#tool-${job.client}-territories`)
    await page.reload()
    await page.getByTestId('visual-briefs').getByRole('button').first().click()
    const changed = page.locator('[data-state="changed-brief"]')
    await expect(changed).toBeVisible({ timeout: 30_000 })
    await expect(changed).toContainText('The brief changed to')
    await expect(changed).toContainText('approved and stays as it is')
    await shot(page, 'visual-brief-changed-brief', size)
    // The approved version did not move: its page still says what it was made from, and one approve stands.
    await expect(frameOf(page).locator('.row[data-key="proposition"] .val')).toHaveText(READY_BRIEF.single_minded_proposition)
    expect(approvalsOf(await chainOf(page, vb.token), vb.docId)).toHaveLength(1)
    await ctx.close()
  })

  // The page itself, scanned on its own: the shell's scan leaves app frames out, so the visual brief has its own.
  test(t('axe finds nothing serious on the visual brief page, light and dark, draft and approved'), async ({ browser }) => {
    const { default: AxeBuilder } = await import('@axe-core/playwright')
    const { ctx, page } = await open(browser, size)
    const job = await signedBrief(page)
    await chooseTerritory(page, job)
    const frameUrl = frameOf(page).owner() && (await page.locator('iframe').first().getAttribute('src'))
    expect(frameUrl, 'the app frame has an address').toBeTruthy()
    const problems: string[] = []
    const scan = async (label: string) => {
      for (const scheme of ['light', 'dark'] as const) {
        const own = await ctx.newPage()
        await own.setViewportSize({ width: size.width, height: size.height })
        await own.emulateMedia({ colorScheme: scheme })
        await own.goto(new URL(frameUrl!, page.url()).toString())
        await expect(own.locator('#tname')).toBeVisible()
        await own.waitForTimeout(500)
        const found = (await new AxeBuilder({ page: own }).analyze()).violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
        problems.push(...found.map(v => `${label} ${scheme}: ${v.id} ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`))
        await own.close()
      }
    }
    await scan('draft')
    await frameOf(page).getByRole('button', { name: 'Approve version 1' }).click()
    await expect(frameOf(page).getByTestId('locked-stamp')).toBeVisible()
    await scan('approved')
    expect(problems).toEqual([])
    await ctx.close()
  })

  // done_when 5
  test(t('Territories uses no Cannes, Effie or WARC material: the retrieval trace has no such hit'), async () => {
    // The engine's own mix path over stand-in rows (seed/visual-brief/territoryTrace.py), as test 12 does for the
    // brief: no index, no model, no network. A Territories run excludes the three sources the owner keeps out of
    // every retrieval (Laurence, 10 Nov 2026), and a store that ignores the filter is still caught on the way out.
    const dir = mkdtempSync(join(tmpdir(), 'visual-brief-trace-'))
    try {
      const brief = join(dir, 'brief.json')
      writeFileSync(brief, JSON.stringify(READY_BRIEF))
      const trace = (...extra: string[]) => JSON.parse(execFileSync('uv', [
        'run', '-q', '--no-project', '--python', '3.12', ...['numpy', 'requests', 'httpx', 'pypdf', 'pdfplumber', 'python-docx', 'PyYAML', 'python-dotenv'].flatMap(d => ['--with', d]),
        'python', join(HERE, 'seed/visual-brief/territoryTrace.py'), brief, ...extra,
      ], { cwd: join(HERE, '../../engine/rag'), encoding: 'utf8', env: { ...process.env, BRIEF_TESTS_OFFLINE: '1' } })) as {
        source_of: Record<string, Record<string, string>>; egress: { on: string; source?: string }[]
      }
      const served = (r: ReturnType<typeof trace>) => Object.values(r.source_of).flatMap(f => Object.values(f))
      const kept = /^(cannes|effie|warc)$/i
      const clean = trace('--territories')
      expect(served(clean).length, 'the trace records each hit with its source').toBeGreaterThan(0)
      expect(served(clean).filter(s => kept.test(s))).toEqual([])
      expect(clean.egress, 'the filter held, so nothing was caught on the way out').toEqual([])
      const leaky = trace('--territories', '--ignore-filter')
      expect(served(leaky).filter(s => kept.test(s))).toEqual([])
      expect([...new Set(leaky.egress.filter(e => e.on === 'source').map(e => e.source))].sort()).toEqual(['cannes', 'effie', 'warc'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
