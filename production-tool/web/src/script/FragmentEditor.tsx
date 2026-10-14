// One editor bound to one entity's fragment (features/script-editor.clan): the Script
// editor mounts these on demand (the current shot, a focused scene or beat) and the
// Storyboard stage's shot cards mount the compact one. Its typing becomes LocalUndo steps
// (typing.ts); it keeps no undo of its own, so ⌘Z here is the person's undo
// ([data-script-editor], ui/undoKeys.ts).

import { useEffect, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import type { FragmentKind } from '../../../clan-store/src'
import type { ModelStore } from '../model/store'
import type { CaretChain } from './caret'
import { editorExtensions, HookRelay, refNames, type KeyHooks } from './extensions'
import { trackTyping } from './typing'
import { redrawMentions, type MentionHooks } from './mentions'
import './fragment.css'

export interface FragmentEditorProps {
  store: ModelStore
  kind: FragmentKind
  id: string
  label: string
  className?: string
  compact?: boolean
  placeholder?: string | ((blockType: string, index: number) => string)
  keys?: KeyHooks
  /** Its place in the caret chain. */
  chain?: CaretChain
  chainKey?: string
  /** Words the person must see ('Kept the first 4,000 characters'). */
  onNotice?: (message: string) => void
  onEditor?: (editor: Editor | null) => void
  onFocus?: () => void
  /** Focus as soon as it mounts. */
  autoFocus?: 'start' | 'end'
  readOnly?: boolean
  /** @ mentions here (mentionHooks.ts). */
  mentions?: MentionHooks
}

export function FragmentEditor({ store, kind, id, label, className, compact, placeholder, keys, chain, chainKey, onNotice, onEditor, onFocus, autoFocus, readOnly, mentions }: FragmentEditorProps) {
  // The hooks change with every render; the editor is made once per fragment, so it reads them through a relay.
  const [relay] = useState(() => new HookRelay())
  useEffect(() => {
    relay.set(keys, onNotice, onFocus, mentions)
  })
  const editor = useEditor({
    extensions: editorExtensions({
      kind,
      fragment: store.text.fragment(kind, id),
      refs: () => refNames(store.get()),
      compact,
      placeholder,
      notice: (m) => relay.notice(m),
      keys: relay.keys(),
      mentions: () => relay.mentions(),
    }),
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: `fragment ${className ?? ''}`.trim(),
        'data-script-editor': '',
        'data-kind': kind,
        'aria-label': label,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onFocus: () => relay.focus(),
  }, [store, kind, id])

  useEffect(() => {
    if (!editor) return
    const untrack = trackTyping(editor, store.typing, kind, id)
    onEditor?.(editor)
    return () => {
      untrack()
      onEditor?.(null)
    }
    // onEditor is the owner's ref setter; the editor and fragment are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, store, kind, id])

  useEffect(() => {
    if (!editor || !chain || !chainKey) return
    return chain.register(chainKey, { focus: (where) => editor.commands.focus(where) })
  }, [editor, chain, chainKey])

  useEffect(() => {
    if (editor && autoFocus) editor.commands.focus(autoFocus)
    // Only when it mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  // A ref renamed, linked or gone: the mentions redraw under their names now.
  useEffect(() => {
    if (!editor) return
    redrawMentions(editor)
    return store.onChange(() => redrawMentions(editor))
  }, [editor, store])

  return <EditorContent editor={editor} />
}
