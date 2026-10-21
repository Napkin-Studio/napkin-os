// "Set a front for @kapi first" (lib/names.ts FrontsMissingError): Plan shots stops before anything is
// sent when the words name a bare @key with no front. Where that message shows, FrontButtons adds one
// "Choose Kapi's front" per key; it goes to the canvas and opens FrontChooser there, with the key's
// pictures in view. Choosing one renames it key_front (jobs/fronts.ts setFront), one undo step.

import { useContext, useEffect, useState } from 'react'
import { RouterContext, useDoc, useServices, useUi } from '../app/context'
import { canvasActions } from '../canvas/chrome/actions'
import { frontButton, frontKeysIn } from '../lib/names'
import { frontChoices, setFront } from '../jobs/fronts'
import { keyNamed, refName } from '../model/selectors'
import { useBlobUrl } from '../ui/hooks'
import type { NamedRef } from '../contracts/types'
import './fronts.css'

/** The buttons under a "Set a front for …" message: one per key. Nothing for any other message. */
export function FrontButtons({ text }: { text: string | null | undefined }) {
  const keys = frontKeysIn(text)
  const { ui } = useServices()
  const router = useContext(RouterContext)
  if (!keys.length) return null
  const choose = (key: string) => {
    ui.update((u) => { u.chooseFront = key; u.stage = 'character' }, 'choose a front')
    if (router?.get().kind === 'script') router.leave()
  }
  return (
    <span className="fronts-btns">
      {keys.map((k) => <button key={k} type="button" className="btn xs" onClick={() => choose(k)}>{frontButton(k)}</button>)}
    </span>
  )
}

/** On the canvas: the key's pictures; the one chosen becomes its front. */
export function FrontChooser() {
  const key = useUi().chooseFront
  return key ? <ChooseFront key={key} chosen={key} /> : null
}

function ChooseFront({ chosen: key }: { chosen: string }) {
  const doc = useDoc()
  const { doc: store, ui: uiStore } = useServices()
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    // The key's pictures in view, once the canvas shows again.
    const k = keyNamed(doc, key)
    if (!k) return
    const t = setTimeout(() => canvasActions.fitTo({ kind: 'key', id: k.id }), 80)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const close = () => uiStore.update((u) => { delete u.chooseFront }, 'choose a front')
  const pictures = frontChoices(doc, key)
  const front = pictures.find((r) => r.variant === 'front')
  const pick = async (r: NamedRef) => {
    setBusy(true)
    try {
      const name = await setFront(store, r.id)
      setSaid(`@${name} is the front now. Plan shots again when you are ready.`)
    } catch (e) {
      setSaid(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="fronts-chooser" role="dialog" aria-label={frontButton(key)}>
      <header>
        <b>{frontButton(key)}</b>
        <button type="button" className="btn xs ghost" onClick={close} aria-label="Close">Done</button>
      </header>
      <p className="faint">@{key} stands for the whole character, led by its front. Pick the picture that shows it best, face on.</p>
      {pictures.length ? (
        <div className="fronts-grid">
          {pictures.map((r) => <FrontPick key={r.id} r={r} isFront={r === front} disabled={busy} onPick={() => void pick(r)} />)}
        </div>
      ) : <p className="faint">No picture is named @{key}_… on the canvas. Name one (Name… on its bar), then choose it here.</p>}
      {said && <p className="fronts-said" role="status">{said}</p>}
    </section>
  )
}

function FrontPick({ r, isFront, disabled, onPick }: { r: NamedRef; isFront: boolean; disabled: boolean; onPick: () => void }) {
  const url = useBlobUrl(r.asset)
  return (
    <button type="button" className={`fronts-pick ${isFront ? 'on' : ''}`} disabled={disabled || isFront} onClick={onPick}
      aria-label={isFront ? `@${refName(r)} is the front` : `Make @${refName(r)} the front`}>
      {url ? <img src={url} alt="" /> : <span className="fronts-noimg" />}
      <span>@{refName(r)}</span>
      <span className="faint">{isFront ? 'front' : 'Use as front'}</span>
    </button>
  )
}
