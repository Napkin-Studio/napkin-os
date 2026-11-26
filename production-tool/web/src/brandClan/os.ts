// Reading the client's Brand Clans from Napkin OS (Brand Clan phase 2, DESIGN 4a; docs/contracts/brand-clan.md section 5).
// The Production Tool runs at /production on the OS's own origin and session, so it reads the shell API directly, as the
// Brief node does (brief/os.ts):
// - GET /api/session: the tenant;
// - GET /api/t/{tenant}/clients/{client}/brand-clans: the client's Brand Clans (name, note, version, default, palette);
// - GET /api/t/{tenant}/brand-clans/{path}: one Brand Clan's published Brand Bible (data) and version.
// Nothing here writes to the OS: a Brand Clan is edited in the client window, never here.

/** One of the client's Brand Clans as the picker lists it. */
export interface OsBrandClanItem {
  documentId: string
  path: string
  name: string
  note?: string
  version: number
  default: boolean
  palette: string[]
}

/** One Brand Clan as it stands now: its published Brand Bible. */
export interface OsBrandClanRead {
  documentId: string
  path: string
  name: string
  version: number
  client?: { id: string; name?: string }
  data: Record<string, unknown>
}

export interface BrandClanSource {
  available(): Promise<boolean>
  list(clientId: string): Promise<OsBrandClanItem[]>
  read(path: string): Promise<OsBrandClanRead>
  /** Where a Brand Clan's asset (a logo) is served, for the card's picture. */
  assetUrl(path: string, asset: string): Promise<string | null>
  /** A Brand Clan's asset's bytes (its logo), or null when Napkin does not have it. */
  assetFile(path: string, asset: string): Promise<Blob | null>
  /** The client a Production project (its library path) belongs to, as the library says: what its default comes from. */
  projectClient(projectPath: string): Promise<string | null>
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export class BrandClanReadError extends Error {}

/** The shell API of the OS this page is served from (`base`: '' on the same origin). */
export function osBrandClanSource(base = '', fetcher: Fetch = (i, init) => fetch(i, init)): BrandClanSource {
  let tenant: Promise<string | null> | null = null
  const getJson = async (path: string): Promise<unknown> => {
    const r = await fetcher(`${base}${path}`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
    if (!r.ok) throw new BrandClanReadError(r.status === 404 ? 'That Brand Clan is no longer in Napkin.' : `Napkin answered ${r.status}.`)
    return r.json()
  }
  const who = () => {
    tenant ??= getJson('/api/session')
      .then((s) => (s && typeof s === 'object' && typeof (s as { tenant?: unknown }).tenant === 'string' ? (s as { tenant: string }).tenant : null))
      .catch(() => null)
    return tenant
  }
  const need = async () => {
    const t = await who()
    if (!t) throw new BrandClanReadError('Brand Clans are read from Napkin, and this page is not signed in to it.')
    return encodeURIComponent(t)
  }
  const num = (v: unknown) => (typeof v === 'number' && v >= 1 ? Math.floor(v) : 1)
  return {
    async available() {
      return (await who()) !== null
    },
    async list(clientId) {
      const t = await need()
      const v = (await getJson(`/api/t/${t}/clients/${encodeURIComponent(clientId)}/brand-clans`)) as { items?: Record<string, unknown>[] }
      return (v.items ?? []).map((i) => ({
        documentId: String(i.document_id ?? i.path), path: String(i.path ?? i.document_id), name: String(i.name ?? 'Brand Clan'),
        ...(typeof i.note === 'string' && i.note ? { note: i.note } : {}), version: num(i.version), default: i.default === true,
        palette: Array.isArray(i.palette) ? (i.palette as unknown[]).filter((h): h is string => typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h)) : [],
      }))
    },
    async read(path) {
      const t = await need()
      const v = (await getJson(`/api/t/${t}/brand-clans/${encodeURIComponent(path)}`)) as Record<string, unknown>
      const data = v.data && typeof v.data === 'object' ? (v.data as Record<string, unknown>) : null
      if (!data) throw new BrandClanReadError('Napkin sent the Brand Clan without its Brand Bible.')
      const c = v.client as { id?: unknown; name?: unknown } | undefined
      return {
        documentId: String(v.document_id ?? path), path: String(v.path ?? path), name: String(v.name ?? data.name ?? 'Brand Clan'), version: num(v.version),
        ...(c && typeof c.id === 'string' ? { client: { id: c.id, ...(typeof c.name === 'string' ? { name: c.name } : {}) } } : {}),
        data,
      }
    },
    async projectClient(projectPath) {
      const t = await who()
      if (!t) return null
      const v = (await getJson(`/api/t/${encodeURIComponent(t)}/library?app=ie.napkin.production`).catch(() => null)) as { items?: { path?: string; client?: { id?: string } | null }[] } | null
      return v?.items?.find((i) => i.path === projectPath)?.client?.id ?? null
    },
    async assetFile(path, asset) {
      const url = await this.assetUrl(path, asset)
      if (!url) return null
      const r = await fetcher(url, { credentials: 'same-origin' }).catch(() => null)
      return r && r.ok ? r.blob() : null
    },
    async assetUrl(path, asset) {
      const t = await who()
      if (!t) return null
      const name = asset.replace(/^human\/assets\//, '')
      return `${base}/api/t/${encodeURIComponent(t)}/brand-clans/${encodeURIComponent(path)}/assets/${encodeURIComponent(name)}`
    },
  }
}

let OS: BrandClanSource | null = null
/** The Brand Clans this page reads: Napkin's, or in dev a stand-in (window.__brandClanSource). */
export function pageBrandClanSource(): BrandClanSource {
  const dev = import.meta.env.DEV ? (globalThis as unknown as { __brandClanSource?: BrandClanSource }).__brandClanSource : undefined
  return dev ?? (OS ??= osBrandClanSource())
}
