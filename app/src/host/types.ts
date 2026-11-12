// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The contract between the shell and whatever is hosting it.
//
// Every call the UI makes into the host goes through `Host`; nothing in
// `src/` imports `@tauri-apps/api` directly. The desktop implementation maps
// these onto Tauri commands and events; a web build maps the same names onto
// HTTP and a server-sent event stream, and no component changes.

/** App metadata surfaced to the shell (launcher cards, "running an app" chrome). */
export interface AppMeta {
  name: string
  app_id: string
  version: string
  icon?: string | null
}

export interface LineageInfo {
  parent_id: string
  parent_uri: string
  parent_sha256?: string
  delta: string
}

export interface ManifestInfo {
  title: string
  id: string
  version: string
  created_at: string
  updated_at: string
  document_type?: string
  sha256: string
  file_count: number
  lineage?: LineageInfo
  app?: AppMeta
  /** Who the document is for (`manifest.client`), when it has a client. */
  client?: ClientRef
}

export interface OpenResult {
  /** The document's id in its store — a filesystem path on the desktop. */
  path: string
  manifest: ManifestInfo
  validation: string
  has_human_view: boolean
  render_model: 'authored' | 'legacy'
  is_template: boolean
  trusted: boolean
}

/** A template app installed in the local library, listed on the launcher. */
export interface InstalledApp {
  app_id: string
  name: string
  version: string
  path: string
  icon?: string | null
  /** Its card on the OS home (`app.home` in its manifest), when it declares one. */
  home?: AppHome | null
}

/** An app's card on the OS home, in the app's own words (clan-sdk `AppHome`). */
export interface AppHome {
  /** The app's one colour, `#rrggbb`. */
  colour?: string
  /** The card's title, verb first. */
  job?: string
  /** One sentence: the tooltip, and what a screen reader hears. */
  line?: string
  /** The button's words. */
  start?: string
  /** The app's agents, by id (older apps list crew keys); the shell draws each as its role (shell/agents/engine.ts). */
  crew?: string[]
  /** What one document is called, and many. */
  noun?: string[]
  /** A new document's name until it has its own. */
  untitled?: string
  /** The app's own name after "Napkin Studio" in the OS bar: "Research". */
  brand?: string
  /** The CSS font-family that name is set in, when the app has its own face. */
  brand_font?: string
  /** A Google Fonts stylesheet for that face, when the OS does not carry it. */
  brand_font_url?: string
}

/**
 * An installed app that will take the open document as a spin-off source —
 * what "Continue in…" offers. `map` is the dotted key the document's data will
 * be grafted under, when the target app declares one.
 */
export interface SpinoffTarget {
  app_id: string
  name: string
  version: string
  icon?: string | null
  map?: string | null
}

export interface RecentDoc {
  title: string
  path: string
  app_id?: string | null
  updated_at: string
  /** Worked out from its decisions; absent when they could not be read. */
  state?: RecentState | null
}

export interface RecentState {
  /** Things a person must check before the lock, one per place (the document’s own "Needs you"). */
  needs_you: number
  locked: boolean
  /** A Brief Maker brief's gate, in short (features/brief-gate.clan). Absent for any other document. */
  gate?: GateSummary
}

/** The gate of one brief, as the library listing carries it. */
export interface GateSummary {
  /** The host holds the lock list to the gate (`NAPKIN_BRIEF_GATE=on`). */
  enforced: boolean
  passed: boolean
  signed: boolean
  confirmed: boolean
  changed_since_lock: boolean
  /** Territories may open on this brief. */
  open: boolean
}

/** One of the gate's six items (`GET /gate`). */
export interface GateItem {
  id: 'proposition' | 'insight' | 'objective' | 'feel_or_do' | 'famous' | 'baseline'
  label: string
  state: 'pass' | 'missing'
  /** The brief's own words the verdict rests on. */
  evidence?: string
  /** Why it is missing. */
  why?: string
}

export interface GateSigner { role: string; person: string; signed: boolean }

/** `GET /gate`: the Brief gate of the open brief. */
/** The client's own link to the locked brief (`POST /d/{doc}/client-link`). */
export interface ClientLinkMade {
  id: string
  /** `/c/<token>`: the page the client opens, on this server. Shown once. */
  path: string
  expires: string
  version: string
  client: { name: string; email: string }
}

export interface ClientLinkRow {
  id: string
  /** `open`, `answered`, `withdrawn`, `expired` or `superseded`: what the host reads off the chain. */
  state: string
  answer: string | null
  version: string
  client: { name: string; email: string }
  expires: string
  made: string
}

/** One reviewer in a round, as the agency sees them. */
export interface RoundReviewer {
  id: string
  name: string
  email: string
  role: 'approver' | 'reviewer'
  /** `open`, `answered`, `withdrawn`, `expired` or `superseded`. */
  state: string
  answer: string | null
  answered: string | null
  /** Only the approver's answer is the client's decision. */
  counts: boolean
}

/** A reviewer's comment, with the flags two fixed rules gave it (`split`, `same spot`). */
export interface RoundComment {
  id: string
  link: string
  piece: number
  pin: { x?: number; y?: number; t_ms?: number } | null
  tag: string
  text: string
  at: string
  by: { name: string; email: string }
  role: 'approver' | 'reviewer'
  flags: string[]
}

