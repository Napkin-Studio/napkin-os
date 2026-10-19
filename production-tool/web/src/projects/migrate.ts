// The first load with projects (features/project-home.clan): the one project
// this browser held before (the .clan in CLAN_DB, the canvas under 'canvas', the
// UI under 'ui', the plain-data fallback under 'doc') becomes the first project
// in the index. Copied first, checked, listed, and only then are the old
// places cleared, so a load that stops halfway does it again from the start.
// Nothing is lost: an empty first-visit document, with nothing on its canvas
// and no script typed, is the only thing not carried over.

import type { CanvasSnapshot } from '../canvas/controller'
import type { ProductionDocument } from '../contracts/types'
import { CLAN_DB } from '../doc/clan'
import { normaliseDocument } from '../doc/store'
import { initialAppUi, splitUi, type UiState } from '../doc/ui'
import { emptySummary, newProjectId, type ProjectIndex } from './projectIndex'
import type { MakeClan } from './session'
import { canvasKeyFor, clanDbFor, docKeyFor, uiKeyFor, type ProjectStorage } from './storage'
import { autoName, isEmptyDocument, summarise, UNTITLED, type ProjectSummary } from './summary'

/** Where the single project of before lived. */
export const LEGACY = { clanDb: CLAN_DB, canvas: 'canvas', ui: 'ui', doc: 'doc' } as const

export interface Migrated {
  /** The project it became, or null when there was nothing to carry over. */
  id: string | null
}

/** Call when the index does not exist yet. Writes the index (empty or with the one project). */
export async function migrateSingleProject(storage: ProjectStorage, index: ProjectIndex, makeClan: MakeClan, now = () => new Date()): Promise<Migrated> {
  const legacyClan = storage.clan(LEGACY.clanDb)
  const saved = await legacyClan.read().catch(() => null)
  const json = await storage.get<ProductionDocument>(LEGACY.doc)
  const canvas = await storage.get<CanvasSnapshot>(LEGACY.canvas)
  const ui = await storage.get<Partial<UiState>>(LEGACY.ui)
  const { app, project: projectUi } = splitUi(ui ?? {})

  const id = newProjectId()
  let doc: ProductionDocument | null = null
  if (saved) {
    // The bytes as they are: no engine needed to move them.
    await storage.clan(clanDbFor(id)).write(saved)
    const back = await storage.clan(clanDbFor(id)).read()
    if (!back || back.bytes.length !== saved.bytes.length) throw new Error('could not copy the project into its own place; nothing was moved')
    try {
      const c = makeClan(storage.clan(clanDbFor(id)), () => undefined)
      const d = await c.load()
      if (d) doc = normaliseDocument(d as ProductionDocument)
      c.clan.dispose()
    } catch (e) {
      console.warn('could not read the project to describe it; it is carried over all the same', e)
    }
  }
  if (json) {
    await storage.put(docKeyFor(id), json)
    doc ??= normaliseDocument(json)
  }
  if (canvas) await storage.put(canvasKeyFor(id), canvas)
  if (ui) await storage.put(uiKeyFor(id), projectUi)

  const hasCanvas = !!canvas?.elements?.some((e) => !(e as { isDeleted?: boolean }).isDeleted)
  const hasDraft = !!projectUi.scriptDraft?.trim()
  const somethingThere = !!saved || !!json
  const work = somethingThere && (!doc || !isEmptyDocument(doc) || hasCanvas || hasDraft)
  const carried = work || (!somethingThere && (hasCanvas || hasDraft))

  if (carried) {
    let summary: ProjectSummary = emptySummary()
    try {
      if (doc) summary = summarise(doc, projectUi.jobCtx ?? {})
    } catch { /* an odd document: the card fills in when it is opened */ }
    await index.create({ id, name: (doc && autoName(doc)) || UNTITLED, naming: 'auto', summary, at: saved?.savedAt ?? now().toISOString() })
  } else {
    // Nothing worth a card: take the copies back.
    await storage.dropClan(clanDbFor(id))
    await Promise.all([storage.del(docKeyFor(id)), storage.del(canvasKeyFor(id)), storage.del(uiKeyFor(id))])
    await index.saveNow()
  }

  // Listed: now the old places can go. The app's part of the UI stays under 'ui', and Home opens with the card.
  if (saved) await legacyClan.clear()
  await storage.del(LEGACY.doc)
  await storage.del(LEGACY.canvas)
  if (ui) await storage.put(LEGACY.ui, { ...initialAppUi(), ...app, view: 'home' })
  return { id: carried ? id : null }
}
