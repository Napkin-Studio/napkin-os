// The bar's next step with its "What the X agent will send" disclosure (ui/sendRows.ts): the primary and a ▾ that
// opens the rows. Mock production-new-ui-v2: .split-act, sendplan, sendclips.

import { useRef, useState, type ReactNode } from 'react'
import { Float } from './Float'
import type { SendRow } from './sendRows'

export function SendDisclosure({ primary, who, rows }: { primary: ReactNode; who: string; rows: SendRow[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const title = `What ${who} will send`
  return (
    <span className="split-act">
      {primary}
      <button ref={ref} type="button" className="disc" aria-label={title} title={title} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>▾</button>
      <Float anchor={ref} open={open} onClose={() => setOpen(false)} role="dialog" label={title} align="end" className="pt-menu send-disc">
        <div className="lbl">{title}</div>
        <ul>{rows.map((r) => <li key={r.key} className={r.key === 'promise' ? 'promise' : undefined}><b>{r.label}</b>{r.detail && <small>{r.detail}</small>}</li>)}</ul>
      </Float>
    </span>
  )
}
