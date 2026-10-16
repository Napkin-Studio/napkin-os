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

/** Home's notice when a project cannot be opened (made under another contract, projects/session.ts
 *  ProjectRefused): the reason as one sentence. */
export function refusalNotice(message: string): string {
  const t = message.trim()
  return /[.!?]$/.test(t) ? t : `${t}.`
}

/** The person's own name from their Napkin OS account (Me.name), when they have one; else the handle. */
function ownName(me: { name?: string } | null | undefined): string | null {
  const name = me?.name?.trim()
  return name ? name : null
}

/** Who Home greets: "Shrey" from Me.name, else the handle as displayName says it. */
export function greetName(me: { handle?: string; name?: string } | null | undefined): string {
  return ownName(me) ?? displayName(me?.handle)
}

/** Who the ⋯ menu says is signed in: Me.name, else "@handle" ("@guest" with nobody). */
export function menuName(me: { handle?: string; name?: string } | null | undefined): string {
  return ownName(me) ?? `@${me?.handle ?? 'guest'}`
}

/** Dex's first-visit line on Home: what to bring, and who does what with it (the crew row above names each). */
export const FIRST_AD = 'Draw or drop your characters and write a few lines of script. Skye drafts the rest, I plan the shots, Wren renders the frames and clips, Rhea retouches them and Edie edits the ad. Ellis reads your notes back; Jude checks each result.'
