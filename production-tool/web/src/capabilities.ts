// Which controls the UI shows. A control appears only when its config flag is
// on AND the first provider routed for its op supports it (config.schema.json:
// "the UI shows controls from the first provider's sheet"). Nothing in the UI
// checks a provider by name; everything goes through `controlsFor`.

import { CONFIGS, SHEETS, SPEND_POLICY } from './contracts/load'
import type { Allow, CapabilitySheet, ClipQuality, Config, Flags, ModelChoice, OpAlternate, OpSheet, Op, Provider, QualityEntry } from './contracts/types'
import { OPS, QUALITIES } from './contracts/types'

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
  /** Click-to-select (sheet.segment on region_edit + flag clickSelect). The Image editor's Click-select
   *  runs on the device instead (features/image-editor.clan) and needs only a mask. */
  clickSelect: boolean
  /** The Image editor's Upscale: a provider routed for upscale (Magnific on Runway). */
  upscale: boolean
  /** Video */
  video: boolean
  /** Comments that change a region of a clip (sheet.video.regionEdit on clip_edit). */
  videoRegionEdit: boolean
  /** A box on the paused clip, fixed in the shot's storyboard frame and the clip made again
   *  (jobs/fix.ts). Needs frame region edits only, not video region support. */
  fixInShot: boolean
  /** Fix this moment: a note's window on a take made again and spliced back (flag clipPatch and a
   *  provider routed for clip_patch; features/clip-moment-edit.clan, jobs/patch.ts). */
  fixMoment: boolean
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
    // The op's own mask over the sheet's: Runway takes none, except region_edit on ideogram_4_5.
    maskBrush: regionEditFrames && (regionEdit!.ops.region_edit?.mask ?? regionEdit!.mask) !== 'none',
    clickSelect: regionEditFrames && f.clickSelect && regionEdit!.segment,
    upscale: storyboard && !!s('upscale'),
    video,
    videoRegionEdit: video && f.videoRegionEdit && !!clipEdit && clipEdit.video.regionEdit !== 'none',
    fixInShot: video && regionEditFrames,
    fixMoment: video && !!f.clipPatch && !!s('clip_patch'),
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

/** One model a person may pick when they regenerate. No price: the UI shows none (owner, 2026-10-13);
 *  each job's cost is recorded and shown in History. */
export interface ModelOption extends ModelChoice {
  label: string
  note?: string
  /** A family (features/clip-quality.clan): the ids that are its sizes; `model` is the one Standard runs.
   *  Quality picks the member, so the menu shows the family once ("Kling O3"). */
  members?: string[]
}

/** The option a pick or a made job belongs to: the same model, or a member of the option's family. */
export function sameOption(o: ModelChoice & { members?: string[] }, c: Pick<ModelChoice, 'model'> & { provider?: string } | undefined): boolean {
  return !!c && o.provider === c.provider && (o.model === c.model || !!o.members?.includes(c.model))
}

/** What the menu offers for an op: each routed provider in the order its jobs run (Runway, the floor,
 *  is always there), its own model first and then its alternates (features/runway-fallback.clan).
 *  Only models whose maker the agency allows (config.allow, features/tenant-limits.clan).
 *  The relay checks every pick again. */
export function modelChoicesFor(op: Op, config: Config, sheets: Sheets = SHEETS): ModelOption[] {
  const out: ModelOption[] = []
  for (const provider of config.routing[op] ?? []) {
    const spec = sheets[provider]?.ops[op]
    if (!spec) continue
    const entries = [spec, ...(spec.alternates ?? [])].filter((e) => modelOn(sheets, provider, e.model, config.allow))
    const seen = new Set<string>()
    for (const e of entries) {
      if (!e.family) {
        out.push({ provider, model: e.model, label: e.label ?? e.model, ...(e.note ? { note: e.note } : {}) })
        continue
      }
      if (seen.has(e.family)) continue
      seen.add(e.family)
      const members = entries.filter((x) => x.family === e.family)
      const main = members.find((x) => x.quality?.standard) ?? e
      out.push({ provider, model: main.model, label: e.familyLabel ?? e.label ?? e.model, ...(main.note ? { note: main.note } : {}), members: members.map((x) => x.model) })
    }
  }
  return out
}

// ── Clip quality (features/clip-quality.clan) ──

export const QUALITY_NAMES: Record<ClipQuality, string> = { draft: 'Draft', standard: 'Standard', final: 'Final' }
/** A request that names none runs this: the size before quality existed (720p). */
export const DEFAULT_QUALITY: ClipQuality = 'standard'

