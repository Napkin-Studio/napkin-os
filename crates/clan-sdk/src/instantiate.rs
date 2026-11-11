// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Template-as-application (spec §28, v1.2) — the Napkin Studio OS model.
//!
//! An *app* is a developer-authored CLAN file with `document_type: template`
//! whose presentation layer renders from `window.__CLAN__.data` instead of
//! being AI-generated. Two operations live here:
//!
//! - [`make_template`] promotes an authored `.clan` into a template app.
//! - [`instantiate`] produces a working *instance* from a template — the
//!   "new from template" / "create document = copy a template" primitive.
//!
//! Instantiation deliberately does NOT reuse [`crate::merge::fork`]: forking
//! requires ≥2 agents and sets up branch namespaces. An instance is a single
//! working document that is provenance-linked to its template via lineage.

use chrono::Utc;
use uuid::Uuid;

use serde_yaml::{Mapping, Value};

use crate::container::{ClanBuilder, ClanFile, MANIFEST_PATH};
use crate::decision::{Certainty, Decision, DecisionChain, ReasonPoint, Reasoning};
use crate::error::{Error, Result};
use crate::hash::sha256_prefixed;
use crate::manifest::{
    AppInfo, Carried, ClientRef, FileEntry, Lineage, Manifest, ParentRef, ViewState,
};
use crate::merge::MERGE_REPORT_PATH;

pub(crate) const DATA_PATH: &str = "shared/data.yaml";
const APP_MANIFEST_PATH: &str = "app/manifest.yaml";
pub(crate) const CHAIN_PATH: &str = "agent/decision-chain.yaml";
pub(crate) const ASSET_PREFIX: &str = "human/assets/";
const BRANCH_PREFIX: &str = "agents/";
pub(crate) const UPSTREAM_PREFIX: &str = "upstream/";

/// The data key an upstream spin-off freezes its sources under (Contract 4
/// §5.2), and the host-owned key it leaves behind.
pub(crate) const UPSTREAM_KEY: &str = "upstream";
pub(crate) const PROJECTION_KEY: &str = "projection";

/// The list members an upstream spin-off merges by id: role, the path a file
/// that does not register it keeps it at, and the key its list sits under.
pub(crate) const MEMBERS: [(&str, &str, &str); 3] = [
    ("pinned-facts", "shared/facts.yaml", "facts"),
    ("findings", "shared/findings.yaml", "findings"),
    ("sources", "shared/sources.yaml", "sources"),
];

/// Who writes a spin-off's own decisions.
const SPINOFF_AGENT: &str = "napkin-spinoff";

/// Options for [`instantiate`].
#[derive(Debug, Clone)]
pub struct InstantiateOptions {
    /// Title for the new instance. Defaults to the app name when empty.
    pub title: String,
    /// `document_type` of the instance. Defaults to `"document"`. Never
    /// `"template"` — an instance is not itself an app.
    pub document_type: Option<String>,
    /// `true` → reset the data layer to an empty mapping; `false` → copy the
    /// template's seed data (`app.data_seed` or `shared/data.yaml`).
    pub fresh_data: bool,
    /// Override the generated instance id (must be a UUID v4). Defaults to a
    /// fresh UUID.
    pub instance_id: Option<String>,
}

impl Default for InstantiateOptions {
    fn default() -> Self {
        Self {
            title: String::new(),
            document_type: None,
            fresh_data: true,
            instance_id: None,
        }
    }
}

/// Options for [`make_template`].
#[derive(Debug, Clone)]
pub struct MakeTemplateOptions {
    /// Also write a standalone `app/manifest.yaml` member so SDK-less tools
    /// and the launcher can read app metadata without parsing the manifest.
    pub embed_app_manifest: bool,
}

impl Default for MakeTemplateOptions {
    fn default() -> Self {
        Self {
            embed_app_manifest: true,
        }
    }
}

/// Produce a working instance `.clan` from a template `.clan`.
///
/// Copies the presentation layer, schema, and spec; resets or seeds the data
/// layer; records a `template` lineage edge back to the source app; sets
/// `view.source = "app"`; and drops `document_type: template`.
pub fn instantiate(template: &ClanFile, opts: InstantiateOptions) -> Result<Vec<u8>> {
    let tpl_manifest = template.manifest();

    if tpl_manifest.document_type.as_deref() != Some("template") {
        return Err(Error::OutputRejected(
            "instantiate expects a template app (document_type: template); \
             this file is not one"
                .into(),
        ));
    }
    let app = tpl_manifest.app.clone().ok_or_else(|| {
        Error::OutputRejected("template app has no `app` block in its manifest".into())
    })?;

    if let Some(id) = &opts.instance_id {
        if !crate::manifest::is_uuid_v4(id) {
            return Err(Error::OutputRejected(format!(
                "instance_id is not a valid UUID v4: {id}"
            )));
        }
    }

    let now = Utc::now().to_rfc3339();
    let id = opts
        .instance_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let title = if opts.title.trim().is_empty() {
        app.name.clone()
    } else {
        opts.title.clone()
    };
    let parent_sha = template.sha256();

    let mut manifest = tpl_manifest.clone();
    manifest.born_as(id);
    manifest.title = title;
    manifest.created_at = now.clone();
    manifest.updated_at = now.clone();
    // An instance is a document, not an app — but it keeps a lightweight app
    // ref so the viewer can show "this is a <app.name> v<app.version> document".
    manifest.document_type = Some(opts.document_type.unwrap_or_else(|| "document".to_string()));
    manifest.app = Some(app.clone());
    manifest.fork = None;
    manifest.lineage = Some(Lineage {
        parent_id: tpl_manifest.id.clone(),
        parent_uri: format!("file:///unknown/{}.clan", tpl_manifest.id),
        parent_sha256: Some(parent_sha),
        delta: format!("instantiated from template {} v{}", app.name, app.version),
        parents: Vec::new(),
        merge: false,
        carried: None,
        attached: Vec::new(),
    });
    manifest.view = Some(ViewState {
        present: true,
        renderable: true,
        stale: false,
        // Authored app view — protected from `clan render` like "agent".
        source: Some("app".into()),
    });

    // Resolve the seed data for sample mode.
    let seed_path = app.data_seed.as_deref().unwrap_or(DATA_PATH);
    let data_bytes = if opts.fresh_data {
        b"{}\n".to_vec()
    } else {
        template
            .read_entry(seed_path)
            .unwrap_or_else(|_| b"{}\n".to_vec())
    };

    let mut builder = ClanBuilder::new(manifest);
    for (path, bytes) in template.read_all_entries()? {
        if path == MANIFEST_PATH || path == DATA_PATH {
            continue;
        }
        builder.add_entry(path, bytes);
    }
    builder.add_entry(DATA_PATH, data_bytes);
    builder.build()
}

