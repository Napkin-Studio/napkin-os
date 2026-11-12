// The pages of record `script-editor` for the suite's axe, 44 px and em dash checks (tests 72 and 73): the page of a script, open in the
// app's frame. The frame is a document with its own paper, so the suite scans the shell around it; the script's own page is read by
// app/tests/scriptEditor.test.ts (the em dash and the pill buttons) and by the screenshots of this record.
import { expect, type Page } from '@playwright/test'
import { PEOPLE } from './seed/j001'
import { RADIO_SCRIPT, SCRIPT_EDITOR_APP } from './seed/j001/p2/script-editor.mjs'
import type { Phase2Page } from './phase2/pages'

export const PAGES: Phase2Page[] = [
  {
    name: 'script editor', as: PEOPLE.copywriter,
    show: async (page: Page, { job }) => {
      const made = await page.request.post(`${job.api}/documents`, { data: { app_id: SCRIPT_EDITOR_APP, title: 'J001 radio script', client_id: job.client, job: job.job } })
      expect(made.status(), 'the Script editor app is installed').toBe(200)
      const doc = (await made.json()) as { token: string }
      expect((await page.request.post(`/s/${doc.token}/patch-data`, { data: { patch: RADIO_SCRIPT, agent: 'j001-seed', action: 'seed: J001 radio script' } })).status()).toBe(200)
      await page.goto(`/#tool-${job.client}-script`); await page.reload()
      await page.getByTestId('work-item').first().click()
      await expect(page.frameLocator('iframe').first().locator('[data-where="script-editor"]')).toBeVisible()
    },
  },
]
