// Which controls the UI shows. A control appears only when its config flag is
// on AND the first provider routed for its op supports it (config.schema.json:
// "the UI shows controls from the first provider's sheet"). Nothing in the UI
// checks a provider by name; everything goes through `controlsFor`.

import { CONFIGS, SHEETS } from './contracts/load'
import type { CapabilitySheet, Config, Flags, ModelChoice, Op, Provider } from './contracts/types'
import { OPS } from './contracts/types'

export type Sheets = Partial<Record<Provider, CapabilitySheet>>

export interface Controls {
  /** Canvas */
  generate: boolean
  /** How many image inputs one Generate may take on the routed provider (refs.max, at most 14). */
  generateMax: number
  /** …of which characters (refs.maxCharacter), when the sheet limits them. */
  generateCharacters: number
  views: boolean
  /** Turnaround by exact camera angle (sheet.angles on the view provider). */
  angles: boolean
  /** Region edits on canvas images (flag regionEditCanvas). */
  regionEditCanvas: boolean
  /** Storyboard */
  storyboard: boolean
  /** Frames come back as one series call (sheet.series > 0). */
  series: boolean
  frameRegenerate: boolean
  regionEditFrames: boolean
  /** Paint a mask instead of only a box (sheet.mask on region_edit). */
  maskBrush: boolean
  /** Click-to-select (sheet.segment on region_edit + flag clickSelect). */
  clickSelect: boolean
  /** Video */
  video: boolean
  /** Comments that change a region of a clip (sheet.video.regionEdit on clip_edit). */
  videoRegionEdit: boolean
  /** A box on the paused clip, fixed in the shot's storyboard frame and the clip made again
   *  (jobs/fix.ts). Needs frame region edits only, not video region support. */
  fixInShot: boolean
  /** The "change the feel" box (sheet.video.feelEdit on clip_edit). */
  feelEdit: boolean
  /** The Adhere / Flex / Reimagine control (feelEdit === 'strength'). */
  feelStrength: boolean
  stitch: boolean
  moreOptions: boolean
}

/** The first provider routed for an op, when its sheet supports the op. */
export function routedSheet(op: Op, config: Config, sheets: Sheets = SHEETS): CapabilitySheet | null {
  const first = config.routing[op]?.[0]
  if (!first) return null
  const sheet = sheets[first]
  if (!sheet || !sheet.ops[op]) return null
  return sheet
}

export function routedProvider(op: Op, config: Config, sheets: Sheets = SHEETS): Provider | null {
  return routedSheet(op, config, sheets)?.provider ?? null
}

export function controlsFor(config: Config, sheets: Sheets = SHEETS): Controls {
  const f = config.flags
  const s = (op: Op) => routedSheet(op, config, sheets)
  const gen = s('generate')
  const view = s('view')
  const frame = s('frame')
  const regionEdit = s('region_edit')
  const clip = s('clip')
  const clipEdit = s('clip_edit')

  const storyboard = f.storyboard && !!frame
  const regionEditFrames = storyboard && f.regionEditFrames && !!regionEdit
  const video = f.video && !!clip
  const feelEdit = video && f.feelEdit && !!clipEdit && clipEdit.video.feelEdit !== 'none'
  return {
    generate: !!gen,
    generateMax: Math.min(14, gen?.refs.max ?? 0),
    generateCharacters: Math.min(14, gen?.refs.maxCharacter ?? gen?.refs.max ?? 0),
    views: !!view,
    angles: !!view && view.angles,
    regionEditCanvas: f.regionEditCanvas && !!regionEdit,
    storyboard,
    series: storyboard && frame!.series > 0,
    frameRegenerate: storyboard,
    regionEditFrames,
    maskBrush: regionEditFrames && regionEdit!.mask !== 'none',
    clickSelect: regionEditFrames && f.clickSelect && regionEdit!.segment,
    video,
    videoRegionEdit: video && f.videoRegionEdit && !!clipEdit && clipEdit.video.regionEdit !== 'none',
    fixInShot: video && regionEditFrames,
    feelEdit,
    feelStrength: feelEdit && clipEdit!.video.feelEdit === 'strength',
    // stitch and shot_list run inside the relay (ffmpeg Lambda, director), not at a
    // provider: no sheet lists them and both configs route them to [], so only the
    // flags gate them. (Noted for the contract owner.)
    stitch: video && f.stitch,
    moreOptions: f.moreOptions && (gen?.outputsPerCall ?? 1) > 1,
  }
}