export interface RoundPiece { n: number; label: string; kind: string; ai: string; approved_by: string[]; changes_by: string[]; split: boolean }

/** `GET /d/{doc}/client-review/round`: the round last sent for the locked version, merged. */
export interface ClientRoundView {
  review: string
  round: number
  /** How many rounds the job's route gives, when it says. */
  rounds_in_scope: number | null
  version: string
  /** False when the document has moved on since the round was sent. */
  current: boolean
  code: boolean
  pieces: RoundPiece[]
  reviewers: RoundReviewer[]
  comments: RoundComment[]
  approver_answer: string | null
  /** The rounds sent before this one, newest first: who was asked and where each stood. */
  earlier_rounds?: EarlierRound[]
}

export interface EarlierRound {
  review: string
  round: number
  sent: string
  reviewers: { id: string; name: string; email: string; role: 'approver' | 'reviewer'; state: string; answer: string | null; comments: number }[]
}

/** What `POST /d/{doc}/client-link/round` returns: one link a reviewer, shown once. */
export interface ClientRoundMade {
  review: string
  round: number
  expires: string
  links: { id: string; name: string; email: string; role: 'approver' | 'reviewer'; path: string }[]
}

export interface GateView {
  enforced: boolean
  items: GateItem[]
  missing: number
  passed: boolean
  signers: GateSigner[]
  planner_signed: boolean
  signed: boolean
  confirmed: boolean
  /** Who gave the confirmation, name and address in full: for the agency only. */
  confirmed_by?: { name?: string; email?: string; channel?: string }
  changed_since_lock: boolean
  open: boolean
  waiting_on: string[]
}

/** One approved version of a brief, as `GET /versions` lists it (newest first). */
export interface VersionRow {
  /** v1 is the first approve. */
  n: number
  decision: string
  /** Who signed it. */
  signer: string
  at: string
  reason: string
  /** The lock that holds now. */
  locked: boolean
  /** Its words can be shown and restored. */
  readable: boolean
}

/** The newest write to the draft that kept its inverse. */
export interface LastEdit {
  decision: string
  person: string
  keys: string[]
  /** What each key held before, null when it held nothing. */
  before: Record<string, unknown>
}

export interface VersionsView {
  versions: VersionRow[]
  draft: {
    changed: boolean
    restored_from: number | null
    edited_by: string | null
    at: string | null
    last_edit: LastEdit | null
  }
}

/** `GET /version?n=`: the brief's parts as they stood at that version, or now (`draft`). */
export interface VersionParts {
  n: number | 'draft'
  parts: Record<string, unknown>
}

// ── Clients and the library listing (`napkin_host::{clients, listing}`) ──────

/** Who a document is for: the registry's id, and the name it has now. */
export interface ClientRef {
  /** `cli_` and eight lowercase hex digits. */
  id: string
  name: string
}

/** One client of the studio, as the registry holds it. */
export interface ClientRecord {
  id: string
  name: string
  /** One to three characters for the circle. */
  initials: string
  material: ClientMaterial
  /** Who opened it (`human:name@agency`): informational, never a permission. */
  owner: string
  created_at: string
  /** When it was archived; absent while it is live. */
  archived_at?: string | null
}

export type ClientMaterial = 'pearl' | 'ceramic' | 'stone' | 'graphite'

/** What a person may change on a client. */
export interface ClientPatch {
  name?: string
  initials?: string
  material?: ClientMaterial
}

/** A free-text client name the documents carry, offered to `clients.adopt`. */
export interface LegacyName {
  name: string
  /** How many documents carry it. */
  documents: number
}

/** What `clients.adopt` did. */
export interface Adopted {
  created: ClientRecord[]
  linked: number
}

/** A tool running on a document, as the landing says it. */
export interface RunInfo {
  state: 'idle' | 'working' | 'waiting' | 'failed' | 'done'
  label: string
  /** The stage it is at (`research`, `Layout`), when it says: what the ring shows. */
  stage?: string
  since?: string
  /** Steps done and steps in all, when the job says. */
  progress?: [number, number]
}

/** One piece of work in the library, with who it is for. */
export interface LibraryItem {
  path: string
  app_id: string | null
  title: string
  updated_at: string
  client: ClientRef | null
  /** The job it is filed under (`J001`), when it is. Absent on a document with no job. */
  job?: string
  state?: RecentState | null
  run: RunInfo | null
  /** Who last wrote it: the signed-in account's username (`name@agency`). Absent from an older host. */
  last_editor?: string
  /** Middleware jobs on it the host has not seen finish: the shell polls each (`settleJob`). */
  jobs?: string[]
}

/** One thing a person is asked to do next on a job (napkin-host `jobindex::Need`). */
export interface JobNeed {
  /** Stable, `{job}:{stage}:{role}:{kind}`. Absent from an older host. */
  id?: string
  /** A task (`gate`, `approval`, `approval-chase`) or a notice (`brief-changed`, `client-change`, `deadline`, `timesheet`). Absent from an older host. */
  kind?: 'gate' | 'approval' | 'approval-chase' | 'brief-changed' | 'client-change' | 'deadline' | 'timesheet' | 'judge-return' | 'judge-review' | 'judge-return' | 'judge-review'
  stage?: string
  /** An approval: whole days past the step's due date, 0 until the day after; null on a gate need. */
  days_late?: number | null
  job: string
  client: string
  client_id: string
  /** One line on what is waiting. */
  text: string
  /** The next action, on its button. */
  action: string
  /** The document the action opens. */
  path: string
  /** The need's own deadline (`YYYY-MM-DD`): what the list is ordered by. */
  due: string | null
  /** Where `due` came from: the approval route's stage deadline, the job's, or a day's own reminder. */
  due_source?: 'stage' | 'job' | 'day'
  /** Due within 48 hours, or past. */
  urgent?: boolean
  /** A notice may be marked done; a task leaves when the work is done. */
  can_done?: boolean
}

