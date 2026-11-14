// Which documents and clients a test owns, for the stand-in middleware (standin.mjs). The stand-in keeps its state (the job it reports, the task
// to fail, the answer variant, the log of what was asked) per scope, and a request tells it only its document id and its client id, so each browser
// context records the ids of what IT created through its own API: `track(ctx)` watches its POST /clients and POST /documents.
// pilot.ts `control` and `middlewareLog` send that scope; a context that created nothing sends none and gets the shared state, as before.

import type { BrowserContext, Page } from '@playwright/test'

export type Scope = { docs: string[]; clients: string[] }
type Made = { api: string; path: string; ids: string[]; resolved: boolean }
type Own = Scope & { made: Made[] }

const scopes = new WeakMap<object, Own>()
const scopeOfContext = (ctx: object): Own => {
  let s = scopes.get(ctx)
  if (!s) scopes.set(ctx, (s = { docs: [], clients: [], made: [] }))
  return s
}

/** Name a client (or a document) as this page's own: seedJ001 does it for a client that already existed. */
export function own(page: Page, ids: { client?: string; doc?: string }) {
  const s = scopeOfContext(page.context())
  if (ids.client && !s.clients.includes(ids.client)) s.clients.push(ids.client)
  if (ids.doc && !s.docs.includes(ids.doc)) s.docs.push(ids.doc)
}

/** Record every client and document the context creates through its own API. Safe to call twice. */
export function track(ctx: BrowserContext): BrowserContext {
  const req = ctx.request as unknown as { post: (url: string, opts?: unknown) => Promise<{ url(): string; status(): number; json(): Promise<unknown> }>; __tracked?: boolean }
  if (req.__tracked) return ctx
  req.__tracked = true
  const post = req.post.bind(req)
  const s = scopeOfContext(ctx)
  req.post = async (url, opts) => {
    const r = await post(url, opts)
    try {
      const path = new URL(url, 'http://x').pathname
      if (/\/clients$/.test(path) && r.status() === 201) {
        const id = ((await r.json()) as { id?: string }).id
        if (id) s.clients.push(id)
      } else if (/\/documents$/.test(path) && r.status() === 200) {
        // The id a request carries is the document's own (`document_id`), which is not the revision id this reply holds once the
        // document was given a client or a job at creation: `scopeOf` reads the real one from the document when it is asked.
        const b = (await r.json()) as { path?: string; manifest?: { id?: string; document_id?: string } }
        const ids = [b.manifest?.id, b.manifest?.document_id].filter((id): id is string => !!id)
        for (const id of ids) if (!s.docs.includes(id)) s.docs.push(id)
        if (b.path) s.made.push({ api: path.replace(/\/documents$/, ''), path: b.path, ids, resolved: false })
      }
    } catch { /* not a reply to read: the test sees the reply itself */ }
    return r
  }
  return ctx
}

/** What the page's context owns, or null when it created nothing. Reads each new document's own id first (once per document). */
export async function scopeOf(page: Page): Promise<Scope | null> {
  const s = scopes.get(page.context())
  if (!s) return null
  for (const m of s.made.filter(x => !x.resolved)) {
    try {
      const opened = await page.request.get(`${m.api}/d/${encodeURIComponent(m.path)}`)
      const token = opened.ok() ? ((await opened.json()) as { token?: string }).token : undefined
      const html = token ? await (await page.request.get(`/s/${token}/document`)).text() : ''
      const id = html.match(/"document_id":"([^"]+)"/)?.[1]
      if (id) { if (!s.docs.includes(id)) s.docs.push(id); m.resolved = true }
    } catch { /* the creation ids stay */ }
  }
  return s.docs.length || s.clients.length ? { docs: [...s.docs], clients: [...s.clients] } : null
}
