// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The People page (features/people-admin.clan, agency-looks-admin.clan; the
// approved mocks people-admin-v1 and people-agencies-v3): People | Agencies.
// People: who can sign in, by agency, each agency in its own pill; add a
// person by name and agency, rename, remove. Agencies: every agency with its
// kind (In code, Basic, Draft), a new basic agency, and the editor (drafts,
// previews, Publish). Reached from the account menu by an admin only, and
// always in Napkin's look.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { NAPKIN_COLOURS, type AgencyColours } from '../agency/palette'
import { AgenciesList } from './agencies/AgenciesList'
import { AgencyEditor } from './agencies/AgencyEditor'
import { openNew, openRow, type EditorState } from './agencies/editor'
import { LookPill } from './agencies/LookPill'
import { isPublished, personLook, registerRows } from './agencies/model'
import { httpPeopleApi, PeopleError, type PeopleApi, type PeopleList } from './api'
import {
  PAGE_CLASS, addedLine, agencyColours, agencyFieldFromSignInName, agencySlug, findPeople, isPeopleAdmin,
  napkinPageCss, newAgencyLook, pillStyle, recogniseAgency, signInNameOf, type AgencyRow, type PersonRow,
} from './model'
import './PeoplePage.css'
import './agencies/agencies.css'

interface Props {
  /** The signed-in person (`name@agency`). */
  user: string | null
  onClose: () => void
  /** The server's routes; a test hands in a fake. */
  api?: PeopleApi
  /** What the page shows before it has asked (tests, and the screenshot run). */
  initial?: PeopleList | null
  /** The tab it opens on. */
  initialTab?: 'people' | 'agencies'
  /** An agency open in the editor from the start (tests, and the screenshot run). */
  initialEditor?: EditorState | null
}

type Flash = { kind: 'ok' | 'error'; text: ReactNode } | null

/** The Add sheet's fields. */
interface Draft {
  name: string
  agency: string
  username: string
  /** The sign-in name was typed, not made: name and agency changes leave it. */
  touched: boolean
  /** The new agency's name as shown; null until edited (then it is the typed agency). */
  shown: string | null
  from: string
  base: string
  accent: string
}

const FRESH: Draft = { name: '', agency: '', username: '', touched: false, shown: null, from: '', base: '#0F6B5C', accent: '#9FE6D8' }

