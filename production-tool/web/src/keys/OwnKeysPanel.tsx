import { useCallback, useRef, useState } from 'react'
import { useOwnKeys, useOwnKeysStore } from '../app/context'
import { Float } from '../ui/Float'
import { SHEETS } from '../contracts/load'
import { keyUse, OWN_NAMES as NAMES, type OwnKeys, type OwnProvider } from './ownKeys'

export function OwnKeysButton() {
  const keys = useOwnKeys()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const count = Object.keys(keys).length
  return (
    <>
      <button ref={ref} className={`btn sm ${open ? 'on' : ''}`} aria-expanded={open} title="Use your own fal or HeyGen account"
        onClick={() => setOpen(!open)}>
        {count ? `Your keys · ${count}` : 'Your keys'}
      </button>
      <Float anchor={ref} open={open} onClose={close} align="end" role="dialog" label="Your keys" className="ownkeys">
        <OwnKeysPanel onClose={close} />
      </Float>
    </>
  )
}

function OwnKeysPanel({ onClose }: { onClose: () => void }) {
  const ownKeys = useOwnKeysStore()
  const saved = useOwnKeys()
  const [draft, setDraft] = useState<OwnKeys>(saved)
  const changed = (draft.fal ?? '') !== (saved.fal ?? '') || (draft.heygen ?? '') !== (saved.heygen ?? '')
  return (
    <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); ownKeys.set(draft); onClose() }}>
      <b>Use your own accounts</b>
      <span className="faint">Steps your keys cover run on your account and are billed to you. Everything else runs on Runway, on the event's account.</span>
      {(['fal', 'heygen'] as OwnProvider[]).map((p) => (
        <label key={p} className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">{NAMES[p]} key {saved[p] && <span className="faint">· in use</span>}</span>
          <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder={p === 'fal' ? 'For pictures, frames, clips and clip edits' : 'For clips'}
            value={draft[p] ?? ''} onChange={(e) => setDraft({ ...draft, [p]: e.target.value })} />
        </label>
      ))}
      <ul className="ownkeys-use">
        {keyUse(changed ? draft : saved, SHEETS).map((u) => <li key={u.label}><span>{u.label}</span><span className="faint">{u.on}</span></li>)}
      </ul>
      <span className="faint" style={{ fontSize: 11.5 }}>Kept in this tab only: closing it forgets them. They are never saved in your .clan or export. When your provider cannot make a step (a refused key, no credit, an outage), Runway makes it on the event's account instead; if it gave no answer in time, it may still charge you for its attempt.</span>
      <div className="row">
        <button className="btn sm" type="submit" disabled={!changed}>Save</button>
        <button className="btn sm ghost" type="button" disabled={!Object.keys(saved).length}
          onClick={() => { ownKeys.clear(); setDraft({}) }}>Forget my keys</button>
        <span className="spacer" />
        <button className="btn xs ghost" type="button" onClick={onClose}>Close</button>
      </div>
    </form>
  )
}
