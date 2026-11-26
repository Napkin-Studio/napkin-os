// The agency's look on the Production Tool (features/production-new-ui.clan): the same layer the shell
// puts on every page (app/src/shell/agency/palette.ts surfaceCss), from the shell's own source, never a
// copy. The agency is the one the person signed in under (Me.tenant.agency, features/os-sign-in.clan);
// before anyone is signed in, or for an agency an admin has not coloured, Napkin's own look.
// A dev build (and the paired screenshots) may pick a look with ?look=<agency id>.

import { AGENCY_COLOURS, canonicalAgencyId, coloursOf, NAPKIN_COLOURS, pillLogoOf, surfaceCss, type AgencyColours } from '@napkin/app/shell/agency/palette'
import { clientBrand, setClientAgency } from '@napkin/app/shell/agency/clients'
import type { Me } from '../../contracts/types'

export const AGENCY_STYLE_ID = 'pt-agency'

export interface AgencyLook {
  /** The registry id ('tbwa', 'napkin'…); null for the neutral look. */
  id: string | null
  colours: AgencyColours
  /** What the pill says: the agency's name, or Napkin Studio alone for Napkin's own. */
  name: string
  solo: boolean
}

/** The agency id for this person, or the dev override. */
export function agencyIdFor(me: Pick<Me, 'tenant'> | undefined, search = '', dev = false): string | null {
  if (dev) {
    const forced = new URLSearchParams(search).get('look')
    if (forced && canonicalAgencyId(forced)) return canonicalAgencyId(forced)
  }
  return canonicalAgencyId(me?.tenant?.agency ?? null)
}

export function lookOf(id: string | null): AgencyLook {
  const c = coloursOf(id)
  const colours = c ?? NAPKIN_COLOURS
  const solo = !c || id === 'napkin'
  return { id: c ? id : null, colours, name: solo ? 'Napkin Studio' : colours.name, solo }
}

/** Put the agency's surface layer on the page, after the tokens; idempotent. */
export function applyLook(look: AgencyLook, doc: Document = document): void {
  const css = surfaceCss(look.colours)
  let el = doc.getElementById(AGENCY_STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = doc.createElement('style')
    el.id = AGENCY_STYLE_ID
    doc.head.appendChild(el)
  }
  if (el.textContent !== css) el.textContent = css
  setClientAgency(look.id ? `x@${look.id}` : null)
}

/** The pill's wordmark for its ground (the shell's AgencyPill rule), or null for the name in type. */
export function pillMark(look: AgencyLook): string | null {
  return look.solo ? null : pillLogoOf(look.colours).wordmark
}

/** A client's disc: the admin-set colours, or one hashed from its id (clients.ts). */
export function clientDisc(client: { id: string; name: string }): { bg: string; ink: string; initials: string } {
  const b = clientBrand(client)
  const initials = client.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '·'
  return { bg: b?.base ?? '#4A453E', ink: b?.accent ?? '#FFFFFF', initials }
}

export const AGENCY_IDS: readonly string[] = Object.keys(AGENCY_COLOURS)
