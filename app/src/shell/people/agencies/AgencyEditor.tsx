// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency editor (mock people-agencies-v4, states 3-11). A basic agency:
// its name, other spellings, base and accent, its style (how the two colours
// are used: features/agency-style.clan), one SVG wordmark, and "Does it
// read?" (palette.ts lookChecks; a warning never blocks Publish). An agency in
// code: its look read-only, its display name editable, Reset name. Live
// previews, light and dark, of the OS bar pill, the sign-in card and the brief
// header show the draft. Publish or Discard draft, with who drafted and who
// published. Copy to code for a published basic agency.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  AGENCY_COLOURS, inkOn, lookChecks, paletteOf, surfaceTokens, svgOfUri, wordmarkOf,
  type AgencyColours,
} from '../../agency/palette'
import { recolourSvg } from '../../agency/svgSanitise'
import type { PeopleApi } from '../api'
import { KindTags } from './AgenciesList'
import {
  discard, edit, publish, removeWordmark, resetName, saveDraft, toggleCopy, upload,
  type EditorState, type LookEdit,
} from './editor'
import { LookPill } from './LookPill'
import {
  HEX, canPublish, coloursForLook, excerpt, hasColours, hasDraft, histParts, initialsOf, kb, slugOf, startInk, styleOfColours,
  type EditLook, type LookStyle, type UploadReport,
} from './model'

/** What the view's buttons do; the container (AgencyEditor) wires them to the api. */
export interface EditorActions {
  onEdit: (patch: LookEdit, now?: boolean) => void
  onUpload: (name: string, text: string) => void
  onRemoveWordmark: () => void
  onResetName: () => void
  onPublish: () => void
  onDiscard: () => void
  onCopy: () => void
  onBack: () => void
}

const WARN_ICON = (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-label="warning"><path d="M8 1.5 15 14H1z" fill="var(--warn)" /><rect x="7.2" y="5.5" width="1.6" height="4.6" fill="#fff" /><rect x="7.2" y="11.2" width="1.6" height="1.6" fill="#fff" /></svg>
)
const LOCK = (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" /><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
)

/** The shell's inks (shell/nui/tokens.css), light and dark, for a preview of the other theme. */
const INKS = {
  light: { '--ink': '#141413', '--muted': '#6D655A', '--faint': '#9A9082' },
  dark: { '--ink': '#EFE9DE', '--muted': '#A49B8D', '--faint': '#7B7367' },
} as const

/** A look's tokens for one theme, as the shell would put them on :root (surfaceCss, agencyCss), for a preview frame. */
function frameVars(c: AgencyColours, theme: 'light' | 'dark'): CSSProperties {
  const p = paletteOf(c)[theme]
  return { ...surfaceTokens(c, theme), '--agency': p.agency, '--agency-fg': p.fg, '--agency-soft': p.soft, ...INKS[theme], '--mk-base': c.base, '--mk-acc': c.accent } as unknown as CSSProperties
}

function Frame({ theme, c, sid }: { theme: 'light' | 'dark'; c: AgencyColours; sid: string }) {
  const wm = wordmarkOf(c, theme)
  return (
    <div className="ag-pv" style={frameVars(c, theme)} data-testid={`preview-${theme}`}>
      <div className="lab">{theme.toUpperCase()} · OS BAR</div>
      <div className="osbar"><LookPill colours={c} /><span className="tb">Brief Maker ▾</span><span className="sp" /><span className="me">ND</span></div>
      <div className="lab">SIGN-IN CARD</div>
      <div className="signin">
        <div className="sicard">
          <span className="medal" />
          {wm ? <img src={wm} alt={c.name} /> : <b style={{ fontSize: 14 }}>{c.name}</b>}
          <p>Sign in to {c.name} on Napkin Studio.</p>
          <span className="fld">niamh@{sid}</span>
          <span className="go">Continue</span>
        </div>
      </div>
      <div className="lab">BRIEF HEADER</div>
      <div className="brief">
        <span className="tile" style={{ background: c.base, color: inkOn(c.base) }}>{initialsOf(c.name)}</span>
        <span><span className="t">Spring launch: the brief</span><br /><small>{c.name} · for Greenfield Dairy</small></span>
        {wm && <img className="wm" src={wm} alt="" />}
      </div>
    </div>
  )
}

