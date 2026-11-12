/* tslint:disable */
/* eslint-disable */

/**
 * One browser session's Napkin: a store, and the document currently open in it.
 */
export class NapkinHost {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `names` is a JSON array of strings.
     */
    adoptClients(names: string): any;
    /**
     * Compose a standalone document from the open `.clan` — bindings
     * resolved, assets inlined, scripts stripped, brand chrome. The same SDK
     * call every other shell makes; only the delivery differs, because there
     * is no headless browser here to turn it into a PDF.
     */
    composeExport(provenance: boolean, no_brand: boolean): any;
    createClient(name: string, material?: string | null): any;
    /**
     * The packed archive of the open document — the single-file handoff, and
     * on the web the only way work leaves the browser.
     */
    download(): Uint8Array;
    entry(path: string): string;
    /**
     * The page the app frame loads from `srcdoc`, for the options in `query`
     * (`model=&capture=&theme=`): the same composer as every host, with the
     * device's CSP and rpc shim (napkin-host `frame`, `Reach::Device`).
     */
    framePage(query: string): string;
    /**
     * The `clan://` surface, as a function call.
     *
     * `/patch-data`, `/assets/…`, `/chain`, `/apps`, `/launch` — the same
     * table the desktop reaches through a custom URI scheme and the server
     * reaches over HTTP. `/api-proxy` is the one route that does not arrive
     * here: the page holds the credentials and answers it before we are asked.
     * `/client-review` is answered here as everywhere: which parts the
     * client's words were about is the host's own word match, no middleware.
     */
    handle(path: string, query: string, body: Uint8Array): any;
    /**
     * Install a template app from its packed bytes — fetched from wherever the
     * site publishes them.
     */
    installApp(bytes: Uint8Array): any;
    /**
     * The free-text client names no client has yet, with their document counts.
     */
    legacyClientNames(): any;
    listApps(): any;
    /**
     * The clients, live ones (or all, with `include_archived`).
     */
    listClients(include_archived: boolean): any;
    /**
     * Every piece of work in this tab, by client: the landing's one read.
     * `client` is a registry id and `app` an app id; either may be absent.
     */
    listLibrary(client?: string | null, app?: string | null): any;
    listRecent(): any;
    /**
     * Instantiate a working document from an installed app and open it, for
     * `client_id` when one is named.
     */
    newDocument(app_id: string, title?: string | null, client_id?: string | null): any;
    constructor();
    /**
     * The launcher, which is itself a CLAN app. Built here on first use — the
     * SDK needs nothing but bytes, so there is nothing to download.
     */
    openHome(): any;
    open(doc: string): any;
    setClientArchived(id: string, archived: boolean): any;
    setEditMode(active: boolean): void;
    /**
     * Branch the open document into another app, carrying its data and its
     * decisions, and open the result.
     */
    spinoffDocument(app_id: string, title?: string | null, map?: string | null): any;
    /**
     * Which installed apps will take the open document as a spin-off source.
     */
    spinoffTargets(): any;
    title(): string;
    /**
     * `patch` is JSON: `{name?, initials?, material?}`.
     */
    updateClient(id: string, patch: string): any;
    /**
     * Take an uploaded `.clan` into the store and open it.
     */
    upload(bytes: Uint8Array, suggested_id: string): any;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_napkinhost_free: (a: number, b: number) => void;
    readonly napkinhost_adoptClients: (a: number, b: number, c: number) => [number, number, number];
    readonly napkinhost_composeExport: (a: number, b: number, c: number) => [number, number, number];
    readonly napkinhost_createClient: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly napkinhost_download: (a: number) => [number, number, number, number];
    readonly napkinhost_entry: (a: number, b: number, c: number) => [number, number, number, number];
    readonly napkinhost_framePage: (a: number, b: number, c: number) => [number, number, number, number];
    readonly napkinhost_handle: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly napkinhost_installApp: (a: number, b: number, c: number) => [number, number, number];
    readonly napkinhost_legacyClientNames: (a: number) => [number, number, number];
    readonly napkinhost_listApps: (a: number) => any;
    readonly napkinhost_listClients: (a: number, b: number) => [number, number, number];
    readonly napkinhost_listLibrary: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly napkinhost_listRecent: (a: number) => any;
    readonly napkinhost_new: () => number;
    readonly napkinhost_newDocument: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly napkinhost_open: (a: number, b: number, c: number) => [number, number, number];
    readonly napkinhost_openHome: (a: number) => [number, number, number];
    readonly napkinhost_setClientArchived: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly napkinhost_setEditMode: (a: number, b: number) => void;
    readonly napkinhost_spinoffDocument: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly napkinhost_spinoffTargets: (a: number) => any;
    readonly napkinhost_title: (a: number) => [number, number, number, number];
    readonly napkinhost_updateClient: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly napkinhost_upload: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
