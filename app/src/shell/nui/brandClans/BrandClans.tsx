// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The client page's Brand Clans section (docs/contracts/brand-clan.md section 6),
// built to the approved mocks: the list with the default marked (b1), the
// rendered Brand Bible (b2), the review of a new version (b3), editing in
// place (f1), the draft with its marks (f2), the publish confirm (f3), the
// published state (f3b), the history (f4) and an old version, read-only (f4b).
// The screens are the controller's; this draws them.

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { BrandBehind, BrandChange, BrandClanSummary, BrandClanView } from '../../../host/types'
import { Bible, type Edits } from './Bible'
import type { BrandClansController, BrandState } from './controller'
import { useBrandState } from './hooks'
import * as M from './model'
import { Pop } from '../Pop'
import { usePop } from '../popKit'
import './brandClans.css'

/** Addresses for the pictures a Bible names, resolved once each. */
function useSrc(c: BrandClansController, path: string | undefined, assets: (string | undefined)[]) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = assets.filter(Boolean).join('|')
  useEffect(() => {
    if (!path) return
    let live = true
    for (const a of assets) {
      if (!a || urls[a]) continue
      c.api.assetUrl(path, M.assetName(a)).then(u => { if (live) setUrls(p => (p[a] ? p : { ...p, [a]: u })) }, () => {})
    }
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, path, key])
  return (a: string | undefined) => (a ? urls[a] : undefined)
}

const Swatches = ({ hex }: { hex: string[] }) => <span className="bcm-sw" aria-hidden>{hex.map(h => <i key={h} style={{ background: h }} />)}</span>

interface Props {
  controller: BrandClansController
  /** The client's name, for "Tidewell · Zero". */
  name: string
  /** Server-rendered tests hand in the state; the page reads it from the controller. */
  state?: BrandState
  /** The category's players this client's research found and no Brand Clan holds yet (phase 2): offered, never written. */
  found?: M.ResearchFound[]
}

export function BrandClans({ controller: c, name, state, found = [] }: Props) {
  const live = useBrandState(c)
  const s = state ?? live
  const count = s.list?.items.length ?? 0
  const view = s.view
  const pics: (string | undefined)[] = useMemo(() => {
    if (!view) return []
    const b = s.candidate ?? view.draft?.candidate ?? view.data
    return [...M.logos(b).map(l => l.asset), ...M.examples(b).map(x => x.asset), ...M.logos(view.data).map(l => l.asset), ...M.examples(view.data).map(x => x.asset)]
  }, [s.candidate, view])
  const src = useSrc(c, view?.path, pics)
  const listSrc = useListLogos(c, s.list?.items ?? [])

  return (
    <section className="cp-sec" aria-label={`Brand Clans for ${name}`} data-testid="brand-clan" id="bcm">
      <div className="cp-hrow bcm-hrow">
        <h2 className="cp-h">Brand Clans{count > 0 && <small>{count}</small>}</h2>
        {s.screen === 'list'
          ? <span className="cp-new"><button type="button" className="cp-plus" title="New Brand Clan" aria-label="New Brand Clan" data-testid="brand-new" onClick={() => c.startAdding()}>+</button></span>
          : <button type="button" className="side-link" data-testid="brand-all" onClick={() => void c.back()}>All Brand Clans</button>}
      </div>
      {s.screen === 'list' && <Found s={s} c={c} found={found} />}
      {s.screen === 'list' && <List s={s} c={c} name={name} src={listSrc} />}
      {view && s.screen !== 'list' && s.screen !== 'history' && s.screen !== 'changes' && <Screen s={s} c={c} view={view} name={name} src={src} />}
      {view && s.screen === 'history' && <History s={s} c={c} view={view} name={name} />}
      {view && s.screen === 'changes' && <Changes s={s} c={c} view={view} name={name} />}
    </section>
  )
}

