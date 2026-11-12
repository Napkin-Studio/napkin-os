// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency's people and their roles (features/agency-setup.clan). An admin adds a person, changes
// their roles and removes them; a change reaches that person's next request, with no new sign-in. Anyone
// else in the agency reads the names and roles, and no email (the server cuts it). Nothing here counts,
// scores or ranks a person: it is a list.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { homeView } from '../../host/http'
import { Empty, FailedSave, Loading } from '../../components/states/ScreenStates'
import type { Route } from '../route'
import { editPerson, invitePerson, listPeople, removePerson, type Person } from './api'
import { roleWords, stateWords } from './model'
import '../home/home.css'
import './setup.css'

export interface RoleOption { id: string; title: string }

interface BodyProps {
  people: Person[]
  admin: boolean
  roles: RoleOption[]
  /** The sign-in name whose roles are being changed. */
  editing: string | null
  busy: boolean
  /** The server's own sentence for the last change that did not go through. */
  said: string
  me: string | null
  onAdd: (p: { name: string; email: string; roles: string[] }) => void
  onEdit: (username: string | null) => void
  onSaveRoles: (username: string, roles: string[]) => void
  onRemove: (p: Person) => void
  go: (r: Route) => void
}

const roleTitles = (roles: RoleOption[]) => new Map(roles.map(r => [r.id, r.title]))

