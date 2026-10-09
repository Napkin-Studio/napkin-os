// Home's words for a project card (ui/Home.tsx), apart so they can be tested.

import type { ProjectSummary } from '../projects/summary'

/** Where the project is: blue on its way, amber when things wait for an update, green once the ad is made. */
export function stageChip(s: ProjectSummary): { tone: 'on' | 'warn' | 'done'; text: string } {
  const label = s.stage === 'character' ? 'Canvas' : s.stage === 'storyboard' ? 'Storyboard' : 'Video'
  if (s.behind > 0) return { tone: 'warn', text: `${label} · ${s.behind} behind` }
  if (s.adSeconds !== null) return { tone: 'done', text: `Ad rendered · ${s.adSeconds} s` }
  if (s.stage === 'character') return { tone: 'on', text: s.pictures ? `Canvas · ${s.pictures} ${s.pictures === 1 ? 'picture' : 'pictures'}` : 'Canvas · empty' }
  return { tone: 'on', text: `${label} · ${s.shots} ${s.shots === 1 ? 'shot' : 'shots'}` }
}

/** "edited now", "12 min ago", "today 14:05", "yesterday", "Tue", "2 Oct". */
export function edited(iso: string, now = new Date()): string {
  const t = new Date(iso)
  const mins = Math.floor((now.getTime() - t.getTime()) / 60_000)
  if (mins < 1) return 'edited now'
  if (mins < 60) return `${mins} min ago`
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(now) - day(t)) / 86_400_000)
  if (days === 0) return `today ${clock(iso)}`
  if (days === 1) return 'yesterday'
  if (days < 7) return t.toLocaleDateString('en-GB', { weekday: 'short' })
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(t.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function greeting(h = new Date().getHours()) {
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** The handle as Home greets it: "shrey" → "Shrey". */
export function displayName(handle: string | undefined) {
  if (!handle || handle === 'guest') return 'there'
  return handle.slice(0, 1).toUpperCase() + handle.slice(1)
}
