// The input state machine (features/engine-ink.clan; ui-behaviour section 8).
// DOM-free: raw pointer samples in, intents out, so every rule is tested without
// a device. The adapter feeds it PointerEvents and acts on the intents.
//
// - Pen mode is sticky: once a pen is seen, touches never draw. One finger pans,
//   two pinch, a two-finger tap is undo, a three-finger tap redo, and a long
//   press is reported (the selection bar, or the ratio picker on a sketch area).
// - Palm first: a touch pan that began within PALM_MS before a pen-down is
//   reverted (palm-revert carries the pan to undo), and the first one is flagged
//   so the palm toast shows once. Touches that land while the pen is down are
//   ignored.
// - Pen hover (a pen move with no button) reports an 18 px ring.
// - Before any pen is seen, a finger draws with the ink tools (an iPad without
//   a Pencil); a second finger turns that into a pinch and cancels the stroke.
// - Mouse and pen in the ink tools draw; in other tools they press, drag and
//   release (engine-select); the hand tool and the middle button pan.
// - A finger grabs by a long press (board-move; ui-behaviour 8): held still for
//   LONG_PRESS_MS on something canGrab says a press would pick up, it becomes a
//   press, then drags and a release, by 'touch'. A palm (the pen coming down) or
//   a second finger cancels the grab (press-cancel), and two fingers pinch.
//   Elsewhere one finger still pans.

export type PointerKind = 'mouse' | 'pen' | 'touch'
export type ToolKind = 'ink' | 'select' | 'hand'

export interface InPoint {
  x: number
  y: number
  pressure: number
}

export interface RawPointer {
  phase: 'down' | 'move' | 'up' | 'cancel' | 'leave'
  id: number
  type: PointerKind
  /** Viewport (client) pixels. */
  x: number
  y: number
  pressure: number
  /** PointerEvent.buttons; 0 on a hover move. 4 is the middle button. */
  buttons: number
  /** Event time, ms. */
  t: number
  coalesced?: InPoint[]
  predicted?: InPoint[]
}

export type Intent =
  | { kind: 'ink-start'; id: number; at: InPoint; by: PointerKind }
  | { kind: 'ink-move'; id: number; points: InPoint[]; predicted?: InPoint[] }
  | { kind: 'ink-end'; id: number }
  | { kind: 'ink-cancel'; id: number }
  | { kind: 'press'; id: number; x: number; y: number; by: PointerKind }
  | { kind: 'drag'; id: number; x: number; y: number }
  | { kind: 'release'; id: number; x: number; y: number }
  /** A press is called off (a palm, or a second finger, during a finger's grab): drop its preview. */
  | { kind: 'press-cancel'; id: number }
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'pinch'; scale: number; cx: number; cy: number; dx: number; dy: number }
  | { kind: 'hover'; x: number; y: number; radius: number }
  | { kind: 'hover-end' }
  | { kind: 'tap'; x: number; y: number; by: PointerKind }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'long-press'; x: number; y: number }
  | { kind: 'palm-revert'; dx: number; dy: number; first: boolean }

export const PALM_MS = 150
export const TAP_MS = 300
export const TAP_SLOP = 10
export const LONG_PRESS_MS = 500
export const HOVER_RADIUS = 18

interface Touch {
  x: number
  y: number
  startX: number
  startY: number
  t0: number
  /** The pan this touch made (for a palm revert). */
  panX: number
  panY: number
  /** The time its first pan began, if it panned. */
  panT: number | null
}

/** One touch gesture, from the first finger down to the last up. */
interface Gesture {
  t0: number
  maxFingers: number
  moved: boolean
  longPressed: boolean
  ignored: boolean
  /** The finger that grabbed by a long press: its moves drag. */
  grab: number | null
}

export class InputRouter {
  /** Once a pen is seen, for the rest of the session. */
  penMode = false
  tool: ToolKind = 'ink'
  private penDown: number | null = null
  private penInk = false
  private mouse: { id: number; ink: boolean; pan: boolean; x: number; y: number } | null = null
  private readonly touches = new Map<number, Touch>()
  private gesture: Gesture | null = null
  /** A finger drawing before any pen was seen. */
  private fingerInk: number | null = null
  private palmShown = false
  private hovering = false
  private pinch: { d: number; cx: number; cy: number } | null = null
  /**
   * Would a press at this viewport point pick something up? Asked once, when a finger's long press
   * fires (DOM-free: the adapter answers from the select tool's grabOrder). Null: a finger never grabs.
   */
  canGrab: ((x: number, y: number) => boolean) | null = null

  constructor(opts: { canGrab?: (x: number, y: number) => boolean } = {}) {
    this.canGrab = opts.canGrab ?? null
  }

