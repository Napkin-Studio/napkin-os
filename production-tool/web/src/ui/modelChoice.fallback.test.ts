import { describe, expect, it } from 'vitest'
import { fallbackNotice, fellBack } from './modelChoice'

describe("Napkin's got you", () => {
  it('says which provider could not, what was made, and that Runway made it', () => {
    expect(fallbackNotice({ provider: 'fal', model: 'veo3.1-fast-i2v' }, 'runway', 'the clip for shot 3'))
      .toBe("fal couldn't make the clip for shot 3, so we made it on Runway. Napkin's got you.")
    expect(fallbackNotice({ provider: 'heygen', model: 'heygen-video-1' }, 'runway', 'a clip'))
      .toBe("HeyGen couldn't make a clip, so we made it on Runway. Napkin's got you.")
  })

  it('says nothing when the job ran where it was meant to', () => {
    expect(fallbackNotice({ provider: 'fal', model: 'x' }, 'fal', 'a frame')).toBeUndefined()
    expect(fallbackNotice(undefined, 'runway', 'a frame')).toBeUndefined()
    expect(fellBack({ provider: 'runway', model: 'x' }, 'runway')).toBeUndefined()
  })
})