/** The soonest deadline on the person's own jobs: what an empty Needs you names. */
export interface NextDeadline { job: string; client: string; client_id: string; due: string }

/** What `GET /needs` answers: the person's items, and the next deadline (null: none set; undefined: an older host). */
export interface NeedsAnswer { items: JobNeed[]; next_deadline?: NextDeadline | null }

/** One stage's approval: who approves it and by when (napkin-host `jobs::RouteStep`). */
export interface RouteStep {
  stage: string
  party: 'agency' | 'client'
  role?: string | null
  /** An agency step: a sign-in name, `user@agency`. A client step: a name. */
  approver: string
  /** A client step: the approver's email. */
  contact?: string | null
  /** `YYYY-MM-DD`. */
  due: string
  /** A client step: the rounds of changes the client may ask for. */
  rounds?: number | null
}

/** A route step as the documents' decisions have it (napkin-host `jobindex::RouteStepState`). */
export interface RouteStepState {
  stage: string
  label: string
  party: 'agency' | 'client'
  role: string | null
  approver: string
  contact: string | null
  rounds: number | null
  due: string
  state: 'not_started' | 'waiting' | 'approved'
  /** Read from the approving decision, never typed in. */
  approved_by: string | null
  approved_at: string | null
  version: string | null
  document: string | null
  /** The waiting step only. */
  held_since: string | null
  days_held: number | null
  days_late: number | null
}

/** Who a job waits on and for how long: a fact about one job. */
export interface Holder {
  party: 'agency' | 'client'
  person: string
  role: string | null
  stage: string
  since: string
  days: number
  due: string
  days_late: number
}

/** One job as the index has it (`GET /jobs`, `GET /jobs/{number}`). */
export interface JobEntry {
  number: string
  title: string
  client: ClientRef
  owner: string
  opened_on: string
  due: string | null
  /** Sent to the Money roles only: absent for every other role. */
  budget_hours?: number | null
  stage: { id: string; step: number; label: string }
  status: string
  waiting_on: 'agency' | 'client'
  days_waiting_on_client: number | null
  at_risk: boolean
  documents: JobDocument[]
  route: RouteStepState[]
  holder: Holder | null
  /** The latest Judge score of each piece of work in the job. Absent from an older host. */
  scores?: PieceScore[]
}

/** A document filed under a job. `version` and `changed_since_lock` are a gated brief's: its newest signed version, and whether the draft has moved on. */
export interface JobDocument {
  path: string
  title: string
  app_id: string | null
  needs_you: number
  locked: boolean
  version: number | null
  changed_since_lock: boolean
}

/** What this person may do with jobs; the server refuses the write in any case. */
export interface JobRights { manage: boolean; budget: boolean }

/** One job page's answer (`GET /jobs/{number}`): the job as this person may see it, what it asks of them, and what they may do. */
export interface JobView { job: JobEntry; needs: JobNeed[]; can: JobRights }

/** What a person may change on a job (`PATCH /jobs/{number}`); `due: null` clears the deadline. */
export interface JobPatch { title?: string; owner?: string; due?: string | null; budget_hours?: number }

/** A job named on a dashboard tile. */
export interface JobLine { number: string; client: string; client_id: string; line: string }

/** The six tiles of the agency dashboard (`GET /dashboard`). Judge scores and results hold no numbers in Phase 1. */
export interface DashboardView {
  live_jobs: number
  by_stage: { id: string; label: string; count: number; jobs: JobLine[] }[]
  at_risk: JobLine[]
  hours: { budget: number; confirmed: number | null; jobs: JobLine[] }
  /** `line` is the whole days the client has waited. */
  waiting_on_client: JobLine[]
  /** Judge's tile (features/judge.clan): counts of pieces and jobs, never of people. Null until a piece is scored. */
  scores: ScoreTile | null
  results: null
}

/** One piece of work's latest Judge score as the job index holds it: numbers, ids and codes, no person. */
export interface PieceScore {
  doc: string
  title: string
  piece: string
  kind: 'script' | 'idea_route' | 'visual_brief' | string
  score: string
  at: string
  total: number
  idea: number
  craft: number
  effect: number
  advised_route: 'team' | 'cd_brave' | 'cd'
  /** Where it goes now: the creative director's overrule, else Judge's advice. */
  route: 'team' | 'cd_brave' | 'cd'
  brave: boolean
  trust: 'none' | 'shadow' | 'earned'
  overruled: boolean
  decided: 'kept' | 'returned' | null
  /** Still the version that was scored. */
  current: boolean
}

export interface ScoreTile {
  scored: number
  average: number
  under_24: number
  at_27: number
  brave: number
  overruled: number
  /** How many more decided pieces the set needs before trust can be earned. */
  awaiting_set: number
  jobs: { number: string; client: string; client_id: string; scored: number; average: number; under_24: number; at_27: number; brave: number; overruled: number }[]
}

