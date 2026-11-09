// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Edit mode is the OS's, and it belongs to the document it was turned on in:
// a spin-off or a linked document opens with it off, and a lock (with nothing
// reopened) ends it, since there is nothing left to edit.

export interface EditState { docPath: string; on: boolean }

/** Whether edit mode is on for the document open now. */
export const editOn = (e: EditState, docPath: string): boolean => e.docPath === docPath && e.on

/** Turn it on or off (or flip it) for the document open now. */
export function setEditFor(e: EditState, docPath: string, v: boolean | ((was: boolean) => boolean)): EditState {
  return { docPath, on: typeof v === 'function' ? v(editOn(e, docPath)) : v }
}

/** The document just locked (nothing reopened): edit mode ends. */
export function afterLock(e: EditState, docPath: string, wasLocked: boolean, locked: boolean): EditState {
  return locked && !wasLocked && editOn(e, docPath) ? { docPath, on: false } : e
}
