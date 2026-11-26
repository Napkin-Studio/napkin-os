// Undo and redo for the person (ui-behaviour 4.5), now clan-store's LocalUndo
// behind the document store (model/store.ts): one user action is one step,
// even when it writes fields and text; a step someone changed since is skipped
// with the spec's notice; the steps are kept in ProjectUi.undo, so they
// survive a reload. Not steps: job bookkeeping, results landing (the crew's),
// answering an ask, sending a job.

import type { DocumentStore, UndoResult } from './types'

/** Plain words for a step, for the button ("Undo: delete clip v4"). A step's label is its decision's action, which can
 *  name entities by id ("keep_suggestion scenes[scene_01M89…]"): the tooltip says the kind, never the id (UAT acceptance
 *  A47), and an action written in snake_case reads as words. */
export function stepWords(label: string): string {
  const words = label
    .replace(/\s*\b[a-z]+_[0-9A-HJKMNP-TV-Z]{26}\b(?![\]])/g, '')
    .replace(/\b([a-z]+)_(?=[a-z])/g, '$1 ')
  const m = /^(.*?)\s*\b([a-z]+?)s?\[[^\]]*\](?:\.[a-z_.]+)?(.*)$/.exec(words)
  if (!m) return words.replace(/\s{2,}/g, ' ').trim()
  const [, before, kind, after] = m
  const verb = before.trim() === 'set' ? 'change' : before.trim()
  const said = verb.includes(' ') ? `${verb} (${kind})` : `${verb} ${kind}`
  return `${said}${after}`.replace(/\s{2,}/g, ' ').trim()
}

/** What undo and redo would take back now. */
export function undoLabels(store: DocumentStore): { undo: string | null; redo: string | null } {
  return store.undoLabels?.() ?? { undo: null, redo: null }
}

/** Undo the person's last step. null when there is no undo here (the snapshot store). */
export async function undo(store: DocumentStore): Promise<UndoResult | null> {
  return store.undo ? store.undo() : null
}

export async function redo(store: DocumentStore): Promise<UndoResult | null> {
  return store.redo ? store.redo() : null
}