/** A colour: the picker and its hex, either sets it; a half-typed hex waits. */
function ColourField({ id, label, value, onChange, bare = false }: { id: string; label: string; value: string; onChange: (v: string, now: boolean) => void; bare?: boolean }) {
  const [typed, setTyped] = useState<string | null>(null)
  const shown = typed ?? value
  const field = (
    <div className="ag-colour">
      <input type="color" aria-label={`${label} colour`} value={HEX.test(value) ? value.toLowerCase() : '#d9d9d9'} onChange={e => { setTyped(null); onChange(e.target.value.toUpperCase(), true) }} />
      <input id={id} aria-label={bare ? label : undefined} className={`ag-hex${shown.length === 7 && !HEX.test(shown) ? ' ag-bad' : ''}`} maxLength={7} placeholder="#RRGGBB" value={shown}
        onChange={e => { const v = e.target.value; setTyped(v); if (HEX.test(v)) onChange(v.toUpperCase(), true) }}
        onBlur={() => setTyped(null)} />
    </div>
  )
  if (bare) return field
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {field}
    </div>
  )
}

/** One choice of two (or more): the selected one in the page's action colour. */
function Seg<T extends string>({ name, value, options, onPick }: { name: string; value: T; options: readonly (readonly [T, string])[]; onPick: (v: T) => void }) {
  return (
    <span className="ag-seg" role="group" aria-label={name} data-testid={`seg-${name}`}>
      {options.map(([v, label]) => (
        <button key={v} type="button" className={v === value ? 'on' : undefined} aria-pressed={v === value} onClick={() => { if (v !== value) onPick(v) }}>{label}</button>
      ))}
    </span>
  )
}

/** The Style card (mock v4, states 9-11): how the two colours are used, not the colours. Each choice goes to the draft. */
function StyleCard({ look, onEdit }: { look: EditLook; onEdit: EditorActions['onEdit'] }) {
  const auto = HEX.test(look.accent) ? inkOn(look.accent) : null
  return (
    <div className="ag-card" data-testid="style-card">
      <h3>Style</h3>
      <div className="ag-style">
        <div className="ag-opt"><span className="lb">Pill</span><span className="val">
          <Seg name="Pill" value={look.pill} options={[['accent', 'Accent fill'], ['base', 'Base with accent outline']]} onPick={v => onEdit({ pill: v }, true)} />
        </span></div>
        <div className="ag-opt"><span className="lb">Accent use</span><span className="val">
          <Seg name="Accent use" value={look.accentUse} options={[['fill', 'Fill'], ['line', 'Outline only']]} onPick={v => onEdit({ accentUse: v }, true)} />
        </span></div>
        <div className="ag-opt"><span className="lb">Surfaces</span><span className="val">
          <Seg name="Surfaces" value={look.surface} options={[['warm', 'Warm paper'], ['mono', 'Plain']]} onPick={v => onEdit({ surface: v }, true)} />
        </span></div>
        <div className="ag-opt"><span className="lb">Text on accent</span><span className="val">
          <Seg name="Text on accent" value={look.accentInk ? 'set' : 'auto'} options={[['auto', 'Automatic'], ['set', 'Choose a colour']]}
            onPick={v => onEdit({ accentInk: v === 'auto' ? null : startInk(look) }, true)} />
          {look.accentInk
            ? <ColourField bare id="ag-ink" label="Text on accent" value={look.accentInk} onChange={(v, now) => onEdit({ accentInk: v }, now)} />
            : auto && <span className="ag-auto" data-testid="auto-ink"><i style={{ background: auto }} />{auto === '#FFFFFF' ? 'white' : 'near-black'}, worked out</span>}
        </span></div>
      </div>
      <div className="ag-hint">These change how the two colours are used, not the colours.</div>
    </div>
  )
}

/** A style in words, for a look in code's read-only card. */
function StyleWords({ st }: { st: LookStyle }) {
  const items = [
    <>Pill: {st.pill === 'base' ? 'base with accent outline' : 'accent fill'}</>,
    <>Accent: {st.accentUse === 'line' ? 'outline only' : 'fill'}</>,
    <>Surfaces: {st.surface === 'mono' ? 'plain' : 'warm paper'}</>,
    <>Text on accent: {st.accentInk ? <><i style={{ background: st.accentInk }} /><span className="ag-mono">{st.accentInk}</span></> : 'automatic'}</>,
  ]
  return (
    <span className="ag-ro-style" data-testid="code-style">
      {items.map((it, i) => <span key={i} className="it">{i > 0 && <span className="sep">·</span>}{it}</span>)}
    </span>
  )
}