function useListLogos(c: BrandClansController, items: BrandClanSummary[]) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = items.map(i => `${i.path}:${i.logo ?? ''}`).join('|')
  useEffect(() => {
    let live = true
    for (const i of items) {
      if (!i.logo || urls[i.path]) continue
      c.api.assetUrl(i.path, M.assetName(i.logo)).then(u => { if (live) setUrls(p => ({ ...p, [i.path]: u })) }, () => {})
    }
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, key])
  return urls
}

// ── b1: the list ─────────────────────────────────────────────────────────────

/** "Research found the category's players": take them into the default Brand Clan's draft, or not now (Brand Clan phase 2). */
function Found({ s, c, found }: { s: BrandState; c: BrandClansController; found: M.ResearchFound[] }) {
  const [gone, setGone] = useState<string[]>([])
  const items = s.list?.items ?? []
  const target = items.find(i => i.default) ?? items[0]
  const f = found.find(x => !gone.includes(x.document_id))
  if (!f || !target) return null
  const names = f.items.map(i => i.name)
  return (
    <div className="bcm-found" role="note" data-testid="brand-found">
      <p><b>Research found the category’s players:</b> {names.join(', ')} <span className="bcm-hint">in “{f.title}”</span></p>
      <p className="bcm-hint">Add them to {target.name}’s draft: nothing changes for work until someone publishes it.</p>
      <div className="bcm-acts">
        <button type="button" className="bcm-sm on" disabled={s.busy} data-testid="brand-found-add" onClick={() => void c.addFound(target.path, f)}>Add to the draft of {target.name}</button>
        <button type="button" className="bcm-sm" disabled={s.busy} onClick={() => setGone(g => [...g, f.document_id])}>Not now</button>
      </div>
    </div>
  )
}

function List({ s, c, name, src }: { s: BrandState; c: BrandClansController; name: string; src: Record<string, string> }) {
  const items = s.list?.items ?? []
  const [text, setText] = useState('')
  const add = (e: FormEvent) => { e.preventDefault(); const n = text.trim(); if (n) void c.create(n) }
  return (
    <div className="cp-box">
      {s.adding && (
        <form className="bcm-form" aria-label="New Brand Clan" data-testid="brand-add-form" onSubmit={add}
          onKeyDown={e => { if (e.key === 'Escape') c.stopAdding() }}>
          <label>Name of this look<input autoFocus maxLength={60} value={text} placeholder={items.length ? 'Zero, Summer 26…' : 'Original'} onChange={e => setText(e.target.value)} /></label>
          <button type="submit" className="bcm-sm on" disabled={s.busy || !text.trim()}>Make it</button>
          <button type="button" className="bcm-sm" onClick={() => c.stopAdding()}>Cancel</button>
          <p className="bcm-hint" style={{ flexBasis: '100%' }}>Made empty. A brand book added in a Brief, Research or Production builds it for you.</p>
        </form>
      )}
      {s.error && <p className="bcm-err" role="alert">{s.error}</p>}
      {items.length === 0 && !s.loading && !s.adding && (
        <div className="bcm-empty" data-testid="brand-none">
          <b>No Brand Clan yet</b> for {name}. Its logos, colours and voice will live here, and every document for {name} can use them.
          Add its brand book in a Brief, Research or Production and Napkin will ask to build one, or make one by hand with the +.
        </div>
      )}
      {items.map(l => (
        <div className="bcm-row" key={l.path} data-testid="brand-item">
          <span className="bcm-thumb">{src[l.path] ? <img className="bcm-pic" src={src[l.path]} alt="" /> : null}</span>
          <button type="button" className="side-link" style={{ textDecoration: 'none' }} onClick={() => void c.open(l.path)}>
            <b style={{ fontSize: 14 }}>{name} · {l.name}</b>
            {l.default && <span className="bcm-tag" style={{ marginLeft: 8 }}>Default</span>}
            {l.pending && <span className="bcm-tag w" style={{ marginLeft: 8 }}>New version to review</span>}
            {l.draft && <span className="bcm-tag n" style={{ marginLeft: 8 }}>Draft v{l.draft.based_on + 1} · {M.plural(l.draft.changes, 'change')}</span>}
            <br /><span style={{ font: '12px var(--font-mono)', color: 'var(--muted)', fontWeight: 400 }}>v{l.version}{l.note ? ` · ${l.note}` : ''}</span>
          </button>
          <Swatches hex={l.palette} />
          {l.default ? <span style={{ width: 84 }} /> : <button type="button" className="bcm-sm" data-testid="make-default" disabled={s.busy} onClick={() => void c.makeDefault(l.document_id)}>Make default</button>}
        </div>
      ))}
    </div>
  )
}

