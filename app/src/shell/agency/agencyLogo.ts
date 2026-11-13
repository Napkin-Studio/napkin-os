// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency's uploaded logo, kept by napkin-web (crates/napkin-web/src/look.rs) until the People page's agency form
// takes it over (features/align-needs-lock-people.clan). Only the logo: the agency's colours are palette.ts's, set by an
// admin, and nothing is sampled from a picture (features/align-landing-look.clan).

import { sanitiseSvg } from './svgSanitise'

export interface AgencyLogo { logo?: string }

async function lookUrl(): Promise<string> {
  const r = await fetch('/api/session', { credentials: 'same-origin' })
  if (!r.ok) throw new Error(`no session: ${r.status}`)
  const { tenant } = (await r.json()) as { tenant: string }
  return `/api/t/${tenant}/agency/look`
}

/** The saved logo; empty when there is none or no server to ask. */
export async function getAgencyLogo(): Promise<AgencyLogo> {
  try {
    const r = await fetch(await lookUrl(), { credentials: 'same-origin' })
    return r.ok ? ((await r.json()) as AgencyLogo) : {}
  } catch {
    return {}
  }
}

/** Save the logo, with the person's name on it (the server records who and what). */
export async function saveAgencyLogo(look: AgencyLogo): Promise<AgencyLogo> {
  const r = await fetch(await lookUrl(), {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(look),
  })
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || `could not save the logo (${r.status})`)
  }
  return (await r.json()) as AgencyLogo
}

/** A logo file as a data: URI: an SVG with only shapes and fills (svgSanitise.ts), or a PNG. */
export async function logoFromFile(file: File): Promise<AgencyLogo> {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    return { logo: 'data:image/svg+xml,' + encodeURIComponent(sanitiseSvg(await file.text())) }
  }
  if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
    const logo = await new Promise<string>((ok, no) => {
      const r = new FileReader()
      r.onload = () => ok(String(r.result))
      r.onerror = () => no(new Error('could not read the file'))
      r.readAsDataURL(file)
    })
    return { logo }
  }
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) throw new Error('A PDF logo cannot be read here yet. Export it as an SVG or a PNG.')
  throw new Error('Use an SVG or a PNG.')
}