function Spellings({ look, onEdit }: { look: EditLook; onEdit: EditorActions['onEdit'] }) {
  const [typed, setTyped] = useState('')
  if (look.kind === 'code') {
    return (
      <>
        <div className="ag-chips ro">{look.aliases.length ? look.aliases.map(a => <span key={a}>{a}</span>) : <span className="none">none</span>}</div>
        <div className="ag-hint">In code, with the look.</div>
      </>
    )
  }
  return (
    <>
      <div className="ag-chips">
        {look.aliases.map((a, i) => (
          <span key={a}>{a}<button type="button" title="Remove" aria-label={`Remove ${a}`} onClick={() => onEdit({ aliases: look.aliases.filter((_, j) => j !== i) }, true)}>×</button></span>
        ))}
        <input aria-label="Add a spelling" placeholder="Add a spelling, Enter" value={typed} onChange={e => setTyped(e.target.value)}
          onKeyDown={e => {
            const v = typed.trim().toLowerCase()
            if (e.key === 'Enter' && v) { e.preventDefault(); if (!look.aliases.includes(v)) onEdit({ aliases: [...look.aliases, v] }, true); setTyped('') }
          }} />
      </div>
      <div className="ag-hint">Typed at sign-in or on the People page, these mean this agency.</div>
    </>
  )
}

function Report({ r }: { r: UploadReport | null }) {
  if (!r) return null
  if (r.ok) {
    return (
      <div className="ag-report" data-testid="upload-report">
        <div className="pa-ok"><b>{r.name}</b> taken, in the draft. Cleaned: {kb(r.kept)} kept of {kb(r.bytes)}; dropped: {r.dropped.join(', ') || 'nothing'}.
          {r.warnings.length > 0 && <ul>{r.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
        </div>
      </div>
    )
  }
  const lines = excerpt(r)
  return (
    <div className="ag-report" data-testid="upload-refused">
      <div className="pa-err"><b>{r.name}</b> · {r.why} The wordmark is unchanged. Ask for a clean export, or save it again from a vector editor.
        {lines.length > 0 && <pre>{lines.map(l => {
          const t = `${String(l.n).padStart(3)}  ${l.text}`
          return l.mark ? <mark key={l.n}>{t}{'\n'}</mark> : <span key={l.n}>{t}{'\n'}</span>
        })}</pre>}
      </div>
    </div>
  )
}

function Wordmark({ look, report, actions }: { look: EditLook; report: UploadReport | null; actions: EditorActions }) {
  const file = useRef<HTMLInputElement>(null)
  const dark = look.wordmark ? 'data:image/svg+xml,' + encodeURIComponent(recolourSvg(svgOfUri(look.wordmark) ?? '', '#FFFFFF')) : null
  const tile = (src: string | null, cls: 'l' | 'd', label: string) => (
    <div className="ag-ground">
      <div className={`gr ${cls}`}>{src ? <img src={src} alt="" /> : <span className="none" style={{ color: cls === 'l' ? '#141413' : '#fff' }}>{look.name || 'No wordmark'}</span>}</div>
      <div className="cap">{label}</div>
    </div>
  )
  return (
    <div className="ag-card" id="ag-wordmark" data-testid="wordmark-card">
      <h3>Wordmark <span className="ag-mono">one SVG</span></h3>
      <div className="ag-grounds">
        {tile(look.wordmark, 'l', look.wordmark ? 'Light grounds: as uploaded' : 'No wordmark yet: the name stands in')}
        {tile(dark, 'd', look.wordmark ? 'Dark grounds: the same SVG, recoloured white' : 'Dark grounds')}
      </div>
      <div className="ag-uprow">
        <button type="button" className="pa-btn sm" onClick={() => file.current?.click()}>{look.wordmark ? 'Replace the SVG…' : 'Choose an SVG…'}</button>
        <input ref={file} type="file" accept=".svg,image/svg+xml" hidden aria-label="Wordmark SVG file"
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void f.text().then(t => actions.onUpload(f.name, t))
          }} />
        {look.wordmark && <button type="button" className="pa-link" onClick={actions.onRemoveWordmark}>Remove</button>}
        <span className="ag-caps">SVG only, up to 200 KB.{look.file && <> Now: <span className="ag-mono">{look.file}</span></>}</span>
      </div>
      <Report r={report} />
    </div>
  )
}

