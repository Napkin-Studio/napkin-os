// A take being made says where its job is (live test 2026-11-16): while a landed take cannot be
// downloaded yet the box said "Making"; it says the runner's state and note, as the Jobs pill does.
import { describe, expect, it } from 'vitest'
import { jobWord, makingLine } from './model'

describe('a take being made, in words', () => {
  it('a landed take not yet downloaded says Checking, with the runner\'s note', () => {
    expect(makingLine({ state: 'fetching', note: 'Could not download it yet; trying again.' }, 'running'))
      .toBe('Checking · Could not download it yet; trying again.')
  })
  it('follows the runner, else the document, with no note', () => {
    expect(makingLine({ state: 'queued' })).toBe('Sending')
    expect(makingLine(undefined, 'running')).toBe('Making')
    expect(makingLine(undefined, 'validating')).toBe('Checking')
    expect(makingLine(undefined)).toBe('Making')
  })
  it('the Jobs pill uses the same words', () => {
    expect(['queued', 'submitting', 'running', 'fetching', 'validating', 'completed'].map(jobWord))
      .toEqual(['Sending', 'Sending', 'Making', 'Checking', 'Checking', 'Ready'])
  })
})
