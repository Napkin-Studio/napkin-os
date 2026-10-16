// TypeScript mirror of production-tool/contracts/*.schema.json (contract 3,
// 2026-10-13, features/contract-v3.clan). Hand-written, field for field;
// `src/contracts/contracts.test.ts` validates every example against the
// schemas with ajv and type-checks the typed fixtures, so a drift between these
// types and the schemas shows up as a failing test. Do not change a type here
// without the contract changing first.

// ── common.schema.json ──────────────────────────────────────────────────────

export type ContractVersion = '3'

/** The join into a stitch clip (relay-api clips[].transition): a dissolve or dip overlaps s seconds. */
export interface StitchTransition { kind: 'cut' | 'dissolve' | 'dip'; s?: number }
export const CONTRACT_VERSION: ContractVersion = '3'
/** `sha256:<64 hex>` */
export type Sha256 = string
/** Prefixed ULID: job_…, ref_…, shot_…, beat_…, frame_…, take_…, rev_…, link_…, q_… */
export type Id = string
/** An Excalidraw element id (a group, a note, an ink group). */
export type SceneId = string
/** A solid key: one character, place or object. `^[a-z][a-z0-9]{1,23}$` (no underscore). */
export type Key = string
/** Free text after the key: `^[a-z0-9][a-z0-9-]{0,31}$` (laughing, front, red-coat). */
export type Variant = string
/** key_variant, as written after @ (maya_laughing). */
export type RefName = string
/** What words name after @: a bare key (the whole character) or key_variant (one look). */
export type Subject = string
export const KEY_RE = /^[a-z][a-z0-9]{1,23}$/
export const VARIANT_RE = /^[a-z0-9][a-z0-9-]{0,31}$/

export const RATIOS = ['16:9', '9:16', '1:1', '4:5'] as const
export type Ratio = (typeof RATIOS)[number]
export interface Aspect { w: number; h: number }
/** A fractional order key (clan-store/src/rank.ts). */
export type Rank = string

export const CAMERA_SIZES = ['extreme_wide', 'wide', 'medium_wide', 'medium', 'medium_close', 'close', 'extreme_close', 'insert', 'over_shoulder', 'two_shot', 'graphic'] as const
export type CameraSize = (typeof CAMERA_SIZES)[number]
export const CAMERA_ANGLES = ['eye_level', 'high_angle', 'low_angle', 'overhead', 'aerial', 'dutch', 'pov'] as const
export type CameraAngle = (typeof CAMERA_ANGLES)[number]
export const CAMERA_MOVEMENTS = ['static', 'pan', 'tilt', 'push_in', 'pull_out', 'track', 'orbit', 'handheld', 'crane_up', 'crane_down', 'drone'] as const
export type CameraMovement = (typeof CAMERA_MOVEMENTS)[number]
export type MovementSpeed = 'slow' | 'normal' | 'fast'
export interface Camera {
  size: CameraSize
  angle?: CameraAngle
  movement?: CameraMovement
  movement_speed?: MovementSpeed
  lens_mm?: number
  macro?: boolean
}
/** A change to a shot's camera: the leaves that change, each with its new value (common cameraPatch). */
export type CameraPatch = Partial<Camera>
/** The camera fields with a word table (common cameraWords). */
export type CameraWordField = 'size' | 'angle' | 'movement' | 'movement_speed'
/** How each camera value is said: the chip label and the phrases that mean it (common cameraWords). */
export type CameraWords = Record<CameraWordField, Record<string, { label: string; words: string[] }>>

/** Change this frame (director.schema.json#/$defs/frameEdit): how Dex read the words, and what ran. */
export type FrameReading = 'camera' | 'local' | 'both'
export interface FrameEditOutput {
  reading: FrameReading
  runAs: 'frame' | 'region_edit' | 'none'
  camera?: CameraPatch
  maskUnused?: boolean
  words_as_given?: boolean
}

export const BEAT_KINDS = ['moment', 'line', 'vo', 'music', 'sound', 'camera'] as const
export type BeatKind = (typeof BEAT_KINDS)[number]

export const CREW = ['dex', 'skye', 'wren', 'rhea', 'edie', 'ellis', 'jude'] as const
export type CrewId = (typeof CREW)[number]
export type TenantId = string
/** human:<personId> */
export type PersonRef = string
/** A person (human:<id>) or a crew member. */
export type ActorRef = PersonRef | CrewId
/** <doc-id>#<entity-keyed path> */
export type Address = string
export type DecisionId = string

export interface FormatRef { pack_id: string; pack_version: string; format_id: string; client_id?: string }
export type SafeArea =
  | { type: 'insets'; top: number; right: number; bottom: number; left: number; unit: '%' | 'px' | 'mm' }
  | { type: 'box'; width: number; height: number; unit: '%' | 'px' | 'mm'; basis: 'full_size'; anchor: 'centre' }
export interface DeliveryPx { width: number; height: number }

