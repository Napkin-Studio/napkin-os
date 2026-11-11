// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency's look as the shell reads and writes it (features/agency-look.clan):
// its logo, and the accent sampled from it. Everything goes through
// getAgencyLook and saveAgencyLook; when the agency database arrives, those
// two are all that change. Phase 1 keeps one settings file per tenant on napkin-web.

import { accentCss, accentsOf, sampleAccent, type Accents } from './accent'
import { sanitiseSvg } from './svgSanitise'

export interface AgencyLook {
  /** The logo as a data: URI (SVG or PNG). */
  logo?: string
  /** The accent per mode; absent for a logo with no colour of its own. */
  accent?: Accents
}

const STYLE_ID = 'napkin-agency-accent'
const SAMPLE_PX = 128

async function lookUrl(): Promise<string> {
  const r = await fetch('/api/session', { credentials: 'same-origin' })
  if (!r.ok) throw new Error(`no session: ${r.status}`)
  const { tenant } = (await r.json()) as { tenant: string }
  return `/api/t/${tenant}/agency/look`
}

/** The saved look; empty when there is none or no server to ask. */
export async function getAgencyLook(): Promise<AgencyLook> {
  try {
    const r = await fetch(await lookUrl(), { credentials: 'same-origin' })
    return r.ok ? ((await r.json()) as AgencyLook) : {}
  } catch {
    return {}
  }
}

/** Save the look, with the person's name on it (the server records who and what). */
export async function saveAgencyLook(look: AgencyLook): Promise<AgencyLook> {
  const r = await fetch(await lookUrl(), {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(look),
  })
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || `could not save the look (${r.status})`)
  }
  return (await r.json()) as AgencyLook
}

/** Put the accent on the page (or take it off); idempotent. */
export function applyAgencyLook(look: AgencyLook | null, doc: Document = document): void {
  const css = accentCss(look?.accent)
  let el = doc.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    if (!css) return
    el = doc.createElement('style')
    el.id = STYLE_ID
    doc.head.appendChild(el)
  }
  if (el.textContent !== css) el.textContent = css
}

/** What a logo file is: its data: URI, and the pixels to sample. */
async function pixelsOf(file: File): Promise<{ logo: string; data: Uint8ClampedArray }> {
  let logo: string
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    // Only shapes and their fills survive (svgSanitise.ts); the same sanitiser the checked-in logos go through.
    logo = 'data:image/svg+xml,' + encodeURIComponent(sanitiseSvg(await file.text()))
  } else if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
    logo = await new Promise<string>((ok, no) => {
      const r = new FileReader()
      r.onload = () => ok(String(r.result))
      r.onerror = () => no(new Error('could not read the file'))
      r.readAsDataURL(file)
    })
  } else if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    throw new Error('A PDF logo cannot be read here yet. Export it as an SVG or a PNG.')
  } else {
    throw new Error('Use an SVG or a PNG.')
  }
  const img = new Image()
  await new Promise<void>((ok, no) => {
    img.onload = () => ok()
    img.onerror = () => no(new Error('That file is not a picture the browser can read.'))
    img.src = logo
  })
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SAMPLE_PX
  const cx = canvas.getContext('2d', { willReadFrequently: true })
  if (!cx) throw new Error('This browser cannot read pixels.')
  // Fit the logo in the square, keeping its shape; the margin stays see-through and is ignored.
  const w = img.naturalWidth || SAMPLE_PX, h = img.naturalHeight || SAMPLE_PX
  const k = Math.min(SAMPLE_PX / w, SAMPLE_PX / h)
  cx.drawImage(img, (SAMPLE_PX - w * k) / 2, (SAMPLE_PX - h * k) / 2, w * k, h * k)
  return { logo, data: cx.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX).data }
}

/** Read a logo file into a look: the logo, and the accent in each mode (none for black, white and grey). */
export async function lookFromFile(file: File): Promise<AgencyLook> {
  const { logo, data } = await pixelsOf(file)
  const sampled = sampleAccent(data)
  return sampled ? { logo, accent: accentsOf(sampled) } : { logo }
}