// ── The regenerate menu (features/model-choice.clan) ──

/** One model a participant may pick when they regenerate. */
export interface ModelOption extends ModelChoice {
  label: string
  note?: string
  estimateUsd: number | null
}

/** What the menu offers for an op: each routed provider that is not fallback-only, in routing
 *  order, its own model first and then its alternates. The relay checks every pick again. */
export function modelChoicesFor(op: Op, config: Config, sheets: Sheets = SHEETS): ModelOption[] {
  const out: ModelOption[] = []
  for (const provider of config.routing[op] ?? []) {
    if (config.fallbackOnly?.includes(provider)) continue
    const spec = sheets[provider]?.ops[op]
    if (!spec) continue
    out.push({ provider, model: spec.model, label: spec.label ?? spec.model, note: spec.note, estimateUsd: spec.estimateUsd ?? null })
    for (const a of spec.alternates ?? []) out.push({ provider, model: a.model, label: a.label, note: a.note, estimateUsd: a.estimateUsd })
  }
  return out
}

/** The pick to send with a job: none for the routing's first model, which routes as before. */
export function choiceToSend(op: Op, config: Config, choice: ModelChoice | undefined, sheets: Sheets = SHEETS): ModelChoice | undefined {
  if (!choice) return undefined
  const first = modelChoicesFor(op, config, sheets)[0]
  return first && first.provider === choice.provider && first.model === choice.model ? undefined : { provider: choice.provider, model: choice.model }
}

/** A model's menu name on any sheet ("Veo 3.1 Fast"), else its id. */
export function modelLabel(provider: Provider | undefined, model: string | undefined, sheets: Sheets = SHEETS): string | undefined {
  if (!model) return undefined
  for (const spec of Object.values(sheets[provider ?? 'mock']?.ops ?? {})) {
    if (spec?.model === model) return spec.label ?? model
    const alt = spec?.alternates?.find((a) => a.model === model)
    if (alt) return alt.label
  }
  return model
}

// ── The dev switch: pick a config and a provider set to see the UI change ──

export type ConfigChoice = 'allon' | 'testing' | 'event' | 'remote'
export type ProviderChoice = 'config' | 'mock' | 'runway' | 'fal' | 'heygen'

export const CONFIG_CHOICES: { id: ConfigChoice; label: string }[] = [
  { id: 'allon', label: 'All flags on' },
  { id: 'testing', label: 'config.testing.json' },
  { id: 'event', label: 'config.event.json' },
  { id: 'remote', label: 'From the relay (GET /config)' },
]

export const PROVIDER_CHOICES: { id: ProviderChoice; label: string }[] = [
  { id: 'config', label: 'As routed in config' },
  { id: 'mock', label: 'Mock (everything)' },
  { id: 'runway', label: 'Runway' },
  { id: 'fal', label: 'fal' },
  { id: 'heygen', label: 'HeyGen video (images on Mock)' },
]

const ALL_FLAGS_ON: Flags = {
  storyboard: true, video: true, stitch: true, regionEditFrames: true, regionEditCanvas: true,
  videoRegionEdit: true, feelEdit: true, clickSelect: true, moreOptions: true, ownKeys: true,
}

function routeAll(provider: Provider, sheets: Sheets): Config['routing'] {
  const routing: Config['routing'] = {}
  for (const op of OPS) routing[op] = sheets[provider]?.ops[op] ? [provider] : []
  return routing
}

/** Build the effective config for a dev-switch choice. */
export function effectiveConfig(choice: ConfigChoice, providers: ProviderChoice, sheets: Sheets = SHEETS, remote?: Config | null): Config {
  const from: Config = choice === 'remote' && remote ? remote : choice === 'event' ? CONFIGS.event : CONFIGS.testing
  const flags = choice === 'allon' ? ALL_FLAGS_ON : from.flags
  let routing = from.routing
  if (providers === 'mock' || providers === 'runway' || providers === 'fal') {
    routing = routeAll(providers, sheets)
  } else if (providers === 'heygen') {
    routing = { ...routeAll('mock', sheets), clip: ['heygen'], clip_edit: ['heygen'], stitch: ['mock'] }
  }
  return { ...from, flags: { ...flags }, routing }
}
