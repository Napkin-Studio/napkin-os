// The target length in the Script editor's length meter (ui-behaviour 3.10; features/script-editor.clan):
// the common ad lengths, and "Other…" for any whole number of seconds from 1 to 600. Each pick is one
// write (script/length.ts), so one undo step.

import { useRef, useState } from 'react'
import { cleanTarget, lengthChoices, MAX_TARGET_S, MIN_TARGET_S } from './length'

export function LengthPicker({ value, onPick, disabled }: { value: number; onPick: (seconds: number) => void; disabled?: boolean }) {
  const [custom, setCustom] = useState<string | null>(null)
  // Enter closes the box and the blur that follows must not write a second time.
  const closed = useRef(false)
  if (custom !== null) {
    const done = (keep: boolean) => {
      if (closed.current) return
      closed.current = true
      const s = keep ? cleanTarget(custom) : null
      setCustom(null)
      if (s !== null && s !== value) onPick(s)
    }
    return (
      <span className="se-target custom">
        <input type="number" inputMode="numeric" min={MIN_TARGET_S} max={MAX_TARGET_S} step={1} autoFocus
          aria-label="Target length in seconds" value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onBlur={() => done(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); done(true) }
            if (e.key === 'Escape') { e.preventDefault(); done(false) }
          }} /> s
      </span>
    )
  }
  return (
    <span className="se-targetwrap">
      <select className="se-target" aria-label="Target length" value={String(value)} disabled={disabled} title="Change the target length"
        style={{ width: `${String(value).length + 2}ch` }}
        onChange={(e) => {
          if (e.target.value === 'other') { closed.current = false; setCustom(String(value)); return }
          const s = cleanTarget(e.target.value)
          if (s !== null && s !== value) onPick(s)
        }}>
        {lengthChoices(value).map((n) => <option key={n} value={String(n)}>{n} s</option>)}
        <option value="other">Other…</option>
      </select>
    </span>
  )
}
