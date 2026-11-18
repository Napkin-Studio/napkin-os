// A shot's words with each @name marked (the strip's text-only shots, the player before Make). A name's
// description in brackets is left out, as in the rooms' shot names (stages/shotTitle withoutAsides).

import { withoutAsides } from '../stages/shotTitle'

export function Mentions({ text }: { text: string }) {
  const parts = withoutAsides(text).split(/((?<![\w@])@[a-z][a-z0-9_-]*)/g)
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="jc-ment">{p}</span> : p))}</>
}
