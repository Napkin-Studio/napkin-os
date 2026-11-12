// The pages of record `judge` for the suite's axe, 44 px and em dash checks (tests 72 and 73): the Judge scores door a creative director reads,
// and a script open with its score card above it (the card's buttons carry data-primary where a screen has one real primary action).
import { expect, type Page } from '@playwright/test'
import { control } from './pilot'
import { PEOPLE } from './seed/j001'
import { RADIO_SCRIPT, SCRIPT_EDITOR_APP } from './seed/j001/p2/script-editor.mjs'
import type { Phase2Page } from './phase2/pages'

async function scored(page: Page, job: { api: string; client: string; job: string }) {
  const made = await page.request.post(`${job.api}/documents`, { data: { app_id: SCRIPT_EDITOR_APP, title: 'J001 radio script', client_id: job.client, job: job.job } })
  expect(made.status(), 'the Script editor app is installed').toBe(200)
  const doc = (await made.json()) as { token: string }
  expect((await page.request.post(`/s/${doc.token}/patch-data`, { data: { patch: RADIO_SCRIPT, agent: 'j001-seed', action: 'seed: J001 radio script' } })).status()).toBe(200)
  await control(page, { variant: { judge_work: 'score22-idea9' } })
  expect((await page.request.post(`/s/${doc.token}/judge`, { data: { target: 'script' } })).status()).toBe(200)
}

export const PAGES: Phase2Page[] = [
  {
    name: 'judge scores door', as: PEOPLE.creativeDirector,
    show: async (page, { job }) => {
      // the creative director reads the scores; the piece is written and sent by the signed-in person who seeded it
      await scored(page, job)
      await page.goto('/#door-judge-scores'); await page.reload()
      await expect(page.getByTestId('judge-scores')).toBeVisible()
    },
  },
  {
    name: 'judge score card', as: PEOPLE.copywriter,
    show: async (page, { job }) => {
      await scored(page, job)
      await page.goto(`/#tool-${job.client}-script`); await page.reload()
      await page.getByTestId('work-item').first().click()
      await expect(page.getByTestId('score-card')).toBeVisible()
    },
  },
]
