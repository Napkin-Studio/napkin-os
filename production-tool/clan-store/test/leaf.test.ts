// The leaf rules (contracts/collab.md §7): a video's timeline is a map of items set by part
// (features/make-and-edit.clan); a size's edl (a cutdown's windows, features/campaign-formats.clan) is an
// array set whole, so Adjust crop and Beats save.
import { describe, expect, it } from 'vitest'
import { leafProblem } from '../src/bus/leaf'

const ITEM = 'item_01K7C00000000000000000TM01'

describe('leafProblem', () => {
  it('a video\'s timeline is set by item and by field; a size\'s edl and beats are set whole', () => {
    expect(leafProblem('videos', 'timeline')).toMatch(/has parts/)
    expect(leafProblem('videos', `timeline/${ITEM}`)).toBeNull()
    for (const f of ['track', 'start_s', 'source', 'follows', 'fade_in_s', 'fade_out_s', 'transition_in', 'speed', 'hold_s', 'opacity', 'words', 'style', 'from_s', 'to_s']) {
      expect(leafProblem('videos', `timeline/${ITEM}/${f}`)).toBeNull()
    }
    for (const p of ['generation_id', 'asset', 'in_s', 'out_s']) expect(leafProblem('videos', `timeline/${ITEM}/source/${p}`)).toBeNull()
    for (const p of ['box_id', 'shot_id']) expect(leafProblem('videos', `timeline/${ITEM}/follows/${p}`)).toBeNull()
    // transition_in is set whole, as seam was; an item is named by its id.
    expect(leafProblem('videos', `timeline/${ITEM}/transition_in/kind`)).toMatch(/timeline\/<item> has/)
    expect(leafProblem('videos', `timeline/${ITEM}/source/rank`)).toMatch(/timeline\/<item> has/)
    expect(leafProblem('videos', 'timeline/0')).toMatch(/named by its id/)
    expect(leafProblem('videos', 'end_card')).toBeNull()
    expect(leafProblem('videos', 'runs')).toBeNull()
    // edl is gone: a path into it is not a leaf.
    expect(leafProblem('videos', 'edl/edl_01K7C00000000000000000ED01/in_s')).toMatch(/set whole/)
    expect(leafProblem('sizes', 'edl')).toBeNull()
    expect(leafProblem('sizes', 'beats')).toBeNull()
    expect(leafProblem('sizes', 'edl/0/crop')).toMatch(/set whole/)
  })

  it('a generation\'s fields are set whole', () => {
    for (const f of ['kind', 'parent_id', 'delta', 'label', 'inputs', 'box_id', 'shot_ids', 'segments', 'patched', 'asset', 'duration_s', 'state', 'job_id', 'provider', 'crew', 'mock', 'end']) {
      expect(leafProblem('generations', f)).toBeNull()
    }
    expect(leafProblem('generations', 'inputs/model')).toMatch(/set whole/)
    expect(leafProblem('generations', 'id')).toMatch(/never a patch's/)
  })
})
