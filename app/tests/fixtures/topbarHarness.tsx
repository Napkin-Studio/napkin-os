// The document bar alone, in a browser, for tests/topbarFit.test.ts: the real Toolbar and the shell's real CSS.
import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/shell/nui/tokens.css'
import '../../src/shell/nui/nui.css'
import '../../src/shell/nui/shell.css'
import Toolbar from '../../src/components/Toolbar'
import { barFrom } from '../../src/shell/appBar'

const q = new URLSearchParams(location.search)
const chip = q.get('chip') === '1'
const noop = () => {}
// locked=1: a brief locked by approve, as Brief Maker sends it (Save · PDF, Unlock, the ways to save past two) with the
// shell's own Client review beside it: the set that still clipped Continue in at 1024 (UAT round 4 F1).
const lockedAs = q.get('locked')
const locked = !!lockedAs
// locked=research: a locked research report, as Research sends it: Save · PDF ▾ (a menu, the primary) and nothing else.
const armedLabel = 'Click again to redraft'
const items = (armed: boolean) => lockedAs === 'research' ? [
  { kind: 'run', working: false },
  { kind: 'status', label: 'Locked', tone: 'ok', locked: true },
  { kind: 'button', id: 'save', label: 'Save · PDF', primary: true, menu: [
    { id: 'export', label: 'PDF' }, { id: 'export-html', label: 'HTML file' }, { id: 'save-clan', label: 'Napkin file (.clan)' }] },
] : locked ? [
  { kind: 'run', working: false },
  { kind: 'status', label: 'Locked v1', tone: 'ok', locked: true },
  { kind: 'button', id: 'pdf', label: 'Save · PDF', primary: true },
  { kind: 'button', id: 'unlock', label: 'Unlock' },
  { kind: 'button', id: 'reopen', label: 'Reopen a part…' },
  { kind: 'button', id: 'client', label: 'Client copy · PDF' },
  { kind: 'button', id: 'html', label: 'Save · HTML' },
] : [
  { kind: 'run', working: false },
  { kind: 'button', id: 'pdf', label: 'Save · PDF', primary: true },
  // Brief Maker arms Draft it again on the first press and redrafts on the second (UAT round 4 F9)
  { kind: 'button', id: 'redraft', label: armed ? armedLabel : 'Draft it again', stays: !armed },   // as the page sends it (A7)
]
const base = {
  title: q.get('title') ?? 'Proper Crunch', tool: { name: 'Brief' }, toolKey: 'brief',
  onOpenFile: noop, onToggleSidebar: noop, sidebarOpen: false, onLineage: noop, onSave: noop,
  onKeepOffline: noop, onExport: noop, targets: [{ app_id: 'ie.napkin.deck-maker', name: 'Deck Maker', version: '1' }],
  onSpinoff: noop, onToggleEdit: noop, saved: 'saved 5m ago',
  crew: chip ? { people: [], working: 'working', agent: 'judge', progress: [4, 4] as [number, number] } : { people: [] },
  onClientReview: locked ? () => { (window as unknown as { __review: number }).__review = 1 } : undefined,
  clientAnswered: q.get('answered') === '1',
}
/** What the bar's buttons told the app, in order, for the test to read. */
function record(id: string) {
  const w = window as unknown as { __acted?: string[] }
  w.__acted = [...(w.__acted ?? []), id]
}
export function Harness() {
  const [armed, setArmed] = useState(false)
  const acted = (id: string) => {
    record(id)
    if (id === 'redraft') setArmed(a => !a)
  }
  const doc = { ...base, bar: barFrom({ v: 1, items: items(armed) } as never), onBarAction: acted }
  return createElement(Toolbar, {
    agency: 'Napkin Studio', onAgency: noop, onHome: noop, needs: 0, onDecisions: noop, user: 'sam', onSignOut: noop,
    account: { name: 'Sam Agent', initials: 'SA', line: 'Studio A' },
    client: { name: 'Harbour Bakes', mono: 'HB', look: { cl: '#DA291C', ink: '#FFC72C' }, switcher: [{ id: 'c1', name: 'Harbour Bakes' }], onSwitch: noop },
    doc,
  } as never)
}
createRoot(document.getElementById('root')!).render(createElement(Harness))
