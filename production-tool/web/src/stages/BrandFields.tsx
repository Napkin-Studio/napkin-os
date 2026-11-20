// The Name popover's brand part (features/pt-canvas-r2.clan; UAT round 2 R2-1, UX 1): a palette, typography or brand
// rule ref holds its colours, its font or its words, and Save waits for them. The colours start from the picture's own
// main colours; the browser's eyedropper (where it has one) picks any colour on screen.

import { useEffect, useState } from 'react'
import { getBlob } from '../lib/blobs'
import { coloursOf, payloadMissing, type BrandPayload, type BrandRole } from '../canvas/swatches'

type RuleKind = NonNullable<BrandPayload['rule']>['kind']
const RULE_KINDS: { kind: RuleKind; label: string; hint: string }[] = [
  { kind: 'do', label: 'Do', hint: 'Always show the logo on a clear background' },
  { kind: 'dont', label: "Don't", hint: "Don't show alcohol or a gym" },
  { kind: 'tone', label: 'Tone', hint: 'Warm, plain, never jokey' },
]
const FONTS = ['Inter', 'Helvetica Neue', 'Futura', 'Gotham', 'Montserrat', 'Playfair Display', 'Roboto', 'Source Serif']

interface EyeDropperLike { open(): Promise<{ sRGBHex: string }> }
const eyeDropper = (): (new () => EyeDropperLike) | undefined => (globalThis as { EyeDropper?: new () => EyeDropperLike }).EyeDropper

/** The fields for `role`, filled from the picture `asset` (a palette's first colours). */
export function BrandFields({ role, asset, value, onChange }: { role: BrandRole; asset?: string; value: BrandPayload; onChange: (p: BrandPayload) => void }) {
  const [read, setRead] = useState<string | null>(null)
  const swatches = value.swatches ?? []
  const reading = role === 'palette' && !!asset && read !== asset && !swatches.length
  // A palette starts from the picture's main colours, once.
  useEffect(() => {
    if (role !== 'palette' || swatches.length || !asset) return
    let live = true
    void getBlob(asset).then((b) => (b ? coloursOf(b) : [])).catch(() => [] as string[]).then((hexes) => {
      if (!live) return
      setRead(asset)
      if (hexes.length) onChange({ ...value, swatches: hexes.map((hex) => ({ hex })) })
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, asset])

  const missing = payloadMissing(role, value)
  if (role === 'palette') {
    const set = (i: number, hex: string) => onChange({ ...value, swatches: swatches.map((s, k) => (k === i ? { ...s, hex: hex.toUpperCase() } : s)) })
    const Dropper = eyeDropper()
    const pick = async () => {
      if (!Dropper) return
      try {
        const { sRGBHex } = await new Dropper().open()
        onChange({ ...value, swatches: [...swatches, { hex: sRGBHex.toUpperCase() }] })
      } catch { /* the person pressed Escape */ }
    }
    return (
      <div className="brandfields" aria-label="The palette's colours">
        <div className="faint bf-line">{reading ? 'Reading the picture’s colours…' : 'The colours Dex keeps to. Click one to change it.'}</div>
        <div className="row bf-swatches">
          {swatches.map((s, i) => (
            <span key={i} className="bf-swatch">
              <input type="color" aria-label={`Colour ${i + 1}`} value={s.hex.toLowerCase()} onChange={(e) => set(i, e.target.value)} />
              <span className="mono">{s.hex}</span>
              <button type="button" className="btn xs ghost" aria-label={`Take out ${s.hex}`} onClick={() => onChange({ ...value, swatches: swatches.filter((_, k) => k !== i) })}>×</button>
            </span>
          ))}
          <button type="button" className="btn xs" onClick={() => onChange({ ...value, swatches: [...swatches, { hex: '#808080' }] })}>+ Colour</button>
          {Dropper && <button type="button" className="btn xs" title="Pick a colour from anywhere on screen" onClick={() => void pick()}>Eyedropper</button>}
        </div>
        {missing && !reading && <div className="faint bf-missing">{missing}</div>}
      </div>
    )
  }
  if (role === 'typography') {
    const font = value.font ?? { family: '' }
    return (
      <div className="brandfields" aria-label="The font">
        <div className="row" style={{ gap: 6 }}>
          <input className="input" list="napkin-fonts" aria-label="Font" placeholder="Font, like Inter Bold" value={font.family}
            onChange={(e) => onChange({ ...value, font: { ...font, family: e.target.value } })} onKeyDown={(e) => e.stopPropagation()} />
          <input className="input" aria-label="Used for" placeholder="Used for: headlines" value={font.use ?? ''}
            onChange={(e) => onChange({ ...value, font: { ...font, use: e.target.value } })} onKeyDown={(e) => e.stopPropagation()} />
          <datalist id="napkin-fonts">{FONTS.map((f) => <option key={f} value={f} />)}</datalist>
        </div>
        {missing && <div className="faint bf-missing">{missing}</div>}
      </div>
    )
  }
  const rule = value.rule ?? { kind: 'do' as RuleKind, text: '' }
  return (
    <div className="brandfields" aria-label="The rule">
      <div className="row rolepills" role="radiogroup" aria-label="What kind of rule">
        {RULE_KINDS.map((k) => (
          <button key={k.kind} type="button" role="radio" aria-checked={rule.kind === k.kind} className={`btn xs ${rule.kind === k.kind ? 'on' : ''}`}
            onClick={() => onChange({ ...value, rule: { ...rule, kind: k.kind } })}>{k.label}</button>
        ))}
      </div>
      <textarea className="textarea" rows={2} maxLength={600} aria-label="The rule's words" placeholder={RULE_KINDS.find((k) => k.kind === rule.kind)?.hint}
        value={rule.text} onChange={(e) => onChange({ ...value, rule: { ...rule, text: e.target.value } })} onKeyDown={(e) => e.stopPropagation()} />
      {missing && <div className="faint bf-missing">{missing}</div>}
    </div>
  )
}