// ── Make all sizes (features/campaign-formats.clan; common.schema.json) ──
/** A box in a picture's own pixels, origin top-left. */
export interface PxBox { x: number; y: number; w: number; h: number }
/** What must stay in every size: a subject or a product, in the master's pixels. */
export interface ProtectBox extends PxBox { role: 'subject' | 'product' | 'other'; label?: string }
export const FORMAT_CHANNELS = ['film', 'social', 'ooh', 'print', 'display'] as const
export type FormatChannel = (typeof FORMAT_CHANNELS)[number]
export const SIZE_METHODS = ['crop', 'extend', 'nearest', 'reframe', 'regenerate', 'layout', 'reedit'] as const
export type SizeMethod = (typeof SIZE_METHODS)[number]
export const TYPE_LAYER_KINDS = ['line', 'logo', 'supers', 'legal'] as const
export type TypeLayerKind = (typeof TYPE_LAYER_KINDS)[number]
export interface TypeLayerOverride { hidden?: boolean; text?: string; box?: Region; scale?: number }
export const FORMAT_CHECK_CODES = ['subject_safe', 'logo_safe', 'clear_space', 'type_size', 'ooh_words', 'line_present', 'end_card', 'sound_off', 'brand_first_3s'] as const
export type FormatCheckCode = (typeof FORMAT_CHECK_CODES)[number]
export interface FormatCheck { result: 'pass' | 'flag'; note: string; ignored?: { by: PersonRef; at: string } }
export interface SizeEdlWindow { shot_id: Id; take_id?: Id; in_s: number; out_s: number; crop?: PxBox; end_card?: boolean }
/** relay-api TypeLayer: one type layer laid out for one size; the relay or stitch draws it. */
export interface TypeLayer {
  kind: TypeLayerKind
  box: Region
  text?: string
  image?: AssetRef
  sizeFrac?: number
  colour?: string
  align?: 'left' | 'centre' | 'right'
  weight?: 'regular' | 'bold'
  plate?: string
}

export const REF_ROLES = ['character', 'location', 'lighting', 'composition', 'product', 'style', 'wardrobe', 'pose', 'prop', 'texture', 'colour', 'layout', 'logo', 'palette', 'typography', 'brand_rule', 'document', 'other'] as const
export type RefRole = (typeof REF_ROLES)[number]
export interface RefRoleLine {
  ui_line: string
  prompt_line: string
  views: boolean
  payload: 'image' | 'swatches' | 'font' | 'rule' | 'document'
  picker: 'main' | 'more'
}

/** op view: the turnaround view to make; also the variant its result is named by. */
export const VIEWS = ['front', 'three-quarter', 'side', 'back'] as const
export type View = (typeof VIEWS)[number]

export interface Region { x: number; y: number; w: number; h: number }

export const LINK_ENDPOINT_KINDS = ['board', 'group', 'note', 'ink', 'script', 'storyboard', 'video', 'ref', 'key', 'frame', 'render', 'sketch', 'document', 'format_set', 'shot'] as const
export type LinkEndpointKind = (typeof LINK_ENDPOINT_KINDS)[number]
export interface LinkEndpoint { kind: LinkEndpointKind; id: string }
export type StructuralLinkRole = 'drives' | 'renders' | 'input' | 'note' | 'context' | 'brand' | 'master' | 'frame' | 'made_from' | 'note_on_shot'
export type LinkRole = StructuralLinkRole | RefRole
export interface LinkRuleEntry {
  from: LinkEndpointKind[]
  to: LinkEndpointKind[]
  roles: LinkRole[]
  per_target: 'one' | 'many'
  per_source?: 'one'
  system?: boolean
  board_purpose?: BoardPurpose
}
export interface LinkRule { generating: LinkEndpointKind[]; rules: LinkRuleEntry[] }

export interface RouteValue { route: string; node?: LinkEndpoint }
export interface QuestionOption {
  id: string
  label: string
  value?: RouteValue | string | number | boolean | Record<string, unknown> | unknown[]
  detail?: string
  cost?: { estimate: number; currency: 'USD' }
}
export type AskKind = 'block' | 'nudge' | 'ambiguity'
export interface Question {
  id: Id
  kind: AskKind
  text: string
  why?: string
  options: QuestionOption[]
  allow_text: boolean
  recommended_option_id?: string
  address?: Address
}
export type Answer = { option_id: string; text?: never } | { text: string; option_id?: never }

export const PROVIDERS = ['mock', 'runway'] as const
export type Provider = (typeof PROVIDERS)[number]
/** madeBy: the provider that made an output, as recorded then. Free text, not Provider. */
export type MadeBy = string

export const OPS = ['generate', 'view', 'shot_list', 'frame', 'region_edit', 'clip', 'clip_edit', 'stitch', 'frame_edit', 'clip_patch', 'bridge', 'cutout', 'transcribe', 'write', 'read', 'check', 'resize', 'cutdown', 'upscale'] as const
export type Op = (typeof OPS)[number]

export type QuotaClass = 'image' | 'video' | 'render' | 'text'

export const JOB_STATES = ['queued', 'submitting', 'submitted', 'fetching', 'validating', 'needs_input', 'completed', 'failed', 'cancelled', 'uncertain'] as const
export type JobState = (typeof JOB_STATES)[number]

export interface Cost {
  estimate?: number
  reserved?: number
  confirmed?: number
  currency: 'USD'
  unknown: boolean
}

export type Mime =
  | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml' | 'video/mp4' | 'audio/mpeg' | 'audio/wav' | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' | 'font/woff2' | 'font/ttf' | 'font/otf' | 'text/plain' | 'application/zip'
/** What jobs send: today's pictures and clips. */
export type InputMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'video/mp4'

export interface AssetRef { sha256: Sha256; url: string; mime: Mime }

export interface Output {
  sha256: Sha256
  url: string
  mime: string
  w?: number
  h?: number
  durationS?: number
  bytes?: number
  /** The model's size before the relay centre-cropped the picture to the job's shape (frame-aspect). */
  croppedFrom?: Aspect
}

