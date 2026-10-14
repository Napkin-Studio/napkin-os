// The panels any bar can open over the canvas or an editor: History (the decision tree,
// ui-behaviour 3.20) and Assets (3.18). App owns which one is open.

import { createContext, useContext } from 'react'

export interface Panels {
  history: boolean
  assets: boolean
  toggle: (p: 'history' | 'assets') => void
}

export const PanelsContext = createContext<Panels>({ history: false, assets: false, toggle: () => {} })
export const usePanels = () => useContext(PanelsContext)

/** Initials for a person: "Shrey Batra" → "SB", "engineer" → "EN". */
export function initials(name: string | undefined): string {
  const words = (name ?? '').trim().split(/[\s._@-]+/).filter(Boolean)
  if (!words.length) return '·'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/** A node's title in its bar or card: its own title, or, while it still has the template's word
 *  ("Script", "Storyboard"), the ad's name ("First Light" from "Lumen Water · First Light"). */
export function nodeTitle(own: string | undefined, templateWord: string, project: string | undefined): string {
  if (own && own.trim() && own.trim() !== templateWord && !/^untitled/i.test(own.trim())) return own.trim()
  const ad = project?.split(' · ').at(-1)?.trim()
  return ad && !/^untitled/i.test(ad) ? ad : templateWord
}
