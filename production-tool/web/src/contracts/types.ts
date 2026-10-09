// TypeScript mirror of production-tool/contracts/*.schema.json (contract v2,
// 2026-10-07: keys and variants replace the character views). Hand-written, field for field; `src/contracts/contracts.test.ts`
// validates the examples and a store round trip against the schemas with ajv,
// so a drift between these types and the schemas shows up as a failing test.
// Do not change a type here without the contract changing first.

// ── common.schema.json ──────────────────────────────────────────────────────

export type ContractVersion = '2'
/** `sha256:<64 hex>` */
export type Sha256 = string
/** Prefixed ULID: job_…, ref_…, node_…, shot_…, frame_…, take_…, rev_…, pin_… */
export type Id = string
/** A solid key: one character or object. `^[a-z][a-z0-9]{1,23}$` (no underscore). */
export type Key = string
/** Free text after the key: `^[a-z0-9][a-z0-9-]{0,31}$` (laughing, front, red-coat). */
export type Variant = string
/** key_variant, as written after @ (maya_laughing). */
export type RefName = string
/** What a script or shot names: a bare key (the whole character) or key_variant (one look). */
export type Subject = string
export const KEY_RE = /^[a-z][a-z0-9]{1,23}$/
export const VARIANT_RE = /^[a-z0-9][a-z0-9-]{0,31}$/

export const REF_ROLES = ['character', 'shape', 'texture', 'colour', 'feel', 'pose', 'prop', 'other'] as const
export type RefRole = (typeof REF_ROLES)[number]

/** op view: the turnaround view to make; also the variant its result is named by. */
export const VIEWS = ['front', 'three-quarter', 'side', 'back'] as const
export type View = (typeof VIEWS)[number]

export interface Region { x: number; y: number; w: number; h: number }

export const PROVIDERS = ['mock', 'runway', 'fal', 'heygen'] as const
export type Provider = (typeof PROVIDERS)[number]

export const OPS = ['generate', 'view', 'shot_list', 'frame', 'region_edit', 'clip', 'clip_edit', 'stitch'] as const
export type Op = (typeof OPS)[number]

export type QuotaClass = 'image' | 'video' | 'render' | 'text'

export const JOB_STATES = ['queued', 'submitting', 'submitted', 'fetching', 'validating', 'completed', 'failed', 'cancelled', 'uncertain'] as const
export type JobState = (typeof JOB_STATES)[number]

export interface Cost {
  estimate?: number
  reserved?: number
  confirmed?: number
  currency: 'USD'
  unknown: boolean
}

export type InputMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'video/mp4'

export interface AssetRef { sha256: Sha256; url: string; mime: InputMime }

export interface Output {
  sha256: Sha256
  url: string
  mime: string
  w?: number
  h?: number
  durationS?: number
  bytes?: number
}

export type ErrorCode =
  | 'invalid_input' | 'unauthorised' | 'blocked' | 'flag_off' | 'quota_exhausted' | 'spend_stop'
  | 'queue_full' | 'capability_missing' | 'moderated' | 'provider_failed' | 'provider_unavailable'
  | 'timeout' | 'uncertain' | 'conflict' | 'internal'

export interface ContractError {
  code: ErrorCode
  message: string
  retryable: boolean
  retryAfterS?: number
  providerCode?: string
}

// ── capabilities.schema.json ────────────────────────────────────────────────

export interface OpSheet {
  model: string
  endpoint: string
  estimateUsd?: number | null
  maxS?: number
  minS?: number
  durationsS?: number[]
  regionModel?: string
  regionEndpoint?: string
  /** The model's name in the regenerate menu, and one line on what it is good for. */
  label?: string
  note?: string
  /** Vetted models a participant may pick when they regenerate (features/model-choice.clan). */
  alternates?: OpAlternate[]
}

/** One alternate model for an op: its fields replace the op's, its overrides the sheet's. */
export interface OpAlternate {
  model: string
  endpoint: string
  estimateUsd: number | null
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
}

export interface CapabilitySheet {
  contractVersion: ContractVersion
  provider: Provider
  checked: string
  ops: Partial<Record<Op, OpSheet>>
  tagSyntax: 'at_tag' | 'at_image_n' | 'picture_n' | 'figure_n' | 'image_n' | 'none'
  refs: { max: number; maxCharacter?: number; element?: boolean }
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
  /** Participants may send their own fal and HeyGen keys. Optional; absent means off. */
  ownKeys?: boolean
  /** The beta's record: notice, Beta tag, thumbs, POST /dogfood/* (features/production-tool-dogfood.clan). Optional; absent means off. */
  dogfood?: boolean
}

export interface Config {
  contractVersion: ContractVersion
  /** For the event every op routes to ['runway']: Runway is the floor of every job, and fal and
   *  HeyGen come only from own keys (features/runway-fallback.clan). The schema's deprecated
   *  fallbackOnly is no longer read. */
  routing: Partial<Record<Op, Provider[]>>
  director: { promptVersion: string; perClickModel: string; shotListModel: string }
  quotas: { image: number; video: number; render: number }
  inFlightPerParticipant: number
  jobTimeoutS: { image: number; video: number }
  /** How long a job may wait for a free slot (the relay's default when absent: 900 / 1800 s). */
  queueTimeoutS?: { image: number; video: number }
  spend: { capUsd: number; warnUsd: number }
  flags: Flags
  banner: string
  eventName: string
}

