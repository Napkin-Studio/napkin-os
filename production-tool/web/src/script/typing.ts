// Typing as undo steps (features/script-editor.clan; contracts/collab.md §10): one rule.
//
// An editor bound to a fragment keeps no undo of its own. Its typing comes in bursts:
// a burst opens on the first local change to a fragment (the prose before it is taken
// then, before the change reaches the Y.Doc) and closes after 1.5 s idle, when the
// caret leaves the fragment (blur, collapse, unmount), or before any other undo step
// is pushed (LocalUndo.beforePush). Closing records ONE LocalUndo text step through
// TextBus.recordTyping. So ⌘Z order is defined across fragments, collapse and reload.

import type { Editor } from '@tiptap/core'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import type { Transaction } from '@tiptap/pm/state'
import type { FragmentKind, Prose } from '../../../clan-store/src'

/** What TypingBursts needs of the text bus. */
export interface TypingText {
  prose(kind: FragmentKind, id: string): Prose
  recordTyping(kind: FragmentKind, id: string, before: Prose, after: Prose, label?: string): boolean
}

export const IDLE_MS = 1500

interface Burst { kind: FragmentKind; id: string; before: Prose; timer: ReturnType<typeof setTimeout> | null }

export class TypingBursts {
  private readonly open = new Map<string, Burst>()
  private readonly text: TypingText
  private readonly idleMs: number
  private readonly changed: () => void
  private readonly listeners = new Set<() => void>()

  constructor(text: TypingText, opts: { idleMs?: number; changed?: () => void } = {}) {
    this.text = text
    this.idleMs = opts.idleMs ?? IDLE_MS
    this.changed = opts.changed ?? (() => {})
  }

  /** A local change is about to reach this fragment: open its burst (taking the prose before), or keep it open. */
  touch(kind: FragmentKind, id: string) {
    const key = `${kind}/${id}`
    let b = this.open.get(key)
    if (!b) {
      b = { kind, id, before: this.text.prose(kind, id), timer: null }
      this.open.set(key, b)
      this.emit()
    }
    if (b.timer) clearTimeout(b.timer)
    b.timer = setTimeout(() => this.close(kind, id), this.idleMs)
  }

  /** The change landed in the fragment (after the Y transaction): checkpoint soon. */
  landed() {
    this.changed()
  }

  /** Close one fragment's burst: one text step when it changed anything. */
  close(kind: FragmentKind, id: string): boolean {
    const key = `${kind}/${id}`
    const b = this.open.get(key)
    if (!b) return false
    if (b.timer) clearTimeout(b.timer)
    this.open.delete(key)
    const recorded = this.text.recordTyping(kind, id, b.before, this.text.prose(kind, id), 'typing')
    this.emit()
    if (recorded) this.changed()
    return recorded
  }

  /** Close every open burst (before another undo step, an undo, a reload). */
  closeAll() {
    for (const b of [...this.open.values()]) this.close(b.kind, b.id)
  }

  isOpen(kind?: FragmentKind, id?: string): boolean {
    return kind && id ? this.open.has(`${kind}/${id}`) : this.open.size > 0
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }
}

/** Whether a transaction is the person's own change (not the binding bringing in the fragment). */
export const isLocalEdit = (tr: Transaction) => tr.docChanged && !isChangeOrigin(tr)

/**
 * Follow one editor's typing into the bursts. Returns the unbinding. The burst closes on
 * blur and on unbinding (an editor that collapses or unmounts).
 */
export function trackTyping(editor: Editor, bursts: TypingBursts, kind: FragmentKind, id: string): () => void {
  const before = ({ transaction }: { transaction: Transaction }) => {
    if (isLocalEdit(transaction)) bursts.touch(kind, id)
  }
  const after = ({ transaction }: { transaction: Transaction }) => {
    if (isLocalEdit(transaction)) bursts.landed()
  }
  const blur = () => bursts.close(kind, id)
  editor.on('beforeTransaction', before)
  editor.on('transaction', after)
  editor.on('blur', blur)
  return () => {
    editor.off('beforeTransaction', before)
    editor.off('transaction', after)
    editor.off('blur', blur)
    bursts.close(kind, id)
  }
}
