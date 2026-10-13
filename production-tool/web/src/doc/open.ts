// Which store holds a project's document. The CLAN store (a real .clan with its
// decision chain, through napkin-wasm and clan-store's buses) when it loads; the
// snapshot store only when the wasm cannot load, with a visible "Saving without
// history". Each project has its own of both (projects/storage.ts).
//
// A project made under another contract is refused, never read and never
// overwritten (features/contract-v3.clan): the person is told, and its bytes
// stay where they are.

import { UnsupportedContract, type Person, type SerializedUndo } from '../../../clan-store/src'
import type { ProductionDocument } from '../contracts/types'
import { ModelStore } from '../model/store'
import { browserStorage, clanDbFor, docKeyFor, type ProjectStorage } from '../projects/storage'
import { SnapshotDocumentStore, type Persister } from './store'
import type { DocumentStore } from './types'

/** The contract this build reads. */
export const CURRENT = '3'

export const NO_HISTORY = 'Saving without history: the .clan engine did not load in this browser, so your work is kept as plain data.'

export interface OpenedDocument {
  doc: DocumentStore & { flush(): Promise<void> }
  clan: ModelStore | null
  storeNote: string | null
}

/** A project this build cannot open: why, in words a person can read. Nothing was written. */
export interface RefusedDocument { refused: string }

export interface OpenArgs {
  /** The project (projects/projectIndex.ts) whose document this is. */
  project: string
  person: Person
  /** Its title, when a new document is made. */
  title?: string
  /** Where the undo steps are kept (ProjectUi.undo). */
  undo?: { saved: SerializedUndo | null | undefined; save: (s: SerializedUndo) => void }
  make?: () => ModelStore
  storage?: ProjectStorage
}

export async function openDocument({ project, person, title, undo, make, storage = browserStorage }: OpenArgs): Promise<OpenedDocument | RefusedDocument> {
  const build = make ?? (() => ModelStore.inBrowser(person, { persistence: storage.clan(clanDbFor(project)), undo }))
  const tryClan = async () => {
    const clan = build()
    const loaded = await clan.load()
    if (!loaded) await clan.create(person, title)
    return clan
  }
  try {
    let clan: ModelStore
    try {
      clan = await tryClan()
    } catch (e) {
      if (e instanceof UnsupportedContract) throw e
      console.warn('the CLAN store did not open; trying once more', e)
      clan = await tryClan()
    }
    return { doc: clan, clan, storeNote: null }
  } catch (e) {
    if (e instanceof UnsupportedContract) return { refused: e.message }
    console.error('the CLAN store did not open; saving without history', e)
    const persister: Persister<ProductionDocument> = {
      load: () => storage.get<ProductionDocument>(docKeyFor(project)),
      save: (v) => storage.put(docKeyFor(project), v),
    }
    const doc = new SnapshotDocumentStore(undefined as unknown as ProductionDocument, persister)
    const loaded = await doc.load()
    if (!loaded) {
      const kept = await storage.get<{ contract_version?: string }>(docKeyFor(project)).catch(() => undefined)
      if (kept && kept.contract_version !== CURRENT) return { refused: new UnsupportedContract(kept.contract_version ?? null).message }
      await doc.create(person, title)
    }
    return { doc, clan: null, storeNote: NO_HISTORY }
  }
}

export function isRefused(o: OpenedDocument | RefusedDocument): o is RefusedDocument {
  return 'refused' in o
}