/** A tier as people read it: 360p, 1080p, 2K. */
export function sizeLabel(tier: string | undefined): string | undefined {
  return tier && /k$/i.test(tier) ? `${tier.slice(0, -1)}K` : tier
}

/** "Draft 360p", "Final 2K"; the level alone when the size is unknown. */
export function qualityLabel(level: ClipQuality | undefined, size?: string): string | undefined {
  return level ? [QUALITY_NAMES[level], sizeLabel(size)].filter(Boolean).join(' ') : undefined
}

function opEntries(op: Op, provider: Provider, sheets: Sheets): (OpSheet | OpAlternate)[] {
  const spec = sheets[provider]?.ops[op]
  return spec ? [spec, ...(spec.alternates ?? [])] : []
}

export interface Sized {
  /** The model that runs: the asked one, or its family's member for the level. */
  model: string
  /** The level it runs at, the nearest the model has; none where it keeps the clip's size. */
  level?: ClipQuality
  tier?: string
  entry?: QualityEntry
  /** An edit that keeps the clip's own size (Seedance 2.5 edit); its level only prices it. */
  keepsSize?: boolean
}

/** What runs for `level` on `model` (absent: the op's own): the same answer as the relay's quality_choice
 *  (relay/providers/types.py), held by contracts/examples/quality-cases.json. */
export function resolveQuality(op: Op, provider: Provider, model: string | undefined, level: ClipQuality | string | null | undefined, sheets: Sheets = SHEETS): Sized {
  const entries = opEntries(op, provider, sheets)
  const asked = model ?? entries[0]?.model ?? ''
  const own = entries.find((e) => e.model === asked)
  if (!own?.quality || !Object.keys(own.quality).length) return { model: asked }
  const members = own.family ? entries.filter((e) => e.family === own.family) : [own]
  const offered = new Map<ClipQuality, { model: string; entry: QualityEntry }>()
  for (const e of members) for (const l of QUALITIES) if (e.quality?.[l] && !offered.has(l)) offered.set(l, { model: e.model, entry: e.quality[l]! })
  let want: ClipQuality = (QUALITIES as readonly string[]).includes(level ?? '') ? level as ClipQuality : DEFAULT_QUALITY
  if (!offered.has(want)) {
    const i = QUALITIES.indexOf(want)
    want = [...offered.keys()].sort((a, b) => Math.abs(QUALITIES.indexOf(a) - i) - Math.abs(QUALITIES.indexOf(b) - i) || QUALITIES.indexOf(a) - QUALITIES.indexOf(b))[0]
  }
  const hit = own.quality[want] ? { model: asked, entry: own.quality[want]! } : offered.get(want)!
  return { model: hit.model, level: want, tier: hit.entry.tier, entry: hit.entry, ...(own.keepsSize ? { keepsSize: true } : {}) }
}

export interface QualityOption {
  level: ClipQuality
  /** It can be picked on this model (or its family). */
  on: boolean
  /** The size it makes ("360p"), when on. */
  size?: string
  /** Why it is greyed. */
  why?: string
}

/** Draft, Standard and Final for a pick (absent: the routed first model): what each makes, and why one is
 *  greyed. A model that keeps the clip's size, or makes one size, greys the rest and says so. */
export function qualityOptions(op: Op, choice: ModelChoice | undefined, config: Config, sheets: Sheets = SHEETS): QualityOption[] {
  const pick = choice ?? modelChoicesFor(op, config, sheets)[0]
  if (!pick) return QUALITIES.map((level) => ({ level, on: false, why: 'No model can make this now' }))
  const entries = opEntries(op, pick.provider, sheets)
  const own = entries.find((e) => e.model === pick.model)
  const label = own?.familyLabel ?? own?.label ?? modelLabel(pick.provider, pick.model) ?? pick.model
  if (!own?.quality || own.keepsSize) {
    return QUALITIES.map((level) => ({ level, on: false, why: `${label} keeps the clip's own size` }))
  }
  const members = own.family ? entries.filter((e) => e.family === own.family) : [own]
  const made = new Map<ClipQuality, string>()
  for (const e of members) for (const l of QUALITIES) if (e.quality?.[l] && !made.has(l)) made.set(l, sizeLabel(e.quality[l]!.tier)!)
  const sizes = [...new Set(made.values())]
  return QUALITIES.map((level) => made.has(level)
    ? { level, on: true, size: made.get(level) }
    : { level, on: false, why: sizes.length === 1 ? `${label} makes one size, ${sizes[0]}` : `${label} has no ${QUALITY_NAMES[level]} size` })
}

// ── The agency's allowlist (features/tenant-limits.clan) ──

