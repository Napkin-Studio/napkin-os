// A beat's time as a pill ('at 0:02'); click it to type another (0:03.2 keeps 3.0). A time past
// the shot's end is said, and nothing is written (features/script-editor.clan, item 7).

import { useState } from 'react'
import { parseTime, snapTime, timeLabel, timeProblem } from './moments'

export function TimePill({ at, duration, onSet, readOnly }: { at: number; duration: number; onSet: (at: number) => void; readOnly?: boolean }) {
  const [text, setText] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  if (text === null) {
    return (
      <button className="sp-pill" disabled={readOnly} title="When it happens, in the shot. Click to change." onClick={() => { setText(timeLabel(at)); setProblem(null) }}>
        at {timeLabel(at)}
        {problem && <span className="sp-pillproblem" role="alert"> · {problem}</span>}
      </button>
    )
  }
  const commit = () => {
    const t = parseTime(text)
    setText(null)
    if (t === null) return
    const snapped = snapTime(t)
    const p = timeProblem(snapped, duration)
    if (p) return setProblem(p)
    setProblem(null)
    if (snapped !== at) onSet(snapped)
  }
  return (
    <input className="sp-pill input" autoFocus aria-label="Time in the shot" value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setText(null) }
      }} />
  )
}
