// Start over: a fresh document for the same participant. The old .clan is
// not lost: it is mirrored to the organisers on every lock and every five
// minutes, and once more here before the new one starts. Pictures and clips
// stay in the browser's blob store (nothing is deleted from it).

import { CANVAS_KEY } from '../canvas/keys'
import { idbDelete } from '../lib/idb'
import type { Services } from './context'

export const START_OVER_TEXT = 'Start over with an empty project? Your work so far is not lost: its .clan has already been copied to the organisers, and Export still has your pictures. This browser starts a new document.'

export async function startOver(s: Pick<Services, 'doc' | 'clan' | 'ui' | 'relay'>, reload: () => void = () => location.reload()) {
  const participant = s.doc.get().participant
  if (s.clan) {
    await s.clan.record('started over', 'the next document starts empty')
    if (s.relay.kind === 'http') await s.clan.clan.mirrorNow('manual').catch((e) => console.warn('could not mirror before starting over', e))
    await s.clan.flush()
  }
  await s.doc.create({ participant })
  try {
    await idbDelete('kv', CANVAS_KEY)
  } catch { /* no canvas kept */ }
  s.ui.update((u) => {
    u.jobCtx = {}
    u.frameRegions = {}
    u.scriptDraft = ''
  })
  await s.ui.flush()
  if (s.clan) await s.clan.flush()
  reload()
}