export type ErrorCode =
  | 'invalid_input' | 'unauthorised' | 'blocked' | 'flag_off' | 'quota_exhausted' | 'spend_stop'
  | 'limit_reached' | 'not_allowed' | 'queue_full' | 'capability_missing' | 'moderated' | 'provider_failed' | 'provider_unavailable'
  | 'timeout' | 'uncertain' | 'conflict' | 'internal'

export interface ContractError {
  code: ErrorCode
  message: string
  retryable: boolean
  retryAfterS?: number
  providerCode?: string
}

// ── capabilities.schema.json ────────────────────────────────────────────────

/** The settings one job assumes (capabilities.schema.json $defs/defaults); contracts/pricing.py prices
 *  them for the relay. The web app shows no price (owner, 2026-10-13). */
export interface OpDefaults {
  outputs?: number
  ratio?: string
  resolution?: string
  quality?: 'very_low' | 'low' | 'medium' | 'high'
  preciseEdit?: boolean
  refs?: number
  durationS?: number
  audio?: boolean
  inputS?: number
  fps?: number
  inputPx?: number
  scaleFactor?: number
}

export interface OpSheet {
  model: string
  endpoint: string
  defaults: OpDefaults
  maxS?: number
  minS?: number
  durationsS?: number[]
  regionModel?: string
  regionEndpoint?: string
  /** clip only: where a clip with no first frame goes, made from words alone (ui-behaviour 3.5). */
  textEndpoint?: string
  /** The model's name in the regenerate menu, and one line on what it is good for. */
  label?: string
  note?: string
  /** Vetted models a person may pick when they regenerate (features/model-choice.clan). */
  alternates?: OpAlternate[]
  /** This op's model takes masks this way, over the sheet's (Runway region_edit on ideogram_4_5). */
  mask?: CapabilitySheet['mask']
  /** With no region and no mask, the op edits the whole image keeping its composition. */
  preciseEdit?: boolean
}

/** One alternate model for an op: its fields replace the op's, its overrides the sheet's. */
export interface OpAlternate {
  model: string
  endpoint: string
  textEndpoint?: string
  defaults: OpDefaults
  label: string
  note?: string
  maxS?: number
  minS?: number
  durationsS?: number[]
  seed?: boolean
  outputs?: number[]
  tagSyntax?: CapabilitySheet['tagSyntax']
  refs?: CapabilitySheet['refs']
  series?: number
  outputsPerCall?: number
  video?: CapabilitySheet['video']
  mask?: CapabilitySheet['mask']
  preciseEdit?: boolean
}

/** One model in the sheet's catalogue: its checked limits and its published price (read by the relay). */
export interface ModelSheet {
  /** The company that makes the model and receives what a job sends it; an agency's allow.makers
   *  turns models on or off by it (features/tenant-limits.clan). */
  maker: string
  endpoint?: string
  label: string
  ratios?: { ratio: string; tier?: string }[]
  durationsS?: number[]
  inputS?: { min?: number; max?: number; maxFps?: number }
  outputs?: number[]
  promptMax?: number
  promptUnit?: 'utf16'
  refs?: { max: number; maxCharacter?: number }
  mask?: 'none' | 'png_black_edit' | 'png_white_edit'
  preciseEdit?: boolean
  keyframes?: { max: number; range?: 'whole_seconds_end_exclusive' }
  targetAspectRatios?: string[]
  firstLastFrame?: boolean
  audioDefault?: boolean
  scaleFactors?: number[]
  resolutions?: string[]
  /** features/runway-video-models.clan: the request's audio switch, Veo's negativePrompt, the pictures one
   *  clip carries with its frames (Kling O3: 7), WAN's auto ratio with a frame, and how the model edits a clip. */
  audioParam?: boolean
  negativePrompt?: boolean
  imagesMax?: number
  keyframeRatio?: 'auto_tier'
  v2v?: { videoField: 'videoUri' | 'promptVideo'; mode?: 'edit'; durationAuto?: boolean; keepOriginalSound?: boolean; audioParam?: boolean; refsMax: number; inputMaxS?: number }
  pricing: { unit: 'image' | 'second' | 'frame'; source: string[]; [k: string]: unknown }
}

export interface CapabilitySheet {
  contractVersion: ContractVersion
  provider: Provider
  checked: string
  usdPerCredit: number
  sources: { url: string; fetched: string }[]
  ops: Partial<Record<Op, OpSheet>>
  models: Record<string, ModelSheet>
  tagSyntax: 'at_tag' | 'none'
  refs: { max: number; maxCharacter?: number }
  seed: boolean
  outputsPerCall?: number
  mask: 'none' | 'png_black_edit' | 'png_white_edit'
  segment: boolean
  angles: boolean
  series: number
  video: {
    firstFrameWithRefs: boolean
    lastFrame: boolean
    multiShot: boolean
    regionEdit: 'none' | 'temporal_keyframe' | 'mask'
    feelEdit: 'none' | 'prompt' | 'strength'
    audioDefault: boolean
    audioControl?: boolean
    /** A clip with no first frame can carry reference pictures (features/runway-video-models.clan). */
    refsWithoutFrame?: boolean
  }
  inputs: { headRequired: boolean; followsRedirects: boolean; maxImageMb?: number; maxVideoMb?: number }
  results: { mode: 'poll' | 'webhook' | 'poll_or_webhook'; minPollS: number; idempotencyKey: boolean; outputUrlTtlH?: number | null; cancel?: boolean }
  concurrency: { image: number; video: number; note?: string }
}

