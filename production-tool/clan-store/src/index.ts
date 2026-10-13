export type { Doc, DocAsset, DocumentStore, Entity, MapName, Person, Project, Why } from './types'
export { MAP_NAMES } from './types'
export {
  ClanDocumentStore, CONTRACT, UnsupportedContract, assertIntegrity, newProjectData, newUlidId,
  type ChainEntry, type ClanStoreOptions, type MirrorPost,
} from './store'
export { indexedDbPersistence, memoryPersistence, type Persistence, type Saved } from './persist'
export { buildExportZip, assetPath, assetExt, clanFileName, sha256Hex, type AssetResolver, type ExportZip } from './bundle'
export { problems, assertValid, InvalidDocument } from './validate'
export { mergePatch, diffMergePatch, deepEqual } from './merge-patch'
export { HostRefused, loadWasm } from './host'
export { postClanMirror } from './mirror'
export {
  agentKind, cardsFromRationale, crewFor, jobRationale, landingWhy, opVerb, recordJobOutcome, sawPart, SAW, TERMINAL, CREW,
  type DirectorCard, type JobEntry, type Recorder, type SeenCard,
} from './attribution'
// contract 3: the buses, text, integrity, ranks and time
export type { ApplyOptions, EntityName, Patch, PatchBatch, PatchBus, PatchConflict, PatchResult, PatchWhy, RefusalReason } from './bus/types'
export { LocalPatchBus, LEAF_TARGETS_MAX, expectHolds, type Expect } from './bus/local'
export { LocalTextBus, type TextBus, type TextWindow } from './bus/text'
export { LocalUndo, skippedNotice, MAX_STEPS, type SerializedUndo, type TextChange, type UndoStep } from './bus/undo'
export { entityAddress, leafAddress, leafProblem, readPath, TEXT_OWNED } from './bus/leaf'
export { checkpoint, hydrate, proseOf, proseHash, proseFromLines, fragmentName, shapeProblem, EMPTY_PROSE, LIMITS, type CheckpointResult, type Prose, type PMNode, type RefNames } from './text/checkpoint'
export { TEXT_EXTENSIONS, FRAGMENT_BLOCKS, textSchema, type FragmentKind } from './text/extensions'
export { landPlan, keepSuggestion, keepMine, markStale, StaleSuggestion, type PlanLanding, type PlannedEntity } from './text/moves'
export { integrity, canLink, linkRuleFor, makesLoop, LINK_RULE, ENDPOINT_MAP } from './integrity'
export { rankBetween, ranksBetween, isValidRank, validateRank, byRank, RankError } from './rank'
export { noteWindow, windowProblem, MIN_WINDOW_S, type NoteWindow } from './time'
