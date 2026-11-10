// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Decisions drawer, as the approved mock draws it (phases 33 to 36;
// gaps.md §4): over the page with a dimmed backdrop, "DECISIONS / client ·
// document", the call card (each open call with Looks right, Set aside and
// Open; Approve all and lock, per document, through the document's own
// /verify and /approve), then the views: Graph (how it was decided), By part,
// By time (each row with Show in document and its details folded) and
// Lineage (where it came from, You are here, what it fed). In a document it
// is that document's; on the desk the call card lists every call across the
// documents the desk has read, and the views are the first one's.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AttentionItem, DecisionsView, RelatedView } from '../../host'
import { LogoSpinner } from '../../brand/LogoSpinner'
import { looksRightOf, needKey, splitAside } from '../decisions/needs'
import { refOfAddress, sectionsOf } from '../decisions/words'
import { HistoryBody, QuietItem } from '../decisions/DecisionBlock'
import { approveWords, callCount, callWords, graphOf, lineageOf, rowOf } from './drawerData'
import '../decisions/DecisionPanel.css'

export type DrawerView = 'graph' | 'part' | 'time' | 'lineage'

/** Open calls on the card before "Show all N" (the mock lists three). */
export const CALLS_SHOWN = 3

/** One document's calls on the card, and how to settle them. */
export interface CallGroup {
  key: string
  /** The document's name, as the rows' second line says it. */
  title: string
  /** "brief", "research": the Approve button's last word. */
  noun: string
  calls: AttentionItem[]
  /** What this person set aside here: out of the count, still blocking the lock. */
  aside?: ReadonlySet<string>
  onToggleAside?: (key: string) => void
  /** Locked already: nothing to approve. */
  locked: boolean
  verify: (finding: string) => Promise<void>
  approve: () => Promise<void>
  /** Open the call where it is settled. */
  open: (item: AttentionItem) => void
  /** What still stands before the lock, in words. */
  lock?: string | null
}

/** The document the views show. */
export interface Focus {
  title: string
  noun: string
  view: DecisionsView | null
  error?: string | null
  related?: RelatedView | null
  onShow: (ref: string, path?: string) => void
  onOpenPath?: (path: string) => void
  /** "Looks right" on something an agent noticed (Worth a look). */
  acknowledge?: (decision: string) => Promise<void>
  /** "Where it came from", step by step (WorkspaceView). */
  onWorkspace?: () => void
}

interface Props {
  title: string
  groups: CallGroup[]
  /** Documents with calls the desk has not read yet: each opens. */
  pending?: { key: string; title: string; sub: string; onOpen: () => void }[]
  focus?: Focus | null
  view: DrawerView
  onView: (v: DrawerView) => void
  onClose: () => void
  /** Something was settled: read again. */
  onChanged?: () => void
}

