// Choosing a key's front (owner 2026-10-07: a bare @key stands for the whole character, led by its
// front). "Choose Kapi's front" lists the key's live pictures; choosing one renames it key_front, as
// the person's one undo step. A front another live picture holds swaps names with it; a front only a
// deleted picture held (model/live.ts) is free, so that dead name goes.

import type { Id, Key, NamedRef, ProductionDocument } from '../contracts/types'
import { updateDoc } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import { deadRefs, lifeOf } from '../model/live'
import { refName, refsList } from '../model/selectors'

/** The live pictures of a key, the ones a front can be chosen from: its named views with a picture. */
export function frontChoices(live: ProductionDocument, key: Key): NamedRef[] {
  return refsList(live).filter((r) => r.key === key && !!r.asset)
}

/** Make this reference its key's front (key_front). One undo step. Returns the new name. */
export async function setFront(store: DocumentStore, refId: Id): Promise<string> {
  const d = store.get()
  const mine = d.refs[refId]
  if (!mine) throw new Error('That picture is gone.')
  if (mine.variant === 'front') return refName(mine)
  const dead = deadRefs(d, lifeOf(store).get())
  const was = mine.variant
  await updateDoc(store, (x) => {
    const now = new Date().toISOString()
    const holder = Object.values(x.refs).find((r) => r.key === mine.key && r.variant === 'front' && r.id !== refId)
    if (holder && dead.has(holder.id)) {
      // Its picture was deleted: the name is free. Its links went with the picture (model/live.ts).
      delete x.refs[holder.id]
      for (const [id, l] of Object.entries(x.links)) if (l.from.kind === 'ref' && l.from.id === holder.id) delete x.links[id]
    } else if (holder) {
      Object.assign(holder, { variant: was, named_at: now })
    }
    Object.assign(x.refs[refId], { variant: 'front', named_at: now })
  }, `set @${mine.key}_front`)
  return `${mine.key}_front`
}
