// Phase 2 acceptance, record `napkin-brain` (features/j001-phase2-suite.clan): tests 65 to 69 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Written before the screen exists, so each body is marked `test.fixme`: the registry (phase2/tests.mjs) names this record as the one
// that turns it on, and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(napkin-brain) are guesses from
// the design (selectors, routes, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read
// through the document's chain and the API do not move with the screen and are the part to keep.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.
//
// The Napkin Brain (features/napkin-brain.clan): routes GET /api/t/{tenant}/client-brains/{client}/pages, /pages/{slug}, /index.md, /log.md,
// /search?q=, the same under /agency-brain, and POST /api/t/{tenant}/brain/ingest. A page's lines each cite {doc, decision} or {fact}.

import { expect, test, type Page } from '@playwright/test'
import { asMe, lockBrief, makeClientLink, PEOPLE, seedJ001, signBrief } from './seed/j001'
import { chainOf, control, middlewareLog, open, rosterURL, SIZES, signIn } from './pilot'
import { CANARY_SENTENCE } from './seed/j001/p2/wall.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

type Seeded = Awaited<ReturnType<typeof seedJ001>>
type Line = { id: string; kind: string; text: string; cites: { doc: string; decision: string }[]; state: string; superseded_by: string | null }
type BrainPage = { slug: string; type: string; title: string; verified?: boolean; lines: Line[] }

const brain = (job: Seeded, tail = '') => `${job.api}/client-brains/${job.client}${tail}`
const pagesOf = async (page: Page, job: Seeded) => (await (await page.request.get(brain(job, '/pages'))).json()) as BrainPage[]
const ingest = (page: Page, job: Seeded) => page.request.post(`${job.api}/brain/ingest`)

