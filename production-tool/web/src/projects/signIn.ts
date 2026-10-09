// Sign-in's own rules (features/personal-workspaces.clan, 2026-10-09): the team name and the name
// together make a workspace. The relay checks the same (relay/service.py same_text, team_problem);
// these say it before anything is sent.

export const TEAM_MAX = 40

/** One spelling for a team or a name: NFKC, case folded, runs of spaces as one, trimmed. */
export function sameText(s: string): string {
  return s.normalize('NFKC').toLocaleLowerCase('und').split(/\s+/).filter(Boolean).join(' ')
}

// Invisible characters that would make two team names look the same but differ: format and
// control characters, except the joiner and variation selector emoji are made of.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}]/u
const EMOJI_GLUE = /\u200d|\ufe0f/g

/** Why a team name can't be used, or null. Spaces, accents, any script, emoji and '&' are fine;
 *  '/' joins team and name in the workspace key, so it is not. */
export function teamProblem(team: string): string | null {
  const t = sameText(team)
  if ([...t].length < 2 || [...t].length > TEAM_MAX) return `A team name is 2 to ${TEAM_MAX} characters.`
  if (t.includes('/') || HIDDEN.test(t.replace(EMOJI_GLUE, ''))) return "A team name can't have / or hidden characters in it."
  return null
}

/** The rule for a name, as the relay has it (contracts: handle). */
export const NAME_RULE = /^[A-Za-z0-9_.-]{2,24}$/

export function nameProblem(name: string): string | null {
  if (NAME_RULE.test(name.trim())) return null
  return /\s/.test(name.trim()) ? 'A name has no spaces: try Maya-S or Maya_S.' : 'A name is 2 to 24 letters, numbers, . _ or -.'
}

const DEVICE_KEY = 'pt.device'

/** A random id this browser keeps, so the relay can tell when the same team and name signed in from
 *  another browser (two people who picked the same name in one team). Not a login. */
export function deviceId(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocalStorage()): string | undefined {
  try {
    const had = storage?.getItem(DEVICE_KEY)
    if (had && /^[A-Za-z0-9-]{8,64}$/.test(had)) return had
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    storage?.setItem(DEVICE_KEY, id)
    return storage ? id : undefined
  } catch {
    return undefined // private mode or blocked storage: no warning, nothing else changes
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** "3 minutes ago", "just now", "an hour ago". */
export function ago(at: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(at)) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  return h === 1 ? 'an hour ago' : `${h} hours ago`
}

/** The warning when the same team and name signed in from another browser recently. */
export function elsewhereWords(name: string, team: string, at: string, now = Date.now()): string {
  return `Someone signed in as ${name} in ${team} on another browser ${ago(at, now)}. If that isn't you, use a different name, so your work stays apart.`
}

/** "Maya (Blue Herons)". */
export function whoWithTeam(name: string, team?: string): string {
  return team ? `${name} (${team})` : name
}
