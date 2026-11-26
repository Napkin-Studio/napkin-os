// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The shell's ports for the brand flow (brandFlow.ts): the two middleware tasks through the host's `/api-proxy` (the host fills an attachment's
// extracted text and PDF itself, and settles a reply as it does for the page), and the client's Brand Clans from lane A's Host API.
//
// `/api-proxy` is the open document's route, reached on `host.clanOrigin()` as the app's own page reaches it; a host with no server
// (the device) answers the same path through `handleFromFrame`.

import { host } from '../../host'
import { BrandError, type BuildAnswer, type ClanRef, type FileRef, type Identified, type JobView, type Ports } from './brandFlow'
import { unwrap, type Envelope } from './proxyReply'

type Fetch = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export async function call(task: string, input: Record<string, unknown>, doFetch: Fetch = fetch as unknown as Fetch): Promise<Envelope> {
  const body = JSON.stringify({ request_kind: 'middleware', payload: { task, input } })
  const { status, text } = host.frameLoad === 'srcdoc'
    ? await host.handleFromFrame('/api-proxy', '', new TextEncoder().encode(body)).then(r => ({ status: r.status, text: new TextDecoder().decode(r.body) }))
    : await doFetch(`${host.clanOrigin()}/api-proxy`, { method: 'POST', body }).then(async r => ({ status: r.status, text: await r.text() }))
  let parsed: unknown = null
  try { parsed = JSON.parse(text) } catch { /* not JSON: refused below */ }
  return unwrap(status, parsed ?? { ok: false, error: text })
}

const attachment = (f: FileRef) => ({ attachments: [{ name: f.name, label: f.label }] })

/** `host.brandClans.list(client)` (contract 5, `list`): the Summary rows reduced to what the question needs. */
async function listClans(clientId: string): Promise<ClanRef[]> {
  const r = await host.brandClans.list(clientId)
  return r.items.map(i => ({ document_id: i.document_id, path: i.path, name: i.name, default: i.document_id === r.default }))
}

/** The workspace the host's routes name (`/api/t/{tenant}`): what the build job writes into. */
let workspaceOnce: Promise<string> | null = null
function workspace(): Promise<string> {
  workspaceOnce ??= fetch('/api/session', { credentials: 'same-origin' }).then(async r => {
    const t = r.ok ? ((await r.json()) as { tenant?: unknown }).tenant : null
    if (typeof t !== 'string' || !t) throw new BrandError('host_unavailable', 'no workspace')
    return t
  })
  workspaceOnce.catch(() => { workspaceOnce = null })
  return workspaceOnce
}

export const ports: Ports = {
  clans: listClans,
  async identify(file, client, clans) {
    const env = await call('brand_identify', { ...attachment(file), client: { id: client.id, name: client.name }, brand_clans: clans })
    const r = (env.result ?? {}) as unknown as Identified
    return { ask: r.ask === true, reason: r.reason ?? null, question: r.question ?? null, pages: Number(r.pages ?? 0) }
  },
  async build(file, client, a: BuildAnswer) {
    const env = await call('brand_build', {
      ...attachment(file), client: { id: client.id }, workspace: await workspace(), mode: a.mode, confirmed_over_cap: a.confirmed,
      ...(a.mode === 'new' ? { name: a.name } : { brand_clan: a.clan }),
    })
    const job = env.job?.id
    if (!job) throw new BrandError('internal', 'The studio did not start the build.')
    return { job }
  },
  async status(job): Promise<JobView> {
    const env = await call('job_status', { job_id: job })
    const state = (env.job?.state ?? 'running') as JobView['state']
    return { state, error: env.job?.error?.message ? { type: env.job.error.type ?? 'internal', message: env.job.error.message } : null, result: (env.result ?? null) as unknown as JobView['result'] }
  },
  sleep: ms => new Promise(r => setTimeout(r, ms)),
}
