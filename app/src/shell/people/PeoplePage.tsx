// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The People page (features/people-admin.clan, agency-looks-admin.clan; the
// approved mocks people-admin-v1 and people-agencies-v3): People | Agencies.
// People: who can sign in, by agency, each agency in its own pill, with their
// roles; add a person by name, agency and roles, change roles, rename, remove,
// import people from a file. Agencies: every agency with its kind (In code,
// Basic, Draft), a new basic agency, and the editor (drafts, previews, the
// wordmark, Publish). The one People screen (features/align-needs-lock-people.clan):
// a Napkin admin sees every agency and alone adds one; an agency's admin sees
// their own agency's people. Reached from the account menu, always in Napkin's look.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { NAPKIN_COLOURS, type AgencyColours } from '../agency/palette'
import { AgenciesList } from './agencies/AgenciesList'
import { AgencyEditor } from './agencies/AgencyEditor'
import { openNew, openRow, type EditorState } from './agencies/editor'
import { LookPill } from './agencies/LookPill'
import { isPublished, personLook, registerRows } from './agencies/model'
import { httpPeopleApi, PeopleError, type PeopleApi, type PeopleList } from './api'
import {
  PAGE_CLASS, ROLE_CHOICES, addedLine, agencyColours, agencyFieldFromSignInName, agencyOfUser, agencySlug, canManagePeople, findPeople,
  isPeopleAdmin, napkinPageCss, newAgencyLook, pillStyle, recogniseAgency, rolesLine, signInNameOf, type AgencyRow, type PersonRow,
} from './model'
import { PeopleImport } from './PeopleImport'
import { InviteRow, type InviteDoc } from '../firstday/InviteRow'
import { INVITE } from '../firstday/words'
import { jobsView } from '../../host/http'
import './PeoplePage.css'
import './agencies/agencies.css'

interface Props {
  /** The signed-in person (`name@agency`). */
  user: string | null
  /** Their roles (the People store's): `admin` opens the page for their own agency. */
  roles?: readonly string[]
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
  /** At least one: a person with none could sign in to nothing. */
  roles: string[]
}

const FRESH: Draft = { name: '', agency: '', username: '', touched: false, shown: null, from: '', base: '#0F6B5C', accent: '#9FE6D8', roles: [] }

const NO_ROLES: readonly string[] = []

