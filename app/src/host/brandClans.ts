// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Brand Clan operations as the section uses them, over whichever host
// the shell runs on (`Host.brandClan`, docs/contracts/brand-clan.md section 5).

import type { BrandBible, BrandClanList, BrandClanView, BrandHistoryEntry, ClientRecord, Host } from './types'

/** The Brand Clan operations as the shell uses them: `host.brandClans`. */
export interface BrandApi {
  list(clientId: string): Promise<BrandClanList>
  create(clientId: string, name: string): Promise<BrandClanView>
  get(path: string, version?: number): Promise<BrandClanView>
  history(path: string): Promise<BrandHistoryEntry[]>
  saveDraft(path: string, candidate: BrandBible, expectVersion: number): Promise<BrandClanView>
  startDraft(path: string, fromVersion: number): Promise<BrandClanView>
  discardDraft(path: string): Promise<BrandClanView>
  publish(path: string, expectVersion: number): Promise<BrandClanView>
  accept(path: string, take: 'all' | string[], expectVersion: number): Promise<BrandClanView>
  keep(path: string): Promise<BrandClanView>
  setDefault(clientId: string, documentId: string): Promise<ClientRecord>
  /** The Update chip, pressed: attach's update of one work document. Nothing else reaches work. */
  updateWork(brandPath: string, workPath: string): Promise<unknown>
  putAsset(path: string, name: string, bytes: Uint8Array): Promise<{ name: string; path: string }>
  assetUrl(path: string, name: string): Promise<string>
}

/** The typed operations over a host's generic `brandClan` call. */
export function brandApi(h: Pick<Host, 'brandClan' | 'brandClanAsset'>): BrandApi {
  const c = h.brandClan.bind(h)
  return {
    list: client_id => c('list', { client_id }),
    create: (client_id, name) => c('create', { client_id, name }),
    get: (path, version) => c('get', { path, ...(version ? { version } : {}) }),
    history: path => c('history', { path }),
    saveDraft: (path, candidate, expect_version) => c('draft.save', { path, candidate, expect_version }),
    startDraft: (path, from_version) => c('draft.start', { path, from_version }),
    discardDraft: path => c('draft.discard', { path }),
    publish: (path, expect_version) => c('publish', { path, expect_version }),
    accept: (path, take, expect_version) => c('proposal.accept', { path, take, expect_version }),
    keep: path => c('proposal.keep', { path }),
    setDefault: (client_id, document_id) => c('default.set', { client_id, document_id }),
    updateWork: (path, work) => c('work.update', { path, work }),
    putAsset: (path, name, bytes) => c('asset.put', { path, name }, bytes),
    assetUrl: (path, name) => h.brandClanAsset(path, name),
  }
}
