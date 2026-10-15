// The Image editor's edits (ui-behaviour 3.12; features/image-editor.clan): a non-destructive,
// numbered list kept per frame in this browser (ProjectUi.imageEdits), each with its own undo.
// Nothing here changes the stored version: Apply as new version (apply.ts) composites the list into
// v(n+1). Pure, for the tests.

export interface Pt { x: number; y: number }

/** One step of a mask, in 0-1 of the picture. A brush radius is a fraction of the picture's width. */
export type MaskOp =
  | { t: 'brush'; mode: 'add' | 'sub'; r: number; soft: number; pts: Pt[] }
  | { t: 'lasso'; mode: 'add' | 'sub'; pts: Pt[] }
  /** Click-select's mask, run-length coded at a reduced size (mask.ts rle). */
  | { t: 'pick'; mode: 'add' | 'sub'; w: number; h: number; rle: number[] }
  /** Snap to cut-out: keep the mask only where the cut-out is. */
  | { t: 'snap'; cutout: string }

export type Edit =
  | { id: string; kind: 'mask'; name: string; ops: MaskOp[] }
  /** Remove background's result: the picture with its background gone, from the device (sha) or the relay (jobId). */
  | { id: string; kind: 'cutout'; where: 'device' | 'server'; sha?: string; jobId?: string; failed?: string }
  /** x, y: the text's top left, 0-1; size: its height as a fraction of the picture's height. */
  | { id: string; kind: 'text'; text: string; x: number; y: number; size: number }
  /** The kept area, 0-1, the frame's own shape (so w === h in these units). */
  | { id: string; kind: 'crop'; x: number; y: number; w: number; h: number }
  | { id: string; kind: 'fill'; maskId: string; words: string; keepOutside: boolean; jobId: string }
  | { id: string; kind: 'whole'; words: string; jobId: string }
  | { id: string; kind: 'upscale'; scale: 2 | 4; jobId: string }

export type EditKind = Edit['kind']

/** One frame's edits, and what is hidden. `frame` in hidden hides the frame itself. */
export interface EditSession {
  edits: Edit[]
  hidden: string[]
  /** The mask the brush paints now. */
  active?: string
}

export const EMPTY: EditSession = { edits: [], hidden: [] }

