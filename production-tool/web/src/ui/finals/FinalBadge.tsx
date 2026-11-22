// The Final marker (features/pt-final-and-fit.clan; owner-approved mock pt-final-and-fit/mock): a solid ink pill with a
// tick, on a picture that is final. One component for the canvas picture and the Campaign board tile.

export function FinalBadge({ small = false, dot = false }: { small?: boolean; dot?: boolean }) {
  if (dot) return <span className="final-badge dot" role="img" aria-label="Final" title="Final: the Deck Maker takes this picture." />
  return (
    <span className={`final-badge${small ? ' sm' : ''}`} title="Final: the Deck Maker takes this picture.">
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2 6.5l2.6 2.6L10 3.4" /></svg>Final
    </span>
  )
}
