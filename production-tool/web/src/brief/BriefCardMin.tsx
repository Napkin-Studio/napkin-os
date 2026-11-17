// A minimal, unstyled Brief node card (features/brief-node.clan), behind flags.briefNode, so the node can
// be seen and linked end to end before the new UI's compact card lands (mock production-new-ui-v2). The
// new UI replaces this whole file: title, version, proposition and tone are what the compact card shows.

import type { ProductionDocument } from '../contracts/types'

export function BriefCardMin({ doc, id }: { doc: ProductionDocument; id: string }) {
  const b = doc.briefs?.[id]
  if (!b) return null
  return (
    <div className="bl-card bl-brief-min" data-brief={id} style={{ background: 'var(--surface, #fff)', border: '1px solid var(--line, #ccc)', borderRadius: 8, padding: 10, height: '100%', boxSizing: 'border-box', overflow: 'hidden', fontSize: 12 }}>
      <div><b>Brief</b> · {b.title} · v{b.source.taken}</div>
      {b.spine.proposition && <p style={{ margin: '6px 0' }}>{b.spine.proposition}</p>}
      {b.spine.tone && <p style={{ margin: 0, opacity: 0.7 }}>{b.spine.tone}</p>}
    </div>
  )
}
