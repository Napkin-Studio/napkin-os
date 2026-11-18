// The Image editor's tool icons, drawn as in the mock (ui-mocks/ImageEditor.dc.html), in currentColor.
import type { ReactNode } from 'react'
import type { ToolId } from './tools'

const TOOL_ICON: Record<ToolId, ReactNode> = {
  select: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2 L13 8 L8 9 L6 14 Z" fill="currentColor" /></svg>,
  brush: (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M15.5 2.5 L8 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7.6 9.2 C5 9.2 4.2 11 4 12.6 C3.8 14.2 2.8 15 2 15.4 C4.5 16.4 9 15.5 9.2 11.6 Z" fill="currentColor" />
    </svg>
  ),
  lasso: (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <ellipse cx="9.5" cy="7" rx="6.5" ry="4.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.4 1.8" />
      <path d="M5 10.5 C4 12.5 6 13.5 5 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  text: <span aria-hidden="true" className="ie-t">T</span>,
  crop: (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M5 1.5 V13 H16.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 5 H13 V16.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  hand: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 8 V3.5 a1 1 0 0 1 2 0 V7 M7 7 V2.5 a1 1 0 0 1 2 0 V7 M9 7 V3.5 a1 1 0 0 1 2 0 V9 c0 3 -2 5 -4.5 5 C4 14 3 12 2.5 10 L2 8.5 a1 1 0 0 1 1.8 -0.8 L5 9"
        fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
}

export function ToolIcon({ id }: { id: ToolId }) {
  return <>{TOOL_ICON[id]}</>
}

export const Eye = ({ hidden }: { hidden: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M1.5 8 C3.5 4.5 12.5 4.5 14.5 8 C12.5 11.5 3.5 11.5 1.5 8 Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    {hidden ? <path d="M2.5 13.5 L13.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /> : <circle cx="8" cy="8" r="2" fill="currentColor" />}
  </svg>
)

export const Lock = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <rect x="2.5" y="6" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M4.5 6 V4.3 a2.5 2.5 0 0 1 5 0 V6" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)