// ── b2, f1 to f4b: one Brand Bible ───────────────────────────────────────────

function Screen({ s, c, view, name, src }: { s: BrandState; c: BrandClansController; view: BrandClanView; name: string; src: (a: string | undefined) => string | undefined }) {
  const screen = s.screen
  const edit = screen === 'edit'
  const draft = screen === 'draft' || screen === 'confirm'
  const old = screen === 'old'
  const justPublished = s.published && screen === 'bible'
  const next = view.version + 1
  const shown = edit ? s.candidate! : draft ? view.draft!.candidate : view.data
  const nChanges = view.draft?.changes.length ?? 0
  const current = old && view.shown.version === view.version
  const sub = (text: string) => <div style={{ font: '12px var(--font-mono)', color: 'var(--muted)', marginTop: 2 }}>{text}</div>
  const built = view.data.kit.changelog?.find(e => e.version === view.shown.version)

  const edits: Edits = {
    setLogoNote: t => c.edit(b => M.setLogoNote(b, t)),
    setColour: (id, p) => c.edit(b => M.setColour(b, id, p)),
    addColour: () => c.edit(b => M.addColour(b)),
    removeColour: id => c.edit(b => M.removeColour(b, id)),
    setFace: (id, p) => c.edit(b => M.setFace(b, id, p)),
    addFace: () => c.edit(b => M.addFace(b)),
    removeFace: id => c.edit(b => M.removeFace(b, id)),
    setTone: t => c.edit(b => M.setTone(b, t)),
    setRule: (id, t) => c.edit(b => M.setRule(b, id, t)),
    addRule: () => c.edit(b => M.addRule(b)),
    removeRule: id => c.edit(b => M.removeRule(b, id)),
    setStyle: t => c.edit(b => M.setImageryStyle(b, t)),
    setBans: bans => c.edit(b => M.setBans(b, bans)),
    removeExample: id => c.edit(b => M.removeExample(b, id)),
    pick: (kind, file, id) => {
      void file.arrayBuffer().then(async buf => {
        const path = await c.putAsset({ name: file.name, bytes: new Uint8Array(buf) })
        if (!path) return
        c.edit(b => (kind === 'logo' ? M.putLogo(b, path, file.name.replace(/\.[^.]+$/, ''), id) : M.addExample(b, path)))
      })
    },
  }

  return (
    <div className="cp-box" data-testid="brand-bible" data-screen={screen}>
      <div className="bcm-top" style={{ padding: '14px 16px 0', justifyContent: 'space-between' }}>
        <div>
          <b style={{ font: '700 16px var(--font-ui)' }}>{name} · {view.name}</b>{' '}
          <span style={{ font: '12px var(--font-mono)', color: 'var(--muted)' }}>
            {old ? (current ? `v${view.shown.version} · published` : `v${view.shown.version} · read-only`)
              : justPublished ? `v${s.published!.version} · published`
              : draft ? `Draft v${next} · ${M.plural(nChanges, 'change')}`
              : edit ? `Editing · v${view.version}` : `Brand Bible · v${view.version}`}
          </span>
          {view.default && !edit && !old && <span className="bcm-tag" style={{ marginLeft: 8 }}>Default</span>}
          {draft && view.draft && sub(`Edited by ${M.who(view.draft.edited_by.at(-1))} · ${M.when(view.draft.edited_at)} · open work still uses v${view.version}`)}
          {justPublished && view.data.kit.published && sub(`Published by ${M.who(view.data.kit.published.by)} · ${M.when(view.data.kit.published.at)}`)}
          {old && built && sub(`${built.from.kind === 'build' && built.from.file ? `Built from ${built.from.file}` : built.summary} · ${M.who(built.by)} · ${M.when(built.at)}`)}
        </div>
        <div className="bcm-top">
          {screen === 'bible' && <>
            <button type="button" className="bcm-sm" onClick={() => void c.showHistory()}>History</button>
            {!view.default && <button type="button" className="bcm-sm" data-testid="make-default" disabled={s.busy} onClick={() => void c.makeDefault(view.document_id)}>Make default</button>}
            <button type="button" className="bcm-sm on" data-testid="brand-edit" onClick={() => c.startEdit()}>Edit</button>
          </>}
          {edit && <>
            <button type="button" className="bcm-sm" onClick={() => c.cancelEdit()}>Cancel</button>
            <button type="button" className="bcm-sm on" data-testid="save-draft" disabled={s.busy} onClick={() => void c.saveDraft()}>Save as draft</button>
          </>}
          {screen === 'draft' && <>
            <button type="button" className="bcm-sm" disabled={s.busy} onClick={() => void c.discard()}>Discard</button>
            <button type="button" className="bcm-sm" onClick={() => c.startEdit()}>Keep editing</button>
            <button type="button" className="bcm-sm on" data-testid="publish" onClick={() => c.confirm()}>Publish v{next}</button>
          </>}
          {screen === 'confirm' && <button type="button" className="bcm-sm" onClick={() => c.unconfirm()}>Back</button>}
          {old && <>
            {!current && <button type="button" className="bcm-sm" data-testid="start-from" disabled={s.busy} onClick={() => void c.startDraftFrom(view.shown.version)}>Start a draft from this</button>}
            <button type="button" className="bcm-sm on" onClick={() => c.backToHistory()}>Back to history</button>
          </>}
        </div>
      </div>
      {s.error && <p className="bcm-err" role="alert">{s.error}</p>}
      {screen === 'bible' && view.draft && !justPublished && (
        <div className="bbm-pub" style={{ background: 'var(--paper-2)', color: 'var(--ink-soft)' }}>
          <span>There is a draft of v{next} ({M.plural(nChanges, 'change')}) that open work does not use.</span>
          <button type="button" className="bcm-sm" onClick={() => void c.open(view.path)}>Open the draft</button>
        </div>
      )}
      {screen === 'bible' && view.pending && (
        <div className="bbm-pub" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
          <span><b>A new version is waiting for you.</b></span>
          <button type="button" className="bcm-sm" onClick={() => void c.open(view.path)}>Review it</button>
        </div>
      )}
      {screen === 'confirm' && view.draft && (
        <div className="bbm-conf" data-testid="publish-confirm">
          <b>Publish {view.name} v{next}?</b>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
            {view.draft.changes.map(ch => <li key={ch.id}><b>{M.AREA_WORD[ch.area] ?? ch.area}</b> {ch.text}</li>)}
          </ul>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 10px' }}>Work already made keeps v{view.version}. It gets an Update chip; nothing changes until someone presses it.</p>
          <div className="bcm-top">
            <button type="button" className="bcm-sm on" data-testid="publish-go" disabled={s.busy} onClick={() => void c.publish()}>Publish v{next}</button>
            <button type="button" className="bcm-sm" onClick={() => c.unconfirm()}>Back</button>
          </div>
        </div>
      )}
      {justPublished && (
        <div className="bbm-pub" data-testid="published"><span><b>{view.name} v{s.published!.version} · published.</b> Open work that uses {view.name} now shows “Brand Clan updated · Update”. Nothing in it changes until someone presses Update.</span></div>
      )}
      {edit && <div className="bbm-pub" style={{ background: 'var(--paper-2)', color: 'var(--ink-soft)' }}><span>Change anything here. Edits stay in a draft that only you see, until you publish.</span></div>}
      <Bible bible={shown} data={view.data} mode={edit ? 'edit' : draft ? 'draft' : old ? 'old' : 'view'} changes={view.draft?.changes} src={src} edits={edit ? edits : undefined} />
    </div>
  )
}

