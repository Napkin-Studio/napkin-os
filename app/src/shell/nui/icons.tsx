// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The mock's tool icons (TOOL_ICON, phase 33): drawn at 24, stroked in the
// current colour, the same on the dial, the rows and the bar.

import type { ReactNode } from 'react'

const PATHS: Record<string, ReactNode> = {
  production: <><rect x="3.5" y="6" width="17" height="12" rx="1.5" /><path d="M10 9.5l4.5 2.5-4.5 2.5z" /></>,
  brief: <><path d="M6 3.5h8.5l3.5 3.5v13.5H6z" /><path d="M14.5 3.5V7H18" opacity=".55" /><line x1="8.8" y1="11" x2="15.2" y2="11" /><line x1="8.8" y1="14" x2="15.2" y2="14" /><line x1="8.8" y1="17" x2="12.6" y2="17" /></>,
  research: <><circle cx="12" cy="5.5" r="2.3" /><circle cx="6.5" cy="18" r="2.3" /><circle cx="17.5" cy="18" r="2.3" /><path d="M12 7.8v4.2M6.5 15.7V12h11v3.7" /></>,
  deck: <><rect x="3.5" y="5" width="17" height="11" rx="1.5" /><line x1="12" y1="16" x2="12" y2="20" /></>,
}

/** The tool's own key for an icon: `prod` and `ads` draw as production, anything else as a brief. */
function iconKey(tool: string | null | undefined): keyof typeof PATHS {
  if (tool === 'prod' || tool === 'ads' || tool === 'production') return 'production'
  if (tool === 'research' || tool === 'deck' || tool === 'brief') return tool
  return 'brief'
}

/** The paths alone, for a group inside another SVG (the dial). */
export function ToolPaths({ tool }: { tool: string | null | undefined }) {
  return <>{PATHS[iconKey(tool)]}</>
}

export function ToolIcon({ tool, width = 1.7 }: { tool: string | null | undefined; width?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[iconKey(tool)]}
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" />
    </svg>
  )
}

export function MoonSun() {
  return (
    <>
      <svg className="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></svg>
      <svg className="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></svg>
    </>
  )
}
