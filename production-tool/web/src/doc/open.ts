// Which store holds a project's document. The CLAN store (a real .clan with its
// decision chain, through napkin-wasm) when it loads; the JSON snapshot store
// only when the wasm cannot load, with a visible "Saving without history".
// Each project has its own of both (projects/storage.ts).

import type { ProductionDocument } from '../contracts/types'
import { browserStorage, canvasKeyFor, clanDbFor, docKeyFor, type ProjectStorage } from '../projects/storage'
import { ClanBackedStore } from './clan'
import type { JobCtxOf } from './describe'
import { emptyDocument, normaliseDocument, SnapshotDocumentStore, type Persister } from './store'
import type { DocumentStore } from './types'

/** The contract this build reads. A document from an older one starts fresh (no compatibility, 2026-10-07). */
export const CURRENT = '2'

export const NO_HISTORY = 'Saving without history: the .clan engine did not load in this browser, so your work is kept as plain data.'

export interface OpenedDocument {
  doc: DocumentStore & { flush(): Promise<void> }
  clan: ClanBackedStore | null
  storeNote: string | null
}

export interface OpenArgs {
  /** The project (projects/projectIndex.ts) whose document this is. */
  project: string
  participant: { id: string; handle: string }
  ctxOf: JobCtxOf
  make?: () => ClanBackedStore
  storage?: ProjectStorage
}

export async function openDocument({ project, participant, ctxOf, make, storage = browserStorage }: OpenArgs): Promise<OpenedDocument> {
  const build = make ?? (() => ClanBackedStore.inBrowser({ ctxOf, persistence: storage.clan(clanDbFor(project)) }))
  const forgetCanvas = () => storage.del(canvasKeyFor(project)).catch(() => undefined)
  // What this browser kept before the .clan (the JSON snapshot), if anything.
  const earlier = async () => {
    try {
      const v = await storage.get<ProductionDocument>(docKeyFor(project))
      return v && v.contract_version === CURRENT ? normaliseDocument(v) : undefined
    } catch {
      return undefined
    }
  }
  const tryClan = async () => {
    const clan = build()
    const loaded = await clan.load()
    if (loaded && loaded.contract_version !== CURRENT) {
      // Made by an older build: its canvas and data do not fit this one. The organisers
      // already have its .clan (mirrored on every lock and every five minutes).
      await clan.create({ participant })
      await forgetCanvas()
    } else if (!loaded) {
      const old = await earlier()
      if (old && (old.jobs.length || old.assets.length || old.refs.length)) await clan.adopt(old)
      else await clan.create({ participant })
    }
    return clan
  }
  try {
    let clan: ClanBackedStore
    try {
      clan = await tryClan()
    } catch (e) {
      console.warn('the CLAN store did not open; trying once more', e)
      clan = await tryClan()
    }
    return { doc: clan, clan, storeNote: null }
  } catch (e) {
    console.error('the CLAN store did not open; saving without history', e)
    const persister: Persister<ProductionDocument> = {
      load: () => storage.get<ProductionDocument>(docKeyFor(project)),
      save: (v) => storage.put(docKeyFor(project), v),
    }
    const doc = new SnapshotDocumentStore(emptyDocument(), persister)
    const loaded = await doc.load()
    if (!loaded || loaded.contract_version !== CURRENT) {
      await doc.create({ participant })
      if (loaded) await forgetCanvas()
    }
    return { doc, clan: null, storeNote: NO_HISTORY }
  }
}