// ── config.schema.json ──────────────────────────────────────────────────────

export interface Flags {
  storyboard: boolean
  video: boolean
  stitch: boolean
  regionEditFrames: boolean
  regionEditCanvas: boolean
  videoRegionEdit: boolean
  feelEdit: boolean
  clickSelect: boolean
  moreOptions: boolean
  /** The beta's record: notice, Beta tag, thumbs, POST /dogfood/* (features/production-tool-dogfood.clan). Optional; absent means off. */
  dogfood?: boolean
  /** Fix this moment, op clip_patch (features/clip-moment-edit.clan). Optional; absent means off. */
  clipPatch?: boolean
  /** Our own canvas engine for new projects (features/canvas-engine.clan). Optional; absent means off. */
  ownCanvas?: boolean
}

/** Fix this moment's settings (config.schema clipPatch); every key optional. */
export interface ClipPatchSettings {
  model?: string
  /** range (the default): the whole take, the window as the keyframe's range. cut: only the window. */
  send?: 'range' | 'cut'
  contextS?: number
  crossfadeS?: number
  seamMin?: number
}

export interface Config {
  contractVersion: ContractVersion
  /** Runway is the floor of every job routed to it (features/runway-fallback.clan). */
  routing: Partial<Record<Op, Provider[]>>
  director: { promptVersion: string; perClickModel: string; shotListModel: string }
  quotas: { image: number; video: number; render: number }
  inFlightPerParticipant: number
  jobTimeoutS: { image: number; video: number }
  /** How long a job may wait for a free slot (the relay's default when absent: 1800 s each). */
  queueTimeoutS?: { image: number; video: number }
  spend: { capUsd: number; warnUsd: number }
  flags: Flags
  clipPatch?: ClipPatchSettings
  banner: string
  /** Not in config.json: the agency's allowlist from GET /me, which useConfig applies (withAllow):
   *  routing keeps only providers with a model the agency allows, and the model menus list only those. */
  allow?: Allow
}

/** Where an agency's material may go (spend-policy.schema.json#/$defs/allow, features/tenant-limits.clan). */
export interface Allow {
  /** The director and the character cards (Claude on Amazon Bedrock). */
  claude: boolean
  /** The makers whose models may run; any other is off. */
  makers: string[]
}


// ── director.schema.json (only the parts the UI reads) ──────────────────────

export interface AgentBlock {
  model: string
  promptVersion: string
  output: Record<string, unknown>
  rationale: string
  latencyMs?: number
  /** The character cards the director was given (features/character-cards.clan). The relay's
   *  Job carries them; the document's jobs[].director does not (jobs/runner.ts agentForDocument). */
  cards?: DirectorCard[]
}

export interface DirectorCard {
  tag: string
  sha256: Sha256
  kind: 'character' | 'object' | 'setting' | 'style' | 'other'
  card: string
}

export interface PlannedBeat { kind: BeatKind; at_s: number; text: string; speaker?: string; parenthetical?: string }
/** One shot as Dex plans it (director.schema.json#/$defs/plannedShot). */
export interface PlannedShot {
  id?: Id
  kind: 'shot' | 'end_card'
  scene_heading?: string
  duration_s: number
  camera: Camera
  action: string
  direction?: string
  refs: Subject[]
  beats?: PlannedBeat[]
}

// ── document.schema.json ────────────────────────────────────────────────────

/** What every entity carries: its id (= its map key), its version, and the version that wrote each leaf. */
export interface EntityBase {
  id: Id
  v: number
  /** leaf path ('camera/size') → the entity version that wrote it */
  field_v: Record<string, number>
}

/** ProseMirror JSON of a live-text fragment (clan-store/src/text). */
export interface Prose { type: 'doc'; content?: Record<string, unknown>[] }
export interface TextProblem { field: string; length: number; limit: number; message: string }
export interface Pick { current: Id; alternates?: Id[] }
export interface LibraryCopy { shelf: string; key: Key; ver: number; by: PersonRef; at: string }
export type TargetKind = 'ref' | 'frame' | 'take' | 'render' | 'video' | 'shot' | 'scene' | 'beat' | 'script' | 'storyboard' | 'size' | 'format_set' | 'sketch' | 'document' | 'board' | 'key'
export interface Target { kind: TargetKind; id: Id }
export interface NoteWindow { from_s: number; to_s: number }

export type AssetKind = 'image' | 'video' | 'audio' | 'document' | 'font' | 'vector'
export type AssetOrigin = 'uploaded' | 'drawn' | 'generated' | 'mock' | 'edited' | 'extracted'
export interface DocAsset {
  sha256: Sha256
  kind: AssetKind
  mime: Mime
  bytes?: number
  w?: number
  h?: number
  duration_s?: number
  pages?: number
  origin: AssetOrigin
  job_id?: Id
  locations: string[]
  thumb?: string
}