export function DecisionsDrawer({ title, groups, pending = [], focus, view, onView, onClose, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const split = groups.map(g => ({ g, ...splitAside(g.calls, g.aside ?? new Set()) }))
  const n = split.reduce((s, x) => s + x.open.length, 0) + pending.length
  // The mock's card lists the first few calls, then "Show all N", so Approve all and the views stay in sight.
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? Infinity : CALLS_SHOWN
  const openRows = split.flatMap(({ g, open }) => open.map(item => ({ g, item })))
  // Approve buttons for the documents whose calls are in sight (all of them after Show all).
  const inSight = new Set(openRows.slice(0, shown).map(r => r.g.key))
  const approvable = groups.filter(g => !g.locked && g.calls.length && (showAll || openRows.length <= CALLS_SHOWN || inSight.has(g.key)))
  const asideN = split.reduce((s, x) => s + x.aside.length, 0)

  const act = async (key: string, run: () => Promise<void>) => {
    setBusy(key); setError(null)
    try { await run(); onChanged?.() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  const row = (g: CallGroup, item: AttentionItem, isAside: boolean) => {
    const k = `${g.key}|${needKey(item)}`
    const w = callWords(item, g.title)
    const lr = !g.locked ? looksRightOf(item) : null
    return (
      <div className="pp-row" style={{ gridTemplateColumns: '1fr' }} key={k} data-testid="call-row">
        <button type="button" data-np-open style={{ textAlign: 'left' }} onClick={() => g.open(item)}>
          <b style={{ fontSize: 13.5 }}>{w.title}</b><span className="pp-sub" style={{ display: 'block' }}>{w.sub}</span>
        </button>
        <span className="pp-acts" style={{ justifyContent: 'flex-start', marginTop: 6 }}>
          {lr && (
            <button type="button" className="sp-btn" data-np-ok disabled={busy === k} data-testid="looks-right"
              onClick={() => act(k, () => g.verify(lr.finding))}>{busy === k ? 'Recording…' : 'Looks right'}</button>
          )}
          {g.onToggleAside && (
            <button type="button" className="side-link" data-np-aside data-testid={isAside ? 'bring-back' : 'set-aside'}
              title={isAside ? 'Back into the count' : 'Out of the count for now. It still stops the lock.'}
              onClick={() => g.onToggleAside!(needKey(item))}>{isAside ? 'Bring back' : 'Set aside'}</button>
          )}
          {item.address && <button type="button" className="side-link" data-np-open data-testid="call-open" onClick={() => g.open(item)}>Open</button>}
        </span>
      </div>
    )
  }

  const approveFor = (g: CallGroup) => {
    if (g.locked || !g.calls.length) return null
    const stuck = g.calls.filter(c => !looksRightOf(c)).length
    const k = `approve|${g.key}`
    return (
      <button key={k} type="button" className="btn-rect primary" id="dtree-approve-all" data-testid="approve-all"
        style={{ minHeight: 32, padding: '0 14px', fontSize: 12 }} disabled={busy === k || stuck > 0}
        title={stuck ? `${stuck} call${stuck === 1 ? ' asks' : 's ask'} for more than a yes: open ${stuck === 1 ? 'it' : 'them'} first` : `Says yes to every call in ${g.title}, then locks it`}
        onClick={() => act(k, async () => {
          for (const c of g.calls) { const lr = looksRightOf(c); if (lr) await g.verify(lr.finding) }
          await g.approve()
        })}>
        {busy === k ? 'Approving…' : approveWords(g.calls.length, g.noun)}{groups.length > 1 ? ` · ${g.title}` : ''}
      </button>
    )
  }

  return (
    <div className="nui">
      <div className="dtree-backdrop" id="dtree-backdrop" onClick={onClose} aria-hidden />
      <aside className="dtree-drawer" id="dtree-drawer" aria-label="Decisions" role="dialog" data-testid="decisions-drawer">
        <header className="dtree-head">
          <div>
            <div className="sec-num" style={{ margin: 0 }}>DECISIONS</div>
            <h3 style={{ font: '800 18px/1.2 var(--font-ui)' }}>{title}</h3>
          </div>
          <button type="button" className="btn-rect" id="dtree-close-btn" style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }} onClick={onClose}
            aria-label="Close decisions">Close</button>
        </header>
        <div className="dtree-body">
          <div className={`dtree-call-card${n ? '' : ' resolved'}`} id="dtree-open-calls-box" data-testid="call-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <b style={{ fontSize: 13.5, ...(n ? {} : { color: 'var(--ok)' }) }} id="dtree-call-title">{n ? callCount(n) : 'Nothing waits for your sign-off'}</b>
              <span className={`badge-pill ${n ? 'proposed' : 'verified'}`} id="dtree-call-badge">{n ? 'Needs you' : 'Done'}</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.45 }} id="dtree-call-desc">
              {n || asideN ? (
                <div className="dc-rows">
                  {openRows.slice(0, shown).map(({ g, item }) => row(g, item, false))}
                  {pending.slice(0, Math.max(0, shown - openRows.length)).map(p => (
                    <div className="pp-row" style={{ gridTemplateColumns: '1fr' }} key={p.key} data-testid="call-row">
                      <button type="button" data-np-open style={{ textAlign: 'left' }} onClick={p.onOpen}>
                        <b style={{ fontSize: 13.5 }}>{p.title}</b><span className="pp-sub" style={{ display: 'block' }}>{p.sub}</span>
                      </button>
                      <span className="pp-acts" style={{ justifyContent: 'flex-start', marginTop: 6 }}>
                        <button type="button" className="side-link" data-np-open onClick={p.onOpen}>Open</button>
                      </span>
                    </div>
                  ))}
                  {n > CALLS_SHOWN && (
                    <button type="button" className="side-link" data-testid="calls-show-all" aria-expanded={showAll}
                      style={{ marginTop: 8 }} onClick={() => setShowAll(v => !v)}>
                      {showAll ? 'Show fewer' : `Show all ${n}`}
                    </button>
                  )}
                  {asideN > 0 && <>
                    <hr />
                    <div className="pp-h" data-testid="set-aside-list">Set aside · {asideN}</div>
                    {split.map(({ g, aside }) => aside.map(item => row(g, item, true)))}
                  </>}
                </div>
              ) : 'Every call is answered and on the record.'}
            </div>
            {groups.map(g => g.lock && <p key={`lock|${g.key}`} className="dp-lock" data-testid="lock-line">{g.lock}</p>)}
            {error && <p className="dp-err" role="alert">{error}</p>}
            {approvable.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} id="dtree-call-actions">{approvable.map(approveFor)}</div>
            )}
          </div>

          {focus && <Views focus={focus} view={view} onView={onView} busy={busy} act={act} />}
        </div>
      </aside>
    </div>
  )
}

