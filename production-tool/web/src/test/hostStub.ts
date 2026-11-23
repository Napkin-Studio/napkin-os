// A stub of napkin-web's document routes, in memory, for web tests (docs/contracts/production-clan-app.md).
// `createHostStub` returns a `fetch` that answers the contract's routes; `hostStub.test.ts` replays every
// vector in docs/contracts/examples/production-clan-app against it, so the stub and the real host (which
// reads the same vectors) cannot drift. Node only (it uses crypto and fflate).

import { createHash } from 'node:crypto'
import { strFromU8, unzipSync } from 'fflate'

export const ZIP = 'application/vnd.clan+zip'
const MAX_BYTES = 32 * 1024 * 1024
export const CONFLICT_MESSAGE = 'This project was saved from somewhere else since you opened it.'

export interface StubDoc {
  tenant: string
  id: string
  app_id: string
  identity: string
  template: boolean
  title: string
  bytes: Uint8Array
  version: string
  saved_at: string
  client?: { id: string; name: string } | null
  source_uri?: string
}

export interface HostStubOptions {
  tenant: string
  sessionCookie: string
  now?: () => string
  mediaBase?: string | null
  installedApps?: string[]
  documents?: StubDoc[]
}

export interface SaveRecord { doc: string; reason: string; version: string; ifMatch: string }

export const versionOf = (b: Uint8Array): string => 'sha256:' + createHash('sha256').update(b).digest('hex')

/** The document identity of an archive: manifest.document_id, else manifest.id (null when unreadable). */
export function identityOf(bytes: Uint8Array): string | null {
  try {
    const m = strFromU8(unzipSync(bytes)['manifest.yaml'] ?? new Uint8Array())
    const field = (k: string) => new RegExp(`^${k}:\\s*(\\S+)\\s*$`, 'm').exec(m)?.[1] ?? null
    return field('document_id') ?? field('id')
  } catch {
    return null
  }
}

export interface HostStub {
  fetch: typeof fetch
  docs: Map<string, StubDoc>
  saves: SaveRecord[]
  /** Make the next save answer with this status once (e.g. 401 for a session that ended). */
  failNext(status: number): void
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const refuse = (status: number, text: string) => json(status, { error: text })

export function createHostStub(opts: HostStubOptions): HostStub {
  const docs = new Map<string, StubDoc>()
  for (const d of opts.documents ?? []) docs.set(`${d.tenant}/${d.id}`, d)
  const saves: SaveRecord[] = []
  const now = opts.now ?? (() => new Date().toISOString())
  let fail: number | null = null
  let counter = 0

  const stub = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : null
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, 'http://host.test')
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers ?? req?.headers)
    const path = url.pathname
    if (!(headers.get('cookie') ?? '').includes(opts.sessionCookie)) return refuse(401, 'sign in')

    if (method === 'GET' && path === '/api/session') {
      return json(200, { tenant: opts.tenant, sandbox_origin: null, quota: { used: 0, cap: 0 }, dogfood: false, consented: false, production: true, media_base: opts.mediaBase ?? null })
    }
    const lib = /^\/api\/t\/([^/]+)\/library$/.exec(path)
    if (method === 'GET' && lib) {
      if (lib[1] !== opts.tenant) return refuse(404, 'not found')
      const items = [...docs.values()].filter((d) => d.tenant === lib[1] && !d.template).map((d) => ({ path: d.id, title: d.title, app_id: d.app_id, updated_at: d.saved_at, client: d.client ?? null }))
      return json(200, { items })
    }
    const m = /^\/api\/t\/([^/]+)\/d\/([^/]+)\/(save|download|spinoff)$/.exec(path)
    if (!m) return refuse(404, 'not found')
    const [, t, id, what] = m
    const doc = t === opts.tenant ? docs.get(`${t}/${id}`) : undefined
    if (!doc) return refuse(404, 'not found')

    if (what === 'download' && method === 'GET') {
      return new Response(doc.bytes as BodyInit, { status: 200, headers: { 'Content-Type': ZIP, ETag: `"${doc.version}"`, 'X-Saved-At': doc.saved_at } })
    }
    if (what === 'spinoff' && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { app_id: string; title?: string }
      if (!(opts.installedApps ?? []).includes(body.app_id)) return refuse(422, `app not installed: ${body.app_id}`)
      const nid = `doc-spun-${++counter}`
      const title = body.title ?? doc.title
      const source_uri = `doc:${doc.id}@${doc.version}`
      docs.set(`${t}/${nid}`, { ...doc, id: nid, app_id: body.app_id, identity: nid, title, source_uri, bytes: new Uint8Array(), version: versionOf(new Uint8Array()), template: false })
      return json(200, { path: nid, manifest: { title, source_uri }, token: 'stub-token', frame: 'stub-frame', sandbox_origin: null })
    }
    if (what === 'save' && method === 'PUT') {
      const raw = init?.body
      const bytes = raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw instanceof Blob ? new Uint8Array(await raw.arrayBuffer()) : new Uint8Array()
      const ifMatch = headers.get('if-match')
      if (!ifMatch) return refuse(428, 'If-Match is required')
      if (bytes.length > MAX_BYTES) return refuse(413, 'too large')
      if (doc.app_id !== 'ie.napkin.production' || doc.template) return refuse(422, 'not a Production document')
      const ident = identityOf(bytes)
      if (ident === null) return refuse(400, 'unreadable archive')
      if (ident !== doc.identity) return refuse(422, 'archive is not this document')
      if (fail !== null) { const s = fail; fail = null; return refuse(s, 'failed') }
      if (ifMatch.replace(/^"|"$/g, '') !== doc.version) {
        return json(409, { error: { code: 'conflict', message: CONFLICT_MESSAGE }, latest: doc.version })
      }
      const version = versionOf(bytes)
      const reason = headers.get('x-clan-reason') ?? 'interval'
      const snapshot = reason === 'accept' || reason === 'handoff' || reason === 'export' || reason === 'manual'
      doc.bytes = bytes
      doc.version = version
      doc.saved_at = now()
      saves.push({ doc: id, reason, version, ifMatch })
      return json(200, { version, saved_at: doc.saved_at, snapshot }, { ETag: `"${version}"` })
    }
    return refuse(404, 'not found')
  }) as typeof fetch

  return { fetch: stub, docs, saves, failNext: (s) => { fail = s } }
}