/// Promote an authored `.clan` into a template app: set
/// `document_type: template`, attach the `app` block, set `view.source = "app"`,
/// and (optionally) write a standalone `app/manifest.yaml` member.
pub fn make_template(clan: &ClanFile, app: AppInfo, opts: MakeTemplateOptions) -> Result<Vec<u8>> {
    let now = Utc::now().to_rfc3339();
    let mut manifest = clan.manifest().clone();

    // The entry the app renders from must exist in the archive.
    if !clan.has_entry(&app.entry) {
        return Err(Error::OutputRejected(format!(
            "app.entry {:?} does not exist in the archive",
            app.entry
        )));
    }

    manifest.document_type = Some("template".into());
    manifest.updated_at = now;
    // An app is not the document it was built from: it gets an identity of
    // its own, so addresses into the source never resolve against the app.
    manifest.document_id = Some(Uuid::new_v4().to_string());
    manifest.view = Some(ViewState {
        present: clan.has_entry(&app.entry),
        renderable: true,
        stale: false,
        source: Some("app".into()),
    });

    let app_manifest_yaml = if opts.embed_app_manifest {
        let yaml = serde_yaml::to_string(&app)
            .map_err(|e| Error::OutputRejected(format!("failed to serialise app block: {e}")))?;
        // Register the member file if it isn't already in the registry.
        if manifest.file_by_path(APP_MANIFEST_PATH).is_none() {
            manifest.files.push(FileEntry {
                id: "app-manifest".into(),
                path: APP_MANIFEST_PATH.into(),
                role: "app-manifest".into(),
                content_type: "application/yaml".into(),
                priority: None,
                sha256: None,
            });
        }
        Some(yaml.into_bytes())
    } else {
        None
    };

    // A template app is not a task — it carries a BARE agent context, not the
    // verbose "produce a rich rendering" brief that `create` seeds. The app
    // owns its presentation; an agent only writes structured data. The context
    // grows from here via the decision chain as the document is filled.
    let schema_path = app
        .schema
        .clone()
        .unwrap_or_else(|| "agent/output-schema.json".into());
    let app_context = format!(
        "# {name}\n\n\
         This is a Napkin app document. The presentation in `{entry}` renders from \
         `shared/data.yaml`; do not generate or edit HTML.\n\n\
         To contribute, write structured fields matching `{schema}` via `patch-data`. \
         Every write is attributed and appended to the decision chain — this context is \
         intentionally minimal and grows as the document is filled.\n",
        name = app.name,
        entry = app.entry,
        schema = schema_path,
    );

    manifest.app = Some(app);

    let mut builder = ClanBuilder::new(manifest);
    for (path, bytes) in clan.read_all_entries()? {
        // Replace the scaffold's verbose context with the bare app context.
        if path == MANIFEST_PATH || path == APP_MANIFEST_PATH || path == "agent/context.md" {
            continue;
        }
        builder.add_entry(path, bytes);
    }
    builder.add_entry("agent/context.md", app_context.into_bytes());
    if let Some(bytes) = app_manifest_yaml {
        builder.add_entry(APP_MANIFEST_PATH, bytes);
    }
    builder.build()
}

// ── Spin-off: branching one document into another app ───────────────────────

/// Options for [`spinoff`].
#[derive(Debug, Clone, Default)]
pub struct SpinoffOptions {
    /// Title for the new document. Defaults to the source's title.
    pub title: String,
    /// Overrides the target app's declared `spinoff.map`.
    pub map: Option<String>,
    /// Override the generated id (must be a UUID v4).
    pub instance_id: Option<String>,
    /// Where the source file lives, recorded in lineage. Defaults to the
    /// `file:///unknown/<id>.clan` form used elsewhere.
    pub source_uri: Option<String>,
}

/// `clan`'s bytes with `manifest.client` set to `client` (or cleared with
/// `None`), and every other entry untouched. The revision id changes, as on
/// any write; `updated_at` does not, because attaching a document to a client
/// is not work done in it and must not reorder the recent list.
pub fn with_client(clan: &ClanFile, client: Option<ClientRef>) -> Result<Vec<u8>> {
    let mut manifest = clan.manifest().clone();
    manifest.next_revision();
    manifest.client = client;
    let mut b = ClanBuilder::new(manifest);
    for (path, bytes) in clan.read_all_entries()? {
        if path != MANIFEST_PATH {
            b.add_entry(path, bytes);
        }
    }
    b.build()
}

/// `clan`'s bytes with `manifest.job` set to `job` (or cleared with `None`),
/// every other entry untouched. Like [`with_client`], it changes the revision
/// id and not `updated_at`: filing a document under a job is not work done in it.
pub fn with_job(clan: &ClanFile, job: Option<String>) -> Result<Vec<u8>> {
    let mut manifest = clan.manifest().clone();
    manifest.next_revision();
    manifest.job = job;
    let mut b = ClanBuilder::new(manifest);
    for (path, bytes) in clan.read_all_entries()? {
        if path != MANIFEST_PATH {
            b.add_entry(path, bytes);
        }
    }
    b.build()
}

