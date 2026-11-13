// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { host } from '../host'
import type { ClientAnswerKind, ClientPartRef, FrameOptions, ManifestInfo } from '../host'
import { partsFrom } from './clientReview/review'
import { getTheme, onThemeChange } from '../theme'
import { setExportFrame } from './appExport'
import { barFrom, type BarItem } from './appBar'
import { jobsMessage } from './openJobs'
import { editModeMessage } from './editMode'
import { boothFrom, boothKey, boothMessage, readBooth, writeBooth } from './booth'
import { agencyIdOf, coloursOf } from './agency/palette'
import { dogfoodState, record, subscribe as onDogfood } from '../dogfood/recorder'
import { activity as markActivity } from '../components/markStore'
import { writeFrom, type SaveQueue } from '../components/states/saveQueue'
import { fromFrame as feedbackFromFrame, setFeedbackFrame } from '../dogfood/pointer'

interface Props {
  hasHumanView: boolean
  /** The document as opened (manifest sha256, and its view's version): a new one is a new page. */
  version: string
  manifest: ManifestInfo
  /** "authored" → structured (data-layer) bridge; "legacy" → contenteditable. */
  renderModel: 'authored' | 'legacy'
  editMode: boolean
  /**
   * Client review, the OS's other mode (OS-layer contract §7.5). The app's
   * fields show "+ This part" under each part it declared while `on`, and
   * only for an answer that is not Accepted.
   */
  clientMode?: { on: boolean; answer: ClientAnswerKind | null }
  /** The parts the app declares (`clan:parts`), in document order. */
  onParts?: (parts: ClientPartRef[]) => void
  /** A part marked or unmarked in client review, and the words under it (`clan:part-mark`). */
  onPartMark?: (mark: { address: string; marked: boolean; words: string }) => void
  /**
   * The app asks for edit mode (`clan:edit-request`): "Make this change"
   * reopened one part, and the part opens in edit mode with the reason filled in.
   */
  onEditRequest?: () => void
  /**
   * The app asks to be shown under glass chrome (`clan:chrome`, mode glass):
   * the shell's bar, footer and rail lie over it, frosted, and the app is told
   * how much of it they cover (`clan:insets`) so it can keep its content clear.
   */
  onChrome?: (mode: 'glass' | 'solid', tint: string | null) => void
  /** What the app asks the OS bar to show (`clan:bar`): its whole list, each time. */
  onBar?: (items: BarItem[]) => void
  /** Where the app's writes are reported (`clan:write`) and retried (`clan:retry`). */
  writes?: SaveQueue
  /** A write of the app's reached the host (`clan:write`, saved). */
  onSaved?: () => void
  /** Cmd or Ctrl Z, pressed inside the app where no field owns it (`clan:undo-key`). */
  onUndoKey?: (dir: 'undo' | 'redo') => void
  /** Cmd or Ctrl K pressed inside the tool's frame: the bar opens (features/one-bar-search.clan). */
  onBarKey?: () => void
  /** What the shell's chrome covers of the frame, in CSS pixels, when it is glass. */
  insets?: { top: number; right: number; bottom: number } | null
  /**
   * The open document's jobs the host has not seen finish (`LibraryItem.jobs`), told to its page
   * (`clan:jobs`) on every load and whenever they change, so a run still going resumes on open.
   */
  jobs?: readonly string[]
  /**
   * Who is signed in: the Booth's hidden or shown is kept per person and tool
   * (`clan:booth`, booth.ts), and posted to the page on every load.
   */
  person?: string | null
}

/**
 * The render surface for one running app: the human view inside a sandboxed
 * iframe. The host composes the page (napkin-host frame.rs) with the edit
 * bridge the render model asks for — the structured (data-layer) bridge for
 * authored Napkin apps, the legacy contenteditable bridge for AI-generated
 * HTML — and the frame loads it from the host's clan://document, or, with no
 * server, from srcdoc.
 */
/** Fired on window when the open document's page has loaded. */
export const DOC_LOADED = 'napkin:doc-loaded'