/** One test of a score, as the card shows it. */
export interface JudgeTest {
  id: string
  dim: 'idea' | 'craft' | 'effect'
  method: 'code' | 'llm' | 'jev'
  value: 'pass' | 'fail'
  evidence: string
  reason_code: string
  question?: string
}

/** The score card of one piece of work (`GET /judge`). */
export interface JudgeCardView {
  ok: true
  kind: 'script' | 'idea_route' | 'visual_brief'
  piece: string | null
  pieces: string[]
  can_score: boolean
  why_not: string | null
  setup: { backend: string | null; configured: boolean; price_eur: number | null; trust: 'none' | 'shadow' | 'earned'; not_trusted: string; calibration: string; rubric_version: string }
  score: null | {
    id: string; at: string; version: string
    /** The work is still the version that was scored. */
    current: boolean
    /** The brief moved on since. */
    out_of_date: boolean
    total: number
    sub: { idea: number; craft: number; effect: number }
    /** Failed first. */
    tests: JudgeTest[]
    advised_route: 'team' | 'cd_brave' | 'cd'
    route: 'team' | 'cd_brave' | 'cd'
    brave: boolean
    route_line: string
    trust: 'none' | 'shadow' | 'earned'
    judge_version: string
    overruled: null | { route: 'team' | 'cd'; at: string; reason: string }
    decided: 'kept' | 'returned' | null
  }
  older: { id: string; at: string; total: number; version: string; route: string }[]
  can_overrule: boolean
  creative_director_named: boolean
}

export interface LibraryListing {
  /** Newest first, uncapped, after the filter. */
  items: LibraryItem[]
  /** Documents with no client, whatever the filter. */
  clients_unassigned: number
  /** Set when the client registry could not be read; the names shown are then the documents' own. */
  registry_error?: string
}

export interface LibraryFilter {
  /** A client id. */
  client?: string
  /** An app id. */
  app?: string
}

/** The client registry, through the host. */
export interface ClientsApi {
  /** Live clients in the order made; archived ones too with `includeArchived`. */
  list(includeArchived?: boolean): Promise<ClientRecord[]>
  /** Open a client. A name already in use is refused with the host's words. */
  create(name: string, material?: ClientMaterial): Promise<ClientRecord>
  update(id: string, patch: ClientPatch): Promise<ClientRecord>
  archive(id: string): Promise<ClientRecord>
  restore(id: string): Promise<ClientRecord>
  /** Free-text client names in the documents that no client has yet. */
  legacy(): Promise<LegacyName[]>
  /** Turn chosen free-text names into clients and link the documents that name them. */
  adopt(names: string[]): Promise<Adopted>
}

// ── The decision view (`napkin_host::ops::decisions`) ─────────────────────────

/** One point of evidence, and the ids it rests on. */
export interface ReasonPoint {
  point: string
  cites?: string[]
}

/** A decision's structured reasoning (OS-layer contract §3). */
export interface Reasoning {
  decided: string
  because: ReasonPoint[]
  rejected: { option: string; why: string }[]
  only_option?: string
  certainty: { level: 'high' | 'medium' | 'low' | string; why: string }
  would_change_if: string
  attention?: string
}

/** A decision as the chain holds it. Unknown fields ride along. */
export interface Decision {
  id?: string
  kind?: string
  agent: string
  actor?: string
  handler?: string
  backend?: string
  action: string
  targets?: string[]
  cites?: string[]
  superseded_by?: string
  polarity?: string
  reason_code?: string
  rationale: string
  reasoning?: Reasoning
  timestamp: string
  fields_changed?: string[]
  [extra: string]: unknown
}

/** Why something needs a person. `blocks_lock` items are the lock list. */
export interface AttentionReason {
  code:
    | 'flagged' | 'low_certainty' | 'open_contest' | 'unverified_finding'
    | 'flagged_field' | 'bad_verdict' | 'unmerged_branch'
    // A client's answer to the locked document (OS-layer contract §7.5.4).
    | 'client_rejected' | 'client_rejected_parts_unknown' | 'client_change_asked' | 'client_part_suggested'
  text: string
  blocks_lock: boolean
}

export interface AttentionItem extends AttentionReason {
  /** The decision it belongs to, when there is one. */
  decision?: string
  address?: string
  label?: string
  /** A carried item this document cannot settle (a frozen field citing a finding
   *  rejected here, a carried agent branch or merge-report conflict): a person may
   *  set it aside with a written reason (`/acknowledge {target, rationale}`,
   *  OS-layer contract §7.2.1). Absent when false. */
  can_set_aside?: boolean
}

export interface DecisionTarget {
  address: string
  path: string
  label: string
  kind: 'field' | 'contest' | 'finding' | 'fact' | 'decision' | 'document' | 'branch'
  /** False when the address is on another document, carried from upstream. */
  here: boolean
}

export interface DecisionBlock {
  decision: Decision
  who: { kind: 'person' | 'agent'; id: string; name: string; you?: boolean }
  targets: DecisionTarget[]
  attention: AttentionReason[]
  superseded: boolean
}