// ── f4: history ──────────────────────────────────────────────────────────────

function History({ s, c, view, name }: { s: BrandState; c: BrandClansController; view: BrandClanView; name: string }) {
  const rows = s.history ?? []
  const from = (e: { from: { kind: string; file?: string; version?: number }; by: string }) => {
    const k = e.from.kind
    const how = k === 'build' ? `Built from ${e.from.file ?? 'a brand book'}` : k === 'upload' ? `From an upload: ${e.from.file ?? 'a file'}` : k === 'restore' ? `Brought back from v${e.from.version}` : k === 'create' ? 'Made by hand' : 'Edited'
    return `${k === 'edit' || k === 'restore' || k === 'create' ? (k === 'edit' ? 'Edited by' : how + ' by') : `${how} ·`} ${M.who(e.by)}`.replace('Edited by Edited', 'Edited by')
  }
  return (
    <div className="cp-box" data-testid="brand-history">
      <div className="bcm-top" style={{ padding: '14px 16px 8px', justifyContent: 'space-between' }}>
        <div><b style={{ font: '700 16px var(--font-ui)' }}>{name} · {view.name}</b> <span style={{ font: '12px var(--font-mono)', color: 'var(--muted)' }}>History</span></div>
        <button type="button" className="bcm-sm" onClick={() => void c.closeHistory()}>Back to {view.name}</button>
      </div>
      {s.error && <p className="bcm-err" role="alert">{s.error}</p>}
      {rows.map(h => (
        <div className="bbm-hist" key={`${h.version}-${h.state}`} data-testid="history-row">
          <span className="bbm-v">v{h.version}</span>
          <div><b>{h.summary}</b><small>{from(h)} · {M.when(h.at)}</small></div>
          {h.state === 'draft'
            ? <button type="button" className="bcm-sm" onClick={() => void c.open(view.path)}>Open</button>
            : <button type="button" className="bcm-sm" onClick={() => void c.openVersion(h.version)}>Open, read-only</button>}
        </div>
      ))}
      <p style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 18px 14px' }}>Every edit records who made it. Old versions never change.</p>
    </div>
  )
}

