// The J001 seed: the pilot job's documents, written through the tenant's own API the way
// e2e/seedClients.ts writes its clients (POST /clients, POST /documents, a document's
// patch-data, /approve). Never packed by hand, so it holds only what the tools can write.
// The deny-list check runs first; it passes with a note when no list is supplied.

import { expect, type Page } from '@playwright/test'
import { assertDeIdentified } from './denyList.mjs'
import { DECK_TITLE, JOB, MESSY_BRIEF, READY_BRIEF, RESEARCH_TITLE } from './brief'

export { PEOPLE, ROSTER_LINES } from './people'
export { JOB, MESSY_BRIEF, READY_BRIEF } from './brief'

const BRIEF_APP = 'ie.napkin.brief-maker'
const RESEARCH_APP = 'ie.napkin.campaign-research'
const DECK_APP = 'ie.napkin.deck-maker'

export type SeededJob = {
  api: string
  client: string
  /** The client's name: Client A, or Client A2 ... where a tenant is shared (see seedJ001). */
  clientName: string
  /** The sandbox token of each document, for its /s/<token>/... routes. */
  brief: { token: string; id: string; path: string }
  research: { token: string; id: string; path: string }
  deck: { token: string; id: string; path: string }
  deIdentified: { checked: boolean; note: string }
}

async function make(page: Page, api: string, app: string, title: string, client: string, patch?: object) {
  const r = await page.request.post(`${api}/documents`, { data: { app_id: app, title, client_id: client } })
  expect(r.status(), `create ${title}`).toBe(200)
  const body = await r.json() as { token: string; path: string; manifest: { id: string } }
  if (patch) {
    const p = await page.request.post(`/s/${body.token}/patch-data`, { data: { patch, agent: 'j001-seed', action: `seed: ${title}` } })
    expect(p.status(), `patch ${title}`).toBe(200)
  }
  return { token: body.token, id: body.manifest.id, path: body.path }
}

/**
 * Seed J001 into the tenant the page is signed in as. `ready: true` writes the brief that
 * answers the gate's six items; the default is the messy one a planner pastes in.
 */
export async function seedJ001(page: Page, opts: { ready?: boolean; fresh?: boolean } = {}): Promise<SeededJob> {
  const deIdentified = assertDeIdentified()
  await page.goto('/')
  // An anonymous context is its own tenant; a signed-in person works in their agency's, which the next
  // test finds again, so Client A may already be there (409): then it is the one to use. `fresh` is for a
  // test whose answer is about one client alone (Territories reads every brief of a client): it gets
  // Client A2, A3 ... instead.
  const { tenant } = await (await page.request.get('/api/session')).json() as { tenant: string }
  const api = `/api/t/${tenant}`
  let client = ''
  let clientName = ''
  const all = async () => await (await page.request.get(`${api}/clients`)).json() as { id: string; name: string }[]
  for (let n = 1; !client; n++) {
    const name = n === 1 ? JOB.client : `${JOB.client}${n}`
    const made = await page.request.post(`${api}/clients`, { data: { name } })
    if (made.status() === 409) {
      if (opts.fresh) continue
      client = (await all()).find(c => c.name === name)!.id
    } else {
      expect(made.status(), `create ${name}`).toBe(201)
      client = (await made.json() as { id: string }).id
    }
    clientName = name
  }
  const brief = await make(page, api, BRIEF_APP, JOB.title, client, opts.ready ? READY_BRIEF : MESSY_BRIEF)
  const research = await make(page, api, RESEARCH_APP, RESEARCH_TITLE, client)
  const deck = await make(page, api, DECK_APP, DECK_TITLE, client)
  return { api, client, clientName, brief, research, deck, deIdentified }
}

/**
 * A document's routes are on a token minted for whoever opened it, and the host acts as that person. After
 * signing in as someone else, open the document again to act as them.
 */
export async function asMe<T extends { path: string; id: string }>(page: Page, api: string, doc: T): Promise<T & { token: string }> {
  const r = await page.request.get(`${api}/d/${encodeURIComponent(doc.path)}`)
  expect(r.status(), `open ${doc.path}`).toBe(200)
  return { ...doc, token: (await r.json() as { token: string }).token }
}

/**
 * Lock the brief as the signed-in person (needs a named person: the roster stack). With the Brief
 * gate on, the planner must have signed first (`signBrief`), or the host refuses with 409.
 */
export async function lockBrief(page: Page, brief: { token: string }, rationale = 'Gate passed.') {
  return page.request.post(`/s/${brief.token}/approve`, { data: { rationale } })
}

/**
 * Sign the brief as the signed-in person (needs a named person: the roster stack). The planner's
 * sign writes one `sign` decision; the creative director's signature is the `approve` that locks it.
 */
export async function signBrief(page: Page, brief: { token: string }, rationale = 'Gate passed.') {
  return page.request.post(`/s/${brief.token}/sign`, { data: { rationale } })
}

/** The brief's gate, as the host reads it (`GET /gate`). */
export async function gateOf(page: Page, brief: { token: string }) {
  return (await (await page.request.get(`/s/${brief.token}/gate`)).json()) as {
    passed: boolean; signed: boolean; confirmed: boolean; open: boolean; changed_since_lock: boolean; items: { id: string; state: string }[]
  }
}

/** The client's answer, recorded by an agency person (the host's `/client-review`): what the client's link replaces. */
export async function recordClientConfirmation(page: Page, brief: { token: string }) {
  return page.request.post(`/s/${brief.token}/client-review`, {
    data: { answer: 'accepted', client: { name: 'Client A contact' }, channel: 'none', parts: [] },
  })
}