/** What a cite names, resolved by the host. */
export interface CiteInfo {
  kind:
    | 'fact'
    | 'finding'
    | 'source'
    | 'material'
    | 'passage'
    | 'capture'
    | 'decision'
    | 'person'
    | 'address'
    | 'unknown'
  label: string
  detail?: string
  quote?: string
  /** A fact: its value as a person reads it, and the sources behind it. */
  value?: string
  sources?: string[]
  /** A source the document carries. */
  uri?: string
  publisher?: string
  title?: string
  published_at?: string
  tier?: string
}

/** Where a fact came from (OS-layer contract §8.3). `document` when nothing recorded it. */
export type SourceOrigin = 'research' | 'client' | 'brand' | 'layer' | 'person' | 'document'

/** One review verdict on a fact, finding or field. */
export interface SourceReview {
  verdict: 'verified' | 'rejected' | 'set_aside'
  /** Who, as a person would say it. */
  by: string
  actor?: string
  at?: string
  decision?: string
  note?: string
  /** A later decision replaced it. */
  superseded?: boolean
}

/** The source card for one ref (`GET /cite?ref=`, `POST /cite {refs}`). */
export interface SourceCard extends CiteInfo {
  ref: string
  origin: SourceOrigin
  /** Carried from an upstream document: which one. */
  from?: { document_id: string; title?: string; app_id?: string; version?: string; path?: string }
  /** The latest review that still stands. */
  review?: SourceReview
  /** Every review, newest first: what the card folds under Record. */
  history?: SourceReview[]
}

export interface DecisionsView {
  document_id: string
  version: string
  /** Newest first. */
  decisions: DecisionBlock[]
  /** Lock blockers first. */
  attention: AttentionItem[]
  cites: Record<string, CiteInfo>
  lock: {
    can_lock: boolean
    blockers: number
    /** An `approve` of this document holds (§7.1). Absent from an older host. */
    locked?: boolean
    /** Parts reopened for a client's request since the lock (§7.5.6). */
    reopened?: ReopenedPart[]
  }
  /** Client review (§7.5, §8.2 item 6). Absent from an older host. */
  client?: ClientView
  /** Set when the chain could not be read. */
  problem?: string
}

// ── Client review (OS-layer contract §7.5, §8.2) ──────────────────────────────

export type ClientAnswerKind = 'accepted' | 'accepted_with_changes' | 'rejected'
export type ClientReason = 'off_brief' | 'wrong_audience' | 'tone' | 'facts_wrong' | 'budget' | 'other'
export type ClientChannel = 'pasted_email' | 'file' | 'call' | 'none'

/** Who answered, as the recorder typed it. Data, not identity. */
export interface ClientWho {
  name: string
  email?: string
}

/** A part the app declared: a dotted data path and what to call it. */
export interface ClientPartRef {
  address: string
  label: string
  /**
   * Other words the client may call it by (`data-clan-part-aliases`), for the
   * host's matcher. The host adds the label and its last word itself.
   */
  aliases?: string[]
}

export interface ReopenedPart {
  address: string
  label: string
  /** The `unlock`. */
  decision: string
  /** The part answer it was reopened for. */
  answers: string
}

/** One document answer, as `/decisions` reads it. */
export interface ClientAnswerView {
  decision: string
  answer: ClientAnswerKind
  reasons?: ClientReason[]
  /** The client's words, verbatim — or, on a call, the recorder's note of them. */
  said?: string
  client: ClientWho
  channel?: ClientChannel
  evidence: { asset?: string; sha256?: string; strength: 'strong' | 'weaker' }
  recorded_by: { id: string; name: string }
  at: string
  seen: { version: string; doc_hash: string; parts: (ClientPartRef & { part_hash: string })[] }
  /** It answers the version the lock names now. */
  current: boolean
  /** A part answer names it as its review. */
  parts_known: boolean
}

export interface ClientPartView {
  address: string
  label: string
  state: ClientAnswerKind
  decision: string
  review: string
  /** `document`: an accepted document answer marks every part. */
  found_by: 'person' | 'agent' | 'document'
  quote?: string
  /** What the client said about this part, as the recorder typed it under it: verbatim. */
  said?: string
  client: ClientWho
  at: string
  stale: boolean
  answered: boolean
  reopened: boolean
}

/** One of the Knowledge agent's suggestions nobody has confirmed or dismissed yet. */
export interface ClientSuggestionView {
  decision: string
  review: string
  address: string
  label: string
  answer: ClientAnswerKind
  quote: string
}

export interface ClientView {
  /** `POST /client-review` would be accepted now: locked, nothing reopened. */
  available: boolean
  answer: ClientAnswerView | null
  /** Every document answer, newest first. */
  answers: ClientAnswerView[]
  parts: ClientPartView[]
  /** Oldest first. */
  suggestions: ClientSuggestionView[]
}

/** `POST /client-review`. The recorder is whoever is signed in; never sent. */
export interface ClientReviewBody {
  answer: ClientAnswerKind
  client: ClientWho
  reasons?: ClientReason[]
  channel: ClientChannel
  said?: string
  /** `human/assets/<name>`, stored first with `uploadAsset`. */
  asset?: string
  /** The app's whole list, every time. */
  parts: ClientPartRef[]
  /**
   * The parts the recorder marked. `said` is what they typed under the part
   * ("What they said about it"), verbatim; absent when it is only whitespace.
   */
  marked?: { address: string; answer: ClientAnswerKind; said?: string }[]
}

