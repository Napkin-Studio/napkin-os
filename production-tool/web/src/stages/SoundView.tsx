// The Video editor's Sound view (ui-behaviour 3.21; mock SoundEditor.dc.html) as a shell: the layout
// of shots with their sound path, the mix card, the sound lanes and the line or cue panel, each with
// its real empty state. Sound comes with the audio features (audio-*); nothing here pretends to play,
// mix or measure.

import type { Shot } from '../contracts/types'
import { cameraLabel } from '../jobs/frameEdit'

const LANES: { name: string; sub: string; empty: string }[] = [
  { name: 'Picture', sub: 'shots and motion', empty: '' },
  { name: 'Native', sub: 'shot sound', empty: 'No shot sound yet.' },
  { name: 'Voice', sub: 'lines', empty: 'No lines voiced yet. Write lines and voice-over in the Script editor.' },
  { name: 'Effects', sub: 'cues', empty: 'No effects yet.' },
  { name: 'Ambience', sub: '', empty: 'No ambience yet.' },
  { name: 'Music', sub: 'sections', empty: 'No music yet.' },
]

/** `shots`: the open video's shots in order (the main storyboard's showed on every video, 2026-10-15). */
export function SoundView({ shots }: { shots: Shot[] }) {
  const total = shots.reduce((a, s) => a + s.duration_s, 0) || 1
  return (
    <div className="snd">
      <div className="snd-top">
        <section className="pt-card snd-shots">
          <div className="snd-head"><b>Shots and their sound</b><span className="faint">Paths come with sound</span></div>
          {shots.map((s, i) => (
            <div key={s.id} className="snd-shot">
              <span className="pt-mono">{i + 1}</span>
              <span className="snd-shotname">{cameraLabel('size', s.camera.size).replace(/^./, (c) => c.toUpperCase())}</span>
              <span className="pt-mono">{s.duration_s.toFixed(1)} s</span>
              <span className="pt-pill">Not planned yet</span>
            </div>
          ))}
          {!shots.length && <p className="snd-empty">No shots yet. Plan shots from the script first.</p>}
        </section>
        <section className="pt-card snd-mix">
          <div className="snd-head"><b>Mix</b></div>
          <p className="snd-empty">No mix yet. Edie builds the mix from the takes in it, and measures it against the loudness target you pick.</p>
          <div className="pt-label">Loudness target</div>
          <div className="snd-targets">
            {['Online · −14 LUFS', 'TV · −23 LUFS', 'Radio · −18 LUFS'].map((t) => <button key={t} type="button" className="btn" disabled title="Not in this version yet">{t}</button>)}
          </div>
        </section>
      </div>
      <div className="snd-main">
        <section className="pt-card snd-lanes">
          <div className="snd-head"><b>Sound</b><button type="button" className="btn sm" disabled title="Not in this version yet">+ Line</button><button type="button" className="btn sm" disabled title="Not in this version yet">+ Effect</button></div>
          {LANES.map((l) => (
            <div key={l.name} className="snd-lane">
              <span className="snd-lanename"><b>{l.name}</b><small>{l.sub}</small></span>
              <div className="snd-track">
                {l.name === 'Picture'
                  ? shots.map((s, i) => <span key={s.id} className="snd-seg" style={{ flexGrow: s.duration_s / total }}>{i + 1}</span>)
                  : <span className="snd-empty">{l.empty}</span>}
              </div>
            </div>
          ))}
        </section>
        <aside className="pt-card snd-side">
          <b>Pick a line or a cue</b>
          <p className="snd-empty">Its takes, Redo this line and Jude's sound checks show here once sound is made.</p>
        </aside>
      </div>
    </div>
  )
}
