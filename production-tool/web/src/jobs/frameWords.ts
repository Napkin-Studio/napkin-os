// The passthrough's reading of Change this frame's words, for the local mock relay (relay/mock.ts): the
// relay's own lexicon (relay/director/frame_edit.py) on the same table, common cameraWords
// (features/frame-change-edit.clan). Apart from jobs/frameEdit.ts, so the mock imports no job code.

import { CAMERA_WORDS } from '../contracts/load'
import type { Camera, CameraPatch, CameraWordField, FrameEditOutput, FrameReading, JobInput, Question } from '../contracts/types'

const SIZE_WORDS: Record<string, number> = { bigger: 1, larger: 1, closer: 1, smaller: -1 }
const LADDER = ['extreme_wide', 'wide', 'medium_wide', 'medium', 'medium_close', 'close', 'extreme_close']
const PHRASES = (Object.entries(CAMERA_WORDS) as [CameraWordField, Record<string, { words: string[] }>][])
  .flatMap(([field, values]) => Object.entries(values).filter(([v]) => v !== 'graphic')
    .flatMap(([value, row]) => row.words.map((w) => ({ w: w.toLowerCase(), field, value }))))
  .sort((a, b) => b.w.length - a.w.length)

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sizeWord = (text: string) => (text.toLowerCase().match(/[a-z]+/g) ?? []).find((w) => w in SIZE_WORDS)

/** The camera leaves the words name: the longest phrase wins its span; a field named twice takes its first
 *  mention; a speed counts only beside a movement ("push in slowly", never "she slowly turns"). */
export function cameraInWords(text: string): CameraPatch {
  const low = text.toLowerCase().replace(/\s+/g, ' ')
  const taken = new Array<boolean>(low.length).fill(false)
  const found: Partial<Record<CameraWordField, { at: number; value: string }>> = {}
  for (const { w, field, value } of PHRASES) {
    for (const m of low.matchAll(new RegExp(`(?<![a-z])${escape(w)}(?![a-z])`, 'g'))) {
      const at = m.index ?? 0
      if (taken.slice(at, at + w.length).some(Boolean)) continue
      taken.fill(true, at, at + w.length)
      const had = found[field]
      if (!had || at < had.at) found[field] = { at, value }
    }
  }
  const patch: Record<string, unknown> = Object.fromEntries(Object.entries(found).map(([f, x]) => [f, x?.value]))
  if (patch.movement_speed && !patch.movement) delete patch.movement_speed
  const lens = /\b(\d{1,3})\s?mm\b/.exec(low)
  if (lens && +lens[1] >= 8 && +lens[1] <= 800) patch.lens_mm = +lens[1]
  if (/\bmacro\b/.test(low)) patch.macro = true
  return patch as CameraPatch
}

/** The passthrough's reading: an answer settles it; a size word with no answer asks ('ask'). */
export function readingOf(text: string, camera: Camera, answer?: string): { reading: FrameReading | 'ask'; camera: CameraPatch } {
  const was = camera as unknown as Record<string, unknown>
  const patch = Object.fromEntries(Object.entries(cameraInWords(text)).filter(([k, v]) => was[k] !== v)) as CameraPatch
  const sized = sizeWord(text)
  if (answer === 'camera' || answer === 'local' || answer === 'both') {
    if (answer === 'local') return { reading: 'local', camera: {} }
    if (!Object.keys(patch).length && sized && LADDER.includes(camera.size)) {
      const i = Math.min(Math.max(LADDER.indexOf(camera.size) + SIZE_WORDS[sized], 0), LADDER.length - 1)
      if (LADDER[i] !== camera.size) return { reading: answer, camera: { size: LADDER[i] as Camera['size'] } }
    }
    return { reading: answer, camera: patch }
  }
  if (sized) return { reading: 'ask', camera: {} }
  return Object.keys(patch).length ? { reading: 'camera', camera: patch } : { reading: 'local', camera: {} }
}

/** What the mock relay answers for a frame_edit, as the passthrough does: its frameEdit, or the ask
 *  ("Bigger how?": an ambiguity, nothing recommended, no price). */
export function mockFrameEdit(input: JobInput, answer?: string): { edit?: FrameEditOutput; question?: Omit<Question, 'id'> } {
  const camera = input.shot?.camera ?? { size: 'medium' }
  const { reading, camera: patch } = readingOf(input.text ?? '', camera, answer)
  if (reading === 'ask') {
    const word = sizeWord(input.text ?? '') ?? 'bigger'
    return {
      question: {
        kind: 'ambiguity', text: `${word[0].toUpperCase()}${word.slice(1)} how?`,
        why: `"${word}" could mean moving the camera, or changing the thing itself in the frame.`,
        options: [{ id: 'camera', label: 'Move the camera', value: 'camera' }, { id: 'local', label: 'Change it in the frame', value: 'local' },
          { id: 'both', label: 'Both', value: 'both' }],
        allow_text: false,
      },
    }
  }
  const regioned = !!(input.region || input.mask)
  const keys = Object.keys(patch)
  const moveOnly = reading === 'camera' && keys.length > 0 && keys.every((k) => k === 'movement' || k === 'movement_speed')
  const runAs: FrameEditOutput['runAs'] = reading === 'local' ? (regioned ? 'region_edit' : 'frame') : moveOnly ? 'none' : 'frame'
  return {
    edit: {
      reading, runAs, ...(keys.length ? { camera: patch } : {}), words_as_given: true,
      ...(reading !== 'local' && regioned ? { maskUnused: true } : {}),
    },
  }
}