export interface ClientReviewReply {
  ok: boolean
  decision: string
  parts: string[]
  suggestions: {
    /**
     * From the host's own matcher, in the same reply: `none`, nothing was
     * looked for (accepted, parts marked, no parts, no words); `found`, it
     * looked (`decisions` may be empty: no part is named in the words).
     */
    status: 'none' | 'found' | 'unavailable'
    decisions: string[]
    dropped: number
    reason?: string
  }
}

/** `POST /client-review/confirm`: settle a suggestion, or mark a part after the fact. */
export type ClientConfirmBody =
  | { suggestion: string; confirm: boolean; answer?: ClientAnswerKind; rationale?: string; /** confirm only: the part's words, verbatim */ said?: string }
  | { review: string; address: string; answer: ClientAnswerKind; rationale?: string; /** the part's words, verbatim */ said?: string }

export interface ClientConfirmReply {
  ok: boolean
  decision: string
  targets: string[]
}

/** `POST /client-review/reopen`: what edit mode opens with. */
export interface ClientReopenReply {
  ok: boolean
  decision: string
  address: string
  label: string
  /** The part answer the edit answers: send it as the `/edit`'s `answers`. */
  answers: string
  /** "<client> asked: …" — the edit's reason, pre-filled. */
  reason: string
}

/** `POST /upload-asset`. */
export interface UploadedAsset {
  ok: boolean
  internal_path: string
  extracted_chars: number
}

// ── What changed upstream (§8.1, item 6) ──────────────────────────────────────

export interface UpstreamCarried {
  document_id: string
  data_sha256: string
  facts_sha256?: string
  findings_sha256?: string
  sources_sha256?: string
  last_decision?: string
}

export interface UpstreamEntry {
  document_id: string
  direct: boolean
  in_store: boolean
  title?: string
  app_id?: string
  /** What its app calls it ("report", "brief"), when it is in the store. */
  noun?: string | null
  /** Where the shell opens it (the store's id for it); absent when it is not in the store. */
  path?: string
  version?: string
  locked?: boolean
  status: 'current' | 'changed' | 'not_compared' | 'unknown'
  /** `made_from` (the direct parent), `linked` (attached, os-layer §5.7) or `carried` (further upstream). */
  how?: 'made_from' | 'linked' | 'carried'
  /** A linked document: how many times this one took it (1 on link, one more on each update). */
  taken?: number | null
  changed?: { data: boolean; facts: boolean; findings: boolean; sources: boolean }
  decisions_since?: number | null
  pins?: { id: string; change: 'added' | 'replaced' | 'changed'; label: string; replaced_by?: string }[]
  findings?: { id: string; change: 'added' | 'verified' | 'rejected'; statement: string; reason?: string; cited_by: string[] }[]
  contests?: { id: string; change: 'opened' | 'resolved'; key: string; chosen?: string; resolved_here: boolean }[]
}

export interface UpstreamView {
  document_id: string
  carried: UpstreamCarried | null
  upstream: UpstreamEntry[]
}

// ── Links (os-layer §5.7, §8.1 item 9) ─────────────────────────────────────────

/** A document the open one could link (`GET /attach-targets`). */
export interface AttachTarget {
  app_id: string
  app_name: string
  document_id: string
  title: string
  version?: number | null
  path: string
  updated_at: string
  /** Linked to the open document now. */
  attached: boolean
  /** The open document may hold several of this app at once. */
  many: boolean
  /** The open document is locked, so a link would be refused. */
  locked: boolean
}

/** `POST /attach`, `/attach/update` or `/attach/detach`: what was written. */
export interface AttachReply {
  ok: true
  verb?: 'attached' | 'updated' | 'replaced'
  decision: string | null
  action: string
  document_id: string
}

/** One document related to the open one (`GET /related`). */
export interface RelatedDoc {
  document_id: string
  title?: string | null
  app_id?: string | null
  path?: string | null
  how: 'made_from' | 'linked' | 'made_into' | 'linked_in'
  noun?: string | null
  taken?: number | null
  status?: UpstreamEntry['status'] | null
}

export interface RelatedView {
  document_id: string
  upstream: RelatedDoc[]
  downstream: RelatedDoc[]
}

/** `POST /upstream/update`: the parent's newer version, taken (Contract 4 §5.5, §8.1 item 8). */
export interface UpstreamUpdateReply {
  ok: true
  /** The one decision written: `update_from_<noun>`. */
  decision: string
  action: string
  /** The parent taken from, and the version taken. */
  document_id: string
  version: string
  /** How many of the parent's decisions were new here. */
  decisions_taken: number
}

/**
 * Events the host pushes at the shell. The names are the host's own
 * (`napkin_host::event::HostEvent::name`), so this map and the Rust route
 * table stay in step by construction.
 */
export interface HostEvents {
  /** The OS handed us a .clan to open (double-click, "Open with"). */
  'open-file': string
  /** A launch from inside a CLAN app, or a freshly instantiated document. */
  'clan-open-document': string
  'clan-open-file-request': null
  'clan-request-save': null
  'clan-export-request': { kind: string; filename: string; tmpHtml: string; frame?: string }
  'clan-title-changed': string
  'napkin-notify': { title: string; body: string }
  'clan-theme-changed': Record<string, string>
  /** Informational: a legacy fragment patch was saved. Never save in response (#9). */
  'clan-patch-saved': { id: string; content: string }
  'clan-data-changed': unknown
}