export type BoardPurpose = 'script' | 'character' | 'location' | 'reference' | 'product' | 'storyboard' | 'video' | 'sketches' | 'brand' | 'formats' | 'none'
export interface Board extends EntityBase {
  title: string
  purpose: BoardPurpose
  rank: Rank
  name_prefix?: Key
  source?: { document_id: Id }
  library?: LibraryCopy
}
export interface Sketch extends EntityBase { aspect: Aspect; ratio?: Ratio; format?: FormatRef; board_id?: Id; drawn_by: PersonRef }
export interface Script extends EntityBase { title: string; target_s: number }
export interface Scene extends EntityBase {
  script_id: Id
  rank: Rank
  heading: string
  hands_off?: CrewId[]
  prose?: Prose
  text?: string
  last_writer?: ActorRef
}
export interface Storyboard extends EntityBase { title: string; ratio: Ratio; target_s: number; implicit?: boolean; video_id?: Id }
export type ShotStatus = 'planned' | 'needs_review' | 'locked'
export interface Shot extends EntityBase {
  storyboard_id: Id
  rank: Rank
  kind: 'shot' | 'end_card'
  scene_id?: Id
  duration_s: number
  camera: Camera
  status: ShotStatus
  pick?: Pick
  hands_off?: CrewId[]
  prose?: Prose
  action?: string
  direction?: string
  /** Ref ids the shot's text mentions. */
  refs?: Id[]
  text_problem?: TextProblem
  last_writer?: ActorRef
  direction_condensed?: { text: string; from_hash: Sha256; job_id: Id }
}
export interface Beat extends EntityBase {
  shot_id: Id
  rank: Rank
  at_s: number
  kind: BeatKind
  speaker?: string
  parenthetical?: string
  moment_id?: Id
  hands_off?: CrewId[]
  prose?: Prose
  text?: string
  last_writer?: ActorRef
}
export interface FrameEdit { op: string; params?: Record<string, unknown> }
export interface Frame extends EntityBase {
  shot_id?: Id
  sketch_id?: Id
  size_id?: Id
  version: number
  parent_id?: Id
  kind: 'generated' | 'mock' | 'edited'
  asset: Sha256
  job_id?: Id
  crew: CrewId
  model?: string
  provider?: MadeBy
  edits?: FrameEdit[]
  cropped_to?: { from: Aspect; to: Aspect }
}
export interface TakeSegment { source_take: Id; in_s: number; out_s: number; job_id?: Id }
export interface Take extends EntityBase {
  shot_id: Id
  version: number
  parent_id?: Id
  asset: Sha256
  job_id: Id
  crew: CrewId
  kind: 'generated' | 'mock'
  model: string
  provider: MadeBy
  duration_s: number
  segments: TakeSegment[]
}
export interface EdlItem { rank: Rank; kind: 'shot' | 'bridge'; shot_id?: Id; pick?: Pick; in_s?: number; out_s?: number }
export interface Video extends EntityBase {
  title: string
  ratio: Ratio
  target_s?: number
  pick?: Pick
  edl: Record<Id, EdlItem>
}
export interface Render extends EntityBase { video_id: Id; version: number; parent_id?: Id; asset: Sha256; job_id: Id }
export interface Review extends EntityBase {
  target: { kind: 'frame' | 'take' | 'render' | 'ref' | 'video'; id: Id }
  video_id?: Id
  render_id?: Id
  shot_id?: Id
  at_s?: number
  window?: NoteWindow
  region?: Region
  still?: Sha256
  chips?: string[]
  by: ActorRef
  state: 'open' | 'resolved'
  resolved_by_job?: Id
  fixed_in_render?: Id
  prose?: Prose
  text?: string
  last_writer?: ActorRef
  created_at: string
}
export interface Link extends EntityBase { from: LinkEndpoint; to: LinkEndpoint; role: LinkRole; label?: string }
/** A solid reference key: one character or object. */
export interface KeyEntry extends EntityBase { key: Key; role: RefRole; library?: LibraryCopy }
/** A named reference: key_variant and its role's payload. */
export interface NamedRef extends EntityBase {
  key: Key
  variant: Variant
  role: RefRole
  label?: string
  asset?: Sha256
  swatches?: { hex: string; name?: string }[]
  font?: { family: string; use?: string; file?: Sha256 }
  rule?: { kind: 'do' | 'dont' | 'tone'; text: string; page?: number }
  document_id?: Id
  /** The canvas node the name sits on. */
  node?: SceneId
  library?: LibraryCopy
  named_at?: string
}
export interface DocDocument extends EntityBase {
  title: string
  file_name: string
  asset: Sha256
  pages: number
  excerpt?: string
  read: { state: 'unread' | 'reading' | 'read' | 'failed'; pages_read: number }
}
export interface FormatSet extends EntityBase {
  /** picture: a canvas picture node (its id is the node's). asset, w, h: the master's picture when the set was made. */
  master: { kind: 'frame' | 'ref' | 'render' | 'video' | 'picture'; id: string; asset?: Sha256; w?: number; h?: number }
  pack: { pack_id: string; pack_version: string; client_id?: string }
  plan?: { kind: 'pack' | 'plan'; id: string; lengths_s?: number[] }
  protect?: { boxes?: ProtectBox[]; takes?: Record<Id, ProtectBox[]>; keep_middle?: boolean }
  copy?: { line?: string; legal?: string; supers?: string[] }
}
export interface Size extends EntityBase {
  set_id: Id
  rank: Rank
  format: FormatRef
  aspect: Aspect
  delivery: DeliveryPx
  bleed_mm?: number
  safe_area?: SafeArea
  method: SizeMethod
  media: 'image' | 'video'
  asset?: Sha256
  job_id?: Id
  /** Absent: not made yet. */
  status?: 'making' | 'ready' | 'look' | 'stale'
  locked?: boolean
  /** The master's asset it was made from. */
  from_asset?: Sha256
  /** The part of the master it shows, in the master's pixels. */
  crop?: PxBox
  crop_by?: 'rule' | 'person'
  layers?: Partial<Record<TypeLayerKind, TypeLayerOverride>>
  length_s?: number
  edl?: SizeEdlWindow[]
  checks?: Partial<Record<FormatCheckCode, FormatCheck>>
  /** The picture before its type layers: Edit type draws on it again for free; Export at full size upscales it. */
  plate?: Sha256
  /** The delivery-size file Export at full size made, for the asset it was made for (from). */
  full?: { asset?: Sha256; job_id?: Id; from: Sha256; scale?: 4 | 8 }
}
export interface Check extends EntityBase {
  target: Target
  crew: 'jude'
  job_id?: Id
  result: 'pass' | 'flag'
  reason_code: string
  rule_ref?: Id
  note: string
  ignored?: { by: PersonRef; at: string }
}
export interface AskAnswer { option_id?: string; text?: string; by: PersonRef; at: string }
export interface Ask extends EntityBase {
  question: Question
  node: LinkEndpoint
  job_id?: Id
  crew: CrewId
  state: 'open' | 'answered' | 'withdrawn'
  answers: AskAnswer[]
}
export interface Suggestion extends EntityBase {
  target: { kind: 'scene' | 'shot' | 'beat'; id: Id }
  crew: 'skye'
  job_id: Id
  for: PersonRef
  base_hash: Sha256
  proposed: {
    prose: Prose
    text: string
    /** A shot's new length, applied on Keep in the same step. */
    duration_s?: number
    /** Beats Keep adds to the shot in the same step. */
    new_beats?: { kind: BeatKind; at_s: number; speaker?: string; moment_id?: Id; prose: Prose }[]
  }
  note: string
  state: 'open' | 'kept' | 'dropped' | 'stale'
  decided_by?: PersonRef
}
export interface SpinIn extends EntityBase {
  source: { document_id: string; app: string; title?: string }
  plan: { kind: 'script' | 'ref' | 'document' | 'brand'; title: string; note?: string }[]
  state: 'waiting' | 'brought_in' | 'dismissed'
  decided_by?: PersonRef
}
export interface JobInputRow {
  kind: 'ref' | 'sketch' | 'text' | 'note' | 'ink' | 'document' | 'brand' | 'frame' | 'take' | 'render' | 'board' | 'group'
  ref?: Id
  link_id?: Id
  used_as: string
  included: boolean
  confirmed?: boolean
  text?: string
}
export interface DocJob extends EntityBase {
  op: Op
  state: JobState
  node: LinkEndpoint
  purpose?: string
  started_by: PersonRef
  tenant_id: TenantId
  nonce: string
  crew: CrewId
  inputs?: JobInputRow[]
  region?: Region
  text?: string
  chips?: string[]
  ask_id?: Id
  parent_ids: Id[]
  input_hashes: Sha256[]
  outputs?: Sha256[]
  director?: AgentBlock
  cost?: Cost
  error?: ContractError
  stopped_by?: PersonRef
  provider?: MadeBy
  model?: string
  remote_id?: string
  created_at: string
  updated_at?: string
}
export interface StaleMark extends EntityBase { target: Target; caused_by: Target; reason: string; marked_at?: string }
export type ExportKind = 'ad_mp4' | 'bundle_zip' | 'media_zip' | 'clan_bundle' | 'script_pdf' | 'script_fountain' | 'storyboard_pdf' | 'sizes_zip'
export interface ExportEntry extends EntityBase { kind: ExportKind; asset: Sha256; job_id?: Id; created_at: string }

