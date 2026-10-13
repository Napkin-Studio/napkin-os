// A shot's live text (features/script-editor.clan): its action, then its Direction, bound to
// shots/<id>. The same component edits the shot in the Script editor (expanded) and on the
// Storyboard stage's shot cards (compact), so typing in either place shows in the other at once.

import { useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { ModelStore } from '../model/store'
import type { CaretChain } from './caret'
import { counterText, type KeyHooks } from './extensions'
import { FragmentEditor } from './FragmentEditor'
import { useEditorTick, useFieldLength } from './hooks'

export interface ShotEditorProps {
  store: ModelStore
  shotId: string
  /** 'Shot 3', for the label read out. */
  name: string
  compact?: boolean
  chain?: CaretChain
  chainKey?: string
  keys?: KeyHooks
  autoFocus?: 'start' | 'end'
  readOnly?: boolean
  onFocus?: () => void
  onEditor?: (e: Editor | null) => void
}

export function ShotEditor({ store, shotId, name, compact, chain, chainKey, keys, autoFocus, readOnly, onFocus, onEditor }: ShotEditorProps) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const direction = useFieldLength(editor, store, 'shot', 'direction')
  const action = useFieldLength(editor, store, 'shot', 'action')
  useEditorTick(editor)
  const hasDirection = !!editor && editor.state.doc.lastChild?.type.name === 'direction'
  const d = counterText(direction.length, direction.limit)
  const a = counterText(action.length, action.limit)
  return (
    <div className={`shoteditor ${compact ? 'compact' : ''}`}>
      <FragmentEditor
        store={store} kind="shot" id={shotId} label={`${name}: action and direction`} compact={compact}
        chain={chain} chainKey={chainKey} keys={keys} autoFocus={autoFocus} readOnly={readOnly} onFocus={onFocus}
        placeholder={(type) => (type === 'direction' ? 'How it plays: the look, the pace, the feeling…' : compact ? 'What happens in this shot…' : 'What happens in this shot. Tab for Direction.')}
        onNotice={(m) => {
          setNotice(m)
          setTimeout(() => setNotice(null), 5000)
        }}
        onEditor={(e) => {
          setEditor(e)
          onEditor?.(e)
        }}
      />
      <div className="shoteditor-foot">
        {action.length > action.limit * 0.8 && <span className={`counter ${a.warn ? 'warn' : ''}`} title="The action, as the storyboard keeps it">Action {a.text}</span>}
        {hasDirection && <span className={`counter ${d.warn ? 'warn' : ''}`} aria-live="polite" title="Direction: what a job is told about how the shot plays">{d.text}</span>}
        {notice && <span className="se-notice" role="status">{notice}</span>}
      </div>
    </div>
  )
}