  handle(p: RawPointer): Intent[] {
    if (p.type === 'pen') return this.pen(p)
    if (p.type === 'touch') return this.touch(p)
    return this.pointer(p)
  }

  /** Long press is a timer: call with the time on each frame while a finger is down. */
  tick(t: number): Intent[] {
    const g = this.gesture
    if (!g || g.ignored || g.moved || g.longPressed || this.touches.size !== 1 || this.fingerInk !== null) return []
    if (t - g.t0 < LONG_PRESS_MS) return []
    g.longPressed = true
    const [[id, f]] = this.touches.entries()
    const out: Intent[] = [{ kind: 'long-press', x: f.x, y: f.y }]
    if (this.tool !== 'hand' && this.canGrab?.(f.x, f.y)) {
      g.grab = id
      out.push({ kind: 'press', id, x: f.x, y: f.y, by: 'touch' })
    }
    return out
  }

  private points(p: RawPointer): InPoint[] {
    return p.coalesced?.length ? p.coalesced : [{ x: p.x, y: p.y, pressure: p.pressure }]
  }

  private pen(p: RawPointer): Intent[] {
    const out: Intent[] = []
    if (p.phase === 'down') {
      this.penMode = true
      if (this.hovering) {
        this.hovering = false
        out.push({ kind: 'hover-end' })
      }
      // Palm first: a touch that began panning just before the pen came down was the palm.
      let dx = 0
      let dy = 0
      let palm = false
      for (const t of this.touches.values()) {
        if (t.panT !== null && p.t - t.panT <= PALM_MS) {
          dx += t.panX
          dy += t.panY
          palm = true
        }
      }
      if (this.fingerInk !== null) {
        out.push({ kind: 'ink-cancel', id: this.fingerInk })
        this.fingerInk = null
      }
      if (this.gesture?.grab != null) {
        out.push({ kind: 'press-cancel', id: this.gesture.grab })
        this.gesture.grab = null
      }
      if (this.touches.size) {
        if (palm) {
          out.push({ kind: 'palm-revert', dx: -dx, dy: -dy, first: !this.palmShown })
          this.palmShown = true
        }
        if (this.gesture) this.gesture.ignored = true
        this.pinch = null
      }
      this.penDown = p.id
      if (p.buttons & 4 || this.tool === 'hand') {
        this.penInk = false
        this.mouse = { id: p.id, ink: false, pan: true, x: p.x, y: p.y }
        return out
      }
      this.penInk = this.tool === 'ink'
      out.push(this.penInk ? { kind: 'ink-start', id: p.id, at: { x: p.x, y: p.y, pressure: p.pressure || 0.5 }, by: 'pen' } : { kind: 'press', id: p.id, x: p.x, y: p.y, by: 'pen' })
      return out
    }
    if (p.phase === 'move') {
      if (this.penDown === null) {
        if (p.buttons === 0) {
          this.hovering = true
          return [{ kind: 'hover', x: p.x, y: p.y, radius: HOVER_RADIUS }]
        }
        return []
      }
      if (this.mouse?.pan && this.mouse.id === p.id) return this.panBy(p)
      return this.penInk ? [{ kind: 'ink-move', id: p.id, points: this.points(p), ...(p.predicted?.length ? { predicted: p.predicted } : {}) }] : [{ kind: 'drag', id: p.id, x: p.x, y: p.y }]
    }
    if (p.phase === 'leave') {
      if (!this.hovering) return []
      this.hovering = false
      return [{ kind: 'hover-end' }]
    }
    // up or cancel
    if (this.penDown !== p.id) return []
    this.penDown = null
    if (this.mouse?.pan) {
      this.mouse = null
      return []
    }
    if (this.penInk) return [{ kind: p.phase === 'cancel' ? 'ink-cancel' : 'ink-end', id: p.id }]
    return [{ kind: 'release', id: p.id, x: p.x, y: p.y }]
  }

  private panBy(p: RawPointer): Intent[] {
    const m = this.mouse!
    const dx = p.x - m.x
    const dy = p.y - m.y
    m.x = p.x
    m.y = p.y
    return dx || dy ? [{ kind: 'pan', dx, dy }] : []
  }

  private pointer(p: RawPointer): Intent[] {
    if (p.phase === 'down') {
      const pan = this.tool === 'hand' || (p.buttons & 4) !== 0
      const ink = !pan && this.tool === 'ink'
      this.mouse = { id: p.id, ink, pan, x: p.x, y: p.y }
      if (pan) return []
      return [ink ? { kind: 'ink-start', id: p.id, at: { x: p.x, y: p.y, pressure: 0.5 }, by: 'mouse' } : { kind: 'press', id: p.id, x: p.x, y: p.y, by: 'mouse' }]
    }
    const m = this.mouse
    if (!m || m.id !== p.id) return []
    if (p.phase === 'move') {
      if (m.pan) return this.panBy(p)
      if (m.ink) return [{ kind: 'ink-move', id: p.id, points: this.points(p).map((q) => ({ ...q, pressure: 0.5 })) }]
      return [{ kind: 'drag', id: p.id, x: p.x, y: p.y }]
    }
    if (p.phase === 'leave') return []
    this.mouse = null
    if (m.pan) return []
    if (m.ink) return [{ kind: p.phase === 'cancel' ? 'ink-cancel' : 'ink-end', id: p.id }]
    return [{ kind: 'release', id: p.id, x: p.x, y: p.y }]
  }

