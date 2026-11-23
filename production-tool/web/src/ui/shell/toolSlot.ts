import { useEffect, useState } from 'react'

/** The top bar's place for a canvas tool's options (the pen's colours and widths, the text's size): off the canvas, so
 *  nothing over the canvas swallows a stroke (UAT round 4 S3-2). The canvas bar renders it; the canvas chrome portals in. */
export const TOOL_OPTIONS_SLOT = 'pt-tool-options'

/**
 * The top bar's tool-options slot as it is now, or null (the picture editor's page has no bar). UAT round 5 S3-1: it was
 * looked up once; after the picture editor or the Storyboard the bar is made again with a new slot, the one held was
 * gone, and the options fell back beside the rail, over the canvas, swallowing strokes. It is found again whenever the
 * page's elements change and the one held is not the one there.
 */
export function useToolSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const find = () => setSlot((was) => {
      const now = document.getElementById(TOOL_OPTIONS_SLOT)
      return now === was ? was : now
    })
    find()
    const t = setTimeout(find, 0)
    const watch = typeof MutationObserver === 'undefined' ? null : new MutationObserver(find)
    watch?.observe(document.body, { childList: true, subtree: true })
    return () => { clearTimeout(t); watch?.disconnect() }
  }, [])
  return slot
}
