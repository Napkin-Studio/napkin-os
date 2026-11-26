// The Script editor's React hooks (features/script-editor.clan).

import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { FragmentKind } from '../../../clan-store/src'
import type { ModelStore } from '../model/store'
import { fieldLengths, limitsOf, refNames, type Field } from './extensions'

/** A field's length as checkpoint will count it, live from the editor; re-renders as the person types. */
export function useFieldLength(editor: Editor | null, store: ModelStore, kind: FragmentKind, field: Field): { length: number; limit: number } {
  const limit = limitsOf(kind)[field] ?? 0
  const [length, setLength] = useState(0)
  useEffect(() => {
    if (!editor) return
    const read = () => setLength(fieldLengths(kind, editor.state.doc, refNames(store.get()))[field] ?? 0)
    read()
    editor.on('update', read)
    return () => {
      editor.off('update', read)
    }
  }, [editor, store, kind, field])
  return { length, limit }
}

/** Re-render on every change and selection move in an editor (the element bar, the Direction counter). */
export function useEditorTick(editor: Editor | null): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!editor) return
    const bump = () => setN((x) => x + 1)
    editor.on('transaction', bump)
    return () => {
      editor.off('transaction', bump)
    }
  }, [editor])
  return n
}
