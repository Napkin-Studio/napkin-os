// Assets › From Napkin (features/brief-node.clan; live test 2026-11-18: "you can link one later from Assets ›
// From Napkin" led to an empty tab). The agency's Brief Maker briefs, newest first; Link puts the brief's
// node on the canvas beside the film's Script and links it in (brief/canvas.ts linkBriefLater). A brief
// already on this canvas says so and shows it. Briefs are read-only here: Brief Maker writes them.

import { useEffect, useMemo, useState } from 'react'
import { useDoc } from '../app/context'
import type { NodeEnv } from '../canvas/nodes/nodes'
import { fitClear } from '../canvas/boards/boards'
import { briefElement, linkBriefLater } from './canvas'
import { briefFromDocument } from './model'
import { pageBriefSource, type BriefSource, type OsBriefItem } from './os'
import { briefChoices, offersStartFromBrief } from './start'
import './brief.css'

const message = (e: unknown) => (e instanceof Error ? e.message : 'That brief could not be linked. Try again.')

export function BriefsFromNapkin({ env, src: given }: { env: NodeEnv | null; src?: BriefSource }) {
  const doc = useDoc()
  const src = useMemo(() => given ?? pageBriefSource(), [given])
  const [offers, setOffers] = useState<boolean | null>(null)
  const [briefs, setBriefs] = useState<{ items: OsBriefItem[]; empty?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  // How long the brief has been on its way (UAT round 3 R3-6, UX 8: "Linking…" for over a minute with nothing else
  // said). Napkin's document read is the slow part; the line says so while it waits.
  const [waited, setWaited] = useState(0)
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setWaited((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [busy])
  useEffect(() => {
    let live = true
    void offersStartFromBrief(src).then(async (yes) => {
      if (!live) return
      setOffers(yes)
      if (yes) {
        const got = await briefChoices(src)
        if (live) setBriefs(got)
      }
    })
    return () => { live = false }
  }, [src])

  if (offers === null) return <p className="hint" role="status">Looking for your agency’s briefs…</p>
  if (!offers) return <p className="hint">Nothing from Brief Maker or Research here: this page cannot read Napkin’s briefs.</p>
  const link = async (b: OsBriefItem) => {
    if (!env || busy) return
    setBusy(b.documentId)
    setSaid(`Reading “${b.title}” from Napkin…`)
    setWaited(0)
    try {
      const read = await src.read(b.documentId)
      setSaid(`Putting “${b.title}” on the canvas…`)
      const r = await linkBriefLater(env, read)
      // Into view with the Script it feeds (it lands left of the Script, maybe off screen).
      const els = [briefElement(env, r.briefId), r.scriptId ? env.canvas.elements().find((e) => !e.isDeleted && (e.customData as { id?: string } | undefined)?.id === r.scriptId) : undefined].filter((e): e is NonNullable<typeof e> => !!e)
      if (els.length) fitClear(env.canvas, els, { zoomFactor: 0.8 })
      const script = r.scriptId ? env.doc.get().scripts[r.scriptId]?.title : undefined
      setSaid(r.scriptId ? `Linked “${b.title}” into ${script && script !== 'Script' ? `Script · ${script}` : 'the Script'}. Every agent now reads it.` : `“${b.title}” is on the canvas. ${r.note ?? ''}`.trim())
    } catch (e) {
      setSaid(message(e))
    } finally {
      setBusy(null)
    }
  }
  const show = (b: OsBriefItem) => {
    const there = briefFromDocument(doc, b.documentId)
    const el = env && there ? briefElement(env, there.id) : undefined
    if (env && el) {
      env.canvas.select([el.id])
      fitClear(env.canvas, [el], { zoomFactor: 0.8 })
    }
  }
  return (
    <section className="bsec fn-briefs" aria-label="Briefs from Brief Maker">
      <h4>Briefs · {briefs?.items.length ?? 0}</h4>
      {!briefs?.items.length && <p className="hint">{briefs?.empty ?? 'No briefs yet. Write one in Brief Maker, then link it here.'}</p>}
      <div className="fn-list">
        {(briefs?.items ?? []).map((b) => {
          const there = briefFromDocument(doc, b.documentId)
          return (
            <div key={b.documentId} className="fn-row">
              <span className="tab">BRIEF</span>
              <span className="t"><b>{b.title}</b>{b.client && <small>{b.client.name}</small>}</span>
              {there
                ? <button type="button" className="sp-btn" onClick={() => show(b)} title="This brief is on the canvas: show it">On the canvas</button>
                : <button type="button" className="sp-btn" disabled={!env || !!busy} title={env ? 'Put its Brief node beside the Script and link it in' : 'Open this project on the new canvas to link a brief'}
                    onClick={() => void link(b)}>{busy === b.documentId ? 'Linking…' : 'Link'}</button>}
            </div>
          )
        })}
      </div>
      {said && <p className="ad-meta" role="status">{said}{busy && waited >= 3 ? ` Napkin is still sending it (${waited} s).` : ''}</p>}
      <p className="hint">A linked brief is a frozen copy: it stays as it is until you update it from its Booth. Research comes here in a later version.</p>
    </section>
  )
}
