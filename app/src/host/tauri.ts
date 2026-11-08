// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The desktop host: Tauri commands in, Tauri events out.
//
// This is the ONLY module that imports @tauri-apps/api. Everything it does is
// a one-line delegation, which is the point — the interesting code lives in
// the `napkin-host` crate on the other side of these calls.

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'

import type {
  Adopted,
  LegacyName,
  ClientRecord,
  Host,
  HostEvents,
  InstalledApp,
  LibraryListing,
  OpenResult,
  RecentDoc,
  SourceCard,
  SpinoffTarget,
  Unlisten,
} from './types'

/**
 * Windows has no custom-scheme support in WebView2, so Tauri maps `clan://` to
 * `http://clan.localhost` there.
 */
function clanScheme(): string {
  return window.navigator.userAgent.includes('Windows')
    ? 'http://clan.localhost'
    : 'clan://localhost'
}

export const tauriHost: Host = {
  // One person, on their own machine: the host runs as Ctx::local()
  // (napkin-host ctx.rs, LOCAL_HUMAN), which the decision view shows as "You".
  whoAmI: async () => ({ actor: 'human:local', id: 'local', name: null }),
  openClan: path => invoke<OpenResult>('open_clan', { path }),
  openHome: () => invoke<OpenResult>('open_home'),
  newDocumentFromApp: (appId, title, clientId) =>
    invoke<OpenResult>('new_document_from_app', { appId, title, clientId: clientId ?? null }),
  takeLaunchFile: () => invoke<string | null>('take_launch_file'),

  getHumanHtml: () => invoke<string>('get_human_html'),
  getData: () => invoke<string>('get_data'),
  // The desktop viewer is parked; the web shell is where the panel lives.
  getDecisions: () => Promise.reject(new Error('the decision view is not available on the desktop yet')),
  acknowledge: () => Promise.reject(new Error('the decision view is not available on the desktop yet')),
  // Nor client review, which is read and answered from that view.
  upstream: () => Promise.reject(new Error('what changed upstream is not available on the desktop yet')),
  // The clan:// route answers it, as for the frame.
  cites: async refs => {
    const resp = await fetch(`${clanScheme()}/cite`, { method: 'POST', body: JSON.stringify({ refs }) })
    if (!resp.ok) throw new Error(`cite: ${resp.status}`)
    return ((await resp.json()) as { cites: Record<string, SourceCard> }).cites
  },
  clientReview: () => Promise.reject(new Error('client review is not available on the desktop yet')),
  clientReviewConfirm: () => Promise.reject(new Error('client review is not available on the desktop yet')),
  clientReviewReopen: () => Promise.reject(new Error('client review is not available on the desktop yet')),
  uploadAsset: () => Promise.reject(new Error('client review is not available on the desktop yet')),

  setEditMode: active => invoke('set_edit_mode', { active }),
  updatePreviewHtml: html => invoke('update_preview_html', { html }),
  savePatch: (id, content) => invoke('save_patch', { id, content }),
  clanOrigin: clanScheme,
  // `clan://` is a real scheme here; nothing to rewrite.
  prepareAppHtml: html => html,
  frameLoad: 'url',
  handleFromFrame: () =>
    Promise.reject(new Error('the frame reaches the host directly in this build')),

  listApps: () => invoke<InstalledApp[]>('list_apps'),
  installApp: srcPath => invoke<InstalledApp>('install_app', { srcPath }),
  // No command for this; the clan:// route answers it (and allows any origin).
  listRecent: async () => {
    const resp = await fetch(`${clanScheme()}/recent`)
    if (!resp.ok) throw new Error(`recent: ${resp.status}`)
    return resp.json() as Promise<RecentDoc[]>
  },

  listLibrary: filter =>
    invoke<LibraryListing>('list_library', { client: filter?.client ?? null, appId: filter?.app ?? null }),
  clients: {
    list: (includeArchived = false) => invoke<ClientRecord[]>('list_clients', { includeArchived }),
    create: (name, material) => invoke<ClientRecord>('create_client', { name, material: material ?? null }),
    update: (id, patch) => invoke<ClientRecord>('update_client', { id, patch }),
    archive: id => invoke<ClientRecord>('set_client_archived', { id, archived: true }),
    restore: id => invoke<ClientRecord>('set_client_archived', { id, archived: false }),
    legacy: () => invoke<LegacyName[]>('legacy_client_names'),
    adopt: names => invoke<Adopted>('adopt_clients', { names }),
  },

  spinoffTargets: () => invoke<SpinoffTarget[]>('spinoff_targets'),
  spinoffDocument: (appId, title, map) =>
    invoke<OpenResult>('spinoff_document', { appId, title, map }),

  saveClanTo: path => invoke('save_clan_to', { path }),
  exportCurrent: (kind, provenance, noBrand) =>
    invoke('export_current', { kind, provenance, noBrand }),
  finishExport: (kind, tmpHtml, dest) => invoke<string>('finish_export', { kind, tmpHtml, dest }),

  pickSaveDestination: (defaultName, ext) =>
    saveDialog({
      defaultPath: `${defaultName}.${ext}`,
      filters: [{ name: ext === 'clan' ? 'CLAN Files' : ext.toUpperCase(), extensions: [ext] }],
    }),
  pickClanToOpen: () =>
    openDialog({
      multiple: false,
      filters: [{ name: 'CLAN Files', extensions: ['clan'] }],
    }) as Promise<string | null>,

  agentEndpoint: () => invoke<string>('agent_endpoint'),
  agentPrompt: text => invoke<unknown>('agent_prompt', { text }),

  on: <K extends keyof HostEvents>(
    event: K,
    handler: (payload: HostEvents[K]) => void,
  ): Promise<Unlisten> =>
    listen<HostEvents[K]>(event, e => handler(e.payload)).then(un => un as Unlisten),
}
