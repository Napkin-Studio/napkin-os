import { describe, expect, it } from 'vitest'
import { fallbackNotice, fellBack } from './modelChoice'

describe("Napkin's got you", () => {
  it('says which provider could not, what was made, and that Runway made it', () => {
    expect(fallbackNotice({ provider: 'mock', model: 'mock-hq' }, 'runway', 'the clip for shot 3'))
      .toBe("Mock couldn't make the clip for shot 3, so we made it on Runway. Napkin's got you.")
  })

  it('never mentions keys', () => {
    expect(fallbackNotice({ provider: 'mock', model: 'mock' }, 'runway', 'a clip')).not.toMatch(/key/i)
  })

  it('says nothing when the job ran where it was meant to', () => {
    expect(fallbackNotice({ provider: 'runway', model: 'x' }, 'runway', 'a frame')).toBeUndefined()
    expect(fallbackNotice(undefined, 'runway', 'a frame')).toBeUndefined()
    expect(fellBack({ provider: 'runway', model: 'x' }, 'runway')).toBeUndefined()
  })
})
