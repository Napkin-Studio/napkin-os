// No job sends one picture twice (UAT round 4, R4-F5, the third time: shot 2's frame went with frame 1 as @anchor and as
// @previous, because at index 1 the first frame is the frame before; round 3's dedupe only compared them with the refs).
// One rule at the last step before a request leaves (jobs/runner.ts submit), by picture identity (sha256), whatever made
// the input: the first frame (`image`) and the named references keep their place (a reference carries a name the words
// may use); a continuity picture (anchor, previous, cast frame) or a last frame that repeats one already sent goes.
// Two references of one picture keep the first. Pure.

import type { AssetRef, JobInput, KeyframeRef } from '../contracts/types'

const shaOf = (k: KeyframeRef | AssetRef | undefined): string | undefined => (!k ? undefined : 'asset' in k ? k.asset.sha256 : k.sha256)

export function onePictureOnce(input: JobInput): JobInput {
  const seen = new Set<string>()
  const out: JobInput = { ...input }
  if (input.image) seen.add(input.image.sha256)
  if (input.refs?.length) {
    const refs = input.refs.filter((r) => {
      if (seen.has(r.asset.sha256) && input.refs!.find((x) => x.asset.sha256 === r.asset.sha256) !== r) return false
      seen.add(r.asset.sha256)
      return true
    })
    if (refs.length !== input.refs.length) out.refs = refs
  }
  for (const key of ['anchorFrame', 'previousFrame', 'castFrame', 'lastFrame'] as const) {
    const sha = shaOf(input[key])
    if (!sha) continue
    if (seen.has(sha)) delete out[key]
    else seen.add(sha)
  }
  return out
}
