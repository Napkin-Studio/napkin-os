// The script's facts in the Script editor's band (features/production-new-ui.clan; mock production-new-ui-v2
// scriptBand): "N shots · 16:9 · target [10 s ▾]" and how the words fit it ("about 11 s · 1 s over"), and
// References · N, a small list of what the script links and names (model/scope.ts, ui-behaviour 3.16) with
// + Link. Moved from 'This script' at the foot of the Script agent's Booth (features/script-freeform.clan).

import { useRef, useState } from 'react'
import { newUlidId } from '../../../clan-store/src'
import { useServices } from '../app/context'
import type { ProductionDocument } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { scopeOf, scopeRefs, type ScopeItem } from '../model/scope'
import { linkForMention, linkWords } from '../text/mention/source'
import { Float } from '../ui/Float'
import { roughSeconds, roughText, type ComposedScript } from './compose'
import { setScriptTarget } from './length'
import { LengthPicker } from './LengthPicker'
import type { ModelStore } from '../model/store'

const secs = (n: number) => `${Math.round(n * 10) / 10} s`

/** The script's length against its target, as the band says it. */
function lengthOf(doc: ProductionDocument, composed: ComposedScript) {
  const sb = composed.storyboard
  const target = sb?.target_s ?? composed.script.target_s
  const shots = composed.shots
  const rough = !shots.length ? roughSeconds(roughText(doc, composed.script.id)) : null
  // A rough length from the words is said in whole seconds (the mock's "about 11 s"); planned shots to a tenth.
  const est = rough !== null ? Math.round(rough) : Math.round(composed.total_s * 10) / 10
  return { target, est, over: Math.round((est - target) * 10) / 10, rough: rough !== null }
}

export function ScriptLength({ composed, doc, onError }: { composed: ComposedScript; doc: ProductionDocument; onError: (m: string | null) => void }) {
  const { doc: docStore } = useServices()
  const sb = composed.storyboard
  const n = composed.shots.length
  const { target, est, over, rough } = lengthOf(doc, composed)
  const setLength = (seconds: number) => {
    onError(null)
    void updateDoc(docStore, (d) => setScriptTarget(d, composed.script.id, sb?.id, seconds), `set the script length to ${seconds} s`)
      .catch((e) => onError(e instanceof Error ? e.message : 'That length did not save.'))
  }
  return (
    <span className="se-facts" aria-label="This script">
      <span className="meta">{n ? `${n} ${n === 1 ? 'shot' : 'shots'} · ` : ''}{sb?.ratio ?? '16:9'} · target</span>
      <LengthPicker value={target} onPick={setLength} />
      {est > 0
        ? <span className={`fit ${over > 0 ? 'over' : ''}`}>{rough ? 'about ' : ''}{secs(est)} · {over > 0 ? `${secs(over)} over` : `${secs(-over)} to spare`}</span>
        : <span className="fit none">no words yet</span>}
    </span>
  )
}

export function ScriptRefs({ composed, doc, store, onError, say }: {
  composed: ComposedScript
  doc: ProductionDocument
  store: ModelStore
  onError: (m: string | null) => void
  say: (m: string, undo?: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const scriptId = composed.script.id
  const shots = composed.shots
  // Everything linked into the script and what its words name (model/scope.ts, ui-behaviour 3.16).
  const refs = scopeRefs(scopeOf(doc, scriptId))
  const numbers = (it: ScopeItem) => it.usedBy.map((id) => shots.findIndex((s) => s.id === id) + 1).filter((n) => n > 0)
  const inScope = new Set(refs.filter((i) => i.kind === 'ref' && i.via !== 'mention').map((i) => i.id))
  const unlinked = Object.values(doc.refs).filter((r) => !inScope.has(r.id))
  const link = (refId: string, kind: 'ref' | 'key' = 'ref') => {
    const l = linkForMention(doc, { id: refId, kind }, { kind: 'script', id: scriptId }, () => newUlidId('link'))
    if (!l) return
    onError(null)
    void store.change((x) => { x.links[l.id] = l }, { action: `link ${l.from.kind}s[${l.from.id}] to scripts[${scriptId}]` })
      .then(() => say(`Linked ${linkWords(doc, l)} to this script.`, true), (e) => onError(e instanceof Error ? e.message : 'That link did not save.'))
  }
  return (
    <>
      <button ref={ref} type="button" className="sp-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>References · {refs.length}</button>
      <Float anchor={ref} open={open} onClose={() => setOpen(false)} role="dialog" label="References" align="end" className="pt-menu se-refs">
        <div className="lbl">References in this script</div>
        {!refs.length && <p className="faint">Nothing yet. Type @ in the script to bring in a character, place or reference.</p>}
        <span className="bt-refs" aria-label={`References · ${refs.length}`}>
          {refs.map((it) => {
            const nums = numbers(it)
            const title = nums.length ? `In shot${nums.length === 1 ? '' : 's'} ${nums.join(', ')}` : undefined
            if (it.kind === 'unknown') return <span key={`unknown:${it.id}`} className="bt-pill warn bt-ref" data-via="unknown" title={title}>@{it.name} · no ref yet</span>
            if (it.via === 'mention' && (doc.refs[it.id] || it.kind === 'key')) {
              return <button key={`${it.kind}:${it.id}`} type="button" className="bt-pill bt-ref" data-via="mention" title="Named in the script but not linked to it: link it"
                onClick={() => link(it.id, it.kind === 'key' ? 'key' : 'ref')}>@{it.name} · Link</button>
            }
            return <span key={`${it.kind}:${it.id}`} className="bt-pill blue bt-ref" data-via={it.via} title={title}>@{it.name}</span>
          })}
        </span>
        {unlinked.length > 0 && (
          <select className="select xs" aria-label="Link a reference to this script" value="" onChange={(e) => e.target.value && link(e.target.value)}>
            <option value="">+ Link</option>
            {unlinked.map((r) => <option key={r.id} value={r.id}>@{r.key}_{r.variant} · {r.role}</option>)}
          </select>
        )}
      </Float>
    </>
  )
}
