// The studio mark, copied from app/src/brand/StudioMark.tsx (apps don't import
// across each other): one disc, four departments, turned -45°.
import { useId } from 'react'

export function StudioMark({ size = 22 }: { size?: number }) {
  const clip = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" style={{ display: 'block', flexShrink: 0 }} role="img" aria-label="Napkin">
      <clipPath id={clip}><circle cx="11" cy="11" r="11" /></clipPath>
      <g clipPath={`url(#${clip})`} transform="rotate(-45 11 11)">
        <rect x="0" y="0" width="11" height="11" fill="var(--plan)" />
        <rect x="11" y="0" width="11" height="11" fill="var(--create)" />
        <rect x="0" y="11" width="11" height="11" fill="var(--learn)" />
        <rect x="11" y="11" width="11" height="11" fill="var(--produce)" />
      </g>
    </svg>
  )
}
