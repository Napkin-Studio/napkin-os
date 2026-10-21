// The selectors over the contract's own example of a finished ad (contracts/examples/document.ad.json).

import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { loadJson } from '../test/schemas'
import {
  beatsOf, currentFrame, currentRender, currentTake, cutItemFor, cutOf, shotSegment, framesOf, jobsList, keyNamed, mainScript, mainStoryboard, mainVideo,
  openAsks, refName, refNamed, refsList, rendersOf, reviewsList, reviewsOn, scenesOf, scriptText, shotFrameAsset, shotName, shotNumber, shotsOf,
  shotSubjects, storyboardReady, storyboardSeconds, takesOf, unplannedText,
} from './selectors'

const d = loadJson<ProductionDocument>('examples/document.ad.json')
const SHOT = (n: string) => `shot_01K7A0000000000000000000${n}`
const S1 = SHOT('15')
const S2 = SHOT('16')
const S3 = SHOT('17')
const S4 = SHOT('18')

describe('selectors over the example ad', () => {
  it('finds the main script, storyboard and video through their links, not by position', () => {
    expect(mainVideo(d)!.id).toBe('video_01K7A000000000000000000027')
    // Two storyboards: the one that renders the video is the main one (the 9:16 is an implicit size).
    expect(mainStoryboard(d)!.id).toBe('storyboard_01K7A000000000000000000012')
    expect(mainScript(d)!.id).toBe('script_01K7A00000000000000000000Z')
  })

  it('orders shots by rank and numbers them from 1', () => {
    expect(shotsOf(d).map((s) => s.id)).toEqual([S1, S2, S3, S4])
    expect(shotNumber(d, S3)).toBe(3)
    expect(shotName(d, S2)).toBe('shot 2')
    expect(shotNumber(d, 'shot_gone')).toBe(0)
    expect(shotName(d, undefined)).toBe('a shot')
    expect(storyboardSeconds(d)).toBe(15)
    expect(storyboardReady(d)).toBe(false) // shots 3 and 4 are only planned
  })

  it('the frame in a shot is its pick; versions in order', () => {
    expect(framesOf(d, S2).map((f) => f.version)).toEqual([1, 2, 3])
    expect(currentFrame(d, S2)!.id).toBe('frame_01K7A00000000000000000001Z')
    expect(currentFrame(d, d.shots[S1])!.id).toBe('frame_01K7A000000000000000000020')
    expect(shotFrameAsset(d, S2)).toBe(d.frames['frame_01K7A00000000000000000001Z'].asset)
    expect(currentFrame(d, S3)).toBeUndefined()
  })

  it('the take in the cut is the one its V1 clip plays; the cut is in start order', () => {
    expect(takesOf(d, S1).map((t) => t.id)).toEqual(['gen_01K7A000000000000000000024', 'gen_01K7A000000000000000000025'])
    expect(cutOf(d).slice(0, 3).map((i) => i.id)).toEqual(['item_01K7A000000000000000000028', 'item_01K7A000000000000000000029', 'item_01K7A00000000000000000004C'])
    expect(cutItemFor(d, S1)!.id).toBe('item_01K7A000000000000000000028')
    expect(currentTake(d, S1)!.id).toBe('gen_01K7A000000000000000000025')
    expect(currentTake(d, S2)).toBeUndefined() // its clip stands for no shot
    expect(shotSegment(d.generations['gen_01K7A00000000000000000004A'], S4)).toBeDefined()
  })

  it('the ad is the video\'s picked render', () => {
    expect(rendersOf(d).map((r) => r.version)).toEqual([1, 2])
    expect(currentRender(d)!.id).toBe('render_01K7A00000000000000000002E')
  })

  it('names: refs by key_variant, keys, and what a shot mentions', () => {
    expect(refsList(d)).toHaveLength(10)
    expect(refNamed(d, 'maya_front')!.id).toBe('ref_01K7A00000000000000000000N')
    expect(refName(d.refs['ref_01K7A00000000000000000000Q'])).toBe('loc_beach')
    expect(keyNamed(d, 'maya')!.id).toBe('key_01K7A00000000000000000000K')
    expect(keyNamed(d, 'nobody')).toBeUndefined()
    expect(shotSubjects(d, d.shots[S1])).toEqual(['maya_front', 'loc_beach'])
    expect(shotSubjects(d, d.shots[S2])).toEqual(['product_bottle'])
  })

  it('the script\'s words: unplanned scene text, and the whole script with the shots\' action', () => {
    expect(scenesOf(d).map((s) => s.heading)).toEqual(['EXT. BEACH - DAWN', 'EXT. BEACH - MORNING'])
    expect(unplannedText(d)).toBe('Maya laughs at the sea.\nMAYA\n(quietly)\nAgain.')
    const all = scriptText(d)
    expect(all.indexOf('EXT. BEACH - DAWN')).toBeLessThan(all.indexOf(d.shots[S1].action!))
    expect(all).toContain('Lumen logo on white.')
    expect(all.indexOf('EXT. BEACH - MORNING')).toBeGreaterThan(all.indexOf('Lumen logo on white.'))
  })

  it('beats by time, notes by when they were made, asks that are open, jobs oldest first', () => {
    expect(beatsOf(d, S1).map((b) => b.at_s)).toEqual([0, 0, 2, 3])
    expect(reviewsList(d).map((r) => r.created_at)).toEqual(['2026-10-13T10:12:00Z', '2026-10-13T10:20:00Z', '2026-10-13T10:25:00Z'])
    expect(reviewsOn(d, 'generation', 'gen_01K7A000000000000000000024').map((r) => r.id)).toEqual(['rev_01K7A00000000000000000002F'])
    expect(openAsks(d).map((a) => a.id)).toEqual(['q_01K7A00000000000000000003G'])
    const jobs = jobsList(d)
    expect(jobs).toHaveLength(15)
    expect(jobs.every((j, i) => i === 0 || jobs[i - 1].created_at <= j.created_at)).toBe(true)
  })
})
