// The shell bar's pieces that are not components (ui/shell/ShellBar.tsx).
import { useDoc } from '../../app/context'
import { openAsks } from '../../model/selectors'

export const ICON = {
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 5l2 4M12 5l2 4M17 5l2 4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
}

/** Where the medallion goes: the studio, when the tool is served inside it (at /production/); else Home. */
export function studioHref(base: string = import.meta.env.BASE_URL): string | null {
  const b = base.replace(/\/+$/, '')
  return b && b !== '' && b !== '.' ? '/' : null
}


/** How many things need you: the open questions (the Decisions count). */
export function useNeedsCount(): number {
  const doc = useDoc()
  return openAsks(doc).length
}

