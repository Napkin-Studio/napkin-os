import { describe, expect, it } from 'vitest'
import { outputLocations } from './runner'

const sha = 'sha256:' + 'a'.repeat(64)

describe('output locations', () => {
  it('keeps the https URL of a deployed relay', () => {
    expect(outputLocations(sha, 'https://d1kyxuk8u2ulz5.cloudfront.net/out/' + sha)).toEqual(['idb://sha256/' + 'a'.repeat(64), 'https://d1kyxuk8u2ulz5.cloudfront.net/out/' + sha])
  })
  it('leaves out a local dev relay URL, which the document refuses', () => {
    expect(outputLocations(sha, 'http://localhost:8787/out/' + sha)).toEqual(['idb://sha256/' + 'a'.repeat(64)])
  })
})
