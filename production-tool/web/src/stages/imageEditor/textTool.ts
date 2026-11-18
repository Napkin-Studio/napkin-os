// The Text tool's finish (QA 2026-11-17: clicking the frame to end typing dropped a second "Your words").
// While a text on the frame is being typed, a click on the frame finishes it, never adds another; Enter
// (without Shift) and Escape finish it too.

/** Whether a click on the frame should finish the text being typed instead of adding a new one. */
export function finishesTyping(active: Element | null): boolean {
  return !!active?.closest?.('.ie-text')
}

/** Whether a key ends typing on the frame's text. */
export function endsTyping(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)
}