export type Unlisten = () => void

/**
 * Who this page is signed in as: the actor the host records a person's writes
 * under (`Ctx.actor`), which is what the decision view calls "You". Nobody
 * gives the host a name yet, so `name` is null until an account system does.
 */
export interface Person {
  /** `human:<id>`, as the chain records it. */
  actor: string
  id: string
  name: string | null
}

/** A stored document's own routes (`Host.docOps`), on a token of its own. */
export interface DocOps {
  decisions(): Promise<DecisionsView>
  related(): Promise<RelatedView>
  upstream(): Promise<UpstreamView>
  /** "Looks right" on a finding: `POST /verify`. */
  verify(finding: string, rationale: string): Promise<void>
  /** "Looks right" on an agent's call: `POST /acknowledge`. */
  acknowledge(decision: string): Promise<void>
  /** Its data entry as stored (YAML or JSON text): what a tool home reads its lens coverage from. */
  data(): Promise<string>
  /** Lock it: `POST /approve`. Refused, in the host's words, while its lock list holds. */
  approve(rationale: string): Promise<void>
  /** Judge (features/judge.clan): the score card, a score, and the creative director's overrule. */
  judge: {
    card(target?: string): Promise<JudgeCardView>
    /** Send to Judge. Rejects with the host's words (`ai_off: ...`, `not_configured: ...`) when it will not score. */
    send(target?: string): Promise<JudgeCardView>
    overrule(reason: string, route?: 'team' | 'cd'): Promise<void>
  }
}

export interface Host {
  // ── Who is here ───────────────────────────────────────────────────────────
  /** The signed-in person, as the host acts for them. Read-only. */
  whoAmI(): Promise<Person>

  // ── Documents ─────────────────────────────────────────────────────────────
  openClan(path: string): Promise<OpenResult>
  openHome(): Promise<OpenResult>
  /** A new document of `appId`, for `clientId` when one is given (`manifest.client`). */
  newDocumentFromApp(appId: string, title: string | null, clientId?: string | null): Promise<OpenResult>
  /** The .clan path the app was launched with, if any. Cleared by reading it. */
  takeLaunchFile(): Promise<string | null>

  // ── Reading the open document ─────────────────────────────────────────────
  getHumanHtml(): Promise<string>
  getData(): Promise<string>
  /**
   * Every decision in the open document, newest first, with what needs a
   * person and why — derived by the host, the same for every app.
   */
  getDecisions(): Promise<DecisionsView>
  /** The Brief gate of the open brief: six items, the signers, the client's answer (`GET /gate`). */
  getGate(): Promise<GateView>
  /** The signer named on the brief signs this version (`POST /sign`): the planner's sign, or the creative director's lock. */
  gateSign(rationale?: string): Promise<void>
  /** Make the link a client opens on a phone, with no account, to confirm this locked version. */
  makeClientLink(name: string, email: string): Promise<ClientLinkMade>
  /** The links this document has had, and what each is worth now. */
  listClientLinks(): Promise<ClientLinkRow[]>
  /** Kill a link: it answers 410 from then on. */
  withdrawClientLink(id: string): Promise<void>
  /** A person's edit of the open brief from the gate (`POST /patch-data`), attributed to them. */
  gatePatch(patch: Record<string, unknown>, action: string, rationale?: string): Promise<void>
  /** Start a new version of a signed brief that changed (`POST /unapprove`, with the reason). */
  gateNewVersion(reason: string): Promise<void>
  /** The brief's versions, each approve with its signer and date, and the draft (`GET /versions`). */
  getVersions(): Promise<VersionsView>
  /** One version's words, or the draft's (`GET /version?n=`). */
  getVersion(n: number | 'draft'): Promise<VersionParts>
  /** The open document as it stands now (`GET /current`): what an app draws after the shell changed it. */
  getCurrent(): Promise<{ data: Record<string, unknown>; version: string }>
  /** The draft takes an old version's words as one new attributed edit; no lock changes (`POST /restore`). */
  restoreVersion(n: number): Promise<void>
  /** A person accepts an agent's call ("Looks right"): `/acknowledge`. */
  acknowledge(decision: string): Promise<void>
  /**
   * A person checks an agent's finding and finds it right: `POST /verify`, the
   * same verification the app's own Verify records ("Looks right" on the
   * Decisions card).
   */
  verify(finding: string, rationale: string): Promise<void>
  /** What changed upstream since this document was spun off (`GET /upstream`). */
  upstream(): Promise<UpstreamView>
  /**
   * Take the direct parent's newer version into this spin-off
   * (`POST /upstream/update`). Refused on a locked document, and when the
   * parent has not changed.
   */
  updateFromUpstream(): Promise<UpstreamUpdateReply>
  /** The documents the open one could link (`GET /attach-targets`); empty when its app links nothing. */
  attachTargets(): Promise<AttachTarget[]>
  /** Link an existing document into the open one (`POST /attach`). Refused on a locked document, in the host's words. */
  attach(documentId: string): Promise<AttachReply>
  /** Take a linked document's newer version (`POST /upstream/update {document_id}`). */
  updateLinked(documentId: string): Promise<AttachReply>
  /** Let go of a linked document (`POST /attach/detach`). */
  detach(documentId: string): Promise<AttachReply>
  /** What it was made from and links, and what was made from it or links it (`GET /related`). */
  related(): Promise<RelatedView>
  /** Rename the open document (`POST /set-title`). Absent on a host that cannot. */
  setTitle?(title: string): Promise<void>
  /** The source card for each ref, in one call (`POST /cite`). */
  cites(refs: string[]): Promise<Record<string, SourceCard>>