/// Branch a finished document into a new document of a different app, carrying
/// its data and its decisions across.
///
/// This is not [`instantiate`] (a blank document from a template) and not
/// [`make_template`] (an app built from a document). It is the third edge: a
/// *working document* becomes the starting point of another app's document,
/// keeping the reasoning that produced it. A brief becomes a production; the
/// strategy that was approved during briefing is still legible — and still
/// attributed — while the film is being made.
///
/// The target app declares the shape of the graft in `app.spinoff`, because the
/// target is what knows its own schema. Both parents are recorded, so the new
/// file states which app it is *and* which exact document authorised it.
///
/// With `app.spinoff.upstream` the source travels whole (Contract 4 §5): its
/// data frozen at `data.upstream.<source document_id>` beside any upstream it
/// held itself, its facts, findings and sources merged into the new
/// document's own, its whole chain, agent branches, merge report and assets,
/// and `lineage.carried` recording what was taken. No address is rewritten,
/// so everything upstream still resolves. Without it the source's data is
/// grafted at `map`, or folded in at the root, as it always was.
pub fn spinoff(template: &ClanFile, source: &ClanFile, opts: SpinoffOptions) -> Result<Vec<u8>> {
    let tpl_manifest = template.manifest();
    if tpl_manifest.document_type.as_deref() != Some("template") {
        return Err(Error::OutputRejected(
            "spinoff expects a template app as the target (document_type: template)".into(),
        ));
    }
    let app = tpl_manifest.app.clone().ok_or_else(|| {
        Error::OutputRejected("target template has no `app` block in its manifest".into())
    })?;
    let declared = app.spinoff.clone().unwrap_or_default();

    let src_manifest = source.manifest();
    let src_app_id = src_manifest.app.as_ref().map(|a| a.app_id.as_str());
    // A source app with its own carry (`by_source`) is carried by it.
    let spec = declared.for_source(src_app_id);
    {
        let ok = declared.accepts_source(src_app_id);
        if !ok {
            return Err(Error::OutputRejected(format!(
                "{} accepts a spin-off from {:?}, but the source is {}",
                app.name,
                spec.accepts,
                src_app_id.unwrap_or("an app-less document"),
            )));
        }
    }
    if let Some(id) = &opts.instance_id {
        if !crate::manifest::is_uuid_v4(id) {
            return Err(Error::OutputRejected(format!(
                "instance_id is not a valid UUID v4: {id}"
            )));
        }
    }

    let map = opts
        .map
        .as_deref()
        .or(spec.map.as_deref())
        .filter(|m| !m.is_empty());
    if spec.upstream {
        if let Some(map) = map {
            return Err(Error::OutputRejected(format!(
                "{} carries a spin-off whole under upstream.<id>, so it takes no map \
                 (given {map:?})",
                app.name
            )));
        }
        if let Some(to) = spec
            .lift
            .values()
            .find(|to| to.split('.').next() == Some(UPSTREAM_KEY))
        {
            return Err(Error::OutputRejected(format!(
                "{} lifts into {to:?}, but upstream is the frozen copy and is read-only",
                app.name
            )));
        }
    }

    let now = Utc::now().to_rfc3339();
    let id = opts
        .instance_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let title = if opts.title.trim().is_empty() {
        src_manifest.title.clone()
    } else {
        opts.title.clone()
    };
    let source_uri = opts
        .source_uri
        .unwrap_or_else(|| format!("file:///unknown/{}.clan", src_manifest.id));

    let src_doc = src_manifest.document_id().to_string();

    // ── the data layer: the source's facts, in the target's shape ──────────
    let src_data_bytes = source.read_entry(DATA_PATH).ok();
    let mut src_data: Value = src_data_bytes
        .as_deref()
        .and_then(|b| serde_yaml::from_slice(b).ok())
        .unwrap_or_else(|| Value::Mapping(Mapping::new()));
    let mut data = Value::Mapping(Mapping::new());
    let mut seeds = Vec::new();

    if spec.upstream {
        if src_data.is_null() {
            src_data = Value::Mapping(Mapping::new());
        }
        // The frozen copy is the source's data less what the source's host
        // derived (`projection`) and what it had carried itself (`upstream`,
        // hoisted beside it below).
        let hoisted = src_data.as_mapping_mut().and_then(|m| {
            m.remove(PROJECTION_KEY);
            m.remove(UPSTREAM_KEY)
        });
        // A lift copies here: the frozen copy stays whole, and the seeded
        // field says where it came from.
        for (from, to) in &spec.lift {
            if let Some(v) = get_dotted(&src_data, from).filter(|v| !v.is_null()) {
                set_dotted(&mut data, to, v.clone());
                seeds.push(seed_decision(
                    SPINOFF_AGENT,
                    "process:spinoff",
                    &id,
                    &src_doc,
                    &src_manifest.title,
                    &app.name,
                    from,
                    to,
                    &now,
                ));
            }
        }
        let mut upstream = Mapping::new();
        upstream.insert(Value::String(src_doc.clone()), src_data);
        if let Some(Value::Mapping(older)) = hoisted {
            for (k, v) in older {
                if !upstream.contains_key(&k) {
                    upstream.insert(k, v);
                }
            }
        }
        set_dotted(&mut data, UPSTREAM_KEY, Value::Mapping(upstream));
    } else {
        // Lift the few fields that belong elsewhere in the target schema,
        // taking them out of the source before the rest is grafted wholesale.
        for (from, to) in &spec.lift {
            if let Some(v) = take_dotted(&mut src_data, from) {
                set_dotted(&mut data, to, v);
            }
        }
        match map {
            Some(path) => set_dotted(&mut data, path, src_data),
            // No declared namespace: fold the source in at the root, without
            // overwriting anything a lift rule has already placed there.
            None => {
                if let (Some(dst), Some(src)) = (data.as_mapping_mut(), src_data.as_mapping()) {
                    for (k, v) in src {
                        if !dst.contains_key(k) {
                            dst.insert(k.clone(), v.clone());
                        }
                    }
                }
            }
        }
    }
    let data_bytes = serde_yaml::to_string(&data)
        .map_err(|e| Error::OutputRejected(format!("failed to serialise spun-off data: {e}")))?
        .into_bytes();

    // ── the decision chain: why these facts are what they are ─────────────
    let mut src_chain = match source.read_entry(CHAIN_PATH) {
        // Carried whole means carried or refused: a chain this SDK cannot
        // read is not silently left behind.
        Ok(b) if spec.upstream => DecisionChain::from_yaml(&b).map_err(|e| {
            Error::OutputRejected(format!(
                "the source's decision chain does not parse, so it cannot be carried: {e}"
            ))
        })?,
        Ok(b) => DecisionChain::from_yaml(&b).unwrap_or_default(),
        Err(_) => DecisionChain::default(),
    };
    let last_decision = src_chain.decisions.iter().find_map(|d| d.id.clone());
    let carried = src_chain.decisions.len();
    if spec.pin_source_decisions {
        for d in &mut src_chain.decisions {
            d.pinned = true;
        }
    }
    let mut chain = DecisionChain::default();
    chain.decisions.append(&mut src_chain.decisions);
    if let Ok(mut tpl_chain) = template
        .read_entry(CHAIN_PATH)
        .and_then(|b| DecisionChain::from_yaml(&b))
    {
        chain.decisions.append(&mut tpl_chain.decisions);
    }
    let what = if spec.upstream {
        format!(
            "its data, frozen under upstream.{src_doc}, its facts, findings, sources, \
             branches and assets, and {carried} decision(s)"
        )
    } else {
        format!("the data layer and {carried} decision(s)")
    };
    let mut marker = Decision::new(
        SPINOFF_AGENT,
        format!("spin off \"{}\" into {}", src_manifest.title, app.name),
        format!(
            "Carried {what} from \"{}\" ({}). \
             Everything below this entry was decided in that document; it stays \
             binding here until something in this one supersedes it.",
            src_manifest.title,
            &src_manifest.id[..8.min(src_manifest.id.len())],
        ),
        now.clone(),
    );
    marker.pinned = true;
    chain.prepend(marker);
    // Newest first: the seeds sit above the marker, in lift order.
    chain.decisions.splice(0..0, seeds);
    let chain_bytes = chain.to_yaml()?;

    // ── the manifest: two parents, because there were two ─────────────────
    let mut manifest = tpl_manifest.clone();
    manifest.born_as(id);
    manifest.title = title;
    manifest.created_at = now.clone();
    manifest.updated_at = now;
    manifest.document_type = Some("document".to_string());
    manifest.app = Some(app.clone());
    manifest.fork = None;
    // Who the source was for, this is for: a spin-off stays with its client.
    manifest.client = src_manifest.client.clone();
    manifest.job = src_manifest.job.clone();
    manifest.lineage = Some(Lineage {
        // The source document is the substantive parent — it is where the
        // content came from. The template is recorded alongside it.
        parent_id: src_manifest.id.clone(),
        parent_uri: source_uri.clone(),
        parent_sha256: Some(source.sha256()),
        delta: format!(
            "spun off from \"{}\" into {} v{}",
            src_manifest.title, app.name, app.version
        ),
        parents: vec![
            ParentRef {
                id: src_manifest.id.clone(),
                sha256: Some(source.sha256()),
                delta: Some("source document: data and decisions".into()),
                agent_id: None,
            },
            ParentRef {
                id: tpl_manifest.id.clone(),
                sha256: Some(template.sha256()),
                delta: Some(format!("template app: {} v{}", app.name, app.version)),
                agent_id: None,
            },
        ],
        // Not a `clan merge` product — two origins, one of them an app.
        merge: false,
        carried: None,
        attached: Vec::new(),
    });
    manifest.view = Some(ViewState {
        present: true,
        renderable: true,
        stale: false,
        source: Some("app".into()),
    });

    // ── the entries: the target's app, the source's assets ────────────────
    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
    for (path, bytes) in template.read_all_entries()? {
        if path == MANIFEST_PATH || path == DATA_PATH || path == CHAIN_PATH {
            continue;
        }
        entries.push((path, bytes));
    }
    let src_entries = source.read_all_entries()?;
    if spec.upstream {
        let lineage = manifest.lineage.as_mut().expect("set above");
        lineage.carried = Some(carry_upstream(
            &mut manifest.files,
            &mut entries,
            source,
            &src_entries,
            &src_doc,
            src_data_bytes.as_deref().unwrap_or_default(),
            last_decision,
            false,
        )?);
        // What the source had linked rides along with its hoisted upstream,
        // so the new document can tell later whether any of it moved on.
        lineage.attached = src_manifest.attached().to_vec();
    } else {
        // Mood boards, logos, reference stills — the material the decisions
        // were made about travels with them. The template's own assets win a
        // collision.
        for (path, bytes) in &src_entries {
            if path.starts_with(ASSET_PREFIX) && !entries.iter().any(|(p, _)| p == path) {
                entries.push((path.clone(), bytes.clone()));
            }
        }
    }

    let mut builder = ClanBuilder::new(manifest);
    for (path, bytes) in entries {
        builder.add_entry(path, bytes);
    }
    builder.add_entry(DATA_PATH, data_bytes);
    builder.add_entry(CHAIN_PATH, chain_bytes);
    builder.build()
}

