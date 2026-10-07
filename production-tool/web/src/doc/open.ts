// Which store holds the document. The CLAN store (a real .clan with its
// decision chain, through napkin-wasm) when it loads; the JSON snapshot store
// only when the wasm cannot load, with a visible "Saving without history".

import { CANVAS_KEY } from '../canvas/keys'
import type { ProductionDocument } from '../contracts/types'
import { idbDelete, idbGet } from '../lib/idb'
import { ClanBackedStore } from './clan'
import type { JobCtxOf } from './describe'
import { emptyDocument, idbPersister, normaliseDocument, SnapshotDocumentStore } from './store'
import type { DocumentStore } from './types'

/** The contract this build reads. A document from an older one starts fresh (no compatibility, 2026-10-07). */
const CURRENT = '2'

export const NO_HISTORY = 'Saving without history: the .clan engine did not load in this browser, so your work is kept as plain data.'

export interface OpenedDocument {
  doc: DocumentStore & { flush(): Promise<void> }
  clan: ClanBackedStore | null
  storeNote: string | null
}

export async function openDocument(
  participant: { id: string; handle: string },
  ctxOf: JobCtxOf,
  make: () => ClanBackedStore = () => ClanBackedStore.inBrowser({ ctxOf }),
): Promise<OpenedDocument> {
  // What this browser kept before the .clan (the JSON snapshot), if anything.
  const earlier = async () => {
    try {
      const v = await idbGet<ProductionDocument>('kv', 'doc')
      return v && v.contract_version === CURRENT ? normaliseDocument(v) : undefined
    } catch {
      return undefined
    }
  }
  const tryClan = async () => {
    const clan = make()
    const loaded = await clan.load()
    if (loaded && loaded.contract_version !== CURRENT) {
      // Made by an older build: its canvas and data do not fit this one. The organisers
      // already have its .clan (mirrored on every lock and every five minutes).
      await clan.create({ participant })
      await idbDelete('kv', CANVAS_KEY).catch(() => undefined)
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
    const doc = new SnapshotDocumentStore(emptyDocument(), idbPersister<ProductionDocument>('doc'))
    const loaded = await doc.load()
    if (!loaded || loaded.contract_version !== CURRENT) {
      await doc.create({ participant })
      if (loaded) await idbDelete('kv', CANVAS_KEY).catch(() => undefined)
    }
    return { doc, clan: null, storeNote: NO_HISTORY }
  }
}
