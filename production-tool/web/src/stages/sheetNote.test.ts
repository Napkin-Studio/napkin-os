// The storyboard sheet's out-of-date line (features/production-new-ui.clan; mock "storyboard": notes and
// "N clips out of date · Update" sit on the sheet, not in a Booth).
import { describe, expect, it } from 'vitest'
import { clipsBehindLine } from './storyboardEdits'

describe('the sheet says which clips are out of date', () => {
  it('names the frames that changed after their clips', () => {
    expect(clipsBehindLine([4, 5])).toBe('2 clips out of date: frames 4 and 5 changed after the clips were made.')
    expect(clipsBehindLine([2, 4, 5])).toBe('3 clips out of date: frames 2, 4 and 5 changed after the clips were made.')
    expect(clipsBehindLine([3])).toBe('1 clip out of date: frame 3 changed after the clip was made.')
  })
  it('says the clips are up to date when none is behind', () => {
    expect(clipsBehindLine([])).toBe('Clips up to date')
  })
})