/** J001 with the brief signed, locked and (optionally) confirmed by the client, so there is accepted work for the brain to learn. */
async function approved(page: Page, job: Seeded, confirmed: boolean, browser?: import('@playwright/test').Browser) {
  await signIn(page, PEOPLE.planning)
  await signBrief(page, job.brief)
  await signIn(page, PEOPLE.creativeDirector)
  expect((await lockBrief(page, await asMe(page, job.api, job.brief))).status()).toBe(200)
  if (confirmed) {
    await signIn(page, PEOPLE.accountService)
    const link = await makeClientLink(page, job.api, job.brief)
    const phone = await browser!.newContext({ baseURL: rosterURL })
    expect((await phone.request.post(`${link.path}/answer`, { data: { answer: 'accepted' } })).status()).toBe(200) // ADJUST(napkin-brain)
    await phone.close()
  }
}

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.fixme(t(65), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await approved(page, job, false)
    await signIn(page, PEOPLE.agencyBrain)
    const log = await (await page.request.get(brain(job, '/log.md'))).text()
    expect((await ingest(page, job)).status()).toBe(200)
    const pages = await pagesOf(page, job)
    expect(pages.length).toBeGreaterThan(0)
    // Each page cites an entry in a decision chain: the cited decision is in the document's chain.
    const briefChain = (await chainOf(page, (await asMe(page, job.api, job.brief)).token)).map(d => d.id)
    for (const p of pages) for (const l of p.lines) for (const c of l.cites) if (c.doc === 'brief') expect(briefChain).toContain(c.decision)
    expect(await (await page.request.get(brain(job, '/index.md'))).text()).toContain(pages[0].title) // the index lists them
    expect((await (await page.request.get(brain(job, '/log.md'))).text()).length).toBeGreaterThan(log.length) // the log has grown
    await ctx.close()
  })

  test.fixme(t(66), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await approved(page, job, false)
    await signIn(page, PEOPLE.agencyBrain)
    await ingest(page, job)
    const route = (await pagesOf(page, job)).find(p => p.type === 'idea')
    expect(route, 'the chosen route is on a page labelled an idea').toBeTruthy()
    expect(route!.verified).not.toBe(true) // not yet accepted by the client
    // After the client accepts, a page built from accepted work carries the verified mark.
    await approved(page, job, true, browser)
    await signIn(page, PEOPLE.agencyBrain)
    await ingest(page, job)
    expect((await pagesOf(page, job)).some(p => p.verified === true)).toBe(true)
    await ctx.close()
  })

  test.fixme(t(67), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: { background: CANARY_SENTENCE }, agent: 'j001-seed', action: 'seed: canary in the brief' } })
    await approved(page, job, false)
    await signIn(page, PEOPLE.agencyBrain)
    await ingest(page, job)
    // Client A's pages are not in Client B's brain.
    const other = await page.request.post(`${job.api}/clients`, { data: { name: 'Client B' } })
    const b = other.status() === 201 ? ((await other.json()) as { id: string }).id : ''
    expect(JSON.stringify(await (await page.request.get(`${job.api}/client-brains/${b}/pages`)).json())).not.toContain('Client A')
    // Nor in a second agency's.
    await signIn(page, PEOPLE.otherAgency)
    const second = (await (await page.request.get('/api/session')).json()) as { tenant: string }
    expect((await page.request.get(`/api/t/${second.tenant}/client-brains/${job.client}/pages`)).status()).not.toBe(200)
    // A role with no right to client brains gets 403.
    await signIn(page, PEOPLE.copywriter)
    expect((await page.request.get(brain(job, '/pages'))).status()).toBe(403)
    // The agency's own brain holds no client text.
    await signIn(page, PEOPLE.agencyBrain)
    const own = await (await page.request.get(`${job.api}/agency-brain/pages`)).text()
    expect(own).not.toContain(CANARY_SENTENCE)
    expect(own).not.toContain('Client A')
    await ctx.close()
  })

  test.fixme(t(68), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await approved(page, job, false)
    await signIn(page, PEOPLE.agencyBrain)
    await ingest(page, job)
    const lines = async () => (await pagesOf(page, job)).flatMap(p => p.lines)
    const count = (await lines()).length
    await ingest(page, job) // running the ingest twice adds nothing
    expect((await lines()).length).toBe(count)
    // A fact changes: the old line is marked superseded with a link, and both remain.
    await signIn(page, PEOPLE.planning)
    await page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: { audience: 'Drinkers aged 30 to 40.' }, agent: 'human', action: 'edit the audience' } })
    await signIn(page, PEOPLE.agencyBrain)
    await ingest(page, job)
    const after = await lines()
    const old = after.find(l => l.state === 'superseded')
    expect(old?.superseded_by, 'the old line links to its replacement').toBeTruthy()
    expect(after.some(l => l.id === old!.superseded_by && l.state === 'current')).toBe(true)
    expect(after.length).toBeGreaterThan(count)
    await ctx.close()
  })

  test.fixme(t(69), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await approved(page, job, false)
    await signIn(page, PEOPLE.agencyBrain)
    await ingest(page, job)
    // A keyword search finds the page with no model.
    const before = (await middlewareLog(page)).length
    const hits = (await (await page.request.get(brain(job, '/search?q=proposition'))).json()) as { slug: string }[]
    expect(hits.length).toBeGreaterThan(0)
    expect((await middlewareLog(page)).length).toBe(before)
    // Ask the brain answers in two lines that link the page and the chain entry (answers/ask_brain.json).
    await page.goto(`/#brain-${job.client}`); await page.reload() // ADJUST(napkin-brain)
    await page.getByTestId('ask-brain-input').fill('Who does Client A sell to first?')
    await page.getByRole('button', { name: 'Ask' }).click()
    const answer = page.getByTestId('brain-answer')
    await expect(answer.locator('p, li')).toHaveCount(2)
    await expect(answer.getByRole('link')).not.toHaveCount(0)
    // When it does not know, it says so (answers/ask_brain.unknown.json).
    await control(page, { variant: { ask_brain: 'unknown' } })
    await page.getByRole('button', { name: 'Ask' }).click()
    await expect(page.getByTestId('brain-answer')).toContainText(/does not know/i)
    await ctx.close()
  })
}
