// The canvas records, napkin/1 (features/canvas-engine.clan, contracts: "The
// canvas-engine record schema napkin/1"). One record type, 'el', for every
// element; its kind says which props it carries. @tldraw/store (MIT) keeps the
// records and runs their migrations; never tldraw or @tldraw/editor.
//
// Rules the schema holds:
// - Common fields are flat, so the Y layout can give each its own key
//   (src/y/layout.ts). style and props are small maps of plain values.
// - A stroke's points are not in the record: they are an immutable Uint8Array
//   (src/model/points.ts) kept beside it, written once at pointer-up.
// - Session state (camera, selection, viewport, hover) is never a record field;
//   the validator refuses unknown keys, so it cannot slip in.
// - Previews are referenced by hash (props.assetSha), never stored as bytes.
// - Changes after launch are additive, or go through MIGRATIONS below.

import { createMigrationSequence, createRecordType, StoreSchema, type BaseRecord, type MigrationSequence, type RecordId } from '@tldraw/store'

/** The major version of the scene format: napkin/1. A breaking change is napkin/2. */
export const SCHEMA_VERSION = 1
export const FORMAT = `napkin/${SCHEMA_VERSION}` as const

export const KINDS = ['stroke', 'text', 'image', 'shape', 'arrow', 'frame', 'board', 'sketch', 'node', 'link'] as const
export type Kind = (typeof KINDS)[number]

/** A plain value a style or prop may hold. */
export type Plain = string | number | boolean | null | Plain[] | { [k: string]: Plain }

export interface Style {
  stroke?: string
  fill?: string
  width?: number
  dash?: 'solid' | 'dashed' | 'dotted'
  fontFamily?: string
  fontSize?: number
  align?: 'left' | 'center' | 'right'
  roundness?: number
  arrowheadStart?: string
  arrowheadEnd?: string
}

/** Where an arrow or link end is attached: an element, and where on it (0..1 across its box). */
export interface Binding {
  elementId: string
  anchor?: { x: number; y: number }
}

/** The props each kind may carry (all optional; absent means the default). */
export const PROPS: Record<Kind, readonly string[]> = {
  stroke: ['tool', 'inkGroup', 'convertedFrom'],
  text: ['doc', 'boundTo', 'plain'],
  image: ['assetSha', 'crop', 'status', 'stack'],
  shape: ['geo'],
  arrow: ['start', 'end', 'route', 'bends'],
  frame: ['name'],
  board: ['name', 'purpose'],
  sketch: ['ratio'],
  node: ['nodeKind'],
  link: ['start', 'end', 'route', 'bends', 'role'],
}

/** The tool's customData tag, as today ({kind, id}); the id is the document's. */
export interface Tag {
  kind: string
  id?: string
  [k: string]: Plain | undefined
}

export interface ElementRecord extends BaseRecord<'el', RecordId<ElementRecord>> {
  kind: Kind
  x: number
  y: number
  w: number
  h: number
  /** Radians, about the box's centre. */
  rotation: number
  flipX: boolean
  flipY: boolean
  /** Fractional index: z-order among siblings. */
  z: string
  /** The container (board, frame or sketch area) this element sits in. */
  parentId: string | null
  /** Groups, innermost first and outermost last, as Excalidraw's (nesting; canvas-edit-tools). */
  groupIds: string[]
  locked: boolean
  /** 0..1 */
  opacity: number
  style: Style
  customData: Tag | null
  props: { [k: string]: Plain }
}

export const COMMON_FIELDS = ['kind', 'x', 'y', 'w', 'h', 'rotation', 'flipX', 'flipY', 'z', 'parentId', 'groupIds', 'locked', 'opacity', 'style', 'customData', 'props'] as const
const ALLOWED = new Set<string>(['id', 'typeName', ...COMMON_FIELDS])

export type ElementId = RecordId<ElementRecord>
export const elId = (id: string) => id as ElementId

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const isPlain = (v: unknown): boolean => {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (Array.isArray(v)) return v.every(isPlain)
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.values(v as object).every(isPlain)
  return false
}

/** Refuses anything that is not a napkin/1 element: unknown fields (session state), bad kinds, props of another kind. */
export function validateElement(r: unknown): ElementRecord {
  const e = r as ElementRecord
  const fail = (why: string): never => {
    throw new Error(`Not a napkin/1 element (${(e as { id?: string })?.id ?? '?'}): ${why}`)
  }
  if (!e || typeof e !== 'object') fail('not an object')
  if (e.typeName !== 'el' || typeof e.id !== 'string') fail('typeName or id')
  for (const k of Object.keys(e)) if (!ALLOWED.has(k)) fail(`unknown field '${k}' (session state is never in the scene)`)
  if (!(KINDS as readonly string[]).includes(e.kind)) fail(`kind '${e.kind}'`)
  for (const k of ['x', 'y', 'w', 'h', 'rotation', 'opacity'] as const) if (!isNum(e[k])) fail(k)
  if (e.opacity < 0 || e.opacity > 1) fail('opacity outside 0..1')
  for (const k of ['flipX', 'flipY', 'locked'] as const) if (typeof e[k] !== 'boolean') fail(k)
  if (typeof e.z !== 'string' || !e.z) fail('z')
  if (e.parentId !== null && typeof e.parentId !== 'string') fail('parentId')
  if (!Array.isArray(e.groupIds) || !e.groupIds.every((g) => typeof g === 'string')) fail('groupIds')
  if (!e.style || typeof e.style !== 'object' || !isPlain(e.style)) fail('style')
  if (e.customData !== null && (typeof e.customData !== 'object' || typeof e.customData.kind !== 'string' || !isPlain(e.customData))) fail('customData')
  if (!e.props || typeof e.props !== 'object' || !isPlain(e.props)) fail('props')
  const allowed = PROPS[e.kind]
  for (const k of Object.keys(e.props)) if (!allowed.includes(k)) fail(`prop '${k}' on a ${e.kind}`)
  return e
}

export const ElementType = createRecordType<ElementRecord>('el', { scope: 'document', validator: { validate: validateElement } })

/** The migration sequence for 'el' records. napkin/1 has none yet; each additive change appends one. */
export const SEQUENCE_ID = 'com.napkin.canvas.element'
export const MIGRATIONS: MigrationSequence = createMigrationSequence({ sequenceId: SEQUENCE_ID, sequence: [], retroactive: false })

export function makeSchema(migrations: MigrationSequence = MIGRATIONS) {
  return StoreSchema.create<ElementRecord>({ el: ElementType }, { migrations: [migrations] })
}

export const schema = makeSchema()

/** The minor version of our migration sequence: how many migrations napkin/1 has had. */
export function sequenceVersion(s: { serialize(): { sequences: Record<string, number> } } = schema): number {
  return s.serialize().sequences[SEQUENCE_ID] ?? 0
}

/** A new element with defaults for everything but what it must say, validated. */
export function element(fields: Partial<Omit<ElementRecord, 'id' | 'typeName'>> & { id: string; kind: Kind; z: string }): ElementRecord {
  return validateElement(ElementType.create({
    x: 0, y: 0, w: 0, h: 0, rotation: 0, flipX: false, flipY: false, parentId: null, groupIds: [], locked: false, opacity: 1,
    style: {}, customData: null, props: {},
    ...fields,
    id: elId(fields.id),
  }))
}
