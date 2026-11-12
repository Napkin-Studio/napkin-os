// Phase 2 acceptance, record `timesheet-signals` (features/j001-phase2-suite.clan): tests 43 and 44 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Written before the screen exists, so each body is marked `test.fixme`: the registry (phase2/tests.mjs) names this record as the one
// that turns it on, and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(timesheet-signals) are guesses from
// the design (selectors, routes, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read
// through the document's chain and the API do not move with the screen and are the part to keep.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.

import { expect, test } from '@playwright/test'
import { open, SIZES, signIn } from './pilot'
import { PEOPLE, seedJ001 } from './seed/j001'
import { FIXTURE_MEETING } from './seed/j001/p2/timesheet-signals.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

type Signal = { signal: string; consent: boolean; connected: boolean }

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.fixme(t(43), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter2)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const day = async () => (await (await page.request.get(`${job.api}/timesheet/day?date=2026-11-12`)).json()) as { status: string; lines: { source: string; signal_ids: string[]; title?: string }[] }
    // No consent for calendar: a refresh captures nothing.
    await page.request.post(`${job.api}/timesheet/signals/calendar/refresh`)
    expect((await day()).lines.filter(l => l.source === 'calendar')).toEqual([])
    // With consent, the fixture meeting becomes a draft line; nothing is submitted for the person.
    expect((await page.request.post(`${job.api}/timesheet/signals/calendar/consent`, { data: { yes: true } })).status()).toBe(200)
    await page.request.post(`${job.api}/timesheet/signals/calendar/refresh`)
    const drafted = await day()
    expect(drafted.lines.filter(l => l.source === 'calendar')).toHaveLength(1)
    expect(drafted.status).not.toBe('confirmed')
    await page.goto('/#timesheet'); await page.reload()
    await expect(page.getByTestId('timesheet-line').filter({ hasText: FIXTURE_MEETING.title })).toBeVisible() // ADJUST(timesheet-signals)
    // Only the person confirms it.
    await page.getByRole('button', { name: /^Confirm today/ }).click()
    expect((await day()).status).toBe('confirmed')
    await ctx.close()
  })

  test.fixme(t(44), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter2)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await page.request.post(`${job.api}/timesheet/signals/calendar/consent`, { data: { yes: true } })
    await page.request.post(`${job.api}/timesheet/signals/calendar/refresh`)
    // Consent is withdrawn: capture stops and unconfirmed signals are deleted.
    expect((await page.request.post(`${job.api}/timesheet/signals/calendar/consent`, { data: { yes: false } })).status()).toBe(200)
    await page.request.post(`${job.api}/timesheet/signals/calendar/refresh`)
    const signals = (await (await page.request.get(`${job.api}/timesheet/signals`)).json()) as Signal[]
    expect(signals.find(s => s.signal === 'calendar')?.consent).toBe(false)
    const day = (await (await page.request.get(`${job.api}/timesheet/day?date=2026-11-12`)).json()) as { lines: { source: string }[] }
    expect(day.lines.filter(l => l.source === 'calendar')).toEqual([])
    // No manager's screen shows a person's correction pattern: nothing on the dashboard, the traffic board or the job index names a person's corrections.
    await signIn(page, PEOPLE.management)
    for (const url of [`${job.api}/dashboard`, `${job.api}/jobs`, `${job.api}/timesheet/team`]) { // ADJUST(timesheet-signals): the manager's timesheet routes
      const body = await (await page.request.get(url)).text()
      expect(body).not.toMatch(/correction|per_person|by_person|edited_lines/i)
    }
    await ctx.close()
  })
}