/// What [`take_upstream`] wrote.
#[derive(Debug, Clone)]
pub struct TakenUpstream {
    /// The child's next revision.
    pub bytes: Vec<u8>,
    /// How many of the parent's decisions were new to the child.
    pub decisions_taken: usize,
}

/// Take the direct parent's newer version into a document spun off from it
/// with `upstream` (Contract 4 §5.5, reversed for spin-offs on 2026-11-09).
///
/// The frozen copy at `data.upstream.<parent>` is replaced by the parent's
/// data as it is now (less its `projection` and its `upstream`, whose entries
/// replace the hoisted siblings the parent holds), the parent's facts,
/// findings and sources replace the child's copies by id, except an entry the
/// child reviewed itself (a pin it corrected, a finding it verified or
/// rejected stays as it is) and the child's own entries, which are kept;
/// the parent's decisions the child has not seen are carried, pinned,
/// under `marker`, new branches, merge reports and assets are copied, and
/// `lineage.carried` is moved on to what was taken. The child's own fields,
/// chain and lock are not touched: no address is remapped.
///
/// `marker` is the decision that records the update; the caller (the host)
/// attributes it. Refused when `child` was not spun off with `upstream`, or
/// `parent` is not the document it carried.
pub fn take_upstream(
    child: &ClanFile,
    parent: &ClanFile,
    marker: Decision,
) -> Result<TakenUpstream> {
    let carried = child.manifest().carried().cloned().ok_or_else(|| {
        Error::OutputRejected(
            "this document was not spun off with upstream, so it has no parent to update from"
                .into(),
        )
    })?;
    let parent_doc = parent.manifest().document_id().to_string();
    if parent_doc != carried.document_id {
        return Err(Error::OutputRejected(format!(
            "this document carries {}, not {parent_doc}",
            carried.document_id
        )));
    }

    // ── the data: the frozen copy, replaced; the child's own fields kept ──
    let mut data: Value = child
        .read_entry(DATA_PATH)
        .ok()
        .and_then(|b| serde_yaml::from_slice(&b).ok())
        .filter(|v: &Value| v.is_mapping())
        .unwrap_or_else(|| Value::Mapping(Mapping::new()));
    let parent_data_bytes = parent.read_entry(DATA_PATH).unwrap_or_default();
    let mut parent_data: Value = serde_yaml::from_slice(&parent_data_bytes)
        .ok()
        .filter(|v: &Value| v.is_mapping())
        .unwrap_or_else(|| Value::Mapping(Mapping::new()));
    let hoisted = parent_data.as_mapping_mut().and_then(|m| {
        m.remove(PROJECTION_KEY);
        m.remove(UPSTREAM_KEY)
    });
    let mut upstream = match get_dotted(&data, UPSTREAM_KEY) {
        Some(Value::Mapping(m)) => m.clone(),
        _ => Mapping::new(),
    };
    upstream.insert(Value::String(parent_doc.clone()), parent_data);
    if let Some(Value::Mapping(older)) = hoisted {
        // The parent's own copy of what it carried is the newer one.
        for (k, v) in older {
            upstream.insert(k, v);
        }
    }
    set_dotted(&mut data, UPSTREAM_KEY, Value::Mapping(upstream));
    let data_bytes = serde_yaml::to_string(&data)
        .map_err(|e| Error::OutputRejected(format!("failed to serialise the updated data: {e}")))?
        .into_bytes();

    // ── the chain: the parent's decisions the child has not seen ──────────
    let child_chain = match child.read_entry(CHAIN_PATH) {
        Ok(b) => DecisionChain::from_yaml(&b)?,
        Err(_) => DecisionChain::default(),
    };
    let parent_chain = match parent.read_entry(CHAIN_PATH) {
        Ok(b) => DecisionChain::from_yaml(&b).map_err(|e| {
            Error::OutputRejected(format!(
                "the parent's decision chain does not parse, so it cannot be carried: {e}"
            ))
        })?,
        Err(_) => DecisionChain::default(),
    };
    let held: std::collections::BTreeSet<&str> = child_chain
        .decisions
        .iter()
        .filter_map(|d| d.id.as_deref())
        .collect();
    // Newest first: everything above the last decision carried, less any the
    // child holds already. Without a recorded last decision, every id the
    // child does not hold.
    let above = carried
        .last_decision
        .as_deref()
        .and_then(|last| {
            parent_chain
                .decisions
                .iter()
                .position(|d| d.id.as_deref() == Some(last))
        })
        .unwrap_or(parent_chain.decisions.len());
    let mut taken: Vec<Decision> = parent_chain.decisions[..above]
        .iter()
        .filter(|d| d.id.as_deref().is_some_and(|id| !held.contains(id)))
        .cloned()
        .collect();
    for d in &mut taken {
        d.pinned = true;
    }
    let decisions_taken = taken.len();
    // The member entries this document reviewed itself (a decision of its own
    // targets `<here>#facts[…]`, `#findings[…]` or `#sources[…]`): its copy
    // stands. Every other entry takes the parent's newer copy.
    let here = child.manifest().document_id().to_string();
    let reviewed: std::collections::BTreeSet<String> = child_chain
        .decisions
        .iter()
        .flat_map(|d| d.targets.iter())
        .filter_map(|t| t.strip_prefix(&format!("{here}#")).map(str::to_string))
        .filter_map(|p| {
            ["facts[", "findings[", "sources["]
                .iter()
                .find_map(|k| p.strip_prefix(k))
                .and_then(|r| r.split(']').next())
                .map(str::to_string)
        })
        .collect();
    let mut chain = DecisionChain::default();
    chain.decisions.push(marker);
    chain.decisions.extend(taken);
    chain.decisions.extend(child_chain.decisions);
    let chain_bytes = chain.to_yaml()?;

    // ── the entries: members merged, new carried paths copied ─────────────
    let mut manifest = child.manifest().clone();
    let mut entries: Vec<(String, Vec<u8>)> = child
        .read_all_entries()?
        .into_iter()
        .filter(|(p, _)| p != MANIFEST_PATH && p != DATA_PATH && p != CHAIN_PATH)
        .collect();
    let parent_entries = parent.read_all_entries()?;
    let mut next = Carried {
        document_id: parent_doc.clone(),
        data_sha256: sha256_prefixed(&parent_data_bytes),
        facts_sha256: None,
        findings_sha256: None,
        sources_sha256: None,
        last_decision: parent_chain.decisions.iter().find_map(|d| d.id.clone()),
    };
    let pm = parent.manifest();
    for (role, default_path, key) in MEMBERS {
        let path = pm
            .files_with_role(role)
            .next()
            .map_or(default_path, |f| f.path.as_str());
        let Some((_, src)) = parent_entries.iter().find(|(p, _)| p == path) else {
            continue;
        };
        let hash = Some(sha256_prefixed(src));
        match role {
            "pinned-facts" => next.facts_sha256 = hash,
            "findings" => next.findings_sha256 = hash,
            _ => next.sources_sha256 = hash,
        }
        let own = entries.iter().position(|(p, _)| p == path);
        let merged = refresh_member(
            own.map(|i| entries[i].1.as_slice()),
            src,
            key,
            path,
            &reviewed,
        )?;
        match own {
            Some(i) => entries[i].1 = merged,
            None => entries.push((path.to_string(), merged)),
        }
        register_carried(
            &mut manifest.files,
            pm,
            path,
            Some(yaml_entry(role, path, role)),
        );
    }
    if let Some((_, bytes)) = parent_entries.iter().find(|(p, _)| p == MERGE_REPORT_PATH) {
        let path = format!("{UPSTREAM_PREFIX}{parent_doc}/{MERGE_REPORT_PATH}");
        match entries.iter().position(|(p, _)| *p == path) {
            Some(i) => entries[i].1 = bytes.clone(),
            None => entries.push((path.clone(), bytes.clone())),
        }
        let id = format!("upstream-merge-report-{parent_doc}");
        register_carried(
            &mut manifest.files,
            pm,
            &path,
            Some(yaml_entry(&id, &path, "upstream-merge-report")),
        );
    }
    for (path, bytes) in &parent_entries {
        let carries = path.starts_with(BRANCH_PREFIX)
            || path.starts_with(UPSTREAM_PREFIX)
            || path.starts_with(ASSET_PREFIX);
        if !carries || entries.iter().any(|(p, _)| p == path) {
            continue;
        }
        entries.push((path.clone(), bytes.clone()));
        register_carried(&mut manifest.files, pm, path, None);
    }

    // ── the manifest: the next revision, carrying what was taken ──────────
    manifest.next_revision();
    manifest.updated_at = Utc::now().to_rfc3339();
    if let Some(lineage) = manifest.lineage.as_mut() {
        lineage.parent_id = pm.id.clone();
        lineage.parent_sha256 = Some(parent.sha256());
        lineage.carried = Some(next);
    }
    let mut builder = ClanBuilder::new(manifest);
    for (path, bytes) in entries {
        builder.add_entry(path, bytes);
    }
    builder.add_entry(DATA_PATH, data_bytes);
    builder.add_entry(CHAIN_PATH, chain_bytes);
    Ok(TakenUpstream {
        bytes: builder.build()?,
        decisions_taken,
    })
}

