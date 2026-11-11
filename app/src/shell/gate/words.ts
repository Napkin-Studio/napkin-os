// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the Brief gate says, from what the host answered (`GET /gate`). Pure: no host and no React,
// so the sentences and the buttons' rules are table-tested (features/brief-gate.clan).

import type { GateItem, GateSigner, GateSummary, GateView, LibraryItem } from '../../host'

export const BRIEF_MAKER = 'ie.napkin.brief-maker'

/** The roles a brief names to sign it. */
export const PLANNER = 'planner'
export const CREATIVE_DIRECTOR = 'creative_director'
export const ROLE_WORDS: Record<string, string> = { [PLANNER]: 'Planner', [CREATIVE_DIRECTOR]: 'Creative director' }

/** What the client is asked, for the two gate items only the client can settle. */
const ASK: Partial<Record<GateItem['id'], string>> = {
  objective: 'What number should it reach, and by when?',
  baseline: 'What is the figure today, so we can measure against it?',
}

export interface Question { id: GateItem['id']; text: string; because: string }

/** One question for the client per missing item the client can answer, with what the brief says. */
export function clientQuestions(items: readonly GateItem[]): Question[] {
  return items
    .filter(i => i.state === 'missing' && ASK[i.id])
    .map(i => ({
      id: i.id,
      text: ASK[i.id]!,
      because: i.evidence ? `The brief says "${i.evidence.replace(/[.\s]+$/, '')}".` : (i.why ?? ''),
    }))
}

/** The missing items the team settles itself. */
export const teamItems = (items: readonly GateItem[]): GateItem[] =>
  items.filter(i => i.state === 'missing' && !ASK[i.id])

export const passedCount = (v: Pick<GateView, 'items'>): number => v.items.filter(i => i.state === 'pass').length

/** The line over the six items. */
export function headline(v: GateView, client: string): string {
  const n = passedCount(v)
  const total = v.items.length
  const closed = `Territories stay closed until the brief passes, the agency signs it and ${client} confirms it.`
  if (v.changed_since_lock) return `The brief changed after it was signed. The signed version stays as it was; the new one needs signing. ${closed}`
  if (v.open && v.enforced) return `${n} of ${total} gate items passed, the agency has signed and ${client} has confirmed. Territories are open.`
  return `${n} of ${total} gate items passed. ${closed}`
}

export type SignKind = 'planner' | 'creative_director'

export interface SignAction {
  kind: SignKind
  label: string
  /** Set when the button cannot be pressed yet: the one reason, in words. */
  blocked: string | null
}

/** The signer a person is on this brief, if they are one. */
export function roleOf(signers: readonly GateSigner[], me: string | null): string | null {
  return signers.find(s => me !== null && s.person === me)?.role ?? null
}

/** Whether the brief names both signers (the gate holds the lock until it does). */
export const namesBoth = (signers: readonly GateSigner[]): boolean =>
  signers.some(s => s.role === PLANNER) && signers.some(s => s.role === CREATIVE_DIRECTOR)

/**
 * The button this person gets, or null when none applies (nobody signs for them, or
 * the version is signed and unchanged). The reason a button is blocked is said beside it.
 */
export function signAction(v: GateView, me: string | null): SignAction | null {
  const role = roleOf(v.signers, me)
  if (!role || !namesBoth(v.signers) || (v.signed && !v.changed_since_lock)) return null
  const missing = v.missing === 1 ? 'One gate item is missing.' : `${v.missing} gate items are missing.`
  if (v.changed_since_lock) return null // a changed brief starts a new version first
  if (role === PLANNER) {
    if (v.planner_signed) return { kind: 'planner', label: 'Signed as planner', blocked: 'You have signed. The creative director signs next.' }
    return { kind: 'planner', label: 'Sign this version', blocked: v.passed ? null : `${missing} Signing locks this version.` }
  }
  if (role === CREATIVE_DIRECTOR) {
    if (!v.passed) return { kind: 'creative_director', label: 'Sign and lock this version', blocked: `${missing} Signing locks this version.` }
    return { kind: 'creative_director', label: 'Sign and lock this version', blocked: v.planner_signed ? null : 'The planner signs first.' }
  }
  return null
}

/** Whether this person may start a new version of a signed brief that changed. */
export const canStartNewVersion = (v: GateView, me: string | null): boolean =>
  v.changed_since_lock && roleOf(v.signers, me) !== null

/** What the signing row says, once each signer has or has not signed. */
export function signerLine(s: GateSigner): string {
  return `${ROLE_WORDS[s.role] ?? s.role}, ${s.person}: ${s.signed ? 'signed' : 'not yet'}`
}

// ── Territories, from the library listing ───────────────────────────────────

export interface Step { text: string; done: boolean }

export interface TerritoriesState {
  open: boolean
  /** The brief the answer rests on (the one furthest along), when there is one. */
  brief: LibraryItem | null
  steps: Step[]
}

const rank = (g: GateSummary): number =>
  (g.open ? 8 : 0) + (g.confirmed ? 4 : 0) + (g.signed ? 2 : 0) + (g.passed ? 1 : 0)

/**
 * Whether Territories are open for a client: some brief of theirs has passed the gate, been
 * signed by the agency and been confirmed by the client (the host's own `open`, which is
 * true while the gate is not enforced). No brief at all keeps them closed.
 */
export function territoriesOf(items: readonly LibraryItem[], client: string): TerritoriesState {
  const briefs = items.filter(i => i.app_id === BRIEF_MAKER)
  const withGate = briefs.filter(i => i.state?.gate)
  const best = [...withGate].sort((a, b) => rank(b.state!.gate!) - rank(a.state!.gate!))[0] ?? briefs[0] ?? null
  const g = best?.state?.gate
  const steps: Step[] = [
    { text: 'A brief for ' + client, done: briefs.length > 0 },
    { text: 'The brief passes the gate', done: !!g?.passed },
    { text: 'The agency signs it', done: !!g?.signed && !g.changed_since_lock },
    { text: `${client} confirms it`, done: !!g?.confirmed && !g.changed_since_lock },
  ]
  return { open: !!g?.open, brief: best, steps }
}

/** The briefs that changed after they were signed: the desk's Changed brief alerts. */
export const changedBriefs = (items: readonly LibraryItem[]): LibraryItem[] =>
  items.filter(i => i.app_id === BRIEF_MAKER && i.state?.gate?.changed_since_lock)