// ── b3: what changed in a new version ────────────────────────────────────────

function show(v: unknown, area: string): React.ReactNode {
  if (v === null || v === undefined || v === '') return <span style={{ color: 'var(--faint)' }}>None</span>
  const o = v as Record<string, string>
  const dot = (hex: string) => <i style={{ display: 'inline-block', width: 14, height: 14, background: hex, borderRadius: 4, verticalAlign: -2, marginRight: 6 }} />
  switch (area) {
    case 'colour': return <>{dot(o.hex)}{o.name} {o.hex}</>
    case 'typography': return `${o.family}${[o.weight, o.use].filter(Boolean).length ? ' ' + [o.weight, o.use].filter(Boolean).join(' ') : ''}`
    case 'rule': return o.text
    case 'logo': return o.label
    case 'example': return 'Example picture'
    case 'source': return o.file
    default: return String(v)
  }
}

function Changes({ s, c, view, name }: { s: BrandState; c: BrandClansController; view: BrandClanView; name: string }) {
  const p = view.pending!
  const list: BrandChange[] = p.changes
  const on = list.filter(x => s.taken[x.id]).length
  const file = p.from.file ?? p.source?.file ?? 'The new file'
  return (
    <div className="cp-box" data-testid="brand-changes">
      <div className="bcm-top" style={{ padding: '14px 16px 0', justifyContent: 'space-between' }}>
        <div><b style={{ font: '700 16px var(--font-ui)' }}>{name} · {view.name}</b> <span style={{ font: '12px var(--font-mono)', color: 'var(--muted)' }}>v{view.version + 1}, waiting for you · v{view.version} is current</span></div>
      </div>
      {s.error && <p className="bcm-err" role="alert">{s.error}</p>}
      <div className="bcm-banner"><span><b>{file} changed {M.plural(list.length, 'thing')}.</b> Work already made keeps v{view.version} until you update it.</span>
        <span className="bcm-top">
          <button type="button" className="bcm-sm on" data-testid="accept" disabled={s.busy || on === 0} onClick={() => void c.accept()}>{on === list.length ? `Accept all ${list.length}` : `Accept ${on} of ${list.length}`}</button>
          <button type="button" className="bcm-sm" data-testid="keep-old" disabled={s.busy} onClick={() => void c.keepOld()}>Keep v{view.version}</button>
        </span>
      </div>
      <div style={{ padding: '6px 16px 16px' }}>
        {list.map(ch => {
          const taken = !!s.taken[ch.id]
          return (
            <div className="bcm-chg" key={ch.id} data-testid="waiting-change">
              <small>{M.AREA_WORD[ch.area] ?? ch.area}</small>
              <div className="bcm-old">{ch.old == null ? <span style={{ opacity: .7 }}>None</span> : <s>{show(ch.old, ch.area)}</s>}</div>
              <div>{ch.new == null ? <b>Removed</b> : <b>{show(ch.new, ch.area)}</b>}</div>
              <span className="bcm-top">
                <button type="button" className={`bcm-sm ${taken ? 'on' : ''}`} aria-pressed={taken} onClick={() => c.toggle(ch.id, true)}>Take</button>
                <button type="button" className={`bcm-sm ${taken ? '' : 'on'}`} aria-pressed={!taken} onClick={() => c.toggle(ch.id, false)}>Keep old</button>
              </span>
            </div>
          )
        })}
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Only a person accepts. Accepted changes become v{view.version + 1}; v1 to v{view.version} stay on record.</p>
      </div>
    </div>
  )
}