/// Carry what an upstream spin-off takes besides the data and the chain
/// (Contract 4 §5.2) into the new document's `entries` and `files`, and say
/// what was taken (§5.3).
///
/// `entries` holds the target's own entries on the way in; the target keeps
/// every path it already has except a member, which it shares with the source
/// by merging.
#[allow(clippy::too_many_arguments)]
pub(crate) fn carry_upstream(
    files: &mut Vec<FileEntry>,
    entries: &mut Vec<(String, Vec<u8>)>,
    source: &ClanFile,
    src_entries: &[(String, Vec<u8>)],
    src_doc: &str,
    src_data_bytes: &[u8],
    last_decision: Option<String>,
    source_wins: bool,
) -> Result<Carried> {
    let src_manifest = source.manifest();
    let mut carried = Carried {
        document_id: src_doc.to_string(),
        data_sha256: sha256_prefixed(src_data_bytes),
        facts_sha256: None,
        findings_sha256: None,
        sources_sha256: None,
        last_decision,
    };

    // Facts, findings and sources: merged by id into the target's own, so the
    // new document verifies, rejects and corrects its copies.
    for (role, default_path, key) in MEMBERS {
        let path = src_manifest
            .files_with_role(role)
            .next()
            .map_or(default_path, |f| f.path.as_str());
        let Some((_, src_bytes)) = src_entries.iter().find(|(p, _)| p == path) else {
            continue;
        };
        let hash = Some(sha256_prefixed(src_bytes));
        match role {
            "pinned-facts" => carried.facts_sha256 = hash,
            "findings" => carried.findings_sha256 = hash,
            _ => carried.sources_sha256 = hash,
        }
        let own = entries.iter().position(|(p, _)| p == path);
        let merged = merge_member(own.map(|i| entries[i].1.as_slice()), src_bytes, key, path)?;
        match own {
            Some(i) => entries[i].1 = merged,
            None => entries.push((path.to_string(), merged)),
        }
        register_carried(
            files,
            src_manifest,
            path,
            Some(yaml_entry(role, path, role)),
        );
    }

    // The source's merge report names the source's data, which is no longer
    // at the root, so it goes beside the frozen copy.
    if let Some((_, bytes)) = src_entries.iter().find(|(p, _)| p == MERGE_REPORT_PATH) {
        let path = format!("{UPSTREAM_PREFIX}{src_doc}/{MERGE_REPORT_PATH}");
        put_entry(entries, &path, bytes, true);
        let id = format!("upstream-merge-report-{src_doc}");
        register_carried(
            files,
            src_manifest,
            &path,
            Some(yaml_entry(&id, &path, "upstream-merge-report")),
        );
    }

    // Unmerged agent branches, merge reports carried from further upstream,
    // and the assets: each at its own path, the target's own winning.
    for (path, bytes) in src_entries {
        let carries = path.starts_with(BRANCH_PREFIX)
            || path.starts_with(UPSTREAM_PREFIX)
            || path.starts_with(ASSET_PREFIX);
        if !carries {
            continue;
        }
        if !put_entry(entries, path, bytes, source_wins) {
            continue;
        }
        register_carried(files, src_manifest, path, None);
    }
    Ok(carried)
}

/// Put `bytes` at `path` in `entries`. A path already there is replaced when
/// `overwrite` is set and kept otherwise. Returns whether the entry is new,
/// so the caller registers a new path once.
fn put_entry(
    entries: &mut Vec<(String, Vec<u8>)>,
    path: &str,
    bytes: &[u8],
    overwrite: bool,
) -> bool {
    match entries.iter().position(|(p, _)| p == path) {
        Some(i) => {
            if overwrite {
                entries[i].1 = bytes.to_vec();
            }
            false
        }
        None => {
            entries.push((path.to_string(), bytes.to_vec()));
            true
        }
    }
}