export default function AppRuntime({
  hasHumanView, version, manifest, renderModel, editMode, clientMode, onParts, onPartMark, onEditRequest,
  onChrome, onBar, writes, insets, jobs, person, onSaved, onUndoKey, onBarKey,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const editModeRef = useRef(editMode)

  // Edit mode goes to the host (its record of the session) and to the page
  // itself, on every change and again on every load (`clan:edit-mode`). The
  // page's bridge used to ask clan://edit-mode every 0.4 s instead
  // (features/edit-mode-pushed.clan).
  const postEditMode = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(editModeMessage(editModeRef.current), '*')
  }, [])

  useEffect(() => {
    editModeRef.current = editMode
    host.setEditMode(editMode).catch(console.error)
    postEditMode()
  }, [editMode, postEditMode])

  // Legacy views save HTML-fragment patches; the backend echoes a
  // clan-patch-saved event. The edit is already in the DOM — don't reload.
  useEffect(() => {
    const unlisten = host.on('clan-patch-saved', () => {})
    return () => { unlisten.then(f => f()) }
  }, [])

  // The app runs in its own document, so the colour scheme has to be sent to
  // it. Apps opt in by styling `html[data-color-scheme="light"]`, or by
  // listening for the `clan:colorscheme` event the bridge dispatches; one that
  // does neither simply keeps its own palette.
  const postScheme = useCallback((scheme: string) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'clan:colorscheme', scheme }, '*',
    )
  }, [])

  useEffect(() => onThemeChange(postScheme), [postScheme])

  // With no server to serve it, the frame's clan:// requests arrive here and
  // go to the device host — `/api-proxy` included, which answers that no
  // middleware is configured. Only requests from our own frame are answered.
  useEffect(() => {
    if (host.frameLoad !== 'srcdoc') return
    const onMessage = async (e: MessageEvent) => {
      const frame = iframeRef.current?.contentWindow
      if (!frame || e.source !== frame) return
      const msg = e.data as {
        type?: string; id?: number; op?: string; path?: string; query?: string
        body?: string | Uint8Array
      }
      if (msg?.type !== 'clan:rpc') return
      const path = msg.path ?? (msg.op === 'api-proxy' ? '/api-proxy' : '')

      try {
        const raw = typeof msg.body === 'string' ? new TextEncoder().encode(msg.body)
                                                 : (msg.body ?? new Uint8Array())
        const r = await host.handleFromFrame(path, msg.query ?? '', raw)
        frame.postMessage(
          { type: 'clan:rpc-reply', id: msg.id, status: r.status,
            headers: Object.fromEntries(r.headers), body: r.body },
          '*',
        )
      } catch (err) {
        frame.postMessage(
          { type: 'clan:rpc-reply', id: msg.id, status: 500, headers: {},
            body: new TextEncoder().encode(String(err)) },
          '*',
        )
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Who is signed in, for an app that asks ("clan:me?"): read-only, and only
  // for our own frame. The host records a person's writes under this actor
  // whatever the app says, so an app uses it to write the same `by` and to say
  // "You" — never to prove who someone is.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const frame = iframeRef.current?.contentWindow
      if (!frame || e.source !== frame || (e.data as { type?: string })?.type !== 'clan:me?') return
      host.whoAmI().then(
        // The agency's admin-set colours ride along (features/brief-new-ui.clan):
        // a document wears its agency's base and accent on its own controls.
        me => frame.postMessage({ type: 'clan:me', actor: me.actor, id: me.id, name: me.name, agency: coloursOf(agencyIdOf(me.id)) }, '*'),
        () => frame.postMessage({ type: 'clan:me', actor: null, id: null, name: null }, '*'),
      )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // A token the server no longer holds (a deploy restarts napkin-web, which
  // keeps tokens in memory): the frame's fetch shim asks for this document's
  // origin now ("clan:token?", with the one it was refused on), and sends its
  // call again on the answer, once. The page stays as it is, edit and all.
  // Only our own frame is answered; null tells it to give up.
  useEffect(() => {
    const renew = host.frameLoad === 'url' ? host.renewToken : undefined
    if (!renew) return
    const onMessage = (e: MessageEvent) => {
      const frame = iframeRef.current?.contentWindow
      const m = e.data as { type?: string; held?: unknown }
      if (!frame || e.source !== frame || m?.type !== 'clan:token?') return
      const reply = (origin: string | null) => frame.postMessage({ type: 'clan:token', origin }, '*')
      renew(typeof m.held === 'string' ? m.held : undefined).then(origin => {
        // The new process holds no edit mode either: say it again.
        if (origin) host.setEditMode(editModeRef.current).catch(console.error)
        reply(origin)
      }, () => reply(null))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // ── client review ─────────────────────────────────────────────────────────
  // The mode is the shell's; the app's fields draw the per-part controls. The
  // mode goes to the frame whenever it changes and again on every load, so a
  // reloaded frame is never left showing controls for a mode that ended.
  const clientOn = !!clientMode?.on
  const clientAnswer = clientMode?.answer ?? null
  const clientRef = useRef({ on: clientOn, answer: clientAnswer })
  const postClientMode = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'clan:clientmode', on: clientRef.current.on, answer: clientRef.current.on ? clientRef.current.answer : null }, '*',
    )
  }, [])
  useEffect(() => {
    clientRef.current = { on: clientOn, answer: clientAnswer }
    postClientMode()
  }, [clientOn, clientAnswer, postClientMode])

  // What the app says about its parts. Its contentWindow is the frame's for
  // the frame's whole life, loads included, so nothing it posts before its
  // load event is missed. Only our own frame is heard.
  const handlers = useRef({ onParts, onPartMark, onEditRequest, onChrome, onBar, writes, onSaved, onUndoKey, onBarKey })
  useEffect(() => { handlers.current = { onParts, onPartMark, onEditRequest, onChrome, onBar, writes, onSaved, onUndoKey, onBarKey } })
  // Try again for a write that did not land: the frame holds the write, the shell asks it to send it again.
  useEffect(() => {
    if (!writes) return
    writes.attach(id => iframeRef.current?.contentWindow?.postMessage({ type: 'clan:retry', id }, '*'))
    return () => writes.attach(null)
  }, [writes])
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const frame = iframeRef.current?.contentWindow
      if (!frame || e.source !== frame) return
      const m = e.data as { type?: string; parts?: unknown; address?: unknown; marked?: unknown; words?: unknown }
      if (m?.type === 'clan:parts') handlers.current.onParts?.(partsFrom(m.parts))
      else if (m?.type === 'clan:part-mark' && typeof m.address === 'string') {
        handlers.current.onPartMark?.({ address: m.address, marked: m.marked === true, words: typeof m.words === 'string' ? m.words : '' })
      } else if (m?.type === 'clan:edit-request') handlers.current.onEditRequest?.()
      else if (m?.type === 'clan:activity') markActivity()
      // the dogfood build's listener inside the frame (recorder.ts FRAME_CAPTURE)
      else if (m?.type === 'clan:interaction') {
        const { kind, name } = m as { kind?: unknown; name?: unknown }
        record(typeof kind === 'string' ? kind : 'click', typeof name === 'string' ? name.slice(0, 120) : 'page', { in: 'app' })
      }
      else if (m?.type === 'clan:bar') handlers.current.onBar?.(barFrom(m))
      // feedback by pointing at it, inside the page (dogfood/pointer.ts): what was picked, or F
      else if (m?.type === 'clan:feedback-picked' || m?.type === 'clan:feedback-key') {
        const r = iframeRef.current?.getBoundingClientRect()
        feedbackFromFrame(m, { x: r?.left ?? 0, y: r?.top ?? 0 })
      }
      else if (m?.type === 'clan:write') {
        const w = writeFrom(m)
        if (w) { handlers.current.writes?.report(w); if (w.state === 'saved') handlers.current.onSaved?.() }
      } else if (m?.type === 'clan:undo-key') {
        const dir = (m as { dir?: unknown }).dir
        if (dir === 'undo' || dir === 'redo') handlers.current.onUndoKey?.(dir)
      } else if (m?.type === 'clan:bar-key') handlers.current.onBarKey?.()
      else if (m?.type === 'clan:chrome') {
        const { mode, tint } = m as { mode?: unknown; tint?: unknown }
        handlers.current.onChrome?.(mode === 'glass' ? 'glass' : 'solid',
          typeof tint === 'string' && /^#[0-9a-f]{6}$/i.test(tint) ? tint : null)
      }
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage); setFeedbackFrame(null) }
  }, [])

  // What the glass chrome covers, sent whenever it changes (and on load).
  const insetsRef = useRef(insets)
  const postInsets = useCallback(() => {
    const i = insetsRef.current
    if (!i) return
    iframeRef.current?.contentWindow?.postMessage({ type: 'clan:insets', top: i.top, right: i.right, bottom: i.bottom }, '*')
  }, [])
  // `insets` is a new object only when a value changed (AppHost keeps the old one otherwise).
  useEffect(() => { insetsRef.current = insets; postInsets() }, [insets, postInsets])

  // The document's running jobs, the whole list each time (openJobs.ts): on load and when they change.
  const jobsRef = useRef<readonly string[]>(jobs ?? [])
  const postJobs = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(jobsMessage(jobsRef.current), '*')
  }, [])
  // `jobs` is a new array only when its ids changed (AppHost keys it by them).
  useEffect(() => { jobsRef.current = jobs ?? []; postJobs() }, [jobs, postJobs])

  // The Booth hidden or shown (features/booth.clan): the page says it when the person changes it, and
  // hears the stored choice on every load. Kept per person and per tool, never in the frame (sandboxed).
  const boothAt = boothKey(person, manifest.app?.app_id)
  const boothRef = useRef(boothAt)
  useEffect(() => { boothRef.current = boothAt }, [boothAt])
  const postBooth = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(boothMessage(readBooth(boothRef.current)), '*')
  }, [])
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!iframeRef.current?.contentWindow || e.source !== iframeRef.current.contentWindow) return
      const open = boothFrom(e.data)
      if (open !== null) writeBooth(boothRef.current, open)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // The dogfood build listens inside the frame too, once the person has agreed.
  const dogfood = useSyncExternalStore(onDogfood, dogfoodState, dogfoodState)
  const capture = dogfood.on && dogfood.consented

  // What the page is composed for; the host composes it (features/
  // doc-open-direct.clan). The theme is read when the page is asked for, not
  // followed: a later change is posted to the frame (clan:colorscheme) rather
  // than reloading it.
  const opts = useMemo<FrameOptions | null>(
    () => (hasHumanView ? { model: renderModel, capture, theme: getTheme(), version } : null),
    [hasHumanView, renderModel, capture, version],
  )

  // A host behind an address serves the page there: the frame's src is all
  // the shell sets, and the one GET is the whole open.
  const iframeSrc = useMemo(() => (opts && host.frameLoad === 'url' ? host.frameSrc(opts) : ''), [opts])

  // With no server, the host in this tab composes it for srcdoc. Only the
  // newest page is shown: one composed for older options never replaces it.
  const [srcDoc, setSrcDoc] = useState('')
  const composed = useRef(0)
  useEffect(() => {
    if (!opts || host.frameLoad !== 'srcdoc') return
    const mine = ++composed.current
    host.compose(opts).then(page => { if (mine === composed.current) setSrcDoc(page) }, console.error)
  }, [opts])

  if (!hasHumanView) {
    return (
      <div style={{ padding: '72px 24px', color: 'var(--ink2)', maxWidth: 640, width: '100%', margin: '0 auto' }}>
        <div className="eyebrow">No view yet</div>
        <h2 style={{ color: 'var(--ink)', margin: '10px 0 12px', fontSize: 32, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.05 }}>
          {manifest.title}
        </h2>
        <p style={{ fontSize: 16, lineHeight: 1.55 }}>This .clan file has no view yet, awaiting first agent pass.</p>
      </div>
    )
  }

  // Behind a URL the frame waits for its address: an empty frame would take a click and the keys after it (Cmd K
  // among them) and give them to no page. Until the address is set, the shell's own page has them.
  if (host.frameLoad !== 'srcdoc' && !iframeSrc) return null

  return (
    <iframe
      ref={iframeRef}
      {...(host.frameLoad === 'srcdoc' ? { srcDoc } : { src: iframeSrc })}
      className="ch-frame"
      style={{ width: '100%', flex: 1, border: 'none', background: 'var(--paper)' }}
      // A source link opens as a normal tab (owner, 2026-11-11: publisher pages need their cookies and
      // storage, PDFs and decks must download). The frame itself stays sandboxed: no same-origin, no forms.
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      title={manifest.title}
      onLoad={() => {
        postScheme(getTheme())
        postEditMode()
        postClientMode()
        postInsets()
        postJobs()
        postBooth()
        // An app that declared its parts before the shell heard says them again.
        iframeRef.current?.contentWindow?.postMessage({ type: 'clan:parts?' }, '*')
        // Likewise the tabs and buttons it wants in the OS bar.
        iframeRef.current?.contentWindow?.postMessage({ type: 'clan:bar?' }, '*')
        setExportFrame(iframeRef.current?.contentWindow ?? null)
        setFeedbackFrame(iframeRef.current?.contentWindow ?? null)
        // The page is in: the shell's background reads (the desk's facts) may start (App.tsx).
        window.dispatchEvent(new Event(DOC_LOADED))
      }}
    />
  )
}