function Checks({ look }: { look: EditLook }) {
  if (!hasColours(look)) {
    return (
      <div className="ag-card" data-testid="checks">
        <h3>Does it read?</h3>
        <ul className="ag-checks"><li style={{ color: 'var(--faint)' }}>Pick a base and an accent to check them.</li></ul>
      </div>
    )
  }
  const rows = lookChecks(coloursForLook(look))
  const bad = rows.filter(r => r.ratio < r.need).length
  const svg = svgOfUri(look.wordmark) ?? ''
  return (
    <div className="ag-card" data-testid="checks">
      <h3>Does it read? <span className="ag-mono">{bad ? <span style={{ color: 'var(--warn)' }}>{bad} hard to read</span> : 'all read'}</span></h3>
      <ul className="ag-checks">
        {rows.map(r => {
          const ok = r.ratio >= r.need
          const logo = !r.line && r.need === 3 && svg
          return (
            <li key={r.label} className={ok ? 'good' : 'bad'} data-ok={ok}>
              {r.line ? <span className="sw" style={{ background: r.bg, boxShadow: `inset 0 0 0 2px ${r.fg}` }} />
                : logo ? <span className="sw" style={{ background: r.bg }}><img src={'data:image/svg+xml,' + encodeURIComponent(recolourSvg(svg, r.fg))} alt="" /></span>
                  : <span className="sw" style={{ background: r.bg, color: r.fg }}>Aa</span>}
              <span>{r.label}</span>
              <span className="r">{r.ratio.toFixed(1)}:1{ok ? ' ✓' : <><span className="wi">{WARN_ICON}</span>needs {r.need}:1</>}</span>
            </li>
          )
        })}
      </ul>
      <div className="ag-hint">Text needs 4.5:1, a logo 3:1 (the checks the tests run on every look in code). A warning never stops you publishing.</div>
    </div>
  )
}

function CodeLook({ look }: { look: EditLook }) {
  const code = AGENCY_COLOURS[look.id ?? '']
  if (!code) return null
  const c = coloursForLook(look)
  const tile = (src: string | null, cls: 'l' | 'd', label: string) => (
    <div className="ag-ground">
      <div className={`gr ${cls}`}>{src ? <img src={src} alt="" /> : <span className="none" style={{ color: cls === 'l' ? '#141413' : '#fff' }}>{look.name}</span>}</div>
      <div className="cap">{label}{src ? '' : ' · no logo, the name stands in'}</div>
    </div>
  )
  return (
    <div className="ag-card" data-testid="code-look">
      <h3>Look <span className="ag-mono">in code</span></h3>
      <div className="ag-ro-note">{LOCK}<span>This look is in code. Change it through a PR.</span></div>
      <div className="ag-ro-grid">
        <label>Pill</label><span><LookPill colours={c} /></span>
        <label>Colours</label>
        <span className="ag-sws"><span className="ag-swc"><i style={{ background: code.base }} />base {code.base}</span><span className="ag-swc"><i style={{ background: code.accent }} />accent {code.accent}</span></span>
        <label>Style</label><StyleWords st={styleOfColours(code)} />
        <label>Logos</label>
        <div className="ag-grounds">{tile(wordmarkOf(code, 'light'), 'l', 'On light grounds')}{tile(wordmarkOf(code, 'dark'), 'd', 'On dark grounds')}</div>
        <label>Where</label><span className="ag-mono">app/src/shell/agency/palette.ts · AGENCY_COLOURS.{look.id}</span>
      </div>
    </div>
  )
}