// ── director.schema.json (only the parts the UI reads) ──────────────────────

export type NeedsUser = null | { question: string; options: string[] }

export interface AgentBlock {
  model: string
  promptVersion: string
  output: Record<string, unknown>
  rationale: string
  latencyMs?: number
  /** The character cards the director was given (features/character-cards.clan). The relay's
   *  Job carries them; the document's jobs[].agent does not (jobs/runner.ts agentForDocument). */
  cards?: DirectorCard[]
}

export interface DirectorCard {
  tag: string
  sha256: Sha256
  kind: 'character' | 'object' | 'setting' | 'style' | 'other'
  card: string
}

// ── document.schema.json ────────────────────────────────────────────────────

export const COMPOSITIONS = ['wide', 'medium', 'close', 'extreme_close', 'over_shoulder', 'insert'] as const
export type Composition = (typeof COMPOSITIONS)[number]
export const CAMERA_MOVES = ['static', 'pan', 'tilt', 'push_in', 'pull_out', 'track', 'orbit', 'handheld'] as const
export type CameraMove = (typeof CAMERA_MOVES)[number]

export interface Shot {
  id: Id
  order: number
  duration_s: number
  composition: Composition
  action: string
  camera_move: CameraMove
  /** What the shot shows: bare keys for whole characters (goremon), key_variant for a look (goremon_laughing). */
  refs?: Subject[]
  dialogue?: string
  storyboard_frame?: Sha256
  selected_take?: Id
  status?: 'planned' | 'needs_review' | 'locked'
}

export interface DocAsset {
  sha256: Sha256
  kind: 'image' | 'video'
  mime: string
  bytes?: number
  w?: number
  h?: number
  duration_s?: number
  origin: 'uploaded' | 'drawn' | 'generated' | 'mock'
  job_id?: Id
  locations: string[]
  thumb?: string
}

/** A solid reference: one character or object the participant named. */
export interface KeyEntry {
  key: Key
  role: RefRole
  /** The library version this document holds; a copy, never a live link. */
  library?: { workspace: string; ver: number; by: string; at: string }
}

/** A named image: key_variant -> one asset. */
export interface NamedRef {
  id: Id
  key: Key
  variant: Variant
  asset: Sha256
  /** The canvas node the name sits on. */
  node?: Id
  named_at?: string
}

export interface ScriptRevision {
  id: Id
  parent?: Id
  created_at: string
  imported_text: string
  target_s: number
  status: 'draft' | 'approved' | 'superseded'
}

export interface Frame {
  id: Id
  shot_id: Id
  asset: Sha256
  job_id: Id
  parent?: Id
  selected: boolean
  kind: 'generated' | 'mock'
}

export interface Take {
  id: Id
  shot_id: Id
  asset: Sha256
  job_id: Id
  parent?: Id
  kind: 'generated' | 'mock'
  provider: Provider
  model?: string
  duration_s?: number
  selected: boolean
}

export interface DocJob {
  id: Id
  op: Op
  state: JobState
  provider?: Provider
  model?: string
  remote_id?: string
  parent_ids: Id[]
  input_hashes: Sha256[]
  region?: Region
  text?: string
  chips?: string[]
  outputs?: Sha256[]
  agent?: AgentBlock
  cost?: Cost
  error?: ContractError
  created_at: string
  updated_at?: string
}

export interface Target { kind: 'ref' | 'frame' | 'take' | 'shot'; id: string }

export interface Review {
  id: Id
  target: Target
  comment: string
  chips?: string[]
  region?: Region
  at_s?: number
  resolved: boolean
  resolved_by_job?: Id
  created_at: string
}

export interface StaleMark { target: Target; caused_by: Target; reason: string; marked_at?: string }

export interface ExportEntry {
  id: Id
  kind: 'ad_mp4' | 'bundle_zip'
  asset: Sha256
  job_id?: Id
  created_at: string
}

export type StageName = 'character' | 'storyboard' | 'video'

export interface ProductionDocument {
  contract_version: ContractVersion
  app: 'production-tool'
  participant: { id: string; handle: string }
  stage: { current: StageName; next_action?: string }
  assets: DocAsset[]
  keys: KeyEntry[]
  refs: NamedRef[]
  script?: { current?: Id; revisions: ScriptRevision[] }
  shots?: Shot[]
  frames?: Frame[]
  takes?: Take[]
  jobs: DocJob[]
  reviews?: Review[]
  stale?: StaleMark[]
  exports?: ExportEntry[]
}

// ── customdata.schema.json ──────────────────────────────────────────────────

export type GenOp = 'generate' | 'view' | 'region_edit'

