// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency editor's state and what each button does, against the People
// page's api (features/agency-looks-admin.clan design.contracts). Every edit
// of an agency on the server goes to its draft (PATCH .../draft); a new
// agency stays on the page until Publish makes it (POST, then the wordmark,
// then publish), because its id is made from its name then and fixed. Pure
// async functions of the state, so tests drive them with a fake api.

import { PeopleError, type PeopleApi } from '../api'
import {
  NEW_LOOK, currentLook, refusalWhy, screenUpload,
  type AgencyAdminRow, type BasicRow, type CodeExport, type DraftPatch, type EditLook, type UploadReport,
} from './model'

/** A line over the page: a bold lead and the rest. */
export interface EdFlash { kind: 'ok' | 'error'; lead: string; text: string }

export interface EditorState {
  /** The agency on the server; null for a new one, not made yet. */
  row: AgencyAdminRow | null
  look: EditLook
  /** A new agency: whether anything was edited yet, and when the first edit was. */
  drafted: boolean
  draftedAt: string | null
  /** A new agency's wordmark file, sent to the server at Publish. */
  pending: { name: string; text: string } | null
  report: UploadReport | null
  /** Copy to code, once asked for. */
  copy: CodeExport | null
  flash: EdFlash | null
}

/** The editor on an agency from the list. */
export function openRow(row: AgencyAdminRow): EditorState {
  return { row, look: currentLook(row), drafted: false, draftedAt: null, pending: null, report: null, copy: null, flash: null }
}

/** The editor on a new basic agency. */
export function openNew(): EditorState {
  return { row: null, look: { ...NEW_LOOK, aliases: [] }, drafted: false, draftedAt: null, pending: null, report: null, copy: null, flash: null }
}

/** The fields an edit may change. An agency in code takes its name only. */
export type LookEdit = Partial<Pick<EditLook, 'name' | 'aliases' | 'base' | 'accent'>>

/** Apply an edit on the page, at once (the previews follow); the server hears of it through saveDraft. */
export function edit(st: EditorState, patch: LookEdit, now: () => string = () => new Date().toISOString()): EditorState {
  if (st.look.kind === 'code' && Object.keys(patch).some(k => k !== 'name')) throw new Error('an agency in code changes its name only')
  return { ...st, look: { ...st.look, ...patch }, drafted: true, draftedAt: st.draftedAt ?? now(), flash: null }
}

function failed(st: EditorState, e: unknown): EditorState {
  return { ...st, flash: { kind: 'error', lead: 'Not saved.', text: e instanceof Error ? e.message : String(e) } }
}

/** The agency as the server has it now (after a call that does not answer with the row). */
async function fresh(api: PeopleApi, id: string): Promise<AgencyAdminRow | null> {
  return (await api.agencies()).find(r => r.id === id) ?? null
}

/** A stale rev (another tab or person changed it): reload the agency and say so. */
async function stale(api: PeopleApi, st: EditorState, e: unknown): Promise<EditorState> {
  if (!(e instanceof PeopleError && e.status === 409) || !st.row) return failed(st, e)
  const row = await fresh(api, st.row.id).catch(() => null)
  if (!row) return failed(st, e)
  return { ...openRow(row), flash: { kind: 'error', lead: 'Changed elsewhere.', text: `${e.message} The agency is reloaded as it is now.` } }
}

/** Send the named fields of the look to the draft (an agency on the server; a new one waits for Publish). */
export async function saveDraft(api: PeopleApi, st: EditorState, fields: readonly (keyof LookEdit)[]): Promise<EditorState> {
  if (!st.row || !fields.length) return st
  const body: DraftPatch = { rev: st.row.rev }
  for (const f of fields) {
    if (st.look.kind === 'code' && f !== 'name') continue
    if (f === 'aliases') body.aliases = [...st.look.aliases]
    else body[f] = st.look[f]
  }
  try {
    const row = await api.patchDraft(st.row.id, body)
    return { ...st, row }
  } catch (e) { return stale(api, st, e) }
}

/**
 * A wordmark file chosen: the page sanitises it at once for the preview; on an
 * agency on the server it then goes to the draft, and the server's own cleaned
 * SVG replaces the preview (or its refusal, with the line, keeps the old one).
 */