/// Merge the source's copy of a list member into the target's: the target's
/// entries first, then the source's in order, skipping an id the target
/// already holds. A target with no entries takes the source's bytes unchanged.
fn merge_member(own: Option<&[u8]>, src: &[u8], key: &str, path: &str) -> Result<Vec<u8>> {
    let parse = |bytes: &[u8], whose: &str| -> Result<Mapping> {
        if bytes.iter().all(u8::is_ascii_whitespace) {
            return Ok(Mapping::new());
        }
        match serde_yaml::from_slice::<Value>(bytes) {
            Ok(Value::Mapping(m)) => Ok(m),
            Ok(Value::Null) => Ok(Mapping::new()),
            _ => Err(Error::OutputRejected(format!(
                "{whose} {path} is not a mapping with a `{key}` list"
            ))),
        }
    };
    let list = |doc: &Mapping| match doc.get(key) {
        Some(Value::Sequence(items)) => items.clone(),
        _ => Vec::new(),
    };
    let mut doc = match own {
        Some(bytes) => parse(bytes, "the target's")?,
        None => Mapping::new(),
    };
    let mut items = list(&doc);
    if items.is_empty() {
        return Ok(src.to_vec());
    }
    let theirs = list(&parse(src, "the source's")?);
    let id_of = |v: &Value| v.get("id").and_then(Value::as_str).map(str::to_string);
    let held: std::collections::BTreeSet<String> = items.iter().filter_map(id_of).collect();
    items.extend(
        theirs
            .into_iter()
            .filter(|v| id_of(v).map_or(true, |id| !held.contains(&id))),
    );
    doc.insert(Value::String(key.to_string()), Value::Sequence(items));
    serde_yaml::to_string(&doc)
        .map(String::into_bytes)
        .map_err(|e| Error::OutputRejected(format!("failed to serialise merged {path}: {e}")))
}

/// [`merge_member`] for a later update: the parent's entries in its order,
/// each replaced by the child's copy when the child `reviewed` it, then the
/// child's own entries the parent does not hold.
fn refresh_member(
    own: Option<&[u8]>,
    src: &[u8],
    key: &str,
    path: &str,
    reviewed: &std::collections::BTreeSet<String>,
) -> Result<Vec<u8>> {
    let parse = |bytes: &[u8]| -> Mapping {
        match serde_yaml::from_slice::<Value>(bytes) {
            Ok(Value::Mapping(m)) => m,
            _ => Mapping::new(),
        }
    };
    let list = |doc: &Mapping| match doc.get(key) {
        Some(Value::Sequence(items)) => items.clone(),
        _ => Vec::new(),
    };
    let mut doc = own.map(parse).unwrap_or_default();
    let mine = list(&doc);
    if mine.is_empty() {
        return Ok(src.to_vec());
    }
    let theirs = list(&parse(src));
    let id_of = |v: &Value| v.get("id").and_then(Value::as_str).map(str::to_string);
    let theirs_ids: std::collections::BTreeSet<String> = theirs.iter().filter_map(id_of).collect();
    let mut items: Vec<Value> = theirs
        .into_iter()
        .map(|t| match id_of(&t) {
            Some(id) if reviewed.contains(&id) => mine
                .iter()
                .find(|m| id_of(m).as_deref() == Some(id.as_str()))
                .cloned()
                .unwrap_or(t),
            _ => t,
        })
        .collect();
    items.extend(
        mine.into_iter()
            .filter(|m| id_of(m).map_or(true, |id| !theirs_ids.contains(&id))),
    );
    doc.insert(Value::String(key.to_string()), Value::Sequence(items));
    serde_yaml::to_string(&doc)
        .map(String::into_bytes)
        .map_err(|e| Error::OutputRejected(format!("failed to serialise refreshed {path}: {e}")))
}

/// Register a carried entry in the new document's `files[]` under the
/// source's own registration, or `fallback` when the source had none. The
/// target's registration of the path wins; a source id the target already
/// uses for another path gets the source's document id appended.
fn register_carried(
    files: &mut Vec<FileEntry>,
    src: &Manifest,
    path: &str,
    fallback: Option<FileEntry>,
) {
    if files.iter().any(|f| f.path == path) {
        return;
    }
    let Some(mut entry) = src.file_by_path(path).cloned().or(fallback) else {
        return;
    };
    entry.sha256 = None; // `ClanBuilder::build` hashes the bytes written
    if files.iter().any(|f| f.id == entry.id) {
        entry.id = format!("{}-{}", entry.id, src.document_id());
    }
    files.push(entry);
}

/// A YAML member's registry entry; `ClanBuilder::build` fills in its hash.
fn yaml_entry(id: &str, path: &str, role: &str) -> FileEntry {
    FileEntry {
        id: id.to_string(),
        path: path.to_string(),
        role: role.to_string(),
        content_type: "application/yaml".into(),
        priority: None,
        sha256: None,
    }
}

/// The edit decision that records one lift of an upstream spin-off (Contract
/// 4 §5.4): the seeded field, the upstream address it was copied from, and why
/// there was nothing else to do.
#[allow(clippy::too_many_arguments)]
pub(crate) fn seed_decision(
    agent: &str,
    actor: &str,
    doc: &str,
    src_doc: &str,
    src_title: &str,
    app_name: &str,
    from: &str,
    to: &str,
    now: &str,
) -> Decision {
    let decided = format!("Seeded {to} from {from} in \"{src_title}\".");
    let cite = format!("{src_doc}#{from}");
    Decision {
        kind: Some("edit".into()),
        actor: Some(actor.into()),
        targets: vec![format!("{doc}#{to}")],
        cites: vec![cite.clone()],
        fields_changed: vec![to.split('.').next().unwrap_or(to).to_string()],
        pinned: true,
        reasoning: Some(Reasoning {
            decided: decided.clone(),
            because: vec![ReasonPoint {
                point: format!("{app_name} seeds {to} from the upstream {from}"),
                cites: vec![cite],
                ..Default::default()
            }],
            rejected: Vec::new(),
            only_option: Some(
                "The target app declares this lift; the value is copied unchanged.".into(),
            ),
            certainty: Certainty {
                level: "high".into(),
                why: "the value is the upstream value, copied".into(),
                ..Default::default()
            },
            would_change_if: format!(
                "a person edits {to}, or the document takes newer upstream data"
            ),
            ..Default::default()
        }),
        ..Decision::new(agent, "seed", decided, now)
    }
}

/// Descend a dotted path, creating mappings as needed, and set a value.
pub(crate) fn set_dotted(root: &mut Value, path: &str, value: Value) {
    let keys: Vec<&str> = path.split('.').filter(|s| !s.is_empty()).collect();
    let Some((last, parents)) = keys.split_last() else {
        *root = value;
        return;
    };
    let mut cur = root;
    for k in parents {
        if !cur.is_mapping() {
            *cur = Value::Mapping(Mapping::new());
        }
        let key = Value::String((*k).to_string());
        let m = cur.as_mapping_mut().expect("just ensured mapping");
        if !m.contains_key(&key) {
            m.insert(key.clone(), Value::Mapping(Mapping::new()));
        }
        cur = m.get_mut(&key).expect("just inserted");
    }
    if !cur.is_mapping() {
        *cur = Value::Mapping(Mapping::new());
    }
    cur.as_mapping_mut()
        .expect("just ensured mapping")
        .insert(Value::String((*last).to_string()), value);
}

/// The value at a dotted path, if it is there.
pub(crate) fn get_dotted<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
    let keys: Vec<&str> = path.split('.').filter(|s| !s.is_empty()).collect();
    if keys.is_empty() {
        return None;
    }
    keys.iter().try_fold(root, |cur, k| {
        cur.as_mapping()?.get(Value::String((*k).to_string()))
    })
}

