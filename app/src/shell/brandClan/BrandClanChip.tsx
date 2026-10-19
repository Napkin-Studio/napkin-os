// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Brand Clan chip, in the OS bar of every document whose app accepts one
// (Contract 6 §4.6). Empty: "Set the Brand Clan". Set: the brand's name and
// its version. Behind: "v6 in the Brand Clan · Update". Clicking opens the
// popover. Nothing changes until the person chooses; a refusal from the host
// is shown in the popover in its own words.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { host } from '../../host'
import type { AttachReply, AttachTarget, BrandCandidate } from '../../host'
import BrandClanPopover from './BrandClanPopover'
import type { Naming } from './BrandClanPopover'
import { identifyBrand, makeBrandClan, newCandidates } from './naming'
import { Toast } from './Toast'
import { useToast } from './useToast'
import { useAttached } from './useAttached'
import { chipState, doneWords, errorWords } from './words'
import './BrandClan.css'

interface Props {
  /** Identifies the open document, so what is attached is read again when it changes. */
  docPath: string
  /** `app.attach.accepts` of the open document's app. */
  accepts: readonly string[] | undefined
  /** The document is locked: read-only. */
  locked: boolean
  /** The host wrote something to the document: read it again, and tell the app. */
  onChanged: (clan?: unknown) => void
}

export default function BrandClanChip({ docPath, accepts, locked, onChanged }: Props) {
  const enabled = !!accepts?.length
  const { entries, reload } = useAttached(docPath, enabled)
  const state = chipState({ accepts, attached: entries, locked })
  const [open, setOpen] = useState(false)
  const [targets, setTargets] = useState<AttachTarget[] | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDetach, setConfirmDetach] = useState(false)
  const [naming, setNaming] = useState<Naming>({ step: 'none' })
  const { toast, say } = useToast()
  const anchor = useRef<HTMLDivElement>(null)
  const id = useId()

  const loadTargets = useCallback(() => {
    host.attachTargets().then(setTargets, e => { setTargets([]); setError(errorWords(e)) })
  }, [])

  useEffect(() => { if (open) loadTargets() }, [open, loadTargets])

  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => { if (!anchor.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', esc) }
  }, [open])

  /** After the host wrote: read what is attached and the list again, and have the app read the document. */
  const wrote = useCallback((clan?: unknown) => { reload(); loadTargets(); onChanged(clan) }, [reload, loadTargets, onChanged])

  const run = useCallback(async (key: string, work: () => Promise<AttachReply | { ok: boolean }>, brand: string, say_?: (r: AttachReply) => string) => {
    setBusy(key); setError(null)
    try {
      const r = await work()
      wrote((r as { clan?: unknown }).clan)
      setConfirmDetach(false); setNaming({ step: 'none' }); setQuery('')
      if (say_) say({ title: say_(r as AttachReply) })
      else say({ title: `${brand} is detached.` })
      setOpen(false)
    } catch (e) {
      setError(errorWords(e))
    } finally {
      setBusy(null)
    }
  }, [wrote, say])

  if (state.kind === 'hidden') return null

  const attachThis = (t: AttachTarget) =>
    run(`attach:${t.document_id}`, () => host.attach(t.document_id), t.title, r => doneWords(r.verb, t.title, r.kept))

  const on = {
    onQuery: (q: string) => { setQuery(q); setError(null) },
    onPick: (t: AttachTarget) => { void attachThis(t) },
    onUpdate: () => {
      const e = state.entry
      if (e) void run('update', () => host.attachUpdate(e.document_id), state.brand, r => doneWords(r.verb, state.brand, r.kept))
    },
    onDetachAsk: () => { setConfirmDetach(true); setError(null) },
    onDetachConfirm: () => {
      const e = state.entry
      if (e) void run('detach', () => host.detach(e.app_id), state.brand)
    },
    onDetachCancel: () => setConfirmDetach(false),
    // "Make a Brand Clan for X": ask the middleware which brands X may be.
    onMake: (typed: string) => {
      setError(null); setBusy('naming'); setNaming({ step: 'looking', typed })
      identifyBrand(host, typed).then(
        found => {
          const fresh = newCandidates(found, targets ?? [])
          if (fresh.length) setNaming({ step: 'choose', typed, candidates: fresh })
          else void make(typed, { name: typed })
        },
        e => { setNaming({ step: 'none' }); setError(errorWords(e)); setBusy(null) },
      )
    },
    onCandidate: (c: BrandCandidate) => { void make(c.name, { ref: c.ref, name: c.name }) },
    onNewBrand: (typed: string) => { void make(typed, { name: typed }) },
    onNamingCancel: () => { setNaming({ step: 'none' }); setError(null) },
  }

  async function make(name: string, from: { ref: string; name: string } | { name: string }) {
    setBusy('naming'); setError(null); setNaming({ step: 'making', name })
    try {
      const r = await makeBrandClan(host, from)
      wrote((r as { clan?: unknown }).clan)
      setQuery(''); setNaming({ step: 'none' })
      say({ title: doneWords(r.verb, name, r.kept) })
      setOpen(false)
    } catch (e) {
      setNaming({ step: 'none' })
      setError(errorWords(e))
      loadTargets()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="ch-menu-anchor bc-anchor" ref={anchor}>
      <button
        type="button"
        className={`ch-btn bc-chip bc-${state.kind}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-pop` : undefined}
        title={state.title}
        data-dogfood="brand clan chip"
        onClick={() => setOpen(o => !o)}
      >
        <span className="bc-dot" aria-hidden />
        {state.label}
        {state.readOnly && <span className="bc-lock"> · locked</span>}
      </button>
      {open && (
        <BrandClanPopover
          id={id}
          state={state}
          targets={targets}
          query={query}
          busy={busy}
          error={error}
          confirmDetach={confirmDetach}
          naming={naming}
          canName={host.hasMiddleware}
          on={on}
        />
      )}
      <Toast toast={toast} />
    </div>
  )
}
