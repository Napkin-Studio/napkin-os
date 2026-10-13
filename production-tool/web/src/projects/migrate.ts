// The first load with projects (features/project-home.clan): the one project
// this browser held before (the .clan in CLAN_DB, the canvas under 'canvas', the
// UI under 'ui', the plain-data fallback under 'doc') becomes the first project
// in the index. Copied first, checked, listed, and only then are the old
// places cleared, so a load that stops halfway does it again from the start.
//
// Contract 3 (features/contract-v3.clan): only a document this build reads is
// carried over. One made under another contract (every project of before
// projects was contract 2) is never imported: it is left where it is, exactly
// as it was, and not listed; the index is written all the same. An empty
// first-visit document, with nothing on its canvas, is not carried either.

import { memoryPersistence, UnsupportedContract } from '../../../clan-store/src'
import type { CanvasSnapshot } from '../canvas/controller'
import type { ProductionDocument } from '../contracts/types'
import { CURRENT } from '../doc/open'
import { initialAppUi, splitUi, type UiState } from '../doc/ui'
import { CLAN_DB } from '../model/store'
import { emptySummary, newProjectId, type ProjectIndex } from './projectIndex'
import type { MakeClan } from './session'
import { canvasKeyFor, clanDbFor, docKeyFor, uiKeyFor, type ProjectStorage } from './storage'
import { autoName, isEmptyDocument, summarise, UNTITLED, type ProjectSummary } from './summary'

/** Where the single project of before lived. */
export const LEGACY = { clanDb: CLAN_DB, canvas: 'canvas', ui: 'ui', doc: 'doc' } as const

export interface Migrated {
  /** The project it became, or null when there was nothing to carry over. */
  id: string | null
  /** A project of another contract was there: left in its old place, untouched and not listed. */
  left: boolean
}

/** Call when the index does not exist yet. Writes the index (empty or with the one project). */
export async function migrateSingleProject(storage: ProjectStorage, index: ProjectIndex, makeClan: MakeClan, now = () => new Date()): Promise<Migrated> {
  const legacyClan = storage.clan(LEGACY.clanDb)
  const saved = await legacyClan.read().catch(() => null)
  const json = await storage.get<{ contract_version?: string }>(LEGACY.doc)

  // What the old places hold, read without writing anything.
  let doc: ProductionDocument | null = null
  let left = false
  if (saved) {
    // Read from a copy in memory, so not even a job's outcome is written to the old place.
    const copy = memoryPersistence()
    await copy.write(saved)
    const c = makeClan(copy)
    try {
      doc = await c.load()
    } catch (e) {
      if (!(e instanceof UnsupportedContract)) throw e
      left = true
    } finally {
      await c.close().catch(() => {})
    }
  } else if (json) {
    if (json.contract_version === CURRENT) doc = json as ProductionDocument
    else left = true
  }
  if (left || (!doc && !saved && !json)) {
    await index.saveNow()
    return { id: null, left }
  }

  const canvas = await storage.get<CanvasSnapshot>(LEGACY.canvas)
  const ui = await storage.get<Partial<UiState>>(LEGACY.ui)
  const { app, project: projectUi } = splitUi(ui ?? {})
  const hasCanvas = !!canvas?.elements?.some((e) => !(e as { isDeleted?: boolean }).isDeleted)
  if (!doc || (isEmptyDocument(doc) && !hasCanvas)) {
    await index.saveNow()
    return { id: null, left: false }
  }

  const id = newProjectId()
  if (saved) {
    // The bytes as they are: no engine needed to move them.
    await storage.clan(clanDbFor(id)).write(saved)
    const back = await storage.clan(clanDbFor(id)).read()
    if (!back || back.bytes.length !== saved.bytes.length) throw new Error('could not copy the project into its own place; nothing was moved')
  } else {
    await storage.put(docKeyFor(id), doc)
  }
  if (canvas) await storage.put(canvasKeyFor(id), canvas)
  if (ui) await storage.put(uiKeyFor(id), projectUi)

  let summary: ProjectSummary = emptySummary()
  try {
    summary = summarise(doc, projectUi)
  } catch { /* an odd document: the card fills in when it is opened */ }
  await index.create({ id, name: autoName(doc) || UNTITLED, naming: 'auto', summary, at: saved?.savedAt ?? now().toISOString() })

  // Listed: now the old places can go. The app's part of the UI stays under 'ui', and Home opens with the card.
  if (saved) await legacyClan.clear()
  await storage.del(LEGACY.doc)
  await storage.del(LEGACY.canvas)
  if (ui) await storage.put(LEGACY.ui, { ...initialAppUi(), ...app, view: 'home' })
  return { id, left: false }
}