/// Remove and return the value at a dotted path, if it is there.
pub(crate) fn take_dotted(root: &mut Value, path: &str) -> Option<Value> {
    let keys: Vec<&str> = path.split('.').filter(|s| !s.is_empty()).collect();
    let (last, parents) = keys.split_last()?;
    let mut cur = root;
    for k in parents {
        cur = cur
            .as_mapping_mut()?
            .get_mut(Value::String((*k).to_string()))?;
    }
    cur.as_mapping_mut()?
        .remove(Value::String((*last).to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::create::{create, CreateOptions};
    use crate::manifest::SpinoffSpec;

    /// Build a minimal template app: scaffold a doc, add an authored view,
    /// then promote it with `make_template`.
    fn make_test_template() -> ClanFile {
        let bytes = create(CreateOptions {
            title: "Brief Maker".into(),
            brief: "A template app".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap();
        let clan = ClanFile::from_bytes(bytes).unwrap();
        let app = AppInfo {
            home: None,
            name: "Brief Maker".into(),
            app_id: "ie.napkin.brief".into(),
            version: "1.0.0".into(),
            icon: None,
            entry: "human/index.html".into(),
            schema: Some("agent/output-schema.json".into()),
            prompt_templates: vec![],
            data_seed: None,
            spinoff: None,
            attach: None,
        };
        let tpl = make_template(&clan, app, MakeTemplateOptions::default()).unwrap();
        ClanFile::from_bytes(tpl).unwrap()
    }

    #[test]
    fn make_template_marks_app_and_validates() {
        let tpl = make_test_template();
        let m = tpl.manifest();
        assert_eq!(m.document_type.as_deref(), Some("template"));
        assert_eq!(m.app.as_ref().unwrap().app_id, "ie.napkin.brief");
        assert_eq!(m.view.as_ref().unwrap().source.as_deref(), Some("app"));
        assert!(
            tpl.has_entry(APP_MANIFEST_PATH),
            "app/manifest.yaml written"
        );
        assert!(
            m.structural_problems().is_empty(),
            "{:?}",
            m.structural_problems()
        );
    }

    #[test]
    fn instantiate_links_lineage_and_resets_data() {
        let tpl = make_test_template();
        let inst_bytes = instantiate(
            &tpl,
            InstantiateOptions {
                title: "My Brief".into(),
                fresh_data: true,
                ..Default::default()
            },
        )
        .unwrap();
        let inst = ClanFile::from_bytes(inst_bytes).unwrap();
        let m = inst.manifest();

        assert_eq!(m.title, "My Brief");
        assert_eq!(m.document_type.as_deref(), Some("document"));
        assert_ne!(m.id, tpl.manifest().id, "instance gets a fresh id");
        let lineage = m.lineage.as_ref().expect("instance has lineage");
        assert_eq!(lineage.parent_id, tpl.manifest().id);
        assert_eq!(
            lineage.parent_sha256.as_deref(),
            Some(tpl.sha256().as_str())
        );
        assert_eq!(m.view.as_ref().unwrap().source.as_deref(), Some("app"));
        assert_eq!(inst.read_entry_string(DATA_PATH).unwrap().trim(), "{}");
        // The instance is a normal, valid document.
        assert!(m.structural_problems().is_empty());
    }

    #[test]
    fn instantiate_sample_mode_copies_seed_data() {
        // Promote a template whose data layer carries seed content.
        let bytes = create(CreateOptions {
            title: "Seeded".into(),
            brief: "seed".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap();
        let mut clan = ClanFile::from_bytes(bytes).unwrap();
        // Rebuild with seed data in shared/data.yaml.
        let mut b = ClanBuilder::new(clan.manifest().clone());
        for (p, by) in clan.read_all_entries().unwrap() {
            if p == DATA_PATH {
                continue;
            }
            b.add_entry(p, by);
        }
        b.add_entry(DATA_PATH, b"vendor: Acme\n".to_vec());
        clan = ClanFile::from_bytes(b.build().unwrap()).unwrap();

        let app = AppInfo {
            home: None,
            name: "Seeded".into(),
            app_id: "ie.napkin.seeded".into(),
            version: "1.0.0".into(),
            icon: None,
            entry: "human/index.html".into(),
            schema: None,
            prompt_templates: vec![],
            data_seed: None,
            spinoff: None,
            attach: None,
        };
        let tpl = ClanFile::from_bytes(
            make_template(&clan, app, MakeTemplateOptions::default()).unwrap(),
        )
        .unwrap();

        let inst = ClanFile::from_bytes(
            instantiate(
                &tpl,
                InstantiateOptions {
                    fresh_data: false,
                    ..Default::default()
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert!(inst.read_entry_string(DATA_PATH).unwrap().contains("Acme"));
    }

    #[test]
    fn instantiate_rejects_non_template() {
        let bytes = create(CreateOptions {
            title: "Plain".into(),
            brief: "x".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap();
        let clan = ClanFile::from_bytes(bytes).unwrap();
        assert!(instantiate(&clan, InstantiateOptions::default()).is_err());
    }

    /// A source document that has been through an agent: real data, real
    /// reasoning, and an asset the reasoning was about.
    fn filled_source(app_id: &str) -> ClanFile {
        let bytes = create(CreateOptions {
            title: "Acme Brief".into(),
            brief: "a creative brief".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap();
        let clan = ClanFile::from_bytes(bytes).unwrap();

        let mut manifest = clan.manifest().clone();
        manifest.app = Some(AppInfo {
            home: None,
            name: "Brief Maker".into(),
            app_id: app_id.into(),
            version: "1.0.0".into(),
            icon: None,
            entry: "human/index.html".into(),
            schema: None,
            prompt_templates: vec![],
            data_seed: None,
            spinoff: None,
            attach: None,
        });
        let mut chain = DecisionChain::default();
        chain.decisions.push(Decision::new(
            "strategy-model",
            "set single_minded_proposition",
            "the only claim the product can actually support",
            "2026-01-01T00:00:00Z",
        ));
        let mut builder = ClanBuilder::new(manifest);
        for (path, bytes) in clan.read_all_entries().unwrap() {
            if path == MANIFEST_PATH || path == DATA_PATH || path == CHAIN_PATH {
                continue;
            }
            builder.add_entry(path, bytes);
        }
        builder.add_entry(
            DATA_PATH,
            b"project_name: Acme\ninsight: people forget\n".to_vec(),
        );
        builder.add_entry(CHAIN_PATH, chain.to_yaml().unwrap());
        builder.add_entry("human/assets/mood-1.png", b"\x89PNG fake".to_vec());
        ClanFile::from_bytes(builder.build().unwrap()).unwrap()
    }

    fn film_template(spec: Option<SpinoffSpec>) -> ClanFile {
        let bytes = create(CreateOptions {
            title: "Advertising Studio".into(),
            brief: "a production".into(),
            document_type: None,
            no_render: false,
            schema: None,
        })
        .unwrap();
        let source = ClanFile::from_bytes(bytes).unwrap();
        let app = AppInfo {
            home: None,
            name: "Advertising Studio".into(),
            app_id: "ie.napkin.film".into(),
            version: "0.1.0".into(),
            icon: None,
            entry: "human/index.html".into(),
            schema: None,
            prompt_templates: vec![],
            data_seed: None,
            spinoff: spec,
            attach: None,
        };
        let bytes = make_template(&source, app, MakeTemplateOptions::default()).unwrap();
        ClanFile::from_bytes(bytes).unwrap()
    }

    fn spec_for_film() -> SpinoffSpec {
        SpinoffSpec {
            accepts: vec!["ie.napkin.brief".into()],
            map: Some("brief".into()),
            lift: [("project_name".to_string(), "project.name".to_string())]
                .into_iter()
                .collect(),
            pin_source_decisions: true,
            upstream: false,
            by_source: Default::default(),
        }
    }

    #[test]
    fn new_documents_get_an_identity_of_their_own() {
        let tpl = make_test_template();
        let tpl_doc = tpl.manifest().document_id().to_string();
        let born = create(CreateOptions {
            title: "x".into(),
            brief: "y".into(),
            document_type: None,
            no_render: true,
            schema: None,
        })
        .unwrap();
        let born = ClanFile::from_bytes(born).unwrap();
        assert_eq!(
            born.manifest().document_id.as_deref(),
            Some(born.manifest().id.as_str()),
            "create: identity is the first revision's id"
        );

        let inst = ClanFile::from_bytes(instantiate(&tpl, InstantiateOptions::default()).unwrap())
            .unwrap();
        let m = inst.manifest();
        assert_eq!(m.document_id.as_deref(), Some(m.id.as_str()));
        assert_ne!(m.document_id(), tpl_doc, "an instance is not its template");

        let source = filled_source("ie.napkin.brief");
        let template = film_template(Some(spec_for_film()));
        let spun =
            ClanFile::from_bytes(spinoff(&template, &source, SpinoffOptions::default()).unwrap())
                .unwrap();
        let m = spun.manifest();
        assert_eq!(m.document_id.as_deref(), Some(m.id.as_str()));
        assert_ne!(m.document_id(), source.manifest().document_id());
        assert_ne!(m.document_id(), template.manifest().document_id());

        // make_template: the app is not the document it was built from.
        let src = ClanFile::from_bytes(
            create(CreateOptions {
                title: "src".into(),
                brief: "b".into(),
                document_type: None,
                no_render: false,
                schema: None,
            })
            .unwrap(),
        )
        .unwrap();
        let app = tpl.manifest().app.clone().unwrap();
        let made =
            ClanFile::from_bytes(make_template(&src, app, MakeTemplateOptions::default()).unwrap())
                .unwrap();
        assert_ne!(made.manifest().document_id(), src.manifest().document_id());
        assert!(crate::validate::validate(&made).is_valid());
    }

    #[test]
    fn spinoff_grafts_data_and_carries_reasoning() {
        let source = filled_source("ie.napkin.brief");
        let template = film_template(Some(spec_for_film()));

        let out = spinoff(&template, &source, SpinoffOptions::default()).unwrap();
        let clan = ClanFile::from_bytes(out).unwrap();

        // The brief landed where the target app said it would, and the lifted
        // key went somewhere else entirely.
        let data: serde_yaml::Value =
            serde_yaml::from_slice(&clan.read_entry(DATA_PATH).unwrap()).unwrap();
        assert_eq!(data["brief"]["insight"], Value::from("people forget"));
        assert_eq!(data["project"]["name"], Value::from("Acme"));
        // A lifted key is moved, not copied.
        assert!(data["brief"].get("project_name").is_none());

        // The reasoning came with it, under a marker that says where from.
        let chain = DecisionChain::from_yaml(&clan.read_entry(CHAIN_PATH).unwrap()).unwrap();
        assert_eq!(chain.decisions[0].agent, "napkin-spinoff");
        assert!(chain
            .decisions
            .iter()
            .any(|d| { d.agent == "strategy-model" && d.rationale.contains("actually support") }));
        // Pinned, so compression can never eat the reasoning behind facts this
        // document is now built on.
        assert!(chain.decisions.iter().all(|d| d.pinned));

        // The material the decisions were about travels too.
        assert!(clan.has_entry("human/assets/mood-1.png"));

        // Two origins, both recorded: which app this is, and what authorised it.
        let lineage = clan.manifest().lineage.as_ref().unwrap();
        assert_eq!(lineage.parent_id, source.manifest().id);
        assert_eq!(lineage.parents.len(), 2);
        assert!(!lineage.merge, "a spin-off is not a merge product");
        assert_eq!(
            clan.manifest().app.as_ref().unwrap().app_id,
            "ie.napkin.film"
        );
        assert_eq!(clan.manifest().document_type.as_deref(), Some("document"));
    }

    #[test]
    fn spinoff_carries_the_sources_client_and_adds_none_when_it_had_none() {
        let template = film_template(Some(spec_for_film()));

        // A source with no client: the spin-off has none, and its manifest
        // text does not mention the field at all (older readers see no change).
        let plain = filled_source("ie.napkin.brief");
        let out =
            ClanFile::from_bytes(spinoff(&template, &plain, SpinoffOptions::default()).unwrap())
                .unwrap();
        assert!(out.manifest().client.is_none());
        assert!(!String::from_utf8(out.read_entry("manifest.yaml").unwrap())
            .unwrap()
            .contains("client:"));

        // A source for Client A: the spin-off is for Client A.
        let mut b = crate::container::ClanBuilder::new(plain.manifest().clone());
        b.manifest_mut().client = Some(crate::manifest::ClientRef {
            id: "cli_0a1b2c3d".into(),
            name: "Client A".into(),
        });
        for (p, bytes) in plain.read_all_entries().unwrap() {
            if p != "manifest.yaml" {
                b.add_entry(p, bytes);
            }
        }
        let source = ClanFile::from_bytes(b.build().unwrap()).unwrap();
        let out =
            ClanFile::from_bytes(spinoff(&template, &source, SpinoffOptions::default()).unwrap())
                .unwrap();
        let client = out.manifest().client.as_ref().expect("client carried");
        assert_eq!(client.id, "cli_0a1b2c3d");
        assert_eq!(client.name, "Client A");
    }

    #[test]
    fn spinoff_refuses_a_source_the_app_does_not_accept() {
        let source = filled_source("ie.napkin.ooh");
        let template = film_template(Some(spec_for_film()));
        let err = spinoff(&template, &source, SpinoffOptions::default()).unwrap_err();
        assert!(
            err.to_string().contains("ie.napkin.ooh"),
            "the refusal should name the source app: {err}"
        );
    }

    #[test]
    fn spinoff_without_a_declared_map_folds_in_at_the_root() {
        let source = filled_source("ie.napkin.brief");
        let template = film_template(None);
        let out = spinoff(&template, &source, SpinoffOptions::default()).unwrap();
        let clan = ClanFile::from_bytes(out).unwrap();
        let data: serde_yaml::Value =
            serde_yaml::from_slice(&clan.read_entry(DATA_PATH).unwrap()).unwrap();
        assert_eq!(data["insight"], Value::from("people forget"));
        // No spec at all still pins carried reasoning — Default agrees with serde.
        let chain = DecisionChain::from_yaml(&clan.read_entry(CHAIN_PATH).unwrap()).unwrap();
        assert!(chain.decisions.iter().all(|d| d.pinned));
    }

    #[test]
    fn spinoff_rejects_a_non_template_target() {
        let source = filled_source("ie.napkin.brief");
        let not_a_template = filled_source("ie.napkin.brief");
        let err = spinoff(&not_a_template, &source, SpinoffOptions::default()).unwrap_err();
        assert!(err.to_string().contains("template"), "{err}");
    }

    #[test]
    fn dotted_helpers_create_and_move() {
        let mut v = Value::Mapping(Mapping::new());
        set_dotted(&mut v, "a.b.c", Value::from(1));
        assert_eq!(v["a"]["b"]["c"], Value::from(1));
        assert_eq!(take_dotted(&mut v, "a.b.c"), Some(Value::from(1)));
        assert_eq!(take_dotted(&mut v, "a.b.c"), None);
        assert_eq!(take_dotted(&mut v, "nope.nothing"), None);
    }
}
