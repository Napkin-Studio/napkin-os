// LocalTextBus: live text in one browser (contracts/collab.md §2-6).
//
// One Y.Doc holds a fragment per entity with text (shots/<id>, scenes/<id>,
// beats/<id>, reviews/<id>), rebuilt from the .clan's prose by hydrate().
// Every change marks its fragment dirty with the transaction's origin (its
// last writer); checkpoint() writes the flat fields through PatchBus as one
// quiet batch. A person's typing in one fragment is summed up by one
// attributed decision per 60 s window, written when the window closes or
// they leave.
import * as Y from 'yjs'
import { checkpoint, fragmentName, FRAGMENT_MAP, hydrate, KIND_OF_MAP, proseOf, type Prose, type RefNames } from '../text/checkpoint'
import type { FragmentKind } from '../text/extensions'
import { deepEqual } from '../merge-patch'
import type { Entity } from '../types'
import { entityAddress } from './leaf'
import type { LocalPatchBus } from './local'
import type { Patch } from './types'
import type { TextChange, TextSide } from './undo'

export interface TextBus {
  /** The fragment an editor binds to. */
  fragment(kind: FragmentKind, id: string): Y.XmlFragment
  /** The fragment's prose now. */
  prose(kind: FragmentKind, id: string): Prose
  /** Replace a fragment's text, as `origin` (human:<id> or a crew id). */
  replace(kind: FragmentKind, id: string, prose: Prose, origin: string, opts?: { label?: string; undo?: boolean; joinStep?: boolean }): Promise<void>
  /** Several fragments changed in one Y transaction (the plan move): one undo step. */
  edit(fragments: { kind: FragmentKind; id: string }[], origin: string, change: (frag: (kind: FragmentKind, id: string) => Y.XmlFragment) => void, opts?: { label?: string; undo?: boolean; joinStep?: boolean }): Promise<void>
  /** Write the flat fields of every changed fragment now. */
  checkpoint(): Promise<void>
}

export interface TextWindow { start: number; writer: string; kind: FragmentKind; id: string }

export class LocalTextBus implements TextBus, TextSide {
  readonly ydoc: Y.Doc
  private readonly dirty = new Map<string, string>()
  private readonly windows = new Map<string, TextWindow>()
  private readonly names = new Map<Y.AbstractType<unknown>, string>()
  private readonly clock: () => number
  private readonly windowMs: number
  private hydrating = false

  private readonly bus: LocalPatchBus

  constructor(bus: LocalPatchBus, opts: { ydoc?: Y.Doc; clock?: () => number; windowMs?: number } = {}) {
    this.bus = bus
    this.ydoc = opts.ydoc ?? new Y.Doc()
    this.clock = opts.clock ?? (() => Date.now())
    this.windowMs = opts.windowMs ?? 60_000
    this.ydoc.on('afterTransaction', (tr: Y.Transaction) => {
      if (this.hydrating) return
      for (const type of tr.changedParentTypes.keys()) {
        let t: Y.AbstractType<unknown> | null = type as Y.AbstractType<unknown>
        while (t && t.parent) t = t.parent as Y.AbstractType<unknown>
        const name = t ? this.names.get(t) ?? this.lookup(t) : undefined
        if (name) this.dirty.set(name, typeof tr.origin === 'string' ? tr.origin : this.bus.store.personClaim())
      }
    })
  }

  private lookup(t: Y.AbstractType<unknown>): string | undefined {
    for (const [name, v] of this.ydoc.share) if (v === t) return name
    return undefined
  }

  fragment(kind: FragmentKind, id: string): Y.XmlFragment {
    const name = fragmentName(kind, id)
    const f = this.ydoc.getXmlFragment(name)
    this.names.set(f as unknown as Y.AbstractType<unknown>, name)
    return f
  }

  prose(kind: FragmentKind, id: string): Prose {
    return proseOf(this.fragment(kind, id))
  }

  /** Rebuild every fragment from the document's prose (a fresh browser, another device). Not a change. */
  hydrateAll() {
    const doc = this.bus.doc() as unknown as Record<string, Record<string, Entity>>
    this.hydrating = true
    try {
      this.ydoc.transact(() => {
        for (const [map, kind] of Object.entries(KIND_OF_MAP)) {
          for (const [id, e] of Object.entries(doc[map] ?? {})) {
            const f = this.fragment(kind, id)
            if (!f.length && e.prose) hydrate(f, e.prose as Prose)
          }
        }
      }, 'hydrate')
    } finally {
      this.hydrating = false
    }
  }

  async replace(kind: FragmentKind, id: string, prose: Prose, origin: string, opts: { label?: string; undo?: boolean; joinStep?: boolean } = {}) {
    await this.edit([{ kind, id }], origin, (frag) => hydrate(frag(kind, id), prose), opts)
  }

