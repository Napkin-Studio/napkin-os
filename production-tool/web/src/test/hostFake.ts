// An in-memory Napkin OS host for the web tests: the routes of docs/contracts/production-clan-app.md section 2,
// as a `fetch`. It refuses what the real host refuses (If-Match, a missing document, another version) so a test
// cannot pass against a store that accepts everything. Lane T's hostStub.ts is the shared one once it lands; this
// one lets a test see the requests (`calls`) and start saves late (`hold`).
import { sha256Hex } from '../lib/hash'

export interface Stored { bytes: Uint8Array; version: string; savedAt: string; title: string; trashed?: string }

export class HostFake {
  docs = new Map<string, Stored>()
  calls: { method: string; path: string; headers: Record<string, string>; body?: unknown }[] = []
  tenant = 't1'
  mediaBase: string | null = 'https://media.test'
  private n = 0
  private clock = 0
  /** Makes the next save wait until released (a slow answer). */
  hold: Promise<void> | null = null
  /** Each save takes this long (ms) and is counted: `inFlight`, `mostInFlight`. */
  latency = 0
  inFlight = 0
  mostInFlight = 0

  private now() { return new Date(Date.UTC(2026, 10, 23, 12, 0, 0, this.clock++ * 1000)).toISOString() }

  async put(id: string, bytes: Uint8Array, title = id): Promise<string> {
    const version = `sha256:${await sha256Hex(bytes)}`
    this.docs.set(id, { bytes, version, savedAt: this.now(), title })
    return version
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'https://page.test')
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    this.calls.push({ method, path: url.pathname, headers, body: init?.body })
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } })
    const p = url.pathname.replace(/^\/api/, '')
    if (p === '/session') return json(200, { tenant: this.tenant, media_base: this.mediaBase })
    const t = `/t/${this.tenant}`
    if (p === `${t}/library`) {
      const items = [...this.docs].filter(([, d]) => !d.trashed).map(([path, d]) => ({ path, title: d.title, app_id: 'ie.napkin.production', updated_at: d.savedAt, client: null }))
      return json(200, { items, clients_unassigned: 0 })
    }
    if (p === `${t}/documents` && method === 'POST') {
      const id = `doc-${++this.n}`
      await this.put(id, new TextEncoder().encode(`blank ${id}`), JSON.parse(String(init!.body)).title)
      return json(200, { path: id })
    }
    if (p === `${t}/documents/upload`) {
      const id = `upload-${++this.n}`
      await this.put(id, init!.body as Uint8Array)
      return json(200, { path: id })
    }
    const m = p.match(new RegExp(`^${t}/d/([^/]+)(/download|/save)?$`))
    if (!m) return json(404, { error: 'not found' })
    const doc = this.docs.get(decodeURIComponent(m[1]))
    if (!doc || doc.trashed) return json(404, { error: 'not found' })
    const id = decodeURIComponent(m[1])
    if (m[2] === '/download') {
      return method === 'HEAD'
        ? new Response(null, { status: 200, headers: { ETag: `"${doc.version}"`, 'X-Saved-At': doc.savedAt } })
        : new Response(doc.bytes as unknown as BodyInit, { status: 200, headers: { ETag: `"${doc.version}"`, 'X-Saved-At': doc.savedAt } })
    }
    if (m[2] === '/save' && method === 'PUT') {
      this.inFlight++
      this.mostInFlight = Math.max(this.mostInFlight, this.inFlight)
      try {
        if (this.hold) await this.hold
        if (this.latency) await new Promise((r) => setTimeout(r, this.latency))
      } finally { this.inFlight-- }
      const ifMatch = headers['if-match']
      if (!ifMatch) return json(428, { error: 'If-Match required' })
      if (ifMatch.replace(/"/g, '') !== doc.version) {
        return json(409, { error: { code: 'conflict', message: 'This project was saved from somewhere else since you opened it.' }, latest: doc.version })
      }
      const bytes = init!.body as Uint8Array
      const version = `sha256:${await sha256Hex(bytes)}`
      Object.assign(doc, { bytes, version, savedAt: this.now() })
      return json(200, { version, saved_at: doc.savedAt, snapshot: false }, { ETag: `"${version}"` })
    }
    if (!m[2] && method === 'DELETE') {
      doc.trashed = this.now()
      this.docs.set(id, doc)
      return json(200, { trashed: true, restorable_until: new Date(Date.parse(doc.trashed) + 30 * 864e5).toISOString() })
    }
    return json(404, { error: 'not found' })
  }

  saves(id?: string) { return this.calls.filter((c) => c.method === 'PUT' && (!id || c.path.endsWith(`/${id}/save`))) }
}