export type CustomData =
  | { kind: 'pic'; id: Id; asset: Sha256 }
  | { kind: 'drawn'; id: Id; asset: Sha256 }
  | { kind: 'note'; id: Id }
  | { kind: 'gen'; id: Id; op: GenOp; parentIds: Id[]; state: JobState; asset?: Sha256; view?: View; mock?: boolean }
  | { kind: 'pin'; id: Id; genId: Id; region: Region; resolvedBy?: Id }
  | { kind: 'provenance'; from: Id; to: Id }

// ── relay-api.schema.json ───────────────────────────────────────────────────

/** team + handle make the workspace (features/personal-workspaces.clan); device is a random id this
 *  browser keeps, to warn when the same team and name signed in from another browser. */
export interface SessionRequest { eventCode: string; team: string; handle: string; device?: string }

export interface SessionResponse {
  token: string
  participantId: string
  handle: string
  role: 'participant' | 'organiser'
  /** The participant's own workspace (its participantId): the library and saved projects are kept in it. */
  workspace: string
  expiresAt: string
  quotas: { image: number; video: number; render: number }
  /** Only while flags.dogfood is on: whether this participant has read the beta notice. */
  dogfood?: { consented: boolean }
  /** How many projects this name has saved on the relay ("Welcome back, Maya: 3 projects"). */
  projects: number
  /** The team name as typed: with the handle it makes the workspace unique. */
  team?: string
  /** Another browser signed in with this team and name within 2 hours (probably a second person). */
  elsewhere?: { at: string }
}

/** One of the person's saved projects (GET /projects, POST /clan with X-Project-Id). */
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

export interface UploadRequest { sha256: Sha256; mime: InputMime; bytes: number }
export interface UploadResponse { exists: boolean; putUrl?: string; url: string }

/** An image input: a named ref (name = key_variant) or an unnamed canvas node. The relay makes the wire tags. */
export interface JobInputRef { id: Id; name?: RefName; role: RefRole; kind: 'drawing' | 'picture' | 'generated'; asset: AssetRef }

export type Strength = 'adhere' | 'flex' | 'reimagine'
export type Ratio = '1:1' | '4:5' | '9:16' | '16:9' | '3:1'

export interface JobInput {
  text?: string
  chips?: string[]
  refs?: JobInputRef[]
  view?: View
  script?: string
  targetS?: number
  shot?: Shot
  previousFrame?: AssetRef
  /** frame: the first storyboard frame, the setting/light/style anchor for every later frame (added 2026-10-07). */
  anchorFrame?: AssetRef
  image?: AssetRef
  region?: Region
  mask?: AssetRef
  video?: AssetRef
  atS?: number
  feel?: { strength?: Strength }
  ratio?: Ratio
  clips?: { asset: AssetRef; trimS?: number }[]
  answer?: string
}

export interface JobRequest {
  contractVersion: ContractVersion
  jobId: Id
  op: Op
  parentIds: Id[]
  input: JobInput
  /** The model picked when regenerating; absent means the routing's default. */
  modelChoice?: ModelChoice
}

export interface ModelChoice {
  provider: Provider
  model: string
}

export interface Job {
  contractVersion: ContractVersion
  jobId: Id
  participantId: string
  op: Op
  quotaClass: QuotaClass
  state: JobState
  queuePosition?: number
  nextPollS?: number
  provider?: Provider
  /** Whose key runs the job (the participant's X-Own-Keys, or the event's). */
  keySource?: 'own' | 'event'
  model?: string
  /** Where this job was meant to run (a pick, or its chain's first provider), when it ran on
   *  another provider instead: Runway, the floor, after HeyGen or fal could not make it. */
  fallbackFrom?: ModelChoice
  /** Why it left fallbackFrom, in a participant's words; says when that provider may still charge. */
  fallbackReason?: string
  requestId?: string
  inputHashes: Sha256[]
  director?: AgentBlock
  needsUser?: NeedsUser
  shots?: Shot[]
  outputs?: Output[]
  kind?: 'generated' | 'mock'
  error?: ContractError
  cost: Cost
  createdAt: string
  updatedAt: string
}

export interface LogEntry {
  level: 'error' | 'report' | 'info'
  message: string
  jobId?: Id
  stage?: StageName
  browser?: string
  canvasElements?: number
  stack?: string
}

export interface ErrorResponse { error: ContractError }

export interface LibraryRef { variant: Variant; asset: AssetRef }
export interface LibraryPublish { role: RefRole; baseVer: number; refs: LibraryRef[] }
export interface LibraryEntry { workspace: string; key: Key; ver: number; role: RefRole; by: string; at: string; refs: LibraryRef[] }
export interface LibraryIndex {
  workspace: string
  keys: { key: Key; ver: number; role: RefRole; by: string; at: string; variants: Variant[]; cover: AssetRef }[]
}

export const TERMINAL_STATES: readonly JobState[] = ['completed', 'failed', 'cancelled']

export function quotaClassOf(op: Op): QuotaClass {
  switch (op) {
    case 'clip':
    case 'clip_edit':
      return 'video'
    case 'stitch':
      return 'render'
    case 'shot_list':
      return 'text'
    default:
      return 'image'
  }
}
