// A generating node's inputs strip (ui-behaviour 3.16, 3.3): "Inputs", then one chip per link into the
// node ("Script · First Light", "Locations · 2", "@maya_front", "golden hour · lighting"), read from
// scopeOf (model/scope.ts), so it shows what the editors and the send tray show, and changes as soon as
// a link is made or taken away. The node cards on both engines render it (canvas/nodes/cards.tsx).

import { useDoc } from '../app/context'
import { inputChips, scopeOf, scopeRefs, type ScopeItem } from '../model/scope'
import { useBlobUrl } from '../ui/hooks'
import './inputs.css'

/** At most this many chips; the rest are counted ("+2"). */
const SHOWN = 4

export function InputsStrip({ nodeId }: { nodeId: string | undefined }) {
  const doc = useDoc()
  if (!nodeId) return null
  const chips = inputChips(scopeOf(doc, nodeId))
  if (!chips.length) return null
  const more = chips.length - SHOWN
  return (
    <div className="in-strip" aria-label={`Inputs: ${chips.map((c) => c.label).join(', ')}`}>
      <span className="in-label">Inputs</span>
      {chips.slice(0, SHOWN).map((c) => <InputChip key={`${c.kind}:${c.id}`} item={c} />)}
      {more > 0 && <span className="in-chip in-more" title={chips.slice(SHOWN).map((c) => c.label).join(', ')}>+{more}</span>}
    </div>
  )
}

function InputChip({ item }: { item: ScopeItem }) {
  const url = useBlobUrl(item.asset)
  return (
    <span className={`in-chip kind-${item.kind}`} title={item.words ?? (item.drawn ? `${item.label} · drawn` : item.label)}>
      {url && <img src={url} alt="" />}
      <span className={item.kind === 'ref' ? 'in-ref' : undefined}>{item.label}</span>
    </span>
  )
}

/**
 * An editor's scope line (the Storyboard editor's sub bar): the inputs strip, then every reference in
 * scope, its own link's, a linked board's or the script's, with the shots that name it, then names
 * the text uses that are not linked ("not linked") or name nothing ("no ref yet").
 */
export function ScopeLine({ nodeId, shotNumber }: { nodeId: string | undefined; shotNumber: (shotId: string) => number }) {
  const doc = useDoc()
  if (!nodeId) return null
  const items = scopeOf(doc, nodeId)
  const refs = scopeRefs(items)
  const chips = inputChips(items)
  if (!refs.length && !chips.length) return null
  return (
    <div className="in-scope" aria-label="What this storyboard uses">
      <InputsStrip nodeId={nodeId} />
      {refs.length > 0 && (
        <div className="in-refs" role="list" aria-label={`References · ${refs.length}`}>
          <span className="in-label">References · {refs.length}</span>
          {refs.map((r) => {
            const nums = r.usedBy.map(shotNumber).filter((n) => n > 0)
            const why = r.kind === 'unknown' ? 'no ref yet' : r.via === 'mention' ? 'not linked' : r.via === 'board' ? 'on a linked board' : r.via === 'upstream' ? 'from the script' : r.role
            return (
              <span key={`${r.kind}:${r.id}`} role="listitem" className={`in-chip ${r.kind === 'unknown' ? 'in-unknown' : r.via === 'mention' ? 'in-unlinked' : ''}`} title={`@${r.name} · ${why}${nums.length ? ` · shots ${nums.join(', ')}` : ''}`}>
                <RefThumb sha={r.asset} />
                <span className="in-ref">@{r.name}</span>
                {r.kind === 'unknown' || r.via === 'mention' ? <span className="in-why">{why}</span> : null}
                {nums.length > 0 && <span className="in-shots">{nums.join(' ')}</span>}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RefThumb({ sha }: { sha?: string }) {
  const url = useBlobUrl(sha)
  return url ? <img src={url} alt="" /> : null
}
