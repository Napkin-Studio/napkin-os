// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useEffect, useState, type CSSProperties } from 'react'
import { DeepOMark } from './DeepOMark'
import { lateBegin, lateDelay, lateEnd, waitStart } from './lateShow'
import './LogoSpinner.css'

export type LogoSpinnerSize = 'xs' | 'sm' | 'md' | 'lg'

/** Pixel size of the mark for each named size. */
const LOGO_SPINNER_PX: Record<LogoSpinnerSize, number> = { xs: 16, sm: 20, md: 32, lg: 64 }

export interface LogoSpinnerProps {
  /** A named size, or pixels. Default `md`. */
  size?: LogoSpinnerSize | number
  /** Shown beside (or under, with `stack`) the mark and read out to screen
   *  readers. Without one, screen readers hear "Loading". */
  label?: string
  /** Label under the mark rather than beside it. */
  stack?: boolean
  className?: string
  style?: CSSProperties
}

/**
 * The shell's one loading sign: Deep O working, its arc going round while the
 * length of the wait is unknown (it breathes under prefers-reduced-motion), in
 * the agency's colours (DeepOMark). Use it for anything the OS layer waits on:
 * opening a document, loading a list, an export.
 *
 * For a page with no React, use `staticMarkSvg` and `DEEP_O_CSS` (deepOSvg.ts).
 */
export function LogoSpinner({ size = 'md', label, stack = false, className, style }: LogoSpinnerProps) {
  const px = typeof size === 'number' ? size : LOGO_SPINNER_PX[size]
  const cls = ['logo-spinner', stack && 'logo-spinner-stack', className].filter(Boolean).join(' ')
  return (
    <span className={cls} style={style} role="status" aria-live="polite">
      <span className="logo-spinner-mark" aria-hidden>
        <DeepOMark size={px} state="working" />
      </span>
      {label
        ? <span className="logo-spinner-label">{label}</span>
        : <span className="logo-spinner-sr">Loading</span>}
    </span>
  )
}

/**
 * The animation-delay that shows a full-surface sign only on a slow wait
 * (lateShow.ts): the same clock as the boot screen, so the hand-off from it, and
 * from one sign to the next, never fades the mark out and in again.
 */
function useLateDelay(): number {
  // Still in the page while the first render runs, before React's commit replaces it.
  const [start] = useState(() => waitStart(performance.now(), typeof document !== 'undefined' && typeof document.querySelector === 'function' && !!document.querySelector('.napkin-boot')))
  const [delay] = useState(() => lateDelay(start, performance.now()))
  useEffect(() => { lateBegin(start); return () => lateEnd() }, [start])
  return delay
}

/**
 * A spinner centred in the space it is given — a panel, a pane, a screen — on
 * the desk, as the boot screen is (brand/bootLook.ts); it appears only on a slow wait.
 */
export function LogoSpinnerFill({ label, size = 'lg' }: Pick<LogoSpinnerProps, 'label' | 'size'>) {
  const delay = useLateDelay()
  return (
    <div className="logo-spinner-fill">
      <LogoSpinner size={size} label={label} stack className="logo-spinner-late" style={{ animationDelay: `${delay}ms` }} />
    </div>
  )
}

/** Over everything, while the shell opens or prepares something; it appears only on a slow wait. */
export function LogoSpinnerVeil({ label }: { label?: string }) {
  const delay = useLateDelay()
  return (
    <div className="logo-spinner-veil logo-spinner-late" style={{ animationDelay: `${delay}ms` }}>
      <LogoSpinner size="md" label={label} />
    </div>
  )
}

export default LogoSpinner