  private touch(p: RawPointer): Intent[] {
    if (p.phase === 'down') {
      // The palm while the pen is down: never a gesture.
      if (this.penDown !== null) {
        if (!this.gesture) this.gesture = { t0: p.t, maxFingers: 0, moved: false, longPressed: false, ignored: true, grab: null }
        this.touches.set(p.id, { x: p.x, y: p.y, startX: p.x, startY: p.y, t0: p.t, panX: 0, panY: 0, panT: null })
        return []
      }
      const out: Intent[] = []
      this.gesture ??= { t0: p.t, maxFingers: 0, moved: false, longPressed: false, ignored: false, grab: null }
      this.touches.set(p.id, { x: p.x, y: p.y, startX: p.x, startY: p.y, t0: p.t, panX: 0, panY: 0, panT: null })
      this.gesture.maxFingers = Math.max(this.gesture.maxFingers, this.touches.size)
      if (this.touches.size === 1 && !this.penMode && this.tool === 'ink' && !this.gesture.ignored) {
        this.fingerInk = p.id
        out.push({ kind: 'ink-start', id: p.id, at: { x: p.x, y: p.y, pressure: p.pressure || 0.5 }, by: 'touch' })
      } else if (this.touches.size === 2) {
        // A second finger during a grab: the move is called off, and the two fingers pinch.
        if (this.gesture.grab !== null) {
          out.push({ kind: 'press-cancel', id: this.gesture.grab })
          this.gesture.grab = null
        }
        if (this.fingerInk !== null) {
          out.push({ kind: 'ink-cancel', id: this.fingerInk })
          this.fingerInk = null
        }
        this.pinch = this.pinchOf()
      }
      return out
    }
    const t = this.touches.get(p.id)
    if (!t) return []
    if (p.phase === 'move') {
      const dx = p.x - t.x
      const dy = p.y - t.y
      t.x = p.x
      t.y = p.y
      const g = this.gesture
      if (g && Math.hypot(p.x - t.startX, p.y - t.startY) > TAP_SLOP) g.moved = true
      if (!g || g.ignored) return []
      if (g.grab === p.id) return [{ kind: 'drag', id: p.id, x: p.x, y: p.y }]
      if (this.fingerInk === p.id) return [{ kind: 'ink-move', id: p.id, points: this.points(p) }]
      if (this.touches.size === 1) {
        if (!g.moved) return []
        t.panT ??= p.t
        t.panX += dx
        t.panY += dy
        return dx || dy ? [{ kind: 'pan', dx, dy }] : []
      }
      if (this.touches.size === 2 && this.pinch) {
        const next = this.pinchOf()
        const out: Intent = { kind: 'pinch', scale: next.d / Math.max(1, this.pinch.d), cx: next.cx, cy: next.cy, dx: next.cx - this.pinch.cx, dy: next.cy - this.pinch.cy }
        this.pinch = next
        return [out]
      }
      return []
    }
    if (p.phase === 'leave') return []
    // up or cancel
    this.touches.delete(p.id)
    const out: Intent[] = []
    if (this.gesture?.grab === p.id) {
      this.gesture.grab = null
      out.push(p.phase === 'cancel' ? { kind: 'press-cancel', id: p.id } : { kind: 'release', id: p.id, x: p.x, y: p.y })
    }
    if (this.fingerInk === p.id) {
      this.fingerInk = null
      out.push({ kind: p.phase === 'cancel' ? 'ink-cancel' : 'ink-end', id: p.id })
    }
    if (this.touches.size < 2) this.pinch = null
    if (this.touches.size === 0 && this.gesture) {
      const g = this.gesture
      this.gesture = null
      const quick = p.t - g.t0 <= TAP_MS
      if (!g.ignored && !g.moved && !g.longPressed && quick && p.phase === 'up') {
        if (g.maxFingers === 2) out.push({ kind: 'undo' })
        else if (g.maxFingers === 3) out.push({ kind: 'redo' })
        else if (g.maxFingers === 1 && !out.length) out.push({ kind: 'tap', x: p.x, y: p.y, by: 'touch' })
      }
    }
    return out
  }

  private pinchOf() {
    const [a, b] = [...this.touches.values()]
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
  }
}