function CopyCard({ st }: { st: EditorState }) {
  const [copied, setCopied] = useState<number | null>(null)
  const x = st.copy
  if (!x || !st.row) return null
  const id = st.row.id
  const blocks: { label: string; where: string; text: string; wrap?: boolean }[] = [{ label: 'The look', where: 'app/src/shell/agency/palette.ts', text: x.palette_ts }]
  if (x.svg) blocks.push({ label: `${id}-logo.svg`, where: `the cleaned SVG · ${kb(new TextEncoder().encode(x.svg).length)}`, text: x.svg, wrap: true })
  if (x.agency_logos_files) blocks.push({ label: 'The logo file', where: 'app/scripts/agency-logos.mjs · FILES', text: x.agency_logos_files })
  blocks.push({ label: 'The server’s copy', where: 'crates/napkin-web/src/people.rs · CODE_AGENCIES', text: x.people_rs })
  const copy = (i: number) => {
    void navigator.clipboard?.writeText(blocks[i].text).catch(() => {})
    setCopied(i)
    setTimeout(() => setCopied(c => (c === i ? null : c)), 1200)
  }
  return (
    <div className="ag-card" data-testid="copy-card">
      <h3>Copy to code <span className="ag-mono">the published look, for a pull request</span></h3>
      <ol className="ag-steps">
        <li>1. Save the SVG into the owner’s assets folder.</li>
        <li>2. Run <span className="ag-mono">node scripts/agency-logos.mjs</span> from <span className="ag-mono">app/</span>.</li>
        <li>3. Paste the entry and open a PR.</li>
      </ol>
      {blocks.map((b, i) => (
        <div className="ag-cp" key={b.label}>
          <div className="ag-cp-h"><b>{b.label}</b><span className="ag-mono">{b.where}</span><span className="pa-sp" /><button type="button" className="pa-btn sm" onClick={() => copy(i)}>{copied === i ? 'Copied' : 'Copy'}</button></div>
          <pre className={b.wrap ? 'wrap' : undefined}>{b.text}</pre>
        </div>
      ))}
    </div>
  )
}

/** The editor as a picture of its state: tests render it, AgencyEditor wires it up. */
export function AgencyEditorView({ st, actions, user, busy = false }: { st: EditorState; actions: EditorActions; user: string; busy?: boolean }) {
  const { row, look } = st
  const code = look.kind === 'code'
  const c = coloursForLook(look)
  const drafted = row ? hasDraft(row) : st.drafted
  const sid = row ? row.id : slugOf(look.name)
  const publishable = canPublish(row, look, st.drafted)
  const hist = histParts(row, { drafted: st.drafted, by: user, at: st.draftedAt, publishable })
  const canCopy = !!row && row.kind === 'basic' && row.published
  const codeName = row?.kind === 'code' ? row.code_name : null
  return (
    <div data-testid="agency-editor" data-kind={look.kind}>
      {st.flash && <div className={st.flash.kind === 'ok' ? 'pa-ok' : 'pa-err'} role="status" style={{ marginBottom: 12 }}><b>{st.flash.lead}</b> {st.flash.text}</div>}
      <button type="button" className="pa-link ag-back" onClick={actions.onBack}>← All agencies</button>
      <div className="ag-head">
        <LookPill colours={c} />
        <h2>{look.name || 'New agency'}</h2>
        <KindTags row={row} />
        <span className="pa-sp" />
        {!code && <button type="button" className="pa-btn sm" data-testid="copy-to-code" disabled={!canCopy || busy} title={canCopy ? undefined : 'Publish first'} onClick={actions.onCopy}>{st.copy ? 'Hide the code' : 'Copy to code'}</button>}
      </div>
      <CopyCard st={st} />
      <div className="ag-ed">
        <div>
          <div className="ag-card">
            <h3>Name</h3>
            <div className="ag-grid2">
              <div>
                <label htmlFor="ag-name">Display name</label>
                <input id="ag-name" placeholder="As people should see it" value={look.name} onChange={e => actions.onEdit({ name: e.target.value })} />
                {codeName && look.name !== codeName && (
                  <div className="ag-hint">In code: <b>{codeName}</b>. <button type="button" className="pa-link" onClick={actions.onResetName}>Reset name</button></div>
                )}
              </div>
              <div>
                <label htmlFor="ag-id">Signs in as</label>
                <input id="ag-id" className="ag-fixed" disabled value={sid ? `@${sid}` : '@…'} />
                <div className="ag-hint">{row ? 'The part after the @. Fixed: people’s sign-in names use it.' : 'Made from the name when you publish; fixed after that.'}</div>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <label>Other spellings</label>
              <Spellings look={look} onEdit={actions.onEdit} />
            </div>
          </div>
          {code ? <CodeLook look={look} /> : (
            <>
              <div className="ag-card" data-testid="colours">
                <h3>Colours</h3>
                <div className="ag-grid2">
                  <ColourField id="ag-base" label="Base" value={look.base} onChange={(v, now) => actions.onEdit({ base: v }, now)} />
                  <ColourField id="ag-accent" label="Accent" value={look.accent} onChange={(v, now) => actions.onEdit({ accent: v }, now)} />
                </div>
                <div className="ag-hint">Everything else, in light and dark, is worked out from these two and the style below: the pill, the surfaces, and the text on each.</div>
              </div>
              <StyleCard look={look} onEdit={actions.onEdit} />
              <Wordmark look={look} report={st.report} actions={actions} />
              <Checks look={look} />
            </>
          )}
        </div>
        <div className="ag-pv-col">
          <div className="ag-card">
            <h3>Previews <span className="ag-mono">{drafted ? 'the draft, as people will see it' : !row ? 'as it would look' : 'as people see it now'}</span></h3>
            {!code && !hasColours(look) && <div className="ag-empty-pv">Placeholder colours until you pick a base and an accent.</div>}
            <div className="ag-pvs">
              <Frame theme="light" c={c} sid={sid || 'agency'} />
              <Frame theme="dark" c={c} sid={sid || 'agency'} />
            </div>
          </div>
        </div>
      </div>
      <div className="ag-foot">
        <span className="hist" data-testid="history">{hist.map((p, i) => p.draft ? <b key={i}>{p.text}</b> : p.faint ? <span key={i} className="faint">{p.text}</span> : <span key={i}>{p.text}</span>)}</span>
        <button type="button" className="pa-btn" disabled={!drafted || busy} onClick={actions.onDiscard}>Discard draft</button>
        <button type="button" className="pa-btn pa-primary" disabled={!publishable || busy} onClick={actions.onPublish}>Publish</button>
      </div>
    </div>
  )
}