export interface Project { id: Id; tenant_id: TenantId; client_id?: string; title: string; created_by: PersonRef; created_at: string }

/** Every entity map of the document, by name. */
export interface EntityMaps {
  boards: Record<Id, Board>
  sketches: Record<Id, Sketch>
  scripts: Record<Id, Script>
  scenes: Record<Id, Scene>
  storyboards: Record<Id, Storyboard>
  shots: Record<Id, Shot>
  beats: Record<Id, Beat>
  frames: Record<Id, Frame>
  videos: Record<Id, Video>
  takes: Record<Id, Take>
  renders: Record<Id, Render>
  reviews: Record<Id, Review>
  links: Record<Id, Link>
  keys: Record<Id, KeyEntry>
  refs: Record<Id, NamedRef>
  documents: Record<Id, DocDocument>
  format_sets: Record<Id, FormatSet>
  sizes: Record<Id, Size>
  checks: Record<Id, Check>
  asks: Record<Id, Ask>
  suggestions: Record<Id, Suggestion>
  spin_ins: Record<Id, SpinIn>
  jobs: Record<Id, DocJob>
  stale: Record<Id, StaleMark>
  exports: Record<Id, ExportEntry>
}
export type MapName = keyof EntityMaps
export const MAP_NAMES: readonly MapName[] = ['boards', 'sketches', 'scripts', 'scenes', 'storyboards', 'shots', 'beats', 'frames', 'videos', 'takes', 'renders', 'reviews',
  'links', 'keys', 'refs', 'documents', 'format_sets', 'sizes', 'checks', 'asks', 'suggestions', 'spin_ins', 'jobs', 'stale', 'exports']

export interface ProductionDocument extends EntityMaps {
  contract_version: ContractVersion
  app: 'production-tool'
  project: Project
  /** What the project was spun off from (os-layer §5.2). Host-written, read-only. */
  upstream?: Record<string, Record<string, unknown>>
  assets: Record<Sha256, DocAsset>
}

