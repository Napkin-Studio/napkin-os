// Undo and redo for the person (ui-behaviour 4.5), now clan-store's LocalUndo
// behind the document store (model/store.ts): one user action is one step,
// even when it writes fields and text; a step someone changed since is skipped
// with the spec's notice; the steps are kept in ProjectUi.undo, so they
// survive a reload. Not steps: job bookkeeping, results landing (the crew's),
// answering an ask, sending a job.

import type { DocumentStore, UndoResult } from './types'

/** Plain words for a step, for the button ("Undo: delete clip v4"). */
export function stepWords(label: string): string {
  return label.replace(/ (frame|take|shot|ref|rev|job)_[0-9A-Z]{26}/g, '')
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
