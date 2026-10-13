// LocalUndo: one person's undo, persisted, so it survives a reload
// (contracts/collab.md §10; ui-behaviour 4.5).
//
// A patch step keeps its inverse batch and what it left behind; a text step
// keeps the fragment's prose before and after. Undo applies a step only when
// everything it wrote is still as it left it; otherwise the step is skipped
// with the spec's notice and undo moves on. Asks, tray sends and publishes are
// never steps (their writes pass undo: false).
import { deepEqual } from '../merge-patch'
import type { Prose } from '../text/checkpoint'
import type { FragmentKind } from '../text/extensions'
import { expectHolds, type Expect, type LocalPatchBus } from './local'
import type { Entity } from '../types'
import type { Patch, PatchBatch } from './types'

export interface TextChange { kind: FragmentKind; id: string; before: Prose; after: Prose }

export interface UndoStep {
  label: string
  at: string
  patch?: { inverse: PatchBatch; expect: Expect[] }
  text?: TextChange[]
}

export interface SerializedUndo { undo: UndoStep[]; redo: UndoStep[] }

/** What LocalUndo needs from the text side (LocalTextBus implements it). */
export interface TextSide {
  prose(kind: FragmentKind, id: string): Prose
  /** Put prose back, as the person, without recording a new undo step or checkpointing. */
  restore(kind: FragmentKind, id: string, prose: Prose): void
  /** The checkpoint patches of the restored fragments, against the entities given. */
  pendingPatches(entityOf?: (map: string, id: string) => Entity | undefined): { patches: Patch[]; written: { kind: FragmentKind; id: string; writer: string }[] }
  checkpoint(): Promise<void>
}

export const MAX_STEPS = 100
/** ui-behaviour 4.5's notice, with the other person's name when it is known. */
export const skippedNotice = (who?: string) => `${who ?? 'Someone'} changed this after you, so undo skipped it.`


export class LocalUndo {
  private undoStack: UndoStep[]
  private redoStack: UndoStep[]
  private bus: LocalPatchBus | null = null
  private text: TextSide | null = null
  private readonly onChange?: (s: SerializedUndo) => void
  private readonly now: () => string

  constructor(opts: { saved?: SerializedUndo | null; onChange?: (s: SerializedUndo) => void; now?: () => string } = {}) {
    this.undoStack = structuredClone(opts.saved?.undo ?? [])
    this.redoStack = structuredClone(opts.saved?.redo ?? [])
    this.onChange = opts.onChange
    this.now = opts.now ?? (() => new Date().toISOString())
  }

  bind(bus: LocalPatchBus, text?: TextSide) {
    this.bus = bus
    bus.undo = this
    if (text) this.text = text
  }

  canUndo() { return this.undoStack.length > 0 }
  canRedo() { return this.redoStack.length > 0 }
  /** The label of the step undo would take back. */
  peek(): string | null { return this.undoStack.at(-1)?.label ?? null }

  serialize(): SerializedUndo {
    return structuredClone({ undo: this.undoStack, redo: this.redoStack })
  }

  pushPatch(label: string, inverse: PatchBatch, expect: Expect[], join = false) {
    const last = this.undoStack.at(-1)
    if (join && last && !last.patch) {
      last.patch = { inverse, expect }
    } else if (join && last?.patch) {
      last.patch = { inverse: { patches: [...inverse.patches, ...last.patch.inverse.patches], why: last.patch.inverse.why }, expect: [...last.patch.expect, ...expect] }
    } else {
      this.push({ label, at: this.now(), patch: { inverse, expect } })
      return
    }
    this.redoStack = []
    this.emit()
  }

  pushText(label: string, changes: TextChange[], join = false) {
    const last = this.undoStack.at(-1)
    if (join && last) {
      last.text = [...(last.text ?? []), ...changes]
      this.redoStack = []
      this.emit()
      return
    }
    this.push({ label, at: this.now(), text: changes })
  }

  private push(step: UndoStep) {
    this.undoStack.push(step)
    if (this.undoStack.length > MAX_STEPS) this.undoStack.shift()
    this.redoStack = []
    this.emit()
  }

  private emit() {
    this.onChange?.(this.serialize())
  }

  /** Undo the last step. done false and a notice when it was skipped (it is dropped). */
  async undo(): Promise<{ done: boolean; label?: string; notice?: string }> {
    const step = this.undoStack.pop()
    if (!step) return { done: false }
    const out = await this.run(step)
    if (out.redo) this.redoStack.push(out.redo)
    this.emit()
    return out.redo ? { done: true, label: step.label } : { done: false, label: step.label, notice: skippedNotice() }
  }

  async redo(): Promise<{ done: boolean; label?: string; notice?: string }> {
    const step = this.redoStack.pop()
    if (!step) return { done: false }
    const out = await this.run(step)
    if (out.redo) this.undoStack.push(out.redo)
    this.emit()
    return out.redo ? { done: true, label: step.label } : { done: false, label: step.label, notice: skippedNotice() }
  }

  /** Apply a step if what it wrote is unchanged; give back the step that reverses it. */
  private async run(step: UndoStep): Promise<{ redo: UndoStep | null }> {
    const bus = this.bus
    if (step.patch && !bus) throw new Error('LocalUndo is not bound to a bus')
    for (const t of step.text ?? []) {
      if (!this.text || !deepEqual(this.text.prose(t.kind, t.id), t.after)) return { redo: null }
    }
    if (step.patch && !step.patch.expect.every((e) => expectHolds(bus!.doc(), e))) return { redo: null }
    const reverse: UndoStep = { label: step.label, at: this.now() }
    // The text goes back in Y first; then ONE batch writes the fields the step
    // changed and the text's flat fields together, so the document never holds
    // a span in two places, even for a moment (the plan move's undo).
    for (const t of step.text ?? []) this.text!.restore(t.kind, t.id, t.before)
    if (step.text?.length) reverse.text = step.text.map((t) => ({ ...t, before: t.after, after: t.before }))
    if (step.patch || step.text?.length) {
      const inverse = step.patch?.inverse ?? { patches: [], why: { action: `undo ${step.label}`, quiet: true } }
      const creates = new Map(inverse.patches.filter((p) => p.op === 'create').map((p) => [`${p.entity}/${p.id}`, { ...(p.value as object), id: p.id, v: 0, field_v: {} } as Entity]))
      const deletes = new Set(inverse.patches.filter((p) => p.op === 'delete').map((p) => `${p.entity}/${p.id}`))
      const { patches: text } = this.text ? this.text.pendingPatches((map, id) => {
        const k = `${map}/${id}`
        if (deletes.has(k)) return undefined
        return creates.get(k) ?? ((bus?.doc() as unknown as Record<string, Record<string, Entity>> | undefined)?.[map]?.[id])
      }) : { patches: [] as Patch[] }
      const batch = { patches: [...inverse.patches, ...text], why: inverse.why }
      if (batch.patches.length) {
        const r = await bus!.applyWithExpect(batch, { undo: false, force: true, checkpoint: true })
        if (!r.applied) {
          // The fields could not go back: put the text forward again.
          for (const t of step.text ?? []) this.text!.restore(t.kind, t.id, t.after)
          await this.text?.checkpoint()
          return { redo: null }
        }
        if (step.patch) reverse.patch = { inverse: r.inverse!, expect: r.expect }
      }
    }
    return { redo: reverse }
  }
}
