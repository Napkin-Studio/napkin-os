// Which store holds the document. The CLAN store (a real .clan with its
// decision chain, through napkin-wasm) when it loads; the JSON snapshot store
// only when the wasm cannot load, with a visible "Saving without history".

import type { ProductionDocument } from '../contracts/types'
import { idbGet } from '../lib/idb'
import { ClanBackedStore } from './clan'
import type { JobCtxOf } from './describe'
import { emptyDocument, idbPersister, normaliseDocument, SnapshotDocumentStore } from './store'
import type { DocumentStore } from './types'

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
      return v ? normaliseDocument(v) : undefined
    } catch {
      return undefined
    }
  }
  const tryClan = async () => {
    const clan = make()
    if (!(await clan.load())) {
      const old = await earlier()
      if (old && (old.jobs.length || old.assets.length || old.character.refs.length)) await clan.adopt(old)
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
    if (!(await doc.load())) await doc.create({ participant })
    return { doc, clan: null, storeNote: NO_HISTORY }
  }
}
