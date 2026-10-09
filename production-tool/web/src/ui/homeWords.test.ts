import { describe, expect, it } from 'vitest'
import { emptySummary } from '../projects/projectIndex'
import { displayName, edited, greeting, stageChip } from './homeWords'

describe('a project card\'s words', () => {
  it('the stage chip: blue on its way, amber when behind, green with the ad', () => {
    const s = emptySummary()
    expect(stageChip(s)).toEqual({ tone: 'on', text: 'Canvas · empty' })
    expect(stageChip({ ...s, pictures: 4 })).toEqual({ tone: 'on', text: 'Canvas · 4 pictures' })
    expect(stageChip({ ...s, stage: 'video', shots: 3 })).toEqual({ tone: 'on', text: 'Video · 3 shots' })
    expect(stageChip({ ...s, stage: 'storyboard', shots: 3, behind: 2 })).toEqual({ tone: 'warn', text: 'Storyboard · 2 behind' })
    expect(stageChip({ ...s, stage: 'video', shots: 3, adSeconds: 12 })).toEqual({ tone: 'done', text: 'Ad rendered · 12 s' })
    // Behind wins over a rendered ad: the ad is out of date.
    expect(stageChip({ ...s, stage: 'video', adSeconds: 12, behind: 1 }).tone).toBe('warn')
  })

  it('when it was last edited', () => {
    const now = new Date(2026, 9, 9, 15, 0)
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
    expect(edited(ago(20_000), now)).toBe('edited now')
    expect(edited(ago(12 * 60_000), now)).toBe('12 min ago')
    expect(edited(ago(3 * 3_600_000), now)).toMatch(/^today /)
    expect(edited(new Date(2026, 9, 8, 9).toISOString(), now)).toBe('yesterday')
    expect(edited(new Date(2026, 9, 6, 9).toISOString(), now)).toBe('Tue')
    expect(edited(new Date(2026, 9, 2, 9).toISOString(), now)).toBe('2 Oct')
  })

  it('greets by the time of day and the handle', () => {
    expect(greeting(9)).toBe('Good morning')
    expect(greeting(14)).toBe('Good afternoon')
    expect(greeting(20)).toBe('Good evening')
    expect(displayName('shrey')).toBe('Shrey')
    expect(displayName('guest')).toBe('there')
  })
})