/** The page's content for a list that has people in it. */
export function PeopleBody({ people, admin, roles, editing, busy, said, me, onAdd, onEdit, onSaveRoles, onRemove, go }: BodyProps) {
  const titles = roleTitles(roles)
  const live = people.filter(p => p.state !== 'removed')
  const gone = people.filter(p => p.state === 'removed')
  return (
    <>
      {admin && <AddForm roles={roles} busy={busy} onAdd={onAdd} />}
      {said && <p className="su-warn" role="alert" data-testid="people-said">{said}</p>}
      <section className="hm-sec" aria-labelledby="pp-list">
        <h2 className="hm-h" id="pp-list">{live.length} {live.length === 1 ? 'person' : 'people'}</h2>
        <ul className="pp-list" data-testid="people-list">
          {live.map(p => (
            <li key={p.username} className="pp-row" data-testid="person" data-username={p.username}>
              <span className="pp-who">
                <b>{p.name}{p.username === me ? ' (you)' : ''}</b>
                <small>{p.username}{admin && p.email ? ` · ${p.email}` : ''}</small>
              </span>
              {admin && p.state && p.state !== 'active' && <span className="pp-state">{stateWords(p.state)}</span>}
              {editing === p.username ? (
                <RoleEditor roles={roles} current={p.roles} busy={busy} onSave={r => onSaveRoles(p.username, r)} onCancel={() => onEdit(null)} />
              ) : (
                <>
                  <ul className="pp-roles" aria-label={`Roles of ${p.name}`}>
                    {p.roles.map(r => <li key={r} data-role={r}>{roleWords(r, titles)}</li>)}
                  </ul>
                  {admin && (
                    <span className="pp-acts">
                      <button type="button" className="side-link" data-testid="person-roles" onClick={() => onEdit(p.username)} aria-label={`Change roles of ${p.name}`}>Change roles</button>
                      <button type="button" className="side-link" data-testid="person-remove" onClick={() => onRemove(p)} aria-label={`Remove ${p.name}`}>Remove</button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
      {admin && gone.length > 0 && (
        <section className="hm-sec" aria-labelledby="pp-gone">
          <h2 className="hm-h" id="pp-gone">Removed</h2>
          <ul className="pp-list pp-quiet" data-testid="people-removed">
            {gone.map(p => <li key={p.username} className="pp-row"><span className="pp-who"><b>{p.name}</b><small>{p.username}</small></span></li>)}
          </ul>
        </section>
      )}
      {admin && <p className="su-sub"><button type="button" className="side-link" data-testid="people-import" onClick={() => go({ level: 'setup' })}>Bring more people in from a file</button></p>}
    </>
  )
}

function Roles({ roles, picked, onToggle, idp }: { roles: RoleOption[]; picked: string[]; onToggle: (id: string) => void; idp: string }) {
  return (
    <fieldset className="pp-pick">
      <legend>Roles</legend>
      {roles.map(r => (
        <label key={r.id} className="pp-check">
          <input type="checkbox" checked={picked.includes(r.id)} onChange={() => onToggle(r.id)} data-testid={`${idp}-${r.id}`} />
          <span>{r.title}</span>
        </label>
      ))}
    </fieldset>
  )
}

function RoleEditor({ roles, current, busy, onSave, onCancel }: { roles: RoleOption[]; current: string[]; busy: boolean; onSave: (r: string[]) => void; onCancel: () => void }) {
  const [picked, setPicked] = useState(current)
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  return (
    <form className="pp-edit" onSubmit={e => { e.preventDefault(); if (picked.length > 0) onSave(picked) }} data-testid="role-editor">
      <Roles roles={roles} picked={picked} onToggle={toggle} idp="edit" />
      <span className="pp-acts">
        <button type="submit" className="ch-btn su-btn" disabled={busy || picked.length === 0} data-testid="roles-save">Save roles</button>
        <button type="button" className="side-link" onClick={onCancel}>Cancel</button>
      </span>
      {picked.length === 0 && <small className="su-sub">Everyone needs at least one role.</small>}
    </form>
  )
}

function AddForm({ roles, busy, onAdd }: { roles: RoleOption[]; busy: boolean; onAdd: (p: { name: string; email: string; roles: string[] }) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const ok = name.trim() !== '' && email.includes('@') && picked.length > 0
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  return (
    <form className="pp-add" data-testid="person-add" onSubmit={e => { e.preventDefault(); if (ok) { onAdd({ name, email, roles: picked }); setName(''); setEmail(''); setPicked([]) } }}>
      <h2 className="hm-h">Add a person</h2>
      <div className="su-fields">
        <label className="su-lab">Name<input type="text" value={name} maxLength={120} onChange={e => setName(e.target.value)} data-testid="add-name" /></label>
        <label className="su-lab">Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} data-testid="add-email" /></label>
      </div>
      <Roles roles={roles} picked={picked} onToggle={toggle} idp="add" />
      <div className="su-actions"><button type="submit" className="ch-btn su-btn" disabled={busy || !ok} data-testid="add-submit">Add person</button></div>
    </form>
  )
}

type Load = 'loading' | 'ready' | 'failed'

const fetchAll = () => Promise.all([
  listPeople(),
  homeView(),
  fetch('/api/session', { credentials: 'same-origin' }).then(r => r.json()).catch(() => null) as Promise<{ user?: { username: string } } | null>,
])

export function PeoplePage({ go }: { go: (r: Route) => void }) {
  const [load, setLoad] = useState<Load>('loading')
  const [people, setPeople] = useState<Person[]>([])
  const [roles, setRoles] = useState<RoleOption[]>([])
  const [admin, setAdmin] = useState(false)
  const [me, setMe] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const [failed, setFailed] = useState(false)
  const top = useRef<HTMLDivElement>(null)

  const [attempt, setAttempt] = useState(0)
  const apply = useCallback((got: Awaited<ReturnType<typeof fetchAll>>) => {
    const [p, home, s] = got
    if (!p.ok) { setLoad('failed'); return }
    setPeople(p.data)
    const mine = home?.roles.includes('admin') ?? false
    setAdmin(mine)
    setMe(s?.user?.username ?? null)
    setRoles(mine ? [{ id: 'admin', title: 'Admin' }, ...(home?.switcher ?? [])] : [])
    setLoad('ready')
  }, [])
  const read = useCallback(async () => { apply(await fetchAll()) }, [apply])
  useEffect(() => {
    let live = true
    void fetchAll().then(got => { if (live) apply(got) })
    return () => { live = false }
  }, [apply, attempt])
  useEffect(() => { top.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }) }, [])

  const act = async (f: () => ReturnType<typeof editPerson>) => {
    setBusy(true); setSaid(''); setFailed(false)
    const r = await f()
    setBusy(false)
    if (r.ok) { setEditing(null); await read(); return }
    if (r.status === 0 || r.status >= 500) setFailed(true)
    else setSaid(r.message || 'That change could not be made.')
  }

  let body: ReactNode
  if (load === 'loading') body = <Loading what="your people" rows={4} />
  else if (load === 'failed') body = <FailedSave onRetry={() => { setLoad('loading'); setAttempt(a => a + 1) }} primary={false} />
  else if (people.length === 0) {
    body = admin
      ? <Empty line="No one is on the list yet. Bring your people in from a file, and each gets the home that fits their role." example={{ title: 'Example · Agency C, ten people', lines: ['Dara, creative director. Aoife, planning. Cian, account service.'] }} verb="Bring people in from a file" onStart={() => go({ level: 'setup' })} />
      : <Empty line="Your agency has not set up its people list yet. Your studio admin does that." example={{ title: 'Example · Agency C, ten people', lines: ['Dara, creative director. Aoife, planning. Cian, account service.'] }} verb="Back to your home" onStart={() => go({ level: 'agency' })} />
  } else {
    body = (
      <>
        {failed && <FailedSave onRetry={() => void read()} primary={false} compact />}
        <PeopleBody people={people} admin={admin} roles={roles} editing={editing} busy={busy} said={said} me={me}
          onAdd={p => void act(() => invitePerson(p))}
          onEdit={setEditing}
          onSaveRoles={(u, r) => void act(() => editPerson(u, { roles: r }))}
          onRemove={p => { if (window.confirm(`Remove ${p.name}? They can no longer sign in. Their work stays.`)) void act(() => removePerson(p.username)) }}
          go={go} />
      </>
    )
  }

  return (
    <div className="nui nui-page" ref={top} data-testid="people-page">
      <div className="studio-shell">
        <section className="app-head">
          <div className="app-head-text">
            <div className="eyebrow">PEOPLE</div>
            <h1 className="hero-title" tabIndex={-1} data-testid="people-title">Your people<span className="period-dot" aria-hidden /></h1>
            <p className="hero-sub">{admin ? 'Who works here and what they can open. A change reaches them on their next click.' : 'Who works here and what they do.'}</p>
          </div>
          <div className="hm-tools"><button type="button" className="side-link" data-testid="to-home" onClick={() => go({ level: 'agency' })}>Back to your home</button></div>
        </section>
        <main className="hm-main">{body}</main>
      </div>
    </div>
  )
}