// ── customdata.schema.json ──────────────────────────────────────────────────

export type GenOp = 'generate' | 'view' | 'region_edit' | 'resize'

export type CustomData =
  | { kind: 'pic'; id: Id; asset: Sha256 }
  | { kind: 'drawn'; id: Id; asset: Sha256 }
  | { kind: 'note'; id: Id }
  | { kind: 'gen'; id: Id; op: GenOp; parentIds: Id[]; state: JobState; asset?: Sha256; view?: View; shape?: string; mock?: boolean }
  | { kind: 'provenance'; from: Id; to: Id }
  | { kind: 'board' | 'sketch' | 'script' | 'storyboard' | 'video' | 'link' | 'document' | 'format_set' | 'suggestion'; id: Id }

// ── relay-api.schema.json ───────────────────────────────────────────────────

/** GET /me: who the relay's identity seam says is asking; 401 when no one. */
export interface Me {
  participantId: string
  handle: string
  /** The person's display name, when Napkin Studio knows it. */
  name?: string
  /** The person's agency (the tenant's name). */
  team: string
  /** The agency's workspace: the tenant id (a UUID). */
  workspace: string
  /** The agency the person signed in under (features/os-sign-in.clan). */
  tenant: { id: string; agency: string }
  /** Where the agency's material may go (features/tenant-limits.clan). */
  allow: Allow
  /** Remaining today, per quota class, while the agency's daily quotas are on; null while off (the default). */
  quotas: { image: number; video: number; render: number } | null
  /** How many projects the agency has saved on the relay. */
  projects: number
  /** Only while flags.dogfood is on: whether this person has read the beta notice. */
  dogfood?: { consented: boolean }
}

/** One of the agency's saved projects (GET /projects, POST /clan with X-Project-Id). */
export interface SavedProject {
  id: Id
  name?: string
  savedAt: string
  bytes: number
  /** SHA-256 (hex) of the saved .clan: If-Match on the next save. */
  etag: string
}
export interface ProjectList { projects: SavedProject[] }
export interface ClanSaved { project: SavedProject }
/** The canvas that goes with a saved project (elements only; pictures come back from the assets). */
export interface ProjectCanvas { elements: unknown[]; savedAt?: string }

export interface UploadRequest { sha256: Sha256; mime: Mime; bytes: number }
export interface UploadResponse {
  exists: boolean
  putUrl?: string
  /** Headers the PUT carries besides Content-Type, as given (x-amz-checksum-sha256: features/tenant-limits.clan). */
  putHeaders?: Record<string, string>
  url: string
}

/** An image input: a named ref (name = key_variant) or an unnamed canvas node. The relay makes the wire tags. */
/** A job's input picture. `optional`: offered, not asked for (owner 2026-10-15, features/canvas-nodes.clan):
 *  in the node's scope but not named by the shot's words or linked into the shot, so the director sends it
 *  only as an addition with why (director output `added`). Absent: required. */
export interface JobInputRef { id: Id; name?: RefName; role: RefRole; label?: string; kind: 'drawing' | 'picture' | 'generated'; asset: AssetRef; optional?: true }

/** A reference the director sent beyond those asked for (director.schema.json `added`): its wire tag and why. */
export interface DirectorAddition { name: string; why: string }

export type Strength = 'adhere' | 'flex' | 'reimagine'

/** A shot as a job sends it (relay-api JobShot). */
export interface JobShot {
  id: Id
  kind: 'shot' | 'end_card'
  duration_s: number
  camera: Camera
  action: string
  direction?: string
  direction_condensed?: string
  refs: Subject[]
  beats?: PlannedBeat[]
}

export interface JobContext { kind: 'note' | 'document' | 'brand_rule' | 'palette' | 'typography'; title?: string; text: string }

export interface JobInput {
  text?: string
  chips?: string[]
  refs?: JobInputRef[]
  view?: View
  script?: string
  targetS?: number
  shot?: JobShot
  shots?: JobShot[]
  previousFrame?: AssetRef
  anchorFrame?: AssetRef
  image?: AssetRef
  region?: Region
  mask?: AssetRef
  video?: AssetRef
  atS?: number
  feel?: { strength?: Strength }
  ratio?: Ratio
  aspect?: Aspect
  delivery?: DeliveryPx
  safeArea?: SafeArea
  context?: JobContext[]
  /** stitch: the takes in cut order. inS/outS: the edl item's in and out points; transition: the join into this
   *  clip (features/connected-video.clan; absent: a cut). */
  clips?: { asset: AssetRef; trimS?: number; inS?: number; outS?: number; transition?: StitchTransition; endCard?: boolean }[]
  /** write: what Skye drafts or rewrites (features/script-editor.clan). */
  write?: WriteInput
  /** Change: the new answer to the parent job's question. */
  answer?: JobAnswer
  /** upscale: how many times each side grows (features/image-editor.clan; 8 for Export at full size). */
  scale?: 2 | 4 | 8
  /** upscale for delivery (Export at full size, with delivery): the size's type layers, drawn by the relay. */
  layers?: TypeLayer[]
  /** resize: one size of a format set (features/campaign-formats.clan). */
  resize?: ResizeInput
  /** cutdown: a length or shape of the film from the same takes (phases 5 and 6). */
  cutdown?: CutdownInput
}

