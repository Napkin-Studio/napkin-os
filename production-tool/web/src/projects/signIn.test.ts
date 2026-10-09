import { describe, expect, it } from 'vitest'
import { ago, deviceId, elsewhereWords, nameProblem, sameText, teamProblem, whoWithTeam } from './signIn'

describe('team names', () => {
  it.each([
    'Blue Herons', 'Équipe 7', 'R&D', "O'Brien's crew", 'チーム', 'Команда', 'فريق', '🦩 Flamingos', '👩‍💻 Coders', '12', 'x'.repeat(40), 'a.b_c-d',
  ])('takes %s', (team) => {
    expect(teamProblem(team)).toBeNull()
  })

  it.each([
    ['a', '2 to 40'], ['   a  ', '2 to 40'], ['x'.repeat(41), '2 to 40'], ['', '2 to 40'],
    ['blue/herons', '/'], ['blue​herons', 'hidden'], ['blue‮herons', 'hidden'], ['blue\u0007herons', 'hidden'],
  ])('refuses %j', (team, why) => {
    expect(teamProblem(team)).toContain(why)
  })

  it('counts an emoji as one character, not its code units', () => {
    expect(teamProblem('🦩'.repeat(40))).toBeNull()
    expect(teamProblem('🦩'.repeat(41))).toContain('2 to 40')
  })

  it('spells one team one way', () => {
    expect(new Set(['Blue Herons', 'blue herons', 'BLUE  HERONS', '  Blue Herons ', 'Ｂｌｕｅ Ｈｅｒｏｎｓ'].map(sameText)).size).toBe(1)
  })
})

describe('names', () => {
  it('says what a name may be, under the field', () => {
    expect(nameProblem('Maya')).toBeNull()
    expect(nameProblem('Maya Studio')).toContain('no spaces')
    expect(nameProblem('M')).toContain('2 to 24')
  })
})

describe('the same name twice in one team', () => {
  it('words the warning with when the other browser signed in', () => {
    const now = Date.parse('2026-10-09T12:00:00Z')
    expect(elsewhereWords('Maya', 'Blue Herons', '2026-10-09T11:57:00Z', now))
      .toBe("Someone signed in as Maya in Blue Herons on another browser 3 minutes ago. If that isn't you, use a different name, so your work stays apart.")
    expect(ago('2026-10-09T11:59:50Z', now)).toBe('just now')
    expect(ago('2026-10-09T11:00:00Z', now)).toBe('an hour ago')
  })

  it('keeps one browser id, and none when storage is blocked', () => {
    const store = new Map<string, string>()
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    const a = deviceId(s)
    expect(a).toMatch(/^[A-Za-z0-9-]{8,64}$/)
    expect(deviceId(s)).toBe(a)
    expect(deviceId({ getItem: () => { throw new Error('blocked') }, setItem: () => undefined })).toBeUndefined()
  })

  it('shows the team beside the name', () => {
    expect(whoWithTeam('Maya', 'Blue Herons')).toBe('Maya (Blue Herons)')
    expect(whoWithTeam('Maya')).toBe('Maya')
  })
})
