// The loader is the Napkin logo at work (ui-behaviour 6; approved artboard Loader): four quadrant
// cards round a centre pin; the leading card is the department of the work (create, plan, learn,
// produce). One SVG pattern, copied verbatim; only width, height, data-work and data-state change.
// The words always sit beside it (a status line, a label): the SVG itself is aria-hidden.
// It turns in two places only (owner, 2026-10-15; ui-behaviour 6.5): the busy pointer's badge
// and the top bar's job pill. Everywhere else a job runs, the crew member doing it shows working
// (ui/agents/AgentFigure). places.test.ts holds that.

import type { Work } from '../agents/cast'
import './loader.css'

export type LoaderState = 'run' | 'finish' | 'queued'

const CARD = 'M16 16 L4.686 4.686 A16 16 0 0 1 27.314 4.686 Z'

export function NapkinLoader({ work = 'create', state = 'run', size = 20 }: {
  work?: Work
  state?: LoaderState
  /** 14 (the busy pointer's badge), 20 (the top bar's job pill). */
  size?: 14 | 20
}) {
  return (
    <svg className="napkin-loader" data-work={work} data-state={state}
      width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <g className="nl-spin">
        <g className="nl-c nl-c3" transform="rotate(90 16 16)"><path className="nl-s" d={CARD} fill="#8B919E" /></g>
        <g className="nl-c nl-c2" transform="rotate(180 16 16)"><path className="nl-s" d={CARD} fill="#DADDE3" /></g>
        <g className="nl-c nl-c1" transform="rotate(270 16 16)"><path className="nl-s" d={CARD} fill="#14161B" /></g>
        <g className="nl-c nl-c0"><path className="nl-s" d={CARD} fill="#FF4F2E" /></g>
      </g>
      <circle className="nl-pin" cx="16" cy="16" r="2.4" fill="#14161B" stroke="#FFFFFF" strokeWidth="1.5" />
    </svg>
  )
}
