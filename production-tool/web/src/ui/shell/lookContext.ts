// The agency's look and the theme, as hooks (ui/shell/look.tsx provides the look).
import { createContext, useContext, useSyncExternalStore } from 'react'
import { getTheme, onThemeChange, type Theme } from '../../theme'
import { lookOf, type AgencyLook } from './agency'

export const LookContext = createContext<AgencyLook>(lookOf(null))
export const useLook = () => useContext(LookContext)

export function useTheme(): Theme {
  return useSyncExternalStore(onThemeChange, getTheme, () => 'light' as Theme)
}