  async edit(fragments: { kind: FragmentKind; id: string }[], origin: string, change: (frag: (kind: FragmentKind, id: string) => Y.XmlFragment) => void, opts: { label?: string; undo?: boolean; joinStep?: boolean } = {}) {
    const before = fragments.map((f) => ({ ...f, before: this.prose(f.kind, f.id) }))
    this.ydoc.transact(() => change((k, i) => this.fragment(k, i)), origin)
    const changes: TextChange[] = before.map((b) => ({ ...b, after: this.prose(b.kind, b.id) })).filter((c) => !deepEqual(c.before, c.after))
    if (changes.length && (opts.undo ?? true) && this.bus.undo) this.bus.undo.pushText(opts.label ?? 'edit the text', changes, opts.joinStep)
    await this.checkpoint()
  }

  /** LocalUndo's way back: the prose as it was, as the person, with no new step.
   * Not checkpointed here: the undo writes the flat fields with its own batch. */
  restore(kind: FragmentKind, id: string, prose: Prose) {
    this.ydoc.transact(() => hydrate(this.fragment(kind, id), prose), this.bus.store.personClaim())
  }

  /**
   * The patches that write the flat fields of every changed fragment, against
   * the entities `entityOf` gives (the document's, or the ones a batch is about
   * to create). The fragments they cover are no longer dirty; a fragment with
   * no entity stays dirty until its entity exists.
   */
  pendingPatches(entityOf?: (map: string, id: string) => Entity | undefined): { patches: Patch[]; written: { kind: FragmentKind; id: string; writer: string }[] } {
    const doc = this.bus.doc() as unknown as Record<string, Record<string, Entity>>
    const lookup = entityOf ?? ((map: string, id: string) => doc[map]?.[id])
    const refs: RefNames = {
      ...Object.fromEntries(Object.entries(doc.keys ?? {}).map(([id, k]) => [id, { key: String(k.key) }])),
      ...Object.fromEntries(Object.entries(doc.refs ?? {}).map(([id, r]) => [id, { key: String(r.key), variant: String(r.variant) }])),
    }
    const patches: Patch[] = []
    const written: { kind: FragmentKind; id: string; writer: string }[] = []
    for (const [name, writer] of this.dirty) {
      const [map, id] = name.split('/')
      const kind = KIND_OF_MAP[map]
      const entity = lookup(FRAGMENT_MAP[kind], id)
      if (!entity) continue
      const { fields } = checkpoint(kind, this.prose(kind, id), { refs, previous: entity, lastWriter: writer })
      for (const [path, value] of Object.entries(fields)) {
        if (deepEqual(entity[path], value ?? undefined)) continue
        patches.push({ op: 'set', entity: FRAGMENT_MAP[kind], id, path, value, base_version: entity.v ?? 0 })
      }
      written.push({ kind, id, writer })
    }
    for (const w of written) this.dirty.delete(fragmentName(w.kind, w.id))
    return { patches, written }
  }

  async checkpoint() {
    if (!this.dirty.size) return this.closeWindows(false)
    const { patches, written } = this.pendingPatches()
    if (patches.length) {
      const r = await this.bus.apply({ patches, why: { action: 'write checkpoint', quiet: true } }, { checkpoint: true, force: true, undo: false })
      if (!r.applied) throw new Error(`checkpoint refused: ${r.refused.map((x) => x.message).join('; ')}`)
    }
    await this.noteWriters(written)
  }

  /** Open a 60 s window for each person who wrote, and close the ones that are due. */
  async noteWriters(written: { kind: FragmentKind; id: string; writer: string }[]) {
    const now = this.clock()
    for (const w of written) {
      if (!w.writer.startsWith('human:')) continue
      const key = `${w.writer}|${fragmentName(w.kind, w.id)}`
      if (!this.windows.has(key)) this.windows.set(key, { start: now, writer: w.writer, kind: w.kind, id: w.id })
    }
    await this.closeWindows(false)
  }

  /** The person left (or the page is hiding): close every window now. */
  leave(): Promise<void> {
    return this.closeWindows(true)
  }

  /** Windows still open, for tests and the save indicator. */
  openWindows(): TextWindow[] {
    return [...this.windows.values()]
  }

  private async closeWindows(all: boolean) {
    const now = this.clock()
    const docId = this.bus.store.documentId()
    for (const [key, w] of [...this.windows]) {
      if (!all && now - w.start < this.windowMs) continue
      this.windows.delete(key)
      const map = FRAGMENT_MAP[w.kind]
      if (!this.bus.doc()[map]?.[w.id]) continue
      await this.bus.store.record({ agent: w.writer, action: `write ${map}[${w.id}]`, targets: [entityAddress(docId, map, w.id)] })
    }
  }
}
