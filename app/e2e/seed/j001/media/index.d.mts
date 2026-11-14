export type MediaFile = { name: string; kind: string; bytes: number; sha256: string; owner: string; drawn_by: string; path: string; width?: number; height?: number; slot_s?: number; site?: string; corners?: [number, number][] }
export const MEDIA_DIR: string
export const MEDIA_FILES: Omit<MediaFile, 'path'>[]
export const MEDIA: { bottle: MediaFile; scamp: MediaFile; radio: MediaFile; tv: MediaFile; layout: MediaFile; sheet48: MediaFile; shelter: MediaFile }
export function mediaBytes(name: string): Buffer
export function mediaJson(name: string): any
export const SITES: MediaFile[]