/** A maker the agency allows: one in its list, or Napkin's own (the mock). An unknown maker is off. */
export function makerOn(maker: string | undefined, allow: Allow): boolean {
  return !!maker && (allow.makers.includes(maker) || SPEND_POLICY.alwaysAllowed.includes(maker))
}

/** A model the agency may run on this provider; every model when no allowlist is known. */
export function modelOn(sheets: Sheets, provider: Provider, model: string, allow: Allow | undefined): boolean {
  return !allow || makerOn(sheets[provider]?.models?.[model]?.maker, allow)
}

/** The config with the agency's allowlist applied: each op routes only to providers with a model the
 *  agency allows, so a step with none left loses its controls, and the menus list only allowed models. */
export function withAllow(config: Config, allow: Allow | undefined, sheets: Sheets = SHEETS): Config {
  if (!allow) return config
  const routing: Config['routing'] = {}
  for (const [op, providers] of Object.entries(config.routing) as [Op, Provider[]][]) {
    routing[op] = providers.filter((p) => {
      const spec = sheets[p]?.ops[op]
      return !!spec && [spec.model, ...(spec.alternates ?? []).map((a) => a.model)].some((m) => modelOn(sheets, p, m, allow))
    })
  }
  return { ...config, routing, allow }
}

/** The pick to send with a job: none for the routing's first model, which routes as before. */
export function choiceToSend(op: Op, config: Config, choice: ModelChoice | undefined, sheets: Sheets = SHEETS): ModelChoice | undefined {
  if (!choice) return undefined
  const first = modelChoicesFor(op, config, sheets)[0]
  return first && first.provider === choice.provider && first.model === choice.model && !first.members ? undefined : { provider: choice.provider, model: choice.model }
}

/** A model's menu name on any sheet ("Veo 3.1 Fast"), else its id. The provider may be a document's
 *  madeBy, which can name one no longer routed (features/drop-hackathon-extras.clan): its id, then. */
export function modelLabel(provider: string | undefined, model: string | undefined, sheets: Sheets = SHEETS): string | undefined {
  if (!model) return undefined
  for (const spec of Object.values(sheets[(provider ?? 'mock') as Provider]?.ops ?? {})) {
    if (spec?.model === model) return spec.label ?? model
    const alt = spec?.alternates?.find((a) => a.model === model)
    if (alt) return alt.label
  }
  return model
}

/** "<model> on Runway" (ui-behaviour 3.7): every surface names a model with where it runs. */
export function modelWhere(provider: string | undefined, model: string | undefined): string | undefined {
  const label = modelLabel(provider, model)
  if (!label) return undefined
  const where = provider === 'runway' ? 'Runway' : provider === 'elevenlabs' ? 'ElevenLabs' : provider === 'mock' || !provider ? 'the mock' : provider
  return `${label} on ${where}`
}

// ── The dev switch: pick a config and a provider set to see the UI change ──

export type ConfigChoice = 'allon' | 'testing' | 'live' | 'remote'
export type ProviderChoice = 'config' | 'mock' | 'runway'

export const CONFIG_CHOICES: { id: ConfigChoice; label: string }[] = [
  { id: 'allon', label: 'All flags on' },
  { id: 'testing', label: 'config.testing.json' },
  { id: 'live', label: 'config.live.json' },
  { id: 'remote', label: 'From the relay (GET /config)' },
]

export const PROVIDER_CHOICES: { id: ProviderChoice; label: string }[] = [
  { id: 'config', label: 'As routed in config' },
  { id: 'mock', label: 'Mock (everything)' },
  { id: 'runway', label: 'Runway' },
]

const ALL_FLAGS_ON: Flags = {
  storyboard: true, video: true, stitch: true, regionEditFrames: true, regionEditCanvas: true,
  videoRegionEdit: true, feelEdit: true, clickSelect: true, moreOptions: true, clipPatch: true,
}

function routeAll(provider: Provider, sheets: Sheets): Config['routing'] {
  const routing: Config['routing'] = {}
  for (const op of OPS) routing[op] = sheets[provider]?.ops[op] ? [provider] : []
  return routing
}

/** Build the effective config for a dev-switch choice. */
export function effectiveConfig(choice: ConfigChoice, providers: ProviderChoice, sheets: Sheets = SHEETS, remote?: Config | null): Config {
  const from: Config = choice === 'remote' && remote ? remote : choice === 'live' ? CONFIGS.live : CONFIGS.testing
  const flags = choice === 'allon' ? ALL_FLAGS_ON : from.flags
  const routing = providers === 'config' ? from.routing : routeAll(providers, sheets)
  return { ...from, flags: { ...flags }, routing }
}
