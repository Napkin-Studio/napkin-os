// 'This script' at the foot of Skye's Booth (features/script-freeform.clan, owner 2026-11-16; mock
// script-freeform-v1): the length against its target, the ratio, and the references the script uses.
// Moved from the Script editor's right column; same sources (model/scope.ts, script/length.ts).

import { newUlidId } from '../../../clan-store/src'
import { useServices } from '../app/context'
import type { ProductionDocument } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { scopeOf, scopeRefs, type ScopeItem } from '../model/scope'
import { scriptText } from '../model/selectors'
import { linkForMention, linkWords } from '../text/mention/source'
import { roughSeconds, type ComposedScript } from './compose'
import { meterSegments } from './skyeBooth'
import { setScriptTarget } from './length'
import { LengthPicker } from './LengthPicker'
import type { ModelStore } from '../model/store'

const secs = (n: number) => `${Math.round(n * 10) / 10} s`

export function ScriptFacts({ composed, doc, store, current, onError, say }: {
  composed: ComposedScript
  doc: ProductionDocument
  store: ModelStore
  current?: string
  onError: (m: string | null) => void
  say: (m: string, undo?: boolean) => void
}) {
  const { doc: docStore } = useServices()
  const sb = composed.storyboard
  const scriptId = composed.script.id
  const shots = composed.shots
  const target = sb?.target_s ?? composed.script.target_s
  const rough = !shots.length ? roughSeconds(scriptText(doc, scriptId)) : null
  const est = Math.round((rough ?? composed.total_s) * 10) / 10
  const over = Math.round((est - target) * 10) / 10
  const segs = meterSegments(doc, composed)
  const setLength = (seconds: number) => {
    onError(null)
    void updateDoc(docStore, (d) => setScriptTarget(d, scriptId, sb?.id, seconds), `set the script length to ${seconds} s`)
      .catch((e) => onError(e instanceof Error ? e.message : 'That length did not save.'))
  }
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
  const words = est > 0
  return (
    <section className="bt-facts" aria-label="This script">
      <div className="bt-sec"><span className="pt-label">This script</span><span className="ct">{sb?.ratio ?? '16:9'}</span></div>
      <div className="line">
        <span>Length · <LengthPicker value={target} onPick={setLength} /> target</span>
        <span>{!words ? '—' : shots.length ? `${secs(est)} in ${shots.length} ${shots.length === 1 ? 'shot' : 'shots'}` : `about ${secs(est)} from the words`}</span>
      </div>
      <div className="bt-meter" role="img" aria-label={words ? `${secs(est)} of ${target} s` : 'No words yet'}>
        {segs.map((x) => <span key={x.id} className={`seg ${x.id === current ? 'cur' : ''}`} style={{ flexGrow: x.s }} />)}
        {!segs.length && <span className="seg" style={{ flexGrow: 1, opacity: 0.5 }} />}
        {words && est < target && <span className="seg rest" style={{ flexGrow: target - est }} />}
        {words && <span className="target" style={{ left: `${Math.min(100, (target / Math.max(est, target)) * 100)}%` }} />}
      </div>
      <div>
        {!words ? <span className="bt-pill">no words yet</span>
          : over > 0 ? <span className="bt-pill warn">{secs(over)} over</span>
            : <span className="bt-pill ok">{secs(-over)} to spare</span>}
      </div>
      {(refs.length > 0 || unlinked.length > 0) && (
        <div className="line" aria-label={`References · ${refs.length}`}>
          <span>References</span>
          <span className="bt-refs">
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
            {unlinked.length > 0 && (
              <select className="select xs" aria-label="Link a reference to this script" value="" onChange={(e) => e.target.value && link(e.target.value)}>
                <option value="">+ Link</option>
                {unlinked.map((r) => <option key={r.id} value={r.id}>@{r.key}_{r.variant} · {r.role}</option>)}
              </select>
            )}
          </span>
        </div>
      )}
    </section>
  )
}
