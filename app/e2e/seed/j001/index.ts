// The J001 seed: the pilot job's documents, written through the tenant's own API the way
// e2e/seedClients.ts writes its clients (POST /clients, POST /documents, a document's
// patch-data, /approve). Never packed by hand, so it holds only what the tools can write.
// The deny-list check runs first; it passes with a note when no list is supplied.

import { expect, type Page } from '@playwright/test'
import { assertDeIdentified } from './denyList.mjs'
import { seedClients } from '../../seedClients'
import { DECK_TITLE, JOB, MESSY_BRIEF, READY_BRIEF, RESEARCH_TITLE } from './brief'

export { PEOPLE, ROSTER_LINES } from './people'
export { JOB, MESSY_BRIEF, READY_BRIEF } from './brief'

const BRIEF_APP = 'ie.napkin.brief-maker'
const RESEARCH_APP = 'ie.napkin.campaign-research'
const DECK_APP = 'ie.napkin.deck-maker'

export type SeededJob = {
  api: string
  client: string
  /** The sandbox token of each document, for its /s/<token>/... routes. */
  brief: { token: string; id: string }
  research: { token: string; id: string }
  deck: { token: string; id: string }
  deIdentified: { checked: boolean; note: string }
}

async function make(page: Page, api: string, app: string, title: string, client: string, patch?: object) {
  const r = await page.request.post(`${api}/documents`, { data: { app_id: app, title, client_id: client } })
  expect(r.status(), `create ${title}`).toBe(200)
  const body = await r.json() as { token: string; manifest: { id: string } }
  if (patch) {
    const p = await page.request.post(`/s/${body.token}/patch-data`, { data: { patch } })
    expect(p.status(), `patch ${title}`).toBe(200)
  }
  return { token: body.token, id: body.manifest.id }
}

/**
 * Seed J001 into the tenant the page is signed in as. `ready: true` writes the brief that
 * answers the gate's six items; the default is the messy one a planner pastes in.
 */
export async function seedJ001(page: Page, opts: { ready?: boolean } = {}): Promise<SeededJob> {
  const deIdentified = assertDeIdentified()
  await page.goto('/')
  const { api, ids } = await seedClients(page, 1)
  const client = ids[0]
  const brief = await make(page, api, BRIEF_APP, JOB.title, client, opts.ready ? READY_BRIEF : MESSY_BRIEF)
  const research = await make(page, api, RESEARCH_APP, RESEARCH_TITLE, client)
  const deck = await make(page, api, DECK_APP, DECK_TITLE, client)
  return { api, client, brief, research, deck, deIdentified }
}

/** Lock the brief as the signed-in person (needs a named person: the roster stack). */
export async function lockBrief(page: Page, brief: { token: string }, rationale = 'Gate passed.') {
  return page.request.post(`/s/${brief.token}/approve`, { data: { rationale } })
}
