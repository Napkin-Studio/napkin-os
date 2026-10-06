// Which controls the UI shows. A control appears only when its config flag is
// on AND the first provider routed for its op supports it (config.schema.json:
// "the UI shows controls from the first provider's sheet"). Nothing in the UI
// checks a provider by name; everything goes through `controlsFor`.

import { CONFIGS, SHEETS } from './contracts/load'
import type { CapabilitySheet, Config, Flags, Op, Provider } from './contracts/types'
import { OPS } from './contracts/types'

export type Sheets = Partial<Record<Provider, CapabilitySheet>>

export interface Controls {
  /** Character */
  generate: boolean
  combine: boolean
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
  const combine = s('combine')
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
    combine: !!combine,
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
    feelEdit,
    feelStrength: feelEdit && clipEdit!.video.feelEdit === 'strength',
    // stitch and shot_list run inside the relay (ffmpeg Lambda, director), not at a
    // provider: no sheet lists them and both configs route them to [], so only the
    // flags gate them. (Noted for the contract owner.)
    stitch: video && f.stitch,
    moreOptions: f.moreOptions && (gen?.outputsPerCall ?? 1) > 1,
  }
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
  videoRegionEdit: true, feelEdit: true, clickSelect: true, moreOptions: true,
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
