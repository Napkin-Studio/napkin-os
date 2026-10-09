// "Napkin's got you" (features/runway-fallback.clan): when the relay made a job on Runway because the
// participant's own fal or HeyGen key could not, say so plainly, once per job. The card keeps a small
// "Made on Runway" chip with the reason on hover; this is the moment it happens.

import { useEffect } from 'react'
import { useDoc, useServices, useUi } from '../app/context'
import { jobWhat } from './agents/cast'
import { fallbackNotice } from './modelChoice'

const SHOW_MS = 9000

export function FallbackNotices() {
  const { ui: uiStore } = useServices()
  const ui = useUi()
  const doc = useDoc()
  const order = (shotId: string | undefined) => (shotId ? (doc.shots ?? []).findIndex((s) => s.id === shotId) + 1 || undefined : undefined)
  const pending = Object.entries(ui.jobCtx).flatMap(([id, c]) => {
    if (!c.fallbackFrom || c.fallbackShown || c.dismissed) return []
    const job = doc.jobs.find((j) => j.id === id)
    if (!job?.provider) return [] // not made yet: say it when it lands on Runway
    const words = fallbackNotice(c.fallbackFrom, job.provider, jobWhat(job, c, 'shotId' in c ? order(c.shotId) : undefined))
    return words ? [{ id, words, reason: c.fallbackReason }] : []
  })
  const close = (id: string) => uiStore.update((u) => { const c = u.jobCtx[id]; if (c) c.fallbackShown = true })
  const first = pending[0]?.id
  useEffect(() => {
    if (!first) return
    const t = window.setTimeout(() => close(first), SHOW_MS)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first])
  if (!pending.length) return null
  return (
    <div className="gotyou-stack" role="status" aria-live="polite">
      {pending.slice(0, 3).map((n) => (
        <div key={n.id} className="gotyou" title={n.reason}>
          <span className="gotyou-mark" aria-hidden="true">✓</span>
          <span>{n.words}</span>
          <button className="btn xs ghost icon" aria-label="Close" onClick={() => close(n.id)}>✕</button>
        </div>
      ))}
    </div>
  )
}
