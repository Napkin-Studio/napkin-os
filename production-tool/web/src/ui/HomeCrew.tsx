// The whole crew on Home (owner, 2026-10-15: "We have more agents right?"): the seven of ui-behaviour 5.1
// and the crew sheet (mock Crew.dc.html), in its order, five who make the ad and then the two house
// agents, each signed with the work they do. Drawn from AgentFigure, never by hand.

import { AgentFigure } from './agents/AgentFigure'
import { CAST, CREW_ORDER, HOUSE_AGENTS } from './agents/cast'

/** The first-visit row: every crew member, named, with what they do. */
export function CrewRow({ size = 44 }: { size?: number }) {
  return (
    <ul className="hm-crew" aria-label="The crew">
      {CREW_ORDER.map((k) => (
        <li key={k} className={`hm-mate${HOUSE_AGENTS.includes(k) ? ' house' : ''}`} title={CAST[k].role}>
          <AgentFigure agent={k} size={size} decorative />
          <b>{CAST[k].given}</b>
          <span>{CAST[k].job}</span>
        </li>
      ))}
    </ul>
  )
}

/** The New project card's line of figures: the same seven, small and unlabelled. */
export function CrewLine({ size = 40 }: { size?: number }) {
  return <div className="hm-crewline" aria-hidden>{CREW_ORDER.map((k) => <AgentFigure key={k} agent={k} size={size} decorative />)}</div>
}
