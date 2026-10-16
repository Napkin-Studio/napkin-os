// The leaf rules (contracts/collab.md §7): a video's edl is a map of items set by part; a size's edl (a
// cutdown's windows, features/campaign-formats.clan) is an array set whole, so Adjust crop and Beats save.
import { describe, expect, it } from 'vitest'
import { leafProblem } from '../src/bus/leaf'

describe('leafProblem', () => {
  it('a video\'s edl is set by item; a size\'s edl and beats are set whole', () => {
    expect(leafProblem('videos', 'edl')).toMatch(/has parts/)
    expect(leafProblem('videos', 'edl/edl_01K7C00000000000000000ED01/in_s')).toBeNull()
    expect(leafProblem('sizes', 'edl')).toBeNull()
    expect(leafProblem('sizes', 'beats')).toBeNull()
    expect(leafProblem('sizes', 'edl/0/crop')).toMatch(/set whole/)
  })
})
