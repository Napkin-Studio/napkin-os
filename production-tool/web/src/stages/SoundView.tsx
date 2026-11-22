// The Film editor's Sound view (ui-behaviour 3.21; mock SoundEditor.dc.html) as a shell: the layout
// of shots with their sound path, the mix card, the sound lanes and the line or cue panel, each with
// its real empty state. Sound comes with the audio features (audio-*); nothing here pretends to play,
// mix or measure.

import { useDoc } from '../app/context'
import type { Id, Shot } from '../contracts/types'
import { cameraLabel } from '../jobs/frameEdit'
import { lineFacts, shotSounds } from './soundFacts'

const LANES: { name: string; sub: string; empty: string }[] = [
  { name: 'Picture', sub: 'shots and motion', empty: '' },
  { name: 'Native', sub: 'shot sound', empty: 'No shot sound yet.' },
  { name: 'Voice', sub: 'lines', empty: 'No lines voiced yet. Write lines and voice-over in the Script editor.' },
  { name: 'Effects', sub: 'cues', empty: 'No effects yet.' },
  { name: 'Ambience', sub: '', empty: 'No ambience yet.' },
  { name: 'Music', sub: 'sections', empty: 'No music yet.' },
]

/** `shots`: the open video's shots in order (the main storyboard's showed on every video, 2026-10-15). With the
 *  video, the shots' sound and lines as its cut has them (soundFacts; UAT 2026-11-21, F8). */
export function SoundView({ shots, videoId }: { shots: Shot[]; videoId?: Id }) {
  const doc = useDoc()
  return <SoundViewOf shots={shots} sounds={videoId ? shotSounds(doc, videoId, shots.map((s) => s.id)) : []} lines={videoId ? lineFacts(doc, videoId, shots.map((s) => s.id)) : []} />
}

export function SoundViewOf({ shots, sounds, lines }: { shots: Shot[]; sounds: ReturnType<typeof shotSounds>; lines: ReturnType<typeof lineFacts> }) {
  const total = shots.reduce((a, s) => a + s.duration_s, 0) || 1
  const soundOf = new Map(sounds.map((x) => [x.shotId, x]))
  const heard = sounds.filter((x) => x.sound === 'made' || x.sound === 'background')
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
              <span className={`pt-pill ${soundOf.get(s.id)?.sound === 'made' || soundOf.get(s.id)?.sound === 'background' ? 'on' : ''}`}>{soundOf.get(s.id)?.words ?? 'Not planned yet'}</span>
            </div>
          ))}
          {!shots.length && <p className="snd-empty">No shots yet. Plan shots from the script first.</p>}
        </section>
        <section className="pt-card snd-mix">
          <div className="snd-head"><b>Mix</b></div>
          <p className="snd-empty">No mix yet. The Edit agent builds the mix from the takes in it, and measures it against the loudness target you pick.</p>
          <div className="pt-label">Loudness target</div>
          <div className="snd-targets">
            {['Online · −14 LUFS', 'TV · −23 LUFS', 'Radio · −18 LUFS'].map((t) => <button key={t} type="button" className="btn snd-later" disabled title="Not in this version yet">{t}</button>)}
          </div>
          <p className="snd-why">Picking a loudness target comes in a later version.</p>
        </section>
      </div>
      <div className="snd-main">
        <section className="pt-card snd-lanes">
          <div className="snd-head"><b>Sound</b><span className="snd-why">Adding lines and effects here comes in a later version</span><button type="button" className="btn sm snd-later" disabled title="Not in this version yet">+ Line</button><button type="button" className="btn sm snd-later" disabled title="Not in this version yet">+ Effect</button></div>
          {LANES.map((l) => (
            <div key={l.name} className="snd-lane">
              <span className="snd-lanename"><b>{l.name}</b><small>{l.sub}</small></span>
              <div className="snd-track">
                {l.name === 'Picture'
                  ? shots.map((s, i) => <span key={s.id} className="snd-seg" style={{ flexGrow: s.duration_s / total }}>{i + 1}</span>)
                  : l.name === 'Native' && heard.length
                    ? shots.map((s, i) => { const x = soundOf.get(s.id); const on = x?.sound === 'made' || x?.sound === 'background'
                      return <span key={s.id} className={`snd-seg ${on ? 'on' : 'off'}`} style={{ flexGrow: s.duration_s / total }} title={x?.words}>{on ? `${i + 1} · ${x!.sound === 'made' ? 'clip sound' : 'background'}` : ''}</span> })
                    : l.name === 'Voice' && lines.length
                      ? <span className="snd-lines">{lines.map((x, k) => <span key={k} className={`snd-line ${x.voiced ? 'on' : 'off'}`} title={x.why}>Shot {x.n}{x.who ? ` · ${x.who}` : ''}: “{x.text}” · {x.voiced ? 'spoken in the clip' : 'not voiced'}</span>)}</span>
                      : <span className="snd-empty">{l.empty}</span>}
              </div>
            </div>
          ))}
        </section>
        <aside className="pt-card snd-side">
          <b>Lines and voice-over</b>
          {lines.length ? lines.map((x, k) => (
            <p key={k} className={`snd-why ${x.voiced ? '' : 'snd-warn'}`}><b>Shot {x.n}{x.who ? ` · ${x.who}` : ''}</b> “{x.text}”: {x.why}</p>
          )) : <p className="snd-empty">Its takes, Redo this line and the Review agent's sound checks show here once sound is made.</p>}
        </aside>
      </div>
    </div>
  )
}
