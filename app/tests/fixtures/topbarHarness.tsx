// The document bar alone, in a browser, for tests/topbarFit.test.ts: the real Toolbar and the shell's real CSS.
import { createElement } from 'react'
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
const locked = q.get('locked') === '1'
const bar = barFrom({ v: 1, items: locked ? [
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
  { kind: 'button', id: 'redraft', label: 'Draft it again' },
] })
const doc = {
  title: q.get('title') ?? 'Proper Crunch', tool: { name: 'Brief' }, toolKey: 'brief',
  onOpenFile: noop, onToggleSidebar: noop, sidebarOpen: false, onLineage: noop, onSave: noop,
  onKeepOffline: noop, onExport: noop, targets: [{ app_id: 'ie.napkin.deck-maker', name: 'Deck Maker', version: '1' }],
  onSpinoff: noop, onToggleEdit: noop, saved: 'saved 5m ago', bar,
  crew: chip ? { people: [], working: 'working', agent: 'judge', progress: [4, 4] as [number, number] } : { people: [] },
  onClientReview: locked ? () => { (window as unknown as { __review: number }).__review = 1 } : undefined,
  clientAnswered: q.get('answered') === '1',
  onBarAction: (id: string) => { (window as unknown as { __acted: string[] }).__acted = [...((window as unknown as { __acted?: string[] }).__acted ?? []), id] },
}
createRoot(document.getElementById('root')!).render(createElement(Toolbar, {
  agency: 'Napkin Studio', onAgency: noop, onHome: noop, needs: 0, onDecisions: noop, user: 'sam', onSignOut: noop,
  account: { name: 'Sam Agent', initials: 'SA', line: 'Studio A' },
  client: { name: 'Harbour Bakes', mono: 'HB', look: { cl: '#DA291C', ink: '#FFC72C' }, switcher: [{ id: 'c1', name: 'Harbour Bakes' }], onSwitch: noop },
  doc,
} as never))
