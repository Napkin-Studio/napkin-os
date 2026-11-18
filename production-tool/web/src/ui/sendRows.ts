// "What the X agent will send" (features/production-new-ui.clan; mock production-new-ui-v2 sendplan/sendclips): the
// small disclosure beside a paid next step in the bar. No send tray and no price: the rows say what goes with the
// job, the brief included (brief/model.ts briefSendRow: the spine of the Brief node linked into this node or
// carried down to it), and that nothing goes until the person presses the action.

import type { Id, ProductionDocument } from '../contracts/types'
import { briefSendRow } from '../brief/model'

export interface SendRow { key: string; label: string; detail?: string }

/** The rows for an action on `nodeId`: what the action names, then the brief when there is one, then the promise. */
export function sendRows(d: ProductionDocument, nodeId: Id | undefined, what: SendRow[], action: string): SendRow[] {
  const brief = nodeId ? briefSendRow(d, nodeId) : undefined
  return [
    ...what,
    ...(brief ? [{ key: brief.key, label: brief.label, detail: brief.detail }] : []),
    { key: 'promise', label: `Nothing goes until you press ${action}.` },
  ]
}