function Views({ focus, view, onView, busy, act }: {
  focus: Focus; view: DrawerView; onView: (v: DrawerView) => void
  busy: string | null; act: (key: string, run: () => Promise<void>) => Promise<void>
}) {
  const v = focus.view
  const graph = useMemo(() => (v ? graphOf(v) : []), [v])
  const quiet = useMemo(() => quietOf(v), [v])
  const tabs: [DrawerView, string][] = [['graph', 'Graph'], ['part', 'By part'], ['time', 'By time'], ['lineage', 'Lineage']]
  let body: ReactNode
  if (focus.error) body = <p className="nui-empty">The decisions could not be read: {focus.error}</p>
  else if (!v) body = <div className="dp-loading"><LogoSpinner label="Reading what happened" /></div>
  else if (v.problem) body = <p className="nui-empty">{v.problem}</p>
  else if (view === 'graph') {
    body = (
      <div>
        <div className="sec-num">HOW IT WAS DECIDED · SOURCES → FACTS → DECISIONS → {focus.noun.toUpperCase()}</div>
        {graph.length === 0 ? <p className="nui-empty">Nothing has been decided yet.</p> : (
          <div className="dtree-graph" data-testid="graph">
            {graph.map((s, i) => (
              <div className="dt-node" key={i}>
                <span className="dt-stage">{s.stage}</span>
                <div className="dt-main"><b>{s.title}</b>{s.detail && <span>{s.detail}</span>}</div>
                <span className={`badge-pill ${s.badge.tone}`}>{s.badge.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  } else if (view === 'lineage') {
    const rows = lineageOf(focus.related ?? null, { title: focus.title, noun: focus.noun })
    body = (
      <div className="p33-dlist" id="p33-dlist">
        <div>
          <h5>Where it came from</h5>
          <div className="p33-lineage" data-testid="lineage">
            {rows.map((r, i) => (
              <div className={`ln${r.here ? ' here' : ''}`} key={i}>
                <i aria-hidden />
                <span><b>{r.title}</b><small>{r.sub}</small></span>
                {r.here ? <span className="pp-k">You are here</span>
                  : r.path && focus.onOpenPath ? <button type="button" className="side-link" onClick={() => focus.onOpenPath!(r.path!)}>Open</button> : <span />}
              </div>
            ))}
          </div>
          {focus.onWorkspace && <p style={{ marginTop: 10 }}><button type="button" className="side-link" onClick={focus.onWorkspace}>Step by step</button></p>}
        </div>
      </div>
    )
  } else {
    // By time is one list, newest first (the mock's "What happened, newest first"); By part groups by the part each decision touched.
    const groups = view === 'time' ? [{ key: 'time', title: 'What happened, newest first', blocks: v.decisions }] : sectionsOf(v)
    body = (
      <div className="p33-dlist" id="p33-dlist">
        {groups.length === 0 && <p className="nui-empty">Nothing has happened yet.</p>}
        {groups.map(g => (
          <div key={g.key}>
            <h5>{view === 'time' ? g.title : `${g.title} · ${g.blocks.length}`}</h5>
            {g.blocks.map((b, i) => {
              const r = rowOf(b, v)
              return (
                <div className={`p33-drow ${b.superseded ? 'old' : ''}`} key={b.decision.id ?? i} data-testid="decision-row">
                  <div className="dr-top"><b>{r.what}</b></div>
                  <span className="dr-who">{r.who}</span>
                  <div className="dr-acts">
                    {r.ref && <button type="button" className="side-link" onClick={() => focus.onShow(r.ref!, r.path)}>Show in document</button>}
                    <details><summary>Technical details</summary><code>{r.tech}</code><HistoryBody block={b} view={v} /></details>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        {quiet.length > 0 && (
          <div>
            <h5>Worth a look · {quiet.length}</h5>
            <p className="pp-sub" style={{ marginBottom: 6 }}>The agents noticed these; nothing waits on them.</p>
            {quiet.map(q => (
              <QuietItem key={q.block.decision.id} block={q.block} text={q.text} busy={busy === q.block.decision.id}
                onLooksRight={id => { if (focus.acknowledge) void act(id, () => focus.acknowledge!(id)) }} />
            ))}
          </div>
        )}
      </div>
    )
  }
  return (
    <>
      <div className="seg-row p33-dv" id="p33-dv" role="group" aria-label="Show it">
        {tabs.map(([k, label]) => <button key={k} type="button" data-dv={k} aria-pressed={view === k} onClick={() => onView(k)}>{label}</button>)}
      </div>
      {body}
    </>
  )
}

/**
 * What agents flagged or were unsure of, one item per decision. A decision
 * whose target is already under the call card is not repeated here, and a
 * finding is checked, not waved through.
 */
function quietOf(view: DecisionsView | null) {
  if (!view) return []
  const needy = new Set(view.attention.filter(a => a.blocks_lock).map(a => refOfAddress(a.address)))
  const out: { block: DecisionsView['decisions'][number]; text: string }[] = []
  for (const b of view.decisions) {
    if (b.superseded || b.who.kind !== 'agent' || b.decision.kind === 'finding' || b.decision.kind === 'client_review') continue
    const quiet = b.attention.filter(r => !r.blocks_lock)
    if (!quiet.length) continue
    if (b.targets.some(t => needy.has(refOfAddress(t.address)))) continue
    const flag = quiet.find(r => r.code === 'flagged') ?? quiet[0]
    out.push({ block: b, text: flag.text })
  }
  return out
}