// ── f3b: the Update chip on a piece of work ──────────────────────────────────

/** "Brand Clan updated · Update" beside a work document that holds an older version. It changes nothing until Update is pressed. */
export function UpdateChip({ controller: c, behind }: { controller: BrandClansController; behind: BrandBehind }) {
  const pop = usePop<'what'>()
  const [what, setWhat] = useState<Awaited<ReturnType<BrandClansController['whatChanged']>> | null>(null)
  const [busy, setBusy] = useState(false)
  const open = (el: HTMLElement) => { pop.toggle('what', el); void c.whatChanged(behind).then(setWhat, () => setWhat([])) }
  return (
    <span className="bcm-upd" data-testid="update-chip"> · Brand Clan updated ·
      <button type="button" aria-haspopup="dialog" onClick={e => open(e.currentTarget)}>Update</button>
      {pop.open?.key === 'what' && (
        <Pop anchor={pop.open.anchor} onClose={pop.close} label="What changed in the Brand Clan" testid="update-what">
          <div className="bcm-chip-pop">
            <h4>{behind.brand_name} v{behind.held} to v{behind.current}</h4>
            {what === null ? <p className="bcm-hint">Reading what changed…</p> : (
              <ul>{what.flatMap(w => w.changes.length ? w.changes.map(ch => <li key={`${w.version}-${ch.id}`}>{ch.text}</li>) : [<li key={w.version}>{w.summary}</li>])}</ul>
            )}
            <p className="bcm-hint" style={{ marginBottom: 10 }}>Only this document changes, and only when you press Update.</p>
            <div className="bcm-top">
              <button type="button" className="bcm-sm on" data-testid="update-go" disabled={busy}
                onClick={async () => { setBusy(true); await c.update(behind); setBusy(false); pop.close(false) }}>Update</button>
              <button type="button" className="bcm-sm" onClick={() => pop.close(true)}>Not now</button>
            </div>
          </div>
        </Pop>
      )}
    </span>
  )
}