export default function PeoplePage({ user, onClose, api = httpPeopleApi, initial = null, initialTab = 'people', initialEditor = null }: Props) {
  const [list, setList] = useState<PeopleList | null>(initial)
  const [tab, setTab] = useState<'people' | 'agencies'>(initialEditor ? 'agencies' : initialTab)
  const [editor, setEditor] = useState<EditorState | null>(initialEditor)
  // the editor remounts on each open (its state is its own)
  const [opened, setOpened] = useState(0)
  const [denied, setDenied] = useState(!isPeopleAdmin(user))
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<Flash>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [removing, setRemoving] = useState<PersonRow | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  const failed = useCallback((e: unknown) => {
    if (e instanceof PeopleError && e.status === 403) { setDenied(true); return }
    setFlash({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
  }, [])

  const reload = useCallback(async () => {
    try {
      const l = await api.list()
      setList(l)
      registerRows(l.agencies)
    } catch (e) { failed(e) }
  }, [api, failed])

  // A read from the server: the list is set when it answers.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!denied && !initial) void reload() }, [denied, initial, reload])
  // The rows' published looks wear their pills (the registry, as /api/agency-looks would give it).
  useEffect(() => { if (initial) registerRows(initial.agencies) }, [initial])

  // Escape closes the page, and only it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (draft) setDraft(null)
      else if (editor) setEditor(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [draft, editor, onClose])

  const agencies = useMemo(() => list?.agencies ?? [], [list])
  // the one just added first, as the mock shows it
  const rows = useMemo(() => findPeople(list?.people ?? [], q, agencies).sort((a, b) => Number(b.id === fresh) - Number(a.id === fresh)), [list, q, agencies, fresh])

  const add = async () => {
    if (!draft) return
    const known = recogniseAgency(draft.agency, agencies)
    setBusy(true)
    setFlash(null)
    try {
      let agencyId = known
      if (!agencyId) {
        // a new agency from here is made and published at once (a basic agency: name and two colours)
        const made = await api.createAgency({ name: (draft.shown ?? '').trim() || draft.agency.trim(), base: draft.base, accent: draft.accent })
        agencyId = (await api.publish(made.id, made.rev)).id
      }
      const username = draft.touched ? draft.username.trim() : signInNameOf(draft.name, agencyId)
      const p = await api.add({ name: draft.name.trim(), agency: agencyId, username })
      setDraft(null)
      setFresh(p.id)
      setFlash({ kind: 'ok', text: <>{p.name} can sign in now as <b>{p.id}</b>. Nothing to deploy.</> })
      await reload()
    } catch (e) { failed(e) } finally { setBusy(false) }
  }

  const remove = async (p: PersonRow) => {
    setBusy(true)
    try {
      await api.remove(p.id)
      setRemoving(null)
      setFlash({ kind: 'ok', text: <>{p.name ?? p.id} can no longer sign in. Their documents and decisions stay.</> })
      await reload()
    } catch (e) { failed(e) } finally { setBusy(false) }
  }

  const rename = async () => {
    if (!renaming || !renaming.name.trim()) return
    setBusy(true)
    try {
      await api.rename(renaming.id, renaming.name)
      setRenaming(null)
      await reload()
    } catch (e) { failed(e) } finally { setBusy(false) }
  }

  const people = list?.people.filter(p => !p.removed_at) ?? []
  const crumb = tab === 'people' ? 'Account ▸ People' : editor ? `Account ▸ People ▸ Agencies ▸ ${editor.look.name || 'New agency'}` : 'Account ▸ People ▸ Agencies'
  const go = (t: 'people' | 'agencies') => { setTab(t); setEditor(null); setDraft(null); setFlash(null) }
  const open = (st: EditorState) => { setFlash(null); setEditor(st); setOpened(n => n + 1) }

  return (
    <div className={PAGE_CLASS} role="dialog" aria-modal="true" aria-labelledby="pa-title" data-testid="people-page" data-look="napkin">
      <style>{napkinPageCss()}</style>
      <header className="pa-bar">
        <span className="pa-pill" style={pillStyle(NAPKIN_COLOURS)}>Napkin Studio</span>
        <span className="pa-crumb" data-testid="people-crumb">{crumb}</span>
        <span className="pa-sp" />
        <button type="button" className="pa-btn sm" onClick={onClose}>Close</button>
        {user && <span className="pa-crumb">{user}{isPeopleAdmin(user) ? ' · admin' : ''}</span>}
      </header>
      <main className="pa-wrap">
        <h1 id="pa-title">People</h1>
        {denied ? (
          <p className="pa-lede" data-testid="people-denied">Only a Napkin admin can change who signs in. Ask <b>Shrey</b> or another admin to add someone.</p>
        ) : (
          <>
            <p className="pa-lede">Who can sign in to Napkin Studio, and how each agency looks.</p>
            <div className="ag-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'people'} className={tab === 'people' ? 'on' : ''} onClick={() => go('people')}>People <small>{list ? people.length : ''}</small></button>
              <button type="button" role="tab" aria-selected={tab === 'agencies'} className={tab === 'agencies' ? 'on' : ''} onClick={() => go('agencies')}>Agencies <small>{list ? agencies.length : ''}</small></button>
            </div>
            {flash && <div className={flash.kind === 'ok' ? 'pa-ok' : 'pa-err'} role="status">{flash.text}</div>}
            {tab === 'agencies' ? (
              editor ? (
                <AgencyEditor key={opened} api={api} initial={editor} user={user ?? 'you'}
                  onBack={f => { setEditor(null); if (f) setFlash({ kind: 'ok', text: <><b>{f.lead}</b> {f.text}</> }) }}
                  onChanged={() => void reload()} />
              ) : (
                <AgenciesList rows={agencies} onOpen={r => open(openRow(r))} onNew={() => open(openNew())} />
              )
            ) : (
              <>
                {removing && (
                  <div className="pa-warn" role="alertdialog" aria-label="Remove a person">
                    <span>Remove <b>{removing.name ?? removing.id}</b> ({removing.id})? They can’t sign in after this; their documents and decisions stay, with their name.</span>
                    <span className="pa-acts">
                      <button type="button" className="pa-btn" onClick={() => setRemoving(null)}>Keep</button>
                      <button type="button" className="pa-btn pa-red" disabled={busy} onClick={() => void remove(removing)}>Remove</button>
                    </span>
                  </div>
                )}
                {draft ? (
                  <AddSheet draft={draft} setDraft={setDraft} agencies={agencies} busy={busy} onCancel={() => setDraft(null)} onAdd={() => void add()} />
                ) : (
                  <div className="pa-tools">
                    <input className="pa-search" placeholder="Find a person or agency" aria-label="Find a person or agency" value={q} onChange={e => setQ(e.target.value)} />
                    <button type="button" className="pa-btn pa-primary" onClick={() => { setFlash(null); setDraft({ ...FRESH }) }}>Add a person</button>
                  </div>
                )}
                <table className="pa-table">
                  <thead><tr><th>PERSON</th><th>AGENCY</th><th>ROLE</th><th>ADDED</th></tr></thead>
                  <tbody>
                    {!list && <tr><td colSpan={4}><small>Reading who can sign in…</small></td></tr>}
                    {rows.map(p => {
                      const look = personLook(p.agency, agencies)
                      return (
                        <tr key={p.id}>
                          <td>
                            {renaming?.id === p.id ? (
                              <span className="pa-rename">
                                <input aria-label={`New name for ${p.id}`} value={renaming.name} autoFocus
                                  onChange={e => setRenaming({ id: p.id, name: e.target.value })}
                                  onKeyDown={e => { if (e.key === 'Enter') void rename() }} />
                                <button type="button" className="pa-btn" onClick={() => setRenaming(null)}>Cancel</button>
                                <button type="button" className="pa-btn pa-primary" disabled={busy || !renaming.name.trim()} onClick={() => void rename()}>Save</button>
                              </span>
                            ) : <b>{p.name ?? p.id}</b>}
                            <br /><small>{p.id}</small>
                          </td>
                          <td className="pa-ag" data-agency={p.agency}>{look ? <LookPill colours={look} small /> : p.agency}</td>
                          <td>{p.admin ? <span className="pa-tag pa-admin">ADMIN</span> : fresh === p.id ? <span className="pa-tag pa-new">NEW</span> : <small>member</small>}</td>
                          <td>
                            <small>{addedLine(p, fresh === p.id)}</small>
                            <span className="pa-act">
                              <button type="button" className="pa-link" onClick={() => setRenaming({ id: p.id, name: p.name ?? '' })}>Rename</button>
                              {!p.admin && <button type="button" className="pa-link" onClick={() => { setFlash(null); setRemoving(p) }}>Remove</button>}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                    {list && rows.length === 0 && <tr><td colSpan={4}><small>No one matches “{q}”.</small></td></tr>}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}

/** Add a person: name and agency, the recognised agency's card, the sign-in name, and a new agency's look. */
export function AddSheet({ draft, setDraft, agencies, busy, onCancel, onAdd }: {
  draft: Draft
  setDraft: (d: Draft) => void
  agencies: readonly AgencyRow[]
  busy: boolean
  onCancel: () => void
  onAdd: () => void
}) {
  const id = recogniseAgency(draft.agency, agencies)
  const typed = draft.agency.trim()
  const known: AgencyColours | null = id ? agencyColours(id, agencies) : null
  const count = id ? agencies.find(a => a.id === id)?.people ?? 0 : 0
  const look = newAgencyLook(draft.shown ?? typed, draft.base, draft.accent)
  const username = draft.touched ? draft.username : signInNameOf(draft.name, id ?? (agencySlug(typed) || null))
  const set = (over: Partial<Draft>) => setDraft({ ...draft, ...over })
  const ready = !!draft.name.trim() && !!typed && !busy

  return (
    <section className="pa-sheet" aria-label="Add a person" data-testid="people-add">
      <h2>Add a person</h2>
      <div className="pa-grid">
        <div><label htmlFor="pa-nm">Name</label><input id="pa-nm" placeholder="As people see it" value={draft.name} onChange={e => set({ name: e.target.value })} /></div>
        <div>
          <label htmlFor="pa-ag">Agency</label>
          <input id="pa-ag" list="pa-ag-list" placeholder="Pick or type an agency" value={draft.agency} onChange={e => set({ agency: e.target.value })} />
          <datalist id="pa-ag-list">{agencies.filter(isPublished).map(a => <option key={a.id} value={a.name}>{a.id}</option>)}</datalist>
        </div>
      </div>
      <div className="pa-agcard" data-testid="agency-card" data-agency={id ?? (typed ? 'new' : 'none')}>
        {known && id ? (
          <>
            <span className="pa-pv" style={pillStyle(known)}>{known.name}</span>
            <span><b>{known.name}</b> <small>· {id} · {count} {count === 1 ? 'person' : 'people'} · its look is set</small></span>
          </>
        ) : typed ? (
          <>
            <span className="pa-pv" style={pillStyle(look)}>{look.name}</span>
            <span><b>New agency</b> <small>· id {agencySlug(typed) || '?'} · set its look below</small></span>
          </>
        ) : <small>Pick an agency, or type a new one.</small>}
      </div>
      <div className="pa-grid" style={{ marginTop: 10 }}>
        <div>
          <label htmlFor="pa-em">Sign-in name</label>
          <input id="pa-em" value={username} onChange={e => {
            const v = e.target.value
            const ag = agencyFieldFromSignInName(v, agencies)
            set({ username: v, touched: true, ...(ag ? { agency: ag } : {}) })
          }} />
        </div>
        <div className="pa-hint" style={{ alignSelf: 'end' }}>Made from the name and the agency; change it if you like. Typing <b>name@agency</b> here sets the agency too.</div>
      </div>
      {!id && typed && (
        <div className="pa-newag" data-testid="new-agency">
          <h2>New agency: {typed}</h2>
          <div className="pa-grid">
            <div><label htmlFor="pa-shown">Name as shown</label><input id="pa-shown" value={draft.shown ?? typed} placeholder={typed} onChange={e => set({ shown: e.target.value })} /></div>
            <div>
              <label htmlFor="pa-tpl">Start from a look</label>
              <select id="pa-tpl" value={draft.from} onChange={e => {
                const from = agencyColours(e.target.value, agencies)
                set({ from: e.target.value, ...(from ? { base: from.base, accent: from.accent } : {}) })
              }}>
                <option value="">Plain</option>
                {agencies.filter(isPublished).map(a => <option key={a.id} value={a.id}>Like {a.name}</option>)}
              </select>
            </div>
          </div>
          <div className="pa-grid" style={{ marginTop: 10 }}>
            <div><label htmlFor="pa-base">Base colour</label><input id="pa-base" type="color" className="pa-colour" value={draft.base.toLowerCase()} onChange={e => set({ base: e.target.value.toUpperCase(), from: '' })} /></div>
            <div><label htmlFor="pa-acc">Accent colour</label><input id="pa-acc" type="color" className="pa-colour" value={draft.accent.toLowerCase()} onChange={e => set({ accent: e.target.value.toUpperCase(), from: '' })} /></div>
          </div>
          <div className="pa-hint">Every other colour, light and dark, is worked out from these two. A logo can be added later; until then its name and initials stand in.</div>
        </div>
      )}
      <div className="pa-acts pa-end">
        <button type="button" className="pa-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="pa-btn pa-primary" disabled={!ready} onClick={onAdd}>Add</button>
      </div>
    </section>
  )
}