  // ── Client review (OS-layer contract §7.5) ────────────────────────────────
  /**
   * Record a client's answer to the locked document: `POST /client-review`.
   * The host's matcher suggests which parts it was about in the same reply
   * (shown as the Knowledge agent's; nothing waits on a model).
   */
  clientReview(body: ClientReviewBody): Promise<ClientReviewReply>
  /** Confirm or dismiss one of the Knowledge agent's suggestions, or mark a part after the fact. */
  clientReviewConfirm(body: ClientConfirmBody): Promise<ClientConfirmReply>
  /** "Make this change": reopen the one part a client's answer asked about. */
  clientReviewReopen(answer: string): Promise<ClientReopenReply>
  /** Store a file in the open document (`/upload-asset`) — the client's email or PDF. */
  uploadAsset(name: string, bytes: Uint8Array): Promise<UploadedAsset>

  // ── The render surface ────────────────────────────────────────────────────
  setEditMode(active: boolean): Promise<void>
  updatePreviewHtml(html: string): Promise<void>
  savePatch(id: string, content: string): Promise<void>
  /**
   * Origin the sandboxed app frame reaches the clan:// API on. A custom URI
   * scheme on the desktop; a separate sandbox origin on the web, so a
   * third-party app's JS can never touch the shell's own.
   */
  clanOrigin(): string
  /**
   * Last pass over a composed app page before the frame loads it. Identity on
   * the desktop, where `clan://` is a real scheme; on the web it rewrites that
   * base to the frame's own URL so app HTML runs unmodified.
   */
  prepareAppHtml(html: string): string
  /**
   * How the app frame gets its document. `'url'` means the host serves it and
   * the frame loads it by address; `'srcdoc'` means there is no server to
   * serve it from, so it is inlined.
   */
  readonly frameLoad: 'url' | 'srcdoc'
  /**
   * Answer a `clan://` request the app frame made, when the shim routes those
   * through the shell instead of the network. Only the serverless host needs
   * this; the others let the frame talk to the host directly.
   */
  handleFromFrame(
    path: string,
    query: string,
    body: Uint8Array,
  ): Promise<{ status: number; headers: [string, string][]; body: Uint8Array }>

  // ── The app library ───────────────────────────────────────────────────────
  listApps(): Promise<InstalledApp[]>
  installApp(srcPath: string): Promise<InstalledApp>
  /** Documents in the store, most recently updated first (the host keeps 12). */
  listRecent(): Promise<RecentDoc[]>
  /**
   * Every piece of work, by client: uncapped, newest first, optionally narrowed
   * to a client and/or an app. Rejects on a host that predates it (the shell
   * then keeps the Launcher as home).
   */
  listLibrary(filter?: LibraryFilter): Promise<LibraryListing>
  /**
   * Poll one middleware job of a document, open or not, the way its page
   * does (`job_status`), so the host lands a change that finished after the
   * page closed. Absent on a host with one document at a time.
   */
  settleJob?(path: string, jobId: string): Promise<unknown>
  /** The client registry. */
  readonly clients: ClientsApi
  /**
   * One stored document's own routes, open or not (the desk's Decisions and
   * its Worth a look read and settle calls across documents with it). Absent
   * on a host with one document at a time.
   */
  docOps?(path: string): Promise<DocOps>

  // ── Branching one document into another app ───────────────────────────────
  /**
   * Which installed apps have declared they will take the open document as a
   * spin-off source. Empty is a normal answer — it means nothing downstream is
   * installed, not that anything failed.
   */
  spinoffTargets(): Promise<SpinoffTarget[]>
  /**
   * Branch the open document into `appId`, carrying its data and its decision
   * chain, and open the result. `map` overrides the target app's declared graft.
   */
  spinoffDocument(
    appId: string,
    title: string | null,
    map: string | null,
  ): Promise<OpenResult>

  // ── Getting bytes out ─────────────────────────────────────────────────────
  saveClanTo(path: string): Promise<void>
  /** Resolves with the saved file's name when the host delivered it itself (the browser), or nothing when a `clan-export-request` event follows (the desktop). */
  exportCurrent(kind: 'html' | 'pdf', provenance: boolean, noBrand: boolean): Promise<string | void>
  finishExport(kind: string, tmpHtml: string, dest: string): Promise<string>
  /** Ask the user where a .clan or an export should go. `null` if cancelled. */
  pickSaveDestination(defaultName: string, ext: string): Promise<string | null>
  /** Ask the user for a .clan to open. `null` if cancelled. */
  pickClanToOpen(): Promise<string | null>

  // ── The agent ─────────────────────────────────────────────────────────────
  agentEndpoint(): Promise<string>
  agentPrompt(text: string): Promise<unknown>

  // ── Host → shell ──────────────────────────────────────────────────────────
  on<K extends keyof HostEvents>(
    event: K,
    handler: (payload: HostEvents[K]) => void,
  ): Promise<Unlisten>
}