let counter = 0
export function editId(): string {
  counter = (counter + 1) % 1_000_000
  return `e_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

const masks = (s: EditSession) => s.edits.filter((e): e is Extract<Edit, { kind: 'mask' }> => e.kind === 'mask')

/** A mask's name: "Mask 1", "Mask 2"… */
export function nextMaskName(s: EditSession): string {
  const used = new Set(masks(s).map((m) => m.name))
  for (let n = 1; ; n++) if (!used.has(`Mask ${n}`)) return `Mask ${n}`
}

/** The mask the brush, lasso, eraser and click-select add to: the active one, else a new one. */
export function withMaskOp(s: EditSession, op: MaskOp): EditSession {
  const active = masks(s).find((m) => m.id === s.active)
  if (active) {
    return { ...s, edits: s.edits.map((e) => (e.id === active.id ? { ...active, ops: [...active.ops, op] } : e)) }
  }
  if (op.t === 'brush' && op.mode === 'sub') return s // nothing to erase yet
  const m: Edit = { id: editId(), kind: 'mask', name: nextMaskName(s), ops: [op] }
  return { ...s, edits: [...s.edits, m], active: m.id }
}

/** The last stroke of the active mask taken back (⌘Z inside a mask). */
export function undoMaskOp(s: EditSession): EditSession {
  const active = masks(s).find((m) => m.id === s.active)
  if (!active || !active.ops.length) return s
  return { ...s, edits: s.edits.map((e) => (e.id === active.id ? { ...active, ops: active.ops.slice(0, -1) } : e)) }
}

/** Clear mask: the active mask emptied (it stays, named, for the next strokes). */
export function clearMask(s: EditSession): EditSession {
  return { ...s, edits: s.edits.map((e) => (e.id === s.active && e.kind === 'mask' ? { ...e, ops: [] } : e)) }
}

export function addEdit(s: EditSession, e: Edit): EditSession {
  return { ...s, edits: [...s.edits, e] }
}

export function updateEdit(s: EditSession, id: string, patch: Partial<Edit>): EditSession {
  return { ...s, edits: s.edits.map((e) => (e.id === id ? ({ ...e, ...patch } as Edit) : e)) }
}

/** Each edit's own undo: it goes, with what depends on it (a fill on a mask that goes). */
export function undoEdit(s: EditSession, id: string): EditSession {
  const gone = new Set([id])
  for (const e of s.edits) if (e.kind === 'fill' && gone.has(e.maskId)) gone.add(e.id)
  // A snap to a cut-out that goes is dropped from its mask; the mask stays.
  const edits = s.edits.filter((e) => !gone.has(e.id)).map((e) => (e.kind === 'mask'
    ? { ...e, ops: e.ops.filter((o) => !(o.t === 'snap' && gone.has(o.cutout))) } : e))
  return { edits, hidden: s.hidden.filter((h) => !gone.has(h)), ...(s.active && !gone.has(s.active) ? { active: s.active } : {}) }
}

export function toggleHidden(s: EditSession, id: string): EditSession {
  return { ...s, hidden: s.hidden.includes(id) ? s.hidden.filter((h) => h !== id) : [...s.hidden, id] }
}

/** The edits that count: masks with paint, results that arrived or are on the way. */
export function editCount(s: EditSession): number {
  return s.edits.filter((e) => !(e.kind === 'mask' && !e.ops.length) && !(e.kind === 'cutout' && e.failed)).length
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The top bar's pill: "3 edits not applied". */
export function notApplied(n: number): string {
  return `${plural(n, 'edit')} not applied`
}

/** What the versions menu says Apply will make (3.12). */
export function applyLine(n: number, version: number): string {
  return `Apply saves your ${plural(n, 'edit')} as v${version + 1}. v${version} stays.`
}

/** Asked before moving to another frame with edits not applied (3.12). */
export function leaveAsk(n: number): string {
  return `Keep the ${plural(n, 'edit')} for later, or discard them?`
}

/** "Next: Fill Mask 1": the next Runway step, when a painted mask has no fill yet. */
export function nextStep(s: EditSession): string | undefined {
  const filled = new Set(s.edits.filter((e) => e.kind === 'fill').map((e) => (e as { maskId: string }).maskId))
  const m = masks(s).find((x) => x.ops.length && !filled.has(x.id))
  return m ? `Next: Fill ${m.name}` : undefined
}

/** An edit as the list says it. `state` is its job's, when it has one. */
export function editLabel(e: Edit, s: EditSession, state?: 'running' | 'ready' | 'failed'): string {
  switch (e.kind) {
    case 'mask': return `${e.name}${s.active === e.id ? ' · painting' : ''}`
    case 'cutout': return 'Cut-out'
    case 'text': return `Text "${e.text}"`
    case 'crop': return 'Crop'
    case 'fill': {
      const m = s.edits.find((x) => x.id === e.maskId)
      return `Fill ${m && m.kind === 'mask' ? m.name : 'mask'}: "${e.words}"${state === 'running' ? ' · working' : ''}`
    }
    case 'whole': return `Change whole frame: "${e.words}"`
    case 'upscale': return `Upscale ${e.scale}×`
  }
}

export interface Layer { id: string; kind: EditKind | 'frame'; label: string; hidden: boolean; locked?: boolean; active?: boolean }

/** The Layers panel, front first: text, masks, cut-outs, results, then the locked Frame (3.12). */
export function layersOf(s: EditSession, version: number): Layer[] {
  const rank: Record<EditKind, number> = { text: 0, mask: 1, cutout: 2, fill: 3, whole: 3, upscale: 3, crop: 4 }
  const out = s.edits
    .filter((e) => e.kind !== 'crop' && !(e.kind === 'cutout' && e.failed))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank[a.e.kind] - rank[b.e.kind] || b.i - a.i)
    .map(({ e }): Layer => ({
      id: e.id, kind: e.kind, hidden: s.hidden.includes(e.id), active: s.active === e.id,
      label: e.kind === 'text' ? 'Text' : e.kind === 'mask' ? e.name : e.kind === 'cutout' ? 'Cut-out'
        : e.kind === 'fill' ? 'Fill' : e.kind === 'whole' ? 'Whole frame' : e.kind === 'upscale' ? `Upscale ${e.scale}×` : 'Crop',
    }))
  out.push({ id: 'frame', kind: 'frame', label: 'Frame', hidden: s.hidden.includes('frame'), locked: true })
  void version
  return out
}

/** The output size an upscale makes from our w x h frame ("→ 2688 × 1536"). */
export function upscaleSize(w: number, h: number, scale: 2 | 4): string {
  return `→ ${w * scale} × ${h * scale}`
}

/** The edits as a frame keeps them (document frame.edits, at most 64): the op and its small params. */
export function editsForFrame(s: EditSession): { op: string; params?: Record<string, unknown> }[] {
  return s.edits.filter((e) => !(e.kind === 'mask' && !e.ops.length) && !(e.kind === 'cutout' && e.failed)).slice(0, 64).map((e) => {
    switch (e.kind) {
      case 'mask': return { op: 'mask', params: { name: e.name, steps: e.ops.length } }
      case 'cutout': return { op: 'cutout', params: { where: e.where, ...(e.jobId ? { job: e.jobId } : {}) } }
      case 'text': return { op: 'text', params: { text: e.text } }
      case 'crop': return { op: 'crop', params: { x: e.x, y: e.y, w: e.w, h: e.h } }
      case 'fill': return { op: 'fill', params: { words: e.words, job: e.jobId, keep_outside: e.keepOutside } }
      case 'whole': return { op: 'whole', params: { words: e.words, job: e.jobId } }
      case 'upscale': return { op: 'upscale', params: { scale: e.scale, job: e.jobId } }
    }
  })
}