export default function PeoplePage({ user, roles: myRoles = NO_ROLES, onClose, api = httpPeopleApi, initial = null, initialTab = 'people', initialEditor = null }: Props) {
  // a Napkin admin manages every agency and alone adds one; an agency's admin manages their own
  const napkin = isPeopleAdmin(user)
  const own = napkin ? null : agencyOfUser(user)
  const [list, setList] = useState<PeopleList | null>(initial)
  const [tab, setTab] = useState<'people' | 'agencies'>(napkin && initialEditor ? 'agencies' : napkin ? initialTab : 'people')
  const [editor, setEditor] = useState<EditorState | null>(initialEditor)
  // the editor remounts on each open (its state is its own)
  const [opened, setOpened] = useState(0)
  const [denied, setDenied] = useState(!canManagePeople(user, myRoles))
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<Flash>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [removing, setRemoving] = useState<PersonRow | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [roling, setRoling] = useState<{ id: string; name: string; roles: string[] } | null>(null)
  const [importing, setImporting] = useState(false)
  const [inviting, setInviting] = useState<{ id: string; name: string; agency: string } | null>(null)
  // the live jobs' documents the admin may name as a first thing to open: their own agency's, read when an invite opens
  const [docs, setDocs] = useState<InviteDoc[]>([])
  useEffect(() => {
    if (!inviting) return
    let live = true
    void jobsView().then(js => { if (live) setDocs((js ?? []).flatMap(j => j.documents.map(d => ({ path: d.path, title: d.title, job: j.number, client: j.client.name })))) })
    return () => { live = false }
  }, [inviting])

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
      else if (inviting) setInviting(null)
      else if (roling) setRoling(null)
      else if (importing) setImporting(false)
      else if (editor) setEditor(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [draft, roling, inviting, importing, editor, onClose])

  const agencies = useMemo(() => list?.agencies ?? [], [list])
  // the one just added first, as the mock shows it
  const rows = useMemo(() => findPeople(list?.people ?? [], q, agencies).sort((a, b) => Number(b.id === fresh) - Number(a.id === fresh)), [list, q, agencies, fresh])

  const add = async () => {
    if (!draft) return
    const known = own ?? recogniseAgency(draft.agency, agencies)
    setBusy(true)
    setFlash(null)
    try {
      let agencyId = known
      if (!agencyId && napkin) {
        // a new agency from here is made and published at once (a basic agency: name and two colours)
        const made = await api.createAgency({ name: (draft.shown ?? '').trim() || draft.agency.trim(), base: draft.base, accent: draft.accent })
        agencyId = (await api.publish(made.id, made.rev)).id
      }
      const username = draft.touched ? draft.username.trim() : signInNameOf(draft.name, agencyId)
      const p = await api.add({ name: draft.name.trim(), agency: agencyId ?? '', username, roles: draft.roles ?? [] })
      setDraft(null)
      setFresh(p.id)
      setFlash({ kind: 'ok', text: <>{p.name} can sign in now as <b>{p.id}</b>, as {rolesLine(p.roles).toLowerCase()}. Nothing to deploy.</> })
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

  const saveRoles = async () => {
    if (!roling || roling.roles.length === 0) return
    setBusy(true)
    try {
      const p = await api.setRoles(roling.id, roling.roles)
      setRoling(null)
      setFlash({ kind: 'ok', text: <>{p.name ?? p.id} is now {rolesLine(p.roles).toLowerCase()}, from their next click. No new sign-in.</> })
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
  const go = (t: 'people' | 'agencies') => { setTab(t); setEditor(null); setDraft(null); setRoling(null); setImporting(false); setFlash(null) }
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
            <p className="pa-lede">{napkin ? 'Who can sign in, with which roles, and how each agency looks.' : 'Who in your agency can sign in, and with which roles.'}</p>
            <div className="ag-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'people'} className={tab === 'people' ? 'on' : ''} onClick={() => go('people')}>People <small>{list ? people.length : ''}</small></button>
              {napkin && <button type="button" role="tab" aria-selected={tab === 'agencies'} className={tab === 'agencies' ? 'on' : ''} onClick={() => go('agencies')}>Agencies <small>{list ? agencies.length : ''}</small></button>}
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
                {inviting && (
                  <InviteRow key={inviting.id} person={inviting.id} name={inviting.name} api={api} onClose={() => setInviting(null)}
                    docs={inviting.agency === agencyOfUser(user) ? docs : []} />
                )}
                {roling && (
                  <section className="pa-sheet" aria-label="Change roles" data-testid="people-roles">
                    <h2>Roles for {roling.name}</h2>
                    <RolesPicker roles={roling.roles} onChange={r => setRoling({ ...roling, roles: r })} />
                    <div className="pa-hint">The change holds on their next click, with no new sign-in. To stop someone signing in, remove them.</div>
                    <div className="pa-acts pa-end">
                      <button type="button" className="pa-btn" onClick={() => setRoling(null)}>Cancel</button>
                      <button type="button" className="pa-btn pa-primary" data-testid="roles-save" disabled={busy || roling.roles.length === 0} onClick={() => void saveRoles()}>Save roles</button>
                    </div>
                  </section>
                )}
                {importing ? (
                  <PeopleImport api={api} agency={own ?? agencyOfUser(user)} onClose={() => setImporting(false)}
                    onImported={r => { setFresh(null); setFlash({ kind: 'ok', text: <>{r.created + r.updated} people can sign in now with the roles in the file.</> }); void reload() }} />
                ) : draft ? (
                  <AddSheet draft={draft} setDraft={setDraft} agencies={agencies} busy={busy} own={own} onCancel={() => setDraft(null)} onAdd={() => void add()} />
                ) : (
                  <div className="pa-tools">
                    <input className="pa-search" placeholder="Find a person or agency" aria-label="Find a person or agency" value={q} onChange={e => setQ(e.target.value)} />
                    <button type="button" className="pa-btn" data-testid="people-import-open" onClick={() => { setFlash(null); setRoling(null); setImporting(true) }}>Import people</button>
                    <button type="button" className="pa-btn pa-primary" onClick={() => { setFlash(null); setRoling(null); setDraft({ ...FRESH, agency: own ?? '' }) }}>Add a person</button>
                  </div>
                )}
                <table className="pa-table" data-testid="people-list">
                  <thead><tr><th>PERSON</th><th>AGENCY</th><th>ROLES</th><th>ADDED</th></tr></thead>
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
                          <td data-testid="person-roles">
                            {p.admin && <span className="pa-tag pa-admin">NAPKIN ADMIN</span>} {fresh === p.id && <span className="pa-tag pa-new">NEW</span>} <small>{rolesLine(p.roles)}</small>
                          </td>
                          <td>
                            <small>{addedLine(p, fresh === p.id)}</small>
                            <span className="pa-act">
                              <button type="button" className="pa-link" data-testid="person-roles-open" onClick={() => { setFlash(null); setDraft(null); setImporting(false); setRoling({ id: p.id, name: p.name ?? p.id, roles: [...(p.roles ?? [])] }) }}>Roles</button>
                              <button type="button" className="pa-link" onClick={() => setRenaming({ id: p.id, name: p.name ?? '' })}>Rename</button>
                              <button type="button" className="pa-link" data-testid="person-invite-open" onClick={() => { setFlash(null); setDraft(null); setRoling(null); setImporting(false); setInviting({ id: p.id, name: p.name ?? p.id, agency: p.agency }) }}>{INVITE.open}</button>
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

/** The roles a person holds, as a row of choices; at least one is asked for where it is used. */
export function RolesPicker({ roles, onChange }: { roles: readonly string[]; onChange: (r: string[]) => void }) {
  return (
    <fieldset className="pa-roles" data-testid="roles-picker">
      <legend>Roles</legend>
      {ROLE_CHOICES.map(r => (
        <label key={r.id} className="pa-role" data-testid={`role-${r.id}`}>
          <input type="checkbox" checked={roles.includes(r.id)}
            onChange={e => onChange(e.target.checked ? [...roles, r.id] : roles.filter(x => x !== r.id))} />
          <span>{r.name}</span>
        </label>
      ))}
    </fieldset>
  )
}

/** Add a person: name, agency and roles, the recognised agency's card, the sign-in name, and a new agency's look. An agency's
 *  admin adds to their own agency (`own`), and only a Napkin admin makes a new agency from here. */
export function AddSheet({ draft, setDraft, agencies, busy, own = null, onCancel, onAdd }: {
  draft: Draft
  setDraft: (d: Draft) => void
  agencies: readonly AgencyRow[]
  busy: boolean
  own?: string | null
  onCancel: () => void
  onAdd: () => void
}) {
  const id = own ?? recogniseAgency(draft.agency, agencies)
  const typed = draft.agency.trim()
  const known: AgencyColours | null = id ? agencyColours(id, agencies) : null
  const count = id ? agencies.find(a => a.id === id)?.people ?? 0 : 0
  const look = newAgencyLook(draft.shown ?? typed, draft.base, draft.accent)
  const username = draft.touched ? draft.username : signInNameOf(draft.name, id ?? (agencySlug(typed) || null))
  const set = (over: Partial<Draft>) => setDraft({ ...draft, ...over })
  const chosen = draft.roles ?? []
  const ready = !!draft.name.trim() && !!typed && chosen.length > 0 && (!!id || !own) && !busy

  return (
    <section className="pa-sheet" aria-label="Add a person" data-testid="people-add">
      <h2>Add a person</h2>
      <div className="pa-grid">
        <div><label htmlFor="pa-nm">Name</label><input id="pa-nm" placeholder="As people see it" value={draft.name} onChange={e => set({ name: e.target.value })} /></div>
        <div>
          <label htmlFor="pa-ag">Agency</label>
          <input id="pa-ag" list="pa-ag-list" placeholder="Pick or type an agency" value={draft.agency} disabled={!!own} onChange={e => set({ agency: e.target.value })} />
          <datalist id="pa-ag-list">{agencies.filter(isPublished).map(a => <option key={a.id} value={a.name}>{a.id}</option>)}</datalist>
        </div>
      </div>
      <div className="pa-agcard" data-testid="agency-card" data-agency={id ?? (typed ? 'new' : 'none')}>
        {own ? (
          <span><b>{own}</b> <small>· your agency: everyone you add joins it</small></span>
        ) : known && id ? (
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
      <div style={{ marginTop: 10 }}><RolesPicker roles={chosen} onChange={r => set({ roles: r })} /></div>
      {!id && typed && !own && (
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