export async function upload(api: PeopleApi, st: EditorState, name: string, text: string): Promise<EditorState> {
  const local = screenUpload(name, text)
  if (!st.row) {
    if (!local.wordmark) return { ...st, report: local.report }
    return { ...st, look: { ...st.look, wordmark: local.wordmark, file: name }, pending: { name, text }, report: local.report, drafted: true, draftedAt: st.draftedAt ?? new Date().toISOString() }
  }
  const lines = text.split('\n')
  const before = st
  // the preview before the server answers: the page's own sanitising, or the old wordmark when the page already refuses it
  st = local.wordmark ? { ...st, look: { ...st.look, wordmark: local.wordmark, file: name } } : st
  try {
    const took = await api.putWordmark(st.row!.id, text)
    const was = st.row as BasicRow
    const row: BasicRow = { ...was, rev: took.rev, draft: { ...(was.draft ?? { name: was.name, aliases: was.aliases, base: was.base, accent: was.accent, wordmark: was.wordmark }), wordmark: took.svg } }
    return {
      ...st, row, look: { ...st.look, wordmark: took.svg, file: name },
      report: { ok: true, name, bytes: took.bytes, kept: took.kept_bytes, dropped: took.dropped, warnings: took.warnings },
    }
  } catch (e) {
    if (e instanceof PeopleError && [413, 415, 422].includes(e.status)) {
      const why = e.found.length ? refusalWhy(e.found) : `Refused: ${e.message}`
      return { ...before, report: { ok: false, name, why, found: e.found, lines } }
    }
    return stale(api, before, e)
  }
}

/** Take the wordmark out of the draft. */
export async function removeWordmark(api: PeopleApi, st: EditorState): Promise<EditorState> {
  if (!st.row) return { ...st, look: { ...st.look, wordmark: null, file: null }, pending: null, report: null }
  try {
    const row = await api.deleteWordmark(st.row.id)
    return { ...st, row, look: { ...st.look, wordmark: null, file: null }, report: null }
  } catch (e) { return stale(api, st, e) }
}

/** Publish: the draft goes live. A new agency is made first (and its wordmark sent); its id is fixed from then. */
export async function publish(api: PeopleApi, st: EditorState): Promise<EditorState> {
  let row = st.row
  try {
    if (!row) {
      const l = st.look
      row = await api.createAgency({ name: l.name.trim(), aliases: l.aliases, base: l.base.toUpperCase(), accent: l.accent.toUpperCase() })
      if (st.pending) {
        try {
          row = { ...row, rev: (await api.putWordmark(row.id, st.pending.text)).rev }
        } catch (e) {
          // made as a draft, but its wordmark refused: the editor is on the new draft, with why
          const made = (await fresh(api, row.id)) ?? row
          const why = e instanceof PeopleError && e.found.length ? refusalWhy(e.found) : `Refused: ${e instanceof Error ? e.message : String(e)}`
          return { ...openRow(made), report: { ok: false, name: st.pending.name, why, found: e instanceof PeopleError ? e.found : [], lines: st.pending.text.split('\n') }, flash: { kind: 'error', lead: 'Not published.', text: `${made.name} is a draft; its wordmark was refused.` } }
        }
      }
    }
    const live = await api.publish(row.id, row.rev)
    return { ...openRow(live), flash: { kind: 'ok', lead: 'Published.', text: `People at ${live.name} see it the next time a page loads.` } }
  } catch (e) {
    // a new agency made but not published: the editor is on its draft, with why
    if (row && !st.row) return failed(openRow((await fresh(api, row.id).catch(() => null)) ?? row), e)
    return stale(api, st, e)
  }
}

/** Discard the draft. A new agency, or one never published (the server deletes it): null, back to the list. */
export async function discard(api: PeopleApi, st: EditorState): Promise<EditorState | null> {
  if (!st.row) return null
  try {
    const row = await api.discardDraft(st.row.id)
    if ('removed' in row) return null
    return { ...openRow(row), flash: { kind: 'ok', lead: 'Draft discarded.', text: `${row.name} is as it was; nobody saw the draft.` } }
  } catch (e) { return stale(api, st, e) }
}

/** An agency in code: its name in the draft back to the code's (an edit like any other; Publish makes it live). */
export async function resetName(api: PeopleApi, st: EditorState): Promise<EditorState> {
  if (!st.row || st.row.kind !== 'code') return st
  return saveDraft(api, edit(st, { name: st.row.code_name }), ['name'])
}

/** Show (or hide) Copy to code: a published basic agency's look as the code holds one. */
export async function toggleCopy(api: PeopleApi, st: EditorState): Promise<EditorState> {
  if (st.copy) return { ...st, copy: null }
  if (!st.row || st.row.kind !== 'basic' || !st.row.published) return st
  try {
    return { ...st, copy: await api.exportCode(st.row.id) }
  } catch (e) { return failed(st, e) }
}
