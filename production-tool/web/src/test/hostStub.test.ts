// Replays every contract vector against the stub (docs/contracts/production-clan-app.md).
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createHostStub, versionOf, type StubDoc } from './hostStub'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'docs', 'contracts', 'examples', 'production-clan-app')
const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

interface Step { name: string; request: { method: string; path: string; headers: Record<string, string>; body_base64?: string; body_size?: number; body?: unknown }; response: { status: number; headers: Record<string, string>; body?: unknown; body_base64?: string; body_subset?: unknown; new_document?: Record<string, unknown> } }
interface Vector { admin_cookie?: string; trashed?: Array<Record<string, unknown>>; vector: string; tenant: string; now: string; session_cookie: string; documents: Array<Record<string, unknown>>; installed_apps?: string[]; steps?: Step[]; variants?: Array<{ media_base: string | null; steps: Step[] }> }

const subset = (got: unknown, want: unknown, at = ''): void => {
  if (Array.isArray(want)) {
    expect(Array.isArray(got), at).toBe(true)
    want.forEach((w, i) => subset((got as unknown[])[i], w, `${at}[${i}]`))
  } else if (want && typeof want === 'object') {
    for (const [k, v] of Object.entries(want)) subset((got as Record<string, unknown>)?.[k], v, `${at}.${k}`)
  } else expect(got, at).toEqual(want)
}

const toDoc = (d: Record<string, unknown>): StubDoc => ({ ...(d as unknown as StubDoc), bytes: b64(d.bytes_base64 as string) })

describe('vectors', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  it('has the eight vectors', () => expect(files.sort()).toEqual(['library-item.json', 'save-conflict.json', 'save-ok.json', 'save-refusals.json', 'session.json', 'spinoff-not-installed.json', 'spinoff-ok.json', 'trash.json']))

  for (const f of files) {
    const v = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Vector
    it(`${v.vector}: versions are the sha256 of the bytes`, () => {
      for (const d of v.documents) expect(d.version).toBe(versionOf(b64(d.bytes_base64 as string)))
      for (const s of v.steps ?? []) {
        const body = s.request.body_base64
        const sent = body ? `"${versionOf(b64(body))}"` : null
        const ok = s.response.status === 200 && s.request.method === 'PUT'
        if (ok) expect((s.response.body as { version: string }).version, s.name).toBe(sent?.replace(/"/g, ''))
      }
    })
    const runs = v.variants ? v.variants.map((x) => ({ label: String(x.media_base), mediaBase: x.media_base, steps: x.steps })) : [{ label: '', mediaBase: null, steps: v.steps ?? [] }]
    for (const r of runs) {
      it(`${v.vector} ${r.label}: the stub answers like the vector`, async () => {
        const stub = createHostStub({ tenant: v.tenant, sessionCookie: v.session_cookie, adminCookie: v.admin_cookie, now: () => v.now, mediaBase: r.mediaBase, installedApps: v.installed_apps, documents: v.documents.map(toDoc), trashed: (v.trashed ?? []).map(toDoc) })
        for (const s of r.steps) {
          const q = s.request
          const body = q.body_base64 ? b64(q.body_base64) : q.body_size ? new Uint8Array(q.body_size) : q.body !== undefined ? JSON.stringify(q.body) : undefined
          const res = await stub.fetch(`http://host.test${q.path}`, { method: q.method, headers: q.headers, body: body as BodyInit | undefined })
          expect(res.status, s.name).toBe(s.response.status)
          for (const [k, want] of Object.entries(s.response.headers)) expect(res.headers.get(k), `${s.name} ${k}`).toBe(want)
          if (s.response.body_base64) expect(Buffer.from(await res.arrayBuffer()).toString('base64'), s.name).toBe(s.response.body_base64)
          else {
            const got = await res.json()
            if (s.response.body !== undefined) expect(got, s.name).toEqual(s.response.body)
            if (s.response.body_subset !== undefined) subset(got, s.response.body_subset, s.name)
            if (s.response.new_document) {
              const made = stub.docs.get(`${v.tenant}/${(got as { path: string }).path}`)
              subset(made, s.response.new_document, `${s.name} new document`)
            }
          }
        }
      })
    }
  }
})