export interface ResizeInput {
  method: SizeMethod
  masterSize: Aspect
  protect?: ProtectBox[]
  crop?: PxBox
  previewMaxPx?: number
  background?: string
  /** layout: where the picture sits on the colour field, 0-1 of the size. */
  panel?: Region
  layers?: TypeLayer[]
  /** regenerate: what the picture is; a sketch (a scamp) is drawn as a finished picture. */
  source?: 'picture' | 'sketch'
}
export interface CutdownInput {
  lengthS: number
  clips: { asset: AssetRef; inS: number; outS: number; takeSize?: Aspect; crop?: PxBox; outpaint?: boolean; endCard?: boolean }[]
  endCard?: boolean
  fadeOutS?: number
  layers?: TypeLayer[]
}

export type WriteIntent = 'draft' | 'tighten' | 'fit_seconds' | 'add_beat' | 'write_vo' | 'rephrase' | 'cut_name'
export interface WriteTarget { kind: 'scene' | 'shot' | 'beat'; id: Id }
export interface WriteLine { type: 'action' | 'character' | 'parenthetical' | 'dialogue' | 'direction'; text: string }
export interface WriteInput {
  intent: WriteIntent
  target: WriteTarget
  base_hash: Sha256
  lines: WriteLine[]
  selection?: { from: number; to: number; text: string }
  seconds?: number
  /** cut_name: the @name to take out. */
  name?: string
  /** A person pressed it on a target Skye was asked to leave alone. */
  explicit?: boolean
  context: { script_title?: string; target_s?: number; scene_heading?: string; neighbours: string; refs: { name: string; role: RefRole; label?: string }[] }
}
/** One of Skye's drafts: lands as a suggestion; nothing changes until Keep. */
export interface Write {
  target: WriteTarget
  base_hash: Sha256
  lines: WriteLine[]
  note: string
  reasoning?: string
  duration_s?: number
  new_beats?: { kind: BeatKind; at_s: number; speaker?: string; text: string }[]
}

export interface JobRequest {
  contractVersion: ContractVersion
  jobId: Id
  op: Op
  projectId: Id
  nonce: string
  purpose?: string
  node: LinkEndpoint
  parentIds: Id[]
  input: JobInput
  /** The model picked when regenerating; absent means the routing's default. */
  modelChoice?: ModelChoice
}

export interface ModelChoice {
  provider: Provider
  model: string
}

export interface JobAnswer {
  contractVersion: ContractVersion
  questionId: Id
  optionId?: string
  text?: string
}

export interface Job {
  contractVersion: ContractVersion
  jobId: Id
  participantId: string
  tenantId: TenantId
  projectId: Id
  startedBy: PersonRef
  crew: CrewId
  node: LinkEndpoint
  nonce: string
  purpose?: string
  op: Op
  quotaClass: QuotaClass
  state: JobState
  queuePosition?: number
  nextPollS?: number
  provider?: Provider
  model?: string
  fallbackFrom?: ModelChoice
  fallbackReason?: string
  requestId?: string
  inputHashes: Sha256[]
  director?: AgentBlock
  question?: Question
  answeredBy?: PersonRef
  answer?: Answer
  shots?: PlannedShot[]
  /** write only: Skye's drafts. */
  writes?: Write[]
  outputs?: Output[]
  kind?: 'generated' | 'mock'
  error?: ContractError
  cost: Cost
  /** clip_patch only: what was patched and how (relay-api Job.patch). */
  patch?: JobPatch
  /** resize only: how the size was made. */
  resize?: { method: SizeMethod; crop: PxBox; previewPx: DeliveryPx; layers?: number; plate?: Output }
  /** A clip_patch answered "Remake the whole clip": the client makes this op through the send tray. */
  handoff?: { op: 'clip' }
  createdAt: string
  updatedAt: string
}

/** relay-api Job.patch (features/clip-moment-edit.clan). */
export interface JobPatch {
  send?: 'range' | 'cut' | 'frames'
  window: NoteWindow
  cut: { from_s: number; to_s: number }
  range?: { start_s: number; end_s: number }
  keyframe: 'none' | 'still' | 'edited'
  model: string
  exact?: boolean
  seams?: { at_s: number; score: number; ok: boolean }[]
  rawOutput?: Output
}

export interface AnswerConflict { error: ContractError; answeredBy: PersonRef; answer: Answer }

export interface LogEntry {
  level: 'error' | 'report' | 'info'
  message: string
  jobId?: Id
  node?: LinkEndpoint
  browser?: string
  canvasElements?: number
  stack?: string
}

export interface ErrorResponse { error: ContractError }

export type LibraryKind = 'key' | 'brand_kit' | 'format_pack'
export interface LibraryRef { variant: Variant; asset: AssetRef }
export interface LibraryPublish { kind: LibraryKind; role?: RefRole; baseVer: number; refs?: LibraryRef[]; payload?: Record<string, unknown> }
export interface LibraryEntry {
  workspace: string
  shelf: string
  kind: LibraryKind
  key: Key
  ver: number
  role?: RefRole
  by: string
  at: string
  refs?: LibraryRef[]
  payload?: Record<string, unknown>
}
export interface LibraryIndex {
  workspace: string
  shelf: string
  keys: { key: Key; kind: LibraryKind; ver: number; role?: RefRole; by: string; at: string; variants?: Variant[]; cover?: AssetRef }[]
}
/** The shelf for what no client owns. */
export const AGENCY_SHELF = 'agency'

export const TERMINAL_STATES: readonly JobState[] = ['completed', 'failed', 'cancelled']
