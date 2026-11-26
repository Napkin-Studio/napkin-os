// What the Booth calls a node a Brief node feeds (brief/BriefBooth.tsx).
import type { LinkEndpoint, ProductionDocument } from '../contracts/types'
import { osBriefSource } from './os'

const OS = osBriefSource()

/** Where Open in Brief Maker goes for a Brief node. */
export function briefOpenUrl(d: ProductionDocument, briefId: string): string | undefined {
  const b = d.briefs?.[briefId]
  return b ? OS.openUrl(b.source.document_id) : undefined
}

/** What a node the brief feeds is called in the Booth. */
export function feedLabel(kind: LinkEndpoint['kind']): { title: string; sub: string } {
  switch (kind) {
    case 'script': return { title: 'Script', sub: 'Linked: in its scope, carried on to its storyboard and film' }
    case 'storyboard': return { title: 'Storyboard', sub: 'Linked straight: replaces the script’s brief here' }
    case 'video': return { title: 'Film', sub: 'Linked straight: replaces the script’s brief here' }
    case 'format_set': return { title: 'Sizes', sub: 'Linked straight: the sizes read this brief' }
    default: return { title: kind, sub: 'Linked' }
  }
}
