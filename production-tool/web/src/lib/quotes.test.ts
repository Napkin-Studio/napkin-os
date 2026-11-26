import { describe, expect, it } from 'vitest'
import { quoted } from './quotes'

describe('quoted (UAT 2026-11-18: the end card and the sizes\' line were cut at the first quote)', () => {
  it('takes the words inside the first pair of quotes, straight or curly, double or single', () => {
    expect(quoted('End card with the super: "Quietboil. Let them sleep."')).toBe('Quietboil. Let them sleep.')
    expect(quoted('End line – “Lumo. Calm, on.”')).toBe('Lumo. Calm, on.')
    expect(quoted("Sign-off: 'Hearth. Every morning.'")).toBe('Hearth. Every morning.')
    expect(quoted('Sign-off: ‘Hearth. Every morning.’ on black')).toBe('Hearth. Every morning.')
  })
  it('never takes an apostrophe for a quote, and runs an unclosed double quote to the end', () => {
    expect(quoted("Don't show the kettle's base")).toBeUndefined()
    expect(quoted("Sign-off: 'Hearth's best.'")).toBe("Hearth's best.")
    expect(quoted('must be "Quietboil. Let them sleep.')).toBe('Quietboil. Let them sleep.')
    expect(quoted('No quotes here.')).toBeUndefined()
    expect(quoted('""')).toBeUndefined()
  })
})
