// TypeScript mirror of production-tool/contracts/*.schema.json (contract v1,
// locked at D1). Hand-written, field for field; `src/contracts/contracts.test.ts`
// validates the examples and a store round trip against the schemas with ajv,
// so a drift between these types and the schemas shows up as a failing test.
// Do not change a type here without the contract changing first.

// ── common.schema.json ──────────────────────────────────────────────────────

export type ContractVersion = '1'
/** `sha256:<64 hex>` */
export type Sha256 = string
/** Prefixed ULID: job_…, ref_…, shot_…, frame_…, take_…, rev_…, combine_…, pin_… */
export type Id = string
/** `^[a-z][a-z0-9_]{2,15}$` */
export type Tag = string

export const REF_ROLES = ['character', 'shape', 'texture', 'colour', 'feel', 'pose', 'prop', 'other'] as const
export type RefRole = (typeof REF_ROLES)[number]

export const VIEWS = ['front', 'three_quarter', 'side', 'back', 'side_2'] as const
export type View = (typeof VIEWS)[number]

export interface Region { x: number; y: number; w: number; h: number }

export const PROVIDERS = ['mock', 'runway', 'fal', 'heygen'] as const
export type Provider = (typeof PROVIDERS)[number]

export const OPS = ['generate', 'combine', 'view', 'shot_list', 'frame', 'region_edit', 'clip', 'clip_edit', 'stitch'] as const
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
  | 'timeout' | 'uncertain' | 'internal'

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
}

export interface Config {
  contractVersion: ContractVersion
  routing: Partial<Record<Op, Provider[]>>
  director: { promptVersion: string; perClickModel: string; shotListModel: string }
  quotas: { image: number; video: number; render: number }
  inFlightPerParticipant: number
  jobTimeoutS: { image: number; video: number }
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
  lead_view?: View
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

export interface ViewPick { asset: Sha256; job_id: Id; picked_at?: string }

export interface CharacterRef {
  id: Id
  asset: Sha256
  tag: Tag
  role: RefRole
  label?: string
  kind: 'picture' | 'sketch'
}

export interface Combine { id: Id; sources: Id[]; text: string; job_id?: Id }

export interface Character {
  refs: CharacterRef[]
  combines?: Combine[]
  views: Partial<Record<View, ViewPick>>
  locked: boolean
  locked_at?: string
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

export interface Target { kind: 'view' | 'frame' | 'take' | 'shot'; id: string }

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
  character: Character
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

export type SketchTemplate = 'character-3x4' | 'ig-1x1' | 'ig-4x5' | 'story-9x16'

export type CustomData =
  | { kind: 'ref'; id: Id; asset: Sha256; tag: Tag; role: RefRole; badge: string }
  | { kind: 'sketch'; id: Id; template: SketchTemplate }
  | { kind: 'gen'; id: Id; op: 'generate' | 'combine' | 'view' | 'region_edit'; parentIds: Id[]; state: JobState; asset?: Sha256; view?: View; pickedAs?: View; mock?: boolean }
  | { kind: 'pin'; id: Id; genId: Id; region: Region; resolvedBy?: Id }
  | { kind: 'provenance'; from: Id; to: Id }

// ── relay-api.schema.json ───────────────────────────────────────────────────

export interface SessionRequest { eventCode: string; handle: string }

export interface SessionResponse {
  token: string
  participantId: string
  handle: string
  role: 'participant' | 'organiser'
  expiresAt: string
  quotas: { image: number; video: number; render: number }
}

export interface UploadRequest { sha256: Sha256; mime: InputMime; bytes: number }
export interface UploadResponse { exists: boolean; putUrl?: string; url: string }

export interface JobInputRef { id: Id; tag: Tag; role: RefRole; asset: AssetRef }

export type Strength = 'adhere' | 'flex' | 'reimagine'
export type Ratio = '1:1' | '4:5' | '9:16' | '16:9' | '3:1'

export interface JobInput {
  text?: string
  chips?: string[]
  sketch?: AssetRef
  refs?: JobInputRef[]
  character?: { front: AssetRef } & Partial<Record<Exclude<View, 'front'>, AssetRef>>
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
