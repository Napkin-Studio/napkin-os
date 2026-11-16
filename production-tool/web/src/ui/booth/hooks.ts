// Small helpers for the Booth's cards: when, Why, Later.

import { useCallback, useEffect, useState } from 'react'

/** "just now", "4 min ago", "2 h ago", else the date. */
export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/** Why, open under a card. */
export function useWhy(): [boolean, () => void] {
  const [open, setOpen] = useState(false)
  return [open, useCallback(() => setOpen((o) => !o), [])]
}

/** Later: the card goes to the end of what waits, and stays. */
export function useLater(): { later: (id: string) => void; order: <T>(items: T[], idOf: (t: T) => string) => T[] } {
  const [put, setPut] = useState<string[]>([])
  const later = useCallback((id: string) => setPut((p) => [...p.filter((x) => x !== id), id]), [])
  const order = useCallback(<T,>(items: T[], idOf: (t: T) => string) => {
    const rank = (t: T) => put.indexOf(idOf(t))
    return [...items].sort((a, b) => rank(a) - rank(b))
  }, [put])
  return { later, order }
}

/** The decision chain, newest first, kept current (the History panel's source): [] with no .clan here. */
export function useChain(store: { chain(): Promise<unknown[]>; onChain(cb: () => void): () => void } | null): import('../historyItems').ChainLike[] {
  const [entries, setEntries] = useState<import('../historyItems').ChainLike[]>([])
  useEffect(() => {
    if (!store) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () => { store.chain().then((c) => { if (alive) setEntries(c as import('../historyItems').ChainLike[]) }, () => {}) }
    load()
    const off = store.onChain(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(load, 300)
    })
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      off()
    }
  }, [store])
  return entries
}
