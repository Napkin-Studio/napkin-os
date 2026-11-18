// The canvas's bar and every editor's bar: the slim shell bar (ui/shell/ShellBar; Shrey 2026-11-18/19, the
// pinned decision in features/production-new-ui.clan) with the film's ▾ menu (ui/chrome/DocMenu), and, under an
// editor's bar, its band: ← Canvas, the view switch, Format, meta, the page's own actions and its primary
// (Plan shots, Make clips, Render ad, Apply as new version), Undo/Redo. Nothing a page does sits in the bar.
// History is the Decisions drawer. No spend, cost or limit in any bar (principle 4); costs show only in Decisions.

import { useContext, type ReactNode } from 'react'
import { Band, BandBack, ShellBar, type Crumb } from '../shell/ShellBar'
import { MenuItem } from '../Float'
import { JobTray } from '../JobTray'
import { UndoButtons, UndoMenuItems } from '../UndoButtons'
import { type NodeKind } from './Bar'
import { DocMenu } from './DocMenu'
import { undoInMore, useFitLevel } from './fit'
import { useEscapeBack } from './escapeBack'
import { useCurrentCanvasPage } from './canvasPage'
import { RouterContext, useServices } from '../../app/context'

/** Whose History a bar opens: the app's panel, or the Script editor's own. */
export interface HistoryToggle { on: boolean; toggle: () => void }

/** The canvas's bar: the slim bar with Canvas as where you are. Assets is on the canvas's + menu. */
export function CanvasBar({ phone = false }: { /** The phone's cut: watch only, so its status dot has no ask dock and no Show. */ phone?: boolean }) {
  // A page over the canvas (Sizes) adds itself to the crumb; Canvas then closes it.
  const over = useCurrentCanvasPage()
  const crumb: Crumb[] = over ? [{ label: 'Canvas', onClick: over.close }, { label: over.label }] : [{ label: 'Canvas' }]
  return (
    <ShellBar bar="canvas" className="ptbar" crumb={crumb}
      menu={(close) => <DocMenu close={close} />}
      job={phone ? <JobTray phone /> : <JobTray />} />
  )
}

/** An editor's bar: the slim bar with the crumb (Canvas › this editor's title), the status dot and Decisions;
 *  the film's ▾ menu holds the editor's own rows (and, on a tight window, the view switch and Undo/Redo).
 *  Under it, the band: ← Canvas, the meta pills, the view switch, the editor's own controls, its primary and
 *  Undo/Redo. Escape goes back too, when nothing else takes it (useEscapeBack). */
export function EditorBar({ className = '', back, onBack, icon, title, meta, view, afterView, right, undo = false, history, moreHead, more, primary, holdEscape = false, escapeBack = true }: {
  className?: string
  back: string
  onBack: () => void
  icon: NodeKind
  title: string
  meta?: ReactNode
  /** The one view switch (Screenplay | Video · Audio, Picture | Sound): the band's, or the menu's at tight. */
  view?: { label: string; options: { id: string; label: string }[]; value: string; onPick: (id: string) => void }
  /** Beside the view switch (the Script editor's Format menu); hidden at tight, as the switch is. */
  afterView?: ReactNode
  right?: ReactNode
  undo?: boolean
  /** The editor's own Decisions (the Script editor narrows it to one item for "Why?"). */
  history?: HistoryToggle
  /** Always at the head of the editor's part of the ▾ menu (Script's Shots from). */
  moreHead?: ReactNode
  /** The editor's own rows of the ▾ menu (Copy link to this…). */
  more?: (close: () => void) => ReactNode
  moreTip?: string
  /** The page's primary (Plan shots, Make clips, Render ad, Apply as new version): at the band's right end. */
  primary?: ReactNode
  /** Something on the page closes first on Escape (a selected shot, an open tray): Escape does not go back. */
  holdEscape?: boolean
  /** False where the page handles Escape itself (the rooms). */
  escapeBack?: boolean
}) {
  const { level, coarse } = useFitLevel()
  const tight = level === 'tight'
  const undoMore = undo && undoInMore(level, coarse)
  // Always "› Canvas › … › this page" (Shrey 2026-11-19): Canvas is a link even when Back goes elsewhere first.
  const toCanvas = useToCanvas()
  const crumb: Crumb[] = back === 'Canvas'
    ? [{ label: 'Canvas', onClick: onBack }, { label: title }]
    : [{ label: 'Canvas', onClick: toCanvas }, { label: back, onClick: onBack }, { label: title }]
  useEscapeBack(onBack, escapeBack && !holdEscape)
  const pageRows = (close: () => void) => (view && tight) || more || undoMore ? (
    <>
      {view && tight && <ViewItems view={view} close={close} />}
      {more?.(close)}
      {undoMore && <UndoMenuItems close={close} />}
    </>
  ) : undefined
  return (
    <div className={`ptbar nui-bars ${className}`} data-bar={icon} data-fit={level}>
      <ShellBar bar={icon} crumb={crumb} history={history} job={<JobTray />}
        menu={(close) => <DocMenu close={close} page={{ title, head: moreHead || undefined, rows: pageRows(close) }} />} />
      <Band label={`${title}: controls`}>
        <BandBack label={back} onClick={onBack} />
        <span className="band-sep" aria-hidden="true" />
        <h1 className="pt-title sr-title" title={title}>{title}</h1>
        {meta}
        {view && !tight && <ViewSwitch view={view} />}
        {!tight && afterView}
        <span className="band-grow" />
        {right}
        {primary && <span className="band-primary">{primary}</span>}
        {undo && !undoMore && <UndoButtons />}
      </Band>
    </div>
  )
}

/** Straight to the canvas from any editor: out of the Script editor's route, and the stage back to the canvas. */
function useToCanvas() {
  const { ui } = useServices()
  const router = useContext(RouterContext)
  return () => {
    if (router?.get().kind === 'script') router.leave()
    ui.update((u) => { u.stage = 'character' }, 'stage')
  }
}

function ViewSwitch({ view }: { view: NonNullable<Parameters<typeof EditorBar>[0]['view']> }) {
  return (
    <span className="pt-seg" role="group" aria-label={view.label}>
      {view.options.map((o) => <button key={o.id} type="button" aria-pressed={view.value === o.id} onClick={() => view.onPick(o.id)}>{o.label}</button>)}
    </span>
  )
}

function ViewItems({ view, close }: { view: NonNullable<Parameters<typeof EditorBar>[0]['view']>; close: () => void }) {
  return (
    <>
      <div className="fhead">{view.label}</div>
      {view.options.map((o) => (
        <MenuItem key={o.id} icon={view.value === o.id ? '✓' : undefined} onSelect={() => { close(); view.onPick(o.id) }}>{o.label}</MenuItem>
      ))}
      <div className="pt-menusep" />
    </>
  )
}