/**
 * The editor, wired to the api: edits show at once and go to the draft a
 * moment later (typing waits half a second; a colour, a spelling or a file
 * goes at once), one call at a time, each with the rev the last one returned.
 */
export function AgencyEditor({ api, initial, user, onBack, onChanged }: {
  api: PeopleApi
  initial: EditorState
  user: string
  /** Back to the list, with a line to show there. */
  onBack: (flash?: { lead: string; text: string }) => void
  /** Something was published or discarded: the list reloads. */
  onChanged: () => void
}) {
  const [st, setSt] = useState(initial)
  const [busy, setBusy] = useState(false)
  const cur = useRef(initial)
  const fields = useRef(new Set<keyof LookEdit>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const set = (s: EditorState) => { cur.current = s; setSt(s) }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Send what changed; the answer's rev is the next call's. A reload (a stale rev) replaces the look.
  const flush = (): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const f = [...fields.current]
    fields.current.clear()
    if (!f.length) return chain.current
    chain.current = chain.current.then(async () => {
      const before = cur.current
      const after = await saveDraft(api, before, f)
      set(after.look !== before.look ? after : { ...cur.current, row: after.row ?? cur.current.row, flash: after.flash })
    })
    return chain.current
  }
  const run = (step: (s: EditorState) => Promise<EditorState | null>, done?: (s: EditorState | null) => void) => {
    void flush().then(async () => {
      setBusy(true)
      try {
        const next = await step(cur.current)
        if (next) set(next)
        done?.(next)
      } finally { setBusy(false) }
    })
  }

  const actions: EditorActions = {
    onEdit: (patch, now = false) => {
      set(edit(cur.current, patch))
      for (const k of Object.keys(patch) as (keyof LookEdit)[]) fields.current.add(k)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), now ? 0 : 500)
    },
    onUpload: (name, text) => run(s => upload(api, s, name, text)),
    onRemoveWordmark: () => run(s => removeWordmark(api, s)),
    onResetName: () => run(s => resetName(api, s)),
    onPublish: () => run(s => publish(api, s), s => { if (s?.row) onChanged() }),
    onDiscard: () => run(s => discard(api, s), s => {
      if (!s) { onChanged(); onBack({ lead: 'Draft discarded.', text: 'The new agency was not made.' }) } else onChanged()
    }),
    onCopy: () => run(s => toggleCopy(api, s)),
    onBack: () => { void flush(); onBack() },
  }
  return <AgencyEditorView st={st} actions={actions} user={user} busy={busy} />
}
