// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// "Add to the Brand Clan": what an approved document offers back (Contract 6
// §6). The document itself first, then each field with the document's words
// and the Brand Clan's side by side. Ticked by default exactly where the host
// says `selected`; a field the client asked to change starts unticked; what
// the Brand Clan already holds can't be ticked. Nothing is taken until the
// person presses the button.

import { useEffect, useState } from 'react'
import { host } from '../../host'
import type { HarvestOffer } from '../../host'
import { Toast } from './Toast'
import { useToast } from './useToast'
import HarvestView from './HarvestView'
import { applyBody, doneLine, initialTicks } from './harvest'
import type { Ticks } from './harvest'
import { errorWords } from './words'
import './BrandClan.css'

export default function HarvestPanel({ labels, onClose, onAdded }: {
  labels?: Readonly<Record<string, string>>
  onClose: () => void
  /** The Brand Clan moved on: say so to whoever shows its version. */
  onAdded: () => void
}) {
  const [offer, setOffer] = useState<HarvestOffer | null>(null)
  const [ticks, setTicks] = useState<Ticks>({ work: false, fields: {} })
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast, say } = useToast()

  const read = () => host.harvestOffer().then(o => { setOffer(o); setTicks(initialTicks(o)) }, e => setError(errorWords(e)))
  useEffect(() => { void read() }, [])

  const apply = async () => {
    if (!offer) return
    setBusy(true); setError(null)
    try {
      const r = await host.harvestApply(applyBody(offer, ticks, summary))
      say({ title: doneLine(offer.brand.title, r.published) })
      setSummary('')
      onAdded()
      await read() // the rows now say "Already the Brand Clan’s"
    } catch (e) {
      setError(errorWords(e))
    } finally {
      setBusy(false)
    }
  }

  if (!offer) {
    return <section className="bc-harvest">{error ? <p className="bc-err" role="alert">{error}</p> : <p className="bc-note">Looking at what it offers…</p>}</section>
  }
  return (
    <>
      <HarvestView
        offer={offer} ticks={ticks} summary={summary} busy={busy} error={error} labels={labels}
        onTick={(k, on) => setTicks(t => (k === 'work' ? { ...t, work: on } : { ...t, fields: { ...t.fields, [k]: on } }))}
        onSummary={setSummary} onApply={apply} onClose={onClose}
      />
      <Toast toast={toast} />
    </>
  )
}
