// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Brand Clan (`docs/contracts/brand-clan.md`): one CLAN document of the
//! app `ie.napkin.brand` per look of a client's brand.
//!
//! `shared/data.yaml` is the **published** Brand Bible and changes only when a
//! person publishes or accepts a version, so a work document's frozen copy
//! (and `linked_status`, which hashes that file) never sees a draft or a
//! waiting version. Those live in `app/brand/state.yaml`; every published
//! version is kept read-only in `app/brand/versions/v<N>.yaml`.
//!
//! Everything here is `(store, ctx, input) -> reply` over a [`DocStore`], so
//! it runs unchanged on the server, the desktop and in the browser, and
//! [`call`] is the one entry the three shells route to. No filesystem, no
//! network: wasm32-clean.

mod diff;

use clan_sdk::{
    hash::sha256_prefixed, AgentOutput, ClanFile, DecisionEntry, PackOptions, MANIFEST_PATH,
};
use serde_json::{json, Map, Value};

use crate::clients::{self, ClientRecord};
use crate::ctx::Ctx;
use crate::document::{Change, Document};
use crate::error::{HostError, HostResult};
use crate::library::{self, AttachMode, Backref};
use crate::ops::{self, edit};
use crate::store::{DocId, DocStore};

pub use diff::{apply_taken, changes, merge_proposal, summary};

/// The Brand Clan app's id.
pub const APP_ID: &str = "ie.napkin.brand";
const DATA: &str = "shared/data.yaml";
const STATE: &str = "app/brand/state.yaml";
const SCHEMA: &str = "agent/output-schema.json";
const ASSETS: &str = "human/assets/";

/// What a call answers: JSON, or a file's bytes.
pub enum Reply {
    Json(Value),
    Bytes {
        content_type: String,
        bytes: Vec<u8>,
    },
}

impl Reply {
    /// For a shell that has no HTTP: bytes travel as `{content_type, base64}`.
    pub fn transport(self) -> Value {
        use base64::Engine as _;
        match self {
            Reply::Json(v) => v,
            Reply::Bytes {
                content_type,
                bytes,
            } => json!({
                "content_type": content_type,
                "base64": base64::engine::general_purpose::STANDARD.encode(bytes),
            }),
        }
    }

    pub fn json(self) -> Value {
        match self {
            Reply::Json(v) => v,
            Reply::Bytes {
                content_type,
                bytes,
            } => {
                json!({ "content_type": content_type, "length": bytes.len() })
            }
        }
    }
}

fn version_path(n: u64) -> String {
    format!("app/brand/versions/v{n}.yaml")
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

// ── Reading ─────────────────────────────────────────────────────────────────

fn yaml_json(bytes: &[u8]) -> HostResult<Value> {
    serde_yaml::from_slice::<Value>(bytes)
        .map_err(|e| HostError::internal(format!("a Brand Clan entry is unreadable: {e}")))
}

fn data_of(clan: &ClanFile) -> HostResult<Value> {
    yaml_json(&clan.read_entry(DATA)?)
}

/// The draft and the waiting version. Absent state is both null.
fn state_of(clan: &ClanFile) -> HostResult<(Value, Value)> {
    if !clan.has_entry(STATE) {
        return Ok((Value::Null, Value::Null));
    }
    let s = yaml_json(&clan.read_entry(STATE)?)?;
    Ok((
        s.get("draft").cloned().unwrap_or(Value::Null),
        s.get("pending").cloned().unwrap_or(Value::Null),
    ))
}

fn version_of(data: &Value) -> u64 {
    data.pointer("/kit/version")
        .and_then(Value::as_u64)
        .unwrap_or(1)
}

/// The bible: the data without `kit`.
fn bible_of(data: &Value) -> Value {
    let mut b = data.clone();
    if let Some(o) = b.as_object_mut() {
        o.remove("kit");
        o.remove("$schema");
    }
    b
}

fn load(store: &dyn DocStore, path: &str) -> HostResult<Document> {
    let id = DocId::new(path);
    if !store.exists(&id) {
        return Err(HostError::not_found(format!("no such Brand Clan: {path}")));
    }
    let doc = Document::load(store.parts(), id)?;
    if doc.app_id() != Some(APP_ID) {
        return Err(HostError::new(422, format!("{path} is not a Brand Clan")));
    }
    Ok(doc)
}

fn person(ctx: &Ctx, what: &str) -> HostResult<()> {
    if ctx.actor.is_human() {
        Ok(())
    } else {
        Err(HostError::new(
            403,
            format!("only a person can {what}; {} is not one", ctx.actor),
        ))
    }
}

/// A person, or the build job.
fn person_or_process(ctx: &Ctx, what: &str) -> HostResult<()> {
    if ctx.actor.is_human() || ctx.actor.as_str().starts_with("process:") {
        Ok(())
    } else {
        Err(HostError::new(
            403,
            format!(
                "only a person or a job can {what}; {} is neither",
                ctx.actor
            ),
        ))
    }
}

// ── Writing ─────────────────────────────────────────────────────────────────

/// What a write changes in a Brand Clan.
struct Write {
    /// The new published data, or `None` to leave `shared/data.yaml` as it is.
    data: Option<Value>,
    /// The new `{draft, pending}`.
    state: (Value, Value),
    /// A version snapshot to add: `(n, data)`.
    version: Option<(u64, Value)>,
    action: &'static str,
    rationale: String,
    pinned: bool,
    fields: Vec<String>,
}

/// The change that makes `w` true on `doc`: one `pack` (schema-checked data,
/// the decision with the person's name, the new entries), nothing written.
fn change_for(ctx: &Ctx, doc: &Document, w: Write) -> HostResult<(Change, ClanFile)> {
    let clan = doc.clan();
    let data = match w.data {
        Some(d) => d,
        None => data_of(clan)?,
    };
    let mut extra: Vec<(String, Vec<u8>)> = Vec::new();
    let (draft, pending) = w.state;
    let state = json!({ "draft": draft, "pending": pending });
    extra.push((STATE.into(), to_yaml(&state)?));
    if let Some((n, v)) = &w.version {
        extra.push((version_path(*n), to_yaml(v)?));
    }
    let entry: DecisionEntry = edit::attribute(
        ctx,
        ctx.actor.as_str(),
        w.action,
        &w.rationale,
        w.pinned,
        Some(w.fields),
    );
    let out = AgentOutput {
        mode: "data-update".into(),
        structured: data,
        design: None,
        human: None,
        decision: Some(entry),
    };
    let bytes = clan_sdk::pack(
        clan,
        out,
        PackOptions {
            delta: Some(w.action.to_string()),
            extra_entries: extra,
            ..Default::default()
        },
        None,
    )?;
    let after = ClanFile::from_bytes(bytes.clone())?;
    let mut change = doc.change(bytes)?;
    change.decisions = new_decisions(clan, &after);
    Ok((change, after))
}

fn to_yaml(v: &Value) -> HostResult<Vec<u8>> {
    serde_yaml::to_string(v)
        .map(String::into_bytes)
        .map_err(|e| HostError::internal(e.to_string()))
}

fn new_decisions(before: &ClanFile, after: &ClanFile) -> Vec<clan_sdk::Decision> {
    let chain = |c: &ClanFile| {
        c.read_entry("agent/decision-chain.yaml")
            .ok()
            .and_then(|b| clan_sdk::DecisionChain::from_yaml(&b).ok())
            .map(|c| c.decisions)
            .unwrap_or_default()
    };
    let old: std::collections::BTreeSet<String> =
        chain(before).into_iter().filter_map(|d| d.id).collect();
    chain(after)
        .into_iter()
        .filter(|d| d.id.as_ref().is_some_and(|id| !old.contains(id)))
        .collect()
}

fn apply(store: &dyn DocStore, ctx: &Ctx, doc: &Document, w: Write) -> HostResult<()> {
    let (change, _) = change_for(ctx, doc, w)?;
    store.apply(&change)?;
    Ok(())
}

/// A candidate checked against the document's own schema, as a whole
/// document (the candidate plus `kit`).
fn check_candidate(clan: &ClanFile, candidate: &Value, kit: &Value) -> HostResult<()> {
    let schema = clan
        .read_entry_string(SCHEMA)
        .map_err(|_| HostError::internal("the Brand Clan has no schema"))?;
    let mut whole = candidate.clone();
    whole["kit"] = kit.clone();
    AgentOutput {
        mode: "data-update".into(),
        structured: whole,
        design: None,
        human: None,
        decision: None,
    }
    .validate_schema(&schema)
    .map_err(|e| HostError::bad_request(format!("that is not a Brand Bible: {e}")))
}

fn candidate_of(input: &Value) -> HostResult<Value> {
    let c = input
        .get("candidate")
        .ok_or_else(|| HostError::bad_request("missing candidate"))?;
    if !c.is_object() {
        return Err(HostError::bad_request("candidate must be an object"));
    }
    Ok(bible_of(c))
}

// ── Views ───────────────────────────────────────────────────────────────────

fn palette(data: &Value) -> Vec<Value> {
    data.pointer("/visual/colours")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|c| c.get("hex").cloned())
                .take(5)
                .collect()
        })
        .unwrap_or_default()
}

fn logo_of(data: &Value) -> Value {
    let logos = data.pointer("/visual/logos").and_then(Value::as_array);
    let pick = |v: &str| {
        logos.and_then(|l| {
            l.iter().find(|x| {
                x.get("variant").and_then(Value::as_str) == Some(v) && x.get("asset").is_some()
            })
        })
    };
    pick("light")
        .or_else(|| logos.and_then(|l| l.iter().find(|x| x.get("asset").is_some())))
        .and_then(|l| l.get("asset").cloned())
        .unwrap_or(Value::Null)
}

fn draft_view(published: &Value, draft: &Value) -> Value {
    if draft.is_null() {
        return Value::Null;
    }
    let cand = draft.get("candidate").cloned().unwrap_or(Value::Null);
    let mut d = draft.clone();
    d["changes"] = json!(changes(&bible_of(published), &cand));
    d
}

fn pending_view(published: &Value, pending: &Value) -> Value {
    if pending.is_null() {
        return Value::Null;
    }
    let cand = pending.get("candidate").cloned().unwrap_or(Value::Null);
    let mut p = pending.clone();
    p["changes"] = json!(changes(&bible_of(published), &cand));
    p
}

fn client_ref(clan: &ClanFile) -> Value {
    clan.manifest()
        .client
        .as_ref()
        .map(|c| json!({ "id": c.id, "name": c.name }))
        .unwrap_or(Value::Null)
}

/// Every document that carries this Brand Clan: `(path, clan, held version)`.
fn carriers(store: &dyn DocStore, brand_id: &str) -> Vec<(String, ClanFile, Option<u64>)> {
    let mut out = Vec::new();
    for id in store.documents() {
        let Ok(bytes) = store.read(&id) else { continue };
        let Ok(clan) = ClanFile::from_bytes(bytes) else {
            continue;
        };
        let held = clan
            .manifest()
            .attached()
            .iter()
            .find(|a| a.carried.document_id == brand_id)
            .map(|a| a.version);
        if let Some(h) = held {
            out.push((id.to_string(), clan, h));
        }
    }
    out
}

fn default_of(store: &dyn DocStore, client_id: &str) -> Option<String> {
    clients::get(store, client_id)
        .ok()
        .and_then(|c| c.default_brand_clan)
}

fn view(store: &dyn DocStore, path: &str, version: Option<u64>) -> HostResult<Value> {
    let doc = load(store, path)?;
    let clan = doc.clan();
    let published = data_of(clan)?;
    let current = version_of(&published);
    let (draft, pending) = state_of(clan)?;
    let brand_id = clan.manifest().document_id().to_string();
    let client = client_ref(clan);
    let is_default = client
        .get("id")
        .and_then(Value::as_str)
        .and_then(|c| default_of(store, c))
        .as_deref()
        == Some(brand_id.as_str());
    let (data, readonly, shown) = match version {
        Some(n) if n != current => {
            if n < 1 || n > current || !clan.has_entry(&version_path(n)) {
                return Err(HostError::not_found(format!("{path} has no version {n}")));
            }
            (
                yaml_json(&clan.read_entry(&version_path(n))?)?,
                true,
                json!({"version": n, "state": "published"}),
            )
        }
        _ => (
            published.clone(),
            false,
            json!({"version": current, "state": "published"}),
        ),
    };
    let used_by: Vec<Value> = carriers(store, &brand_id)
        .into_iter()
        .map(|(p, c, held)| {
            json!({
                "path": p,
                "title": c.manifest().title,
                "app_id": c.manifest().app.as_ref().map(|a| a.app_id.clone()),
                "held": held,
                "behind": held.is_some_and(|h| h < current),
            })
        })
        .collect();
    Ok(json!({
        "document_id": brand_id,
        "path": path,
        "client": client,
        "name": data.get("name").cloned().unwrap_or(Value::Null),
        "note": data.get("note").cloned().unwrap_or(Value::Null),
        "version": current,
        "default": is_default,
        "readonly": readonly,
        "shown": shown,
        "data": data,
        "draft": draft_view(&published, &draft),
        "pending": pending_view(&published, &pending),
        "used_by": used_by,
    }))
}

fn summary_of(path: &str, clan: &ClanFile, default: Option<&str>) -> HostResult<Value> {
    let data = data_of(clan)?;
    let (draft, pending) = state_of(clan)?;
    let brand_id = clan.manifest().document_id().to_string();
    let draft_s = if draft.is_null() {
        Value::Null
    } else {
        let n = changes(
            &bible_of(&data),
            &draft.get("candidate").cloned().unwrap_or(Value::Null),
        )
        .len();
        let edited = draft.get("edited_by").and_then(Value::as_array);
        json!({
            "based_on": draft.get("based_on"),
            "changes": n,
            "by": edited.and_then(|e| e.last()).cloned().unwrap_or(Value::Null),
            "at": draft.get("edited_at"),
        })
    };
    let pending_s = if pending.is_null() {
        Value::Null
    } else {
        let n = changes(
            &bible_of(&data),
            &pending.get("candidate").cloned().unwrap_or(Value::Null),
        )
        .len();
        json!({
            "from_version": pending.get("from_version"),
            "changes": n,
            "at": pending.get("at"),
            "by": pending.get("by"),
            "file": pending.pointer("/from/file"),
        })
    };
    Ok(json!({
        "document_id": brand_id,
        "path": path,
        "name": data.get("name").cloned().unwrap_or(Value::Null),
        "note": data.get("note").cloned().unwrap_or(Value::Null),
        "version": version_of(&data),
        "default": default == Some(brand_id.as_str()),
        "updated_at": data.pointer("/kit/published/at").cloned().unwrap_or_else(|| json!(clan.manifest().updated_at)),
        "palette": palette(&data),
        "logo": logo_of(&data),
        "source": data.pointer("/source/file").map(|f| json!({ "file": f })).unwrap_or(Value::Null),
        "pending": pending_s,
        "draft": draft_s,
    }))
}

/// The client's Brand Clans, the default, and the work that is behind.
fn list(store: &dyn DocStore, client_id: &str) -> HostResult<Value> {
    let client = clients::get(store, client_id)?;
    let mut brand_ids: Vec<(String, String, u64)> = Vec::new(); // (document_id, name, version)
    let mut rows: Vec<(String, Value)> = Vec::new(); // (sort key, summary)
    let default = client.default_brand_clan.clone();
    let mut default_found: Option<String> = None;
    for id in store.documents() {
        let Ok(bytes) = store.read(&id) else { continue };
        let Ok(clan) = ClanFile::from_bytes(bytes) else {
            continue;
        };
        let m = clan.manifest();
        if m.app.as_ref().map(|a| a.app_id.as_str()) != Some(APP_ID)
            || m.client.as_ref().map(|c| c.id.as_str()) != Some(client_id)
        {
            continue;
        }
        let Ok(data) = data_of(&clan) else { continue };
        let s = summary_of(id.as_str(), &clan, default.as_deref())?;
        if default.as_deref() == Some(m.document_id()) {
            default_found = Some(m.document_id().to_string());
        }
        brand_ids.push((
            m.document_id().to_string(),
            data.get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            version_of(&data),
        ));
        rows.push((m.created_at.clone(), s));
    }
    // The default first, then the order they were made.
    rows.sort_by(|a, b| {
        let (da, db) = (a.1["default"] == json!(true), b.1["default"] == json!(true));
        db.cmp(&da).then_with(|| a.0.cmp(&b.0))
    });
    let mut behind = Vec::new();
    if !brand_ids.is_empty() {
        for id in store.documents() {
            let Ok(bytes) = store.read(&id) else { continue };
            let Ok(clan) = ClanFile::from_bytes(bytes) else {
                continue;
            };
            for a in clan.manifest().attached() {
                if let Some((_, name, current)) = brand_ids
                    .iter()
                    .find(|(d, _, _)| *d == a.carried.document_id)
                {
                    if a.version.is_some_and(|h| h < *current) {
                        behind.push(json!({
                            "path": id.to_string(),
                            "title": clan.manifest().title,
                            "app_id": clan.manifest().app.as_ref().map(|x| x.app_id.clone()),
                            "brand_clan": a.carried.document_id,
                            "brand_name": name,
                            "held": a.version,
                            "current": current,
                        }));
                    }
                }
            }
        }
    }
    Ok(json!({
        "default": default_found,
        "items": rows.into_iter().map(|r| r.1).collect::<Vec<_>>(),
        "behind": behind,
    }))
}

fn history(store: &dyn DocStore, path: &str) -> HostResult<Value> {
    let doc = load(store, path)?;
    let clan = doc.clan();
    let data = data_of(clan)?;
    let (draft, _) = state_of(clan)?;
    let mut out: Vec<Value> = Vec::new();
    if !draft.is_null() {
        let ch = changes(
            &bible_of(&data),
            &draft.get("candidate").cloned().unwrap_or(Value::Null),
        );
        let who = draft
            .get("edited_by")
            .and_then(Value::as_array)
            .and_then(|e| e.last())
            .cloned()
            .unwrap_or(Value::Null);
        out.push(json!({
            "version": version_of(&data) + 1,
            "state": "draft",
            "at": draft.get("edited_at"),
            "by": who,
            "from": draft.get("from"),
            "summary": summary(&ch),
            "changes": ch,
        }));
    }
    let log = data
        .pointer("/kit/changelog")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for e in log.iter().rev() {
        out.push(json!({
            "version": e.get("version"),
            "state": "published",
            "at": e.get("at"),
            "by": e.get("by"),
            "from": e.get("from"),
            "summary": e.get("summary"),
            "changes": e.get("changes").cloned().unwrap_or_else(|| json!([])),
        }));
    }
    Ok(json!(out))
}

// ── Making one ──────────────────────────────────────────────────────────────

fn skeleton() -> Value {
    json!({
        "visual": { "logos": [], "colours": [], "typography": [] },
        "voice": { "rules": [] },
        "imagery": { "bans": [], "examples": [] },
        "gaps": [],
        "previous_work": [], "categories_explored": [], "likes_dislikes": [], "preferences": {},
    })
}

fn source_with(source: &Value, ctx: &Ctx, at: &str) -> Value {
    let mut s = source.clone();
    if let Some(o) = s.as_object_mut() {
        o.entry("by").or_insert_with(|| json!(ctx.actor.as_str()));
        o.entry("at").or_insert_with(|| json!(at));
    }
    s
}

fn kit_entry(
    version: u64,
    at: &str,
    by: &str,
    from: &Value,
    summary: &str,
    changes: &[Value],
) -> Value {
    let mut e = json!({ "version": version, "at": at, "by": by, "from": from, "summary": summary });
    if !changes.is_empty() {
        e["changes"] = json!(changes);
    }
    e
}

fn create(store: &dyn DocStore, ctx: &Ctx, client_id: &str, input: &Value) -> HostResult<Value> {
    let candidate = input.get("candidate").filter(|c| !c.is_null());
    if candidate.is_some() {
        person_or_process(ctx, "make a Brand Clan from a build")?;
    } else {
        person(ctx, "make a Brand Clan")?;
    }
    let client: ClientRecord = clients::get(store, client_id)?;
    let name = clients::clean_name(input.get("name").and_then(Value::as_str).unwrap_or(""))
        .map_err(|_| HostError::bad_request("a Brand Clan needs a name"))?;
    if name.chars().count() > 60 {
        return Err(HostError::bad_request("a name is at most 60 characters"));
    }
    let at = now();
    let by = ctx.actor.as_str().to_string();
    // The bible: the skeleton, then what the candidate brings.
    let mut bible = skeleton();
    if let Some(c) = candidate {
        let c = bible_of(c);
        if let (Some(b), Some(co)) = (bible.as_object_mut(), c.as_object()) {
            for (k, v) in co {
                if k != "name" {
                    b.insert(k.clone(), v.clone());
                }
            }
        }
    }
    let source = input.get("source").filter(|s| s.is_object());
    if let Some(s) = source {
        bible["source"] = source_with(s, ctx, &at);
    }
    if let Some(n) = input
        .get("note")
        .and_then(Value::as_str)
        .filter(|n| !n.trim().is_empty())
    {
        bible["note"] = json!(n.trim());
    }
    let from = input
        .get("from")
        .filter(|f| f.is_object())
        .cloned()
        .unwrap_or_else(|| {
            if candidate.is_some() {
                json!({ "kind": "build" })
            } else {
                json!({ "kind": "create" })
            }
        });
    let file = source.and_then(|s| s.get("file")).and_then(Value::as_str);
    let summary = match (candidate.is_some(), file) {
        (true, Some(f)) => format!("First version, built from {f}"),
        _ if source.is_some() && file.is_some() => {
            format!("Made by hand from {}", file.unwrap_or(""))
        }
        _ => "Made by hand".to_string(),
    };
    let mut data = bible;
    data["name"] = json!(name);
    data["kit"] = json!({
        "version": 1,
        "published": { "by": by, "at": at },
        "changelog": [kit_entry(1, &at, &by, &from, &summary, &[])],
    });
    // Born in the client's name, as a document nothing has written to yet.
    let title = format!("{} · {}", client.name, name);
    let made = library::instance_change_for(store, APP_ID, Some(title), Some(&client))?;
    let blank = ClanFile::from_bytes(made.bytes.clone())?;
    let doc = Document::from_bytes(made.doc.clone(), made.bytes.clone())?;
    let _ = blank;
    let w = Write {
        data: Some(data.clone()),
        state: (Value::Null, Value::Null),
        version: Some((1, data)),
        action: "brand_clan.create",
        rationale: format!("made the Brand Clan {name} for {}", client.name),
        pinned: true,
        fields: vec!["name".into(), "kit".into()],
    };
    let (change, _) = change_for(ctx, &doc, w)?;
    // One write that is a new document: nothing half-made if the data is refused.
    let created = Change::create(made.doc.clone(), change.bytes.clone());
    store.apply(&created)?;
    let brand = ClanFile::from_bytes(created.bytes)?;
    let brand_id = brand.manifest().document_id().to_string();
    // The first Brand Clan a client gets is its default.
    let has_default = client
        .default_brand_clan
        .as_deref()
        .is_some_and(|d| document_exists(store, d));
    if !has_default {
        clients::set_default_brand_clan(store, ctx, client_id, Some(&brand_id))?;
    }
    view(store, made.doc.as_str(), None)
}

fn document_exists(store: &dyn DocStore, brand_id: &str) -> bool {
    store.documents().into_iter().any(|id| {
        store
            .read(&id)
            .ok()
            .and_then(|b| ClanFile::from_bytes(b).ok())
            .is_some_and(|c| {
                c.manifest().document_id() == brand_id
                    && c.manifest().app.as_ref().map(|a| a.app_id.as_str()) == Some(APP_ID)
            })
    })
}

// ── Drafts ──────────────────────────────────────────────────────────────────

fn expect(published: &Value, input: &Value, required: bool) -> HostResult<()> {
    match input.get("expect_version").and_then(Value::as_u64) {
        Some(v) if v != version_of(published) => Err(HostError::conflict(format!(
            "this Brand Clan is at v{} now, not v{v}; it changed while you were looking. Reload it.",
            version_of(published)
        ))),
        None if required => Err(HostError::bad_request("missing expect_version")),
        _ => Ok(()),
    }
}

fn draft_save(store: &dyn DocStore, ctx: &Ctx, path: &str, input: &Value) -> HostResult<Value> {
    person(ctx, "edit a Brand Clan")?;
    let doc = load(store, path)?;
    let published = data_of(doc.clan())?;
    expect(&published, input, false)?;
    let (draft, pending) = state_of(doc.clan())?;
    let mut cand = candidate_of(input)?;
    if cand
        .get("name")
        .and_then(Value::as_str)
        .map(|n| n.trim().is_empty())
        .unwrap_or(true)
    {
        cand["name"] = published["name"].clone();
    }
    check_candidate(doc.clan(), &cand, &published["kit"])?;
    let base = bible_of(&published);
    let at = now();
    let me = ctx.actor.as_str().to_string();
    if changes(&base, &cand).is_empty() {
        // Edited back to the published bible: no draft.
        if !draft.is_null() {
            apply(
                store,
                ctx,
                &doc,
                Write {
                    data: None,
                    state: (Value::Null, pending),
                    version: None,
                    action: "brand_clan.discard",
                    rationale: "the edits came back to the published version; the draft is gone"
                        .into(),
                    pinned: false,
                    fields: vec![],
                },
            )?;
        }
        return view(store, path, None);
    }
    if draft.get("candidate") == Some(&cand) {
        return view(store, path, None);
    }
    let new_draft = if draft.is_null() {
        json!({
            "based_on": version_of(&published),
            "from": { "kind": "edit" },
            "started_by": me, "started_at": at,
            "edited_by": [me], "edited_at": at,
            "candidate": cand,
        })
    } else {
        let mut d = draft.clone();
        let mut who: Vec<Value> = d
            .get("edited_by")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        who.retain(|w| w.as_str() != Some(me.as_str()));
        who.push(json!(me)); // the last editor is last
        d["edited_by"] = json!(who);
        d["edited_at"] = json!(at);
        d["candidate"] = cand.clone();
        d
    };
    let ch = changes(&base, &cand);
    apply(
        store,
        ctx,
        &doc,
        Write {
            data: None,
            state: (new_draft, pending),
            version: None,
            action: "brand_clan.draft",
            rationale: format!(
                "saved the draft of v{}: {}",
                version_of(&published) + 1,
                summary(&ch)
            ),
            pinned: false,
            fields: ch
                .iter()
                .filter_map(|c| c["id"].as_str().map(String::from))
                .collect(),
        },
    )?;
    view(store, path, None)
}

fn draft_start(store: &dyn DocStore, ctx: &Ctx, path: &str, input: &Value) -> HostResult<Value> {
    person(ctx, "start a draft")?;
    let doc = load(store, path)?;
    let published = data_of(doc.clan())?;
    let current = version_of(&published);
    let (draft, pending) = state_of(doc.clan())?;
    let n = input
        .get("from_version")
        .and_then(Value::as_u64)
        .ok_or_else(|| HostError::bad_request("missing from_version"))?;
    if n >= current || n < 1 {
        return Err(HostError::bad_request(format!(
            "v{n} is not an old version; v{current} is the published one"
        )));
    }
    if !draft.is_null() {
        return Err(HostError::conflict(
            "there is a draft already; publish it or discard it first",
        ));
    }
    let snap_path = version_path(n);
    if !doc.clan().has_entry(&snap_path) {
        return Err(HostError::not_found(format!("{path} has no version {n}")));
    }
    let old = yaml_json(&doc.clan().read_entry(&snap_path)?)?;
    let at = now();
    let me = ctx.actor.as_str().to_string();
    let candidate = bible_of(&old);
    let d = json!({
        "based_on": current,
        "from": { "kind": "restore", "version": n },
        "started_by": me, "started_at": at,
        "edited_by": [me], "edited_at": at,
        "candidate": candidate,
    });
    apply(
        store,
        ctx,
        &doc,
        Write {
            data: None,
            state: (d, pending),
            version: None,
            action: "brand_clan.draft_start",
            rationale: format!("started a draft of v{} from v{n}", current + 1),
            pinned: false,
            fields: vec![],
        },
    )?;
    view(store, path, None)
}

fn draft_discard(store: &dyn DocStore, ctx: &Ctx, path: &str) -> HostResult<Value> {
    person(ctx, "discard a draft")?;
    let doc = load(store, path)?;
    let (draft, pending) = state_of(doc.clan())?;
    if !draft.is_null() {
        apply(
            store,
            ctx,
            &doc,
            Write {
                data: None,
                state: (Value::Null, pending),
                version: None,
                action: "brand_clan.discard",
                rationale: "discarded the draft".into(),
                pinned: false,
                fields: vec![],
            },
        )?;
    }
    view(store, path, None)
}

// ── Publishing ──────────────────────────────────────────────────────────────

/// The published data of version `n + 1`: `bible` over `published`, the kit
/// advanced by one with its changelog entry.
fn next_data(
    published: &Value,
    bible: &Value,
    ctx: &Ctx,
    from: &Value,
    text: &str,
    taken: &[Value],
) -> (u64, Value) {
    let n = version_of(published) + 1;
    let at = now();
    let by = ctx.actor.as_str();
    let mut data = bible.clone();
    // Keys the bible does not carry keep their published value (the provisions).
    if let (Some(d), Some(p)) = (data.as_object_mut(), published.as_object()) {
        for (k, v) in p {
            if k != "kit" && !d.contains_key(k) {
                d.insert(k.clone(), v.clone());
            }
        }
    }
    let mut log = published
        .pointer("/kit/changelog")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    log.push(kit_entry(n, &at, by, from, text, taken));
    data["kit"] = json!({ "version": n, "published": { "by": by, "at": at }, "changelog": log });
    (n, data)
}

fn publish(store: &dyn DocStore, ctx: &Ctx, path: &str, input: &Value) -> HostResult<Value> {
    person(ctx, "publish a Brand Clan")?;
    let doc = load(store, path)?;
    let published = data_of(doc.clan())?;
    expect(&published, input, true)?;
    let (draft, pending) = state_of(doc.clan())?;
    if draft.is_null() {
        return Err(HostError::conflict("there is no draft to publish"));
    }
    let cand = draft.get("candidate").cloned().unwrap_or(Value::Null);
    let ch = changes(&bible_of(&published), &cand);
    if ch.is_empty() {
        return Err(HostError::conflict(
            "the draft changes nothing; there is nothing to publish",
        ));
    }
    let text = input
        .get("summary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| summary(&ch));
    let from = draft
        .get("from")
        .cloned()
        .unwrap_or_else(|| json!({ "kind": "edit" }));
    let (n, data) = next_data(&published, &cand, ctx, &from, &text, &ch);
    apply(
        store,
        ctx,
        &doc,
        Write {
            data: Some(data.clone()),
            state: (Value::Null, pending),
            version: Some((n, data)),
            action: "brand_clan.publish",
            rationale: format!("published v{n}: {text}"),
            pinned: true,
            fields: ch
                .iter()
                .filter_map(|c| c["id"].as_str().map(String::from))
                .collect(),
        },
    )?;
    view(store, path, None)
}

// ── A new version waiting ───────────────────────────────────────────────────

fn proposal_set(store: &dyn DocStore, ctx: &Ctx, path: &str, input: &Value) -> HostResult<Value> {
    person_or_process(ctx, "propose a new version")?;
    let doc = load(store, path)?;
    let published = data_of(doc.clan())?;
    let (draft, _) = state_of(doc.clan())?;
    let from = input
        .get("from")
        .cloned()
        .unwrap_or_else(|| json!({ "kind": "upload" }));
    let kind = from.get("kind").and_then(Value::as_str).unwrap_or("");
    if kind != "build" && kind != "upload" {
        return Err(HostError::bad_request(
            "a proposal comes from a build or an upload",
        ));
    }
    let cand = candidate_of(input)?;
    let at = now();
    let mut merged = merge_proposal(&bible_of(&published), &cand);
    let source = input.get("source").filter(|s| s.is_object());
    if let Some(s) = source {
        merged["source"] = source_with(s, ctx, &at);
    }
    check_candidate(doc.clan(), &merged, &published["kit"])?;
    let ch = changes(&bible_of(&published), &merged);
    if ch.is_empty() {
        return Err(HostError::conflict(
            "the new file changes nothing in this Brand Clan",
        ));
    }
    let pending = json!({
        "from_version": version_of(&published),
        "at": at,
        "by": ctx.actor.as_str(),
        "from": from,
        "source": merged.get("source").cloned().unwrap_or(Value::Null),
        "candidate": merged,
    });
    apply(
        store,
        ctx,
        &doc,
        Write {
            data: None,
            state: (draft, pending),
            version: None,
            action: "brand_clan.proposal",
            rationale: format!(
                "a new version is waiting for a person{}: {}",
                source
                    .and_then(|s| s.get("file"))
                    .and_then(Value::as_str)
                    .map(|f| format!(" (from {f})"))
                    .unwrap_or_default(),
                summary(&ch)
            ),
            pinned: false,
            fields: ch
                .iter()
                .filter_map(|c| c["id"].as_str().map(String::from))
                .collect(),
        },
    )?;
    view(store, path, None)
}

fn proposal_accept(
    store: &dyn DocStore,
    ctx: &Ctx,
    path: &str,
    input: &Value,
) -> HostResult<Value> {
    person(ctx, "accept a new version")?;
    let doc = load(store, path)?;
    let published = data_of(doc.clan())?;
    expect(&published, input, true)?;
    let (draft, pending) = state_of(doc.clan())?;
    if pending.is_null() {
        return Err(HostError::conflict("no new version is waiting"));
    }
    let cand = pending.get("candidate").cloned().unwrap_or(Value::Null);
    let all = changes(&bible_of(&published), &cand);
    let taken: Vec<Value> = match input.get("take") {
        Some(Value::String(s)) if s == "all" => all.clone(),
        Some(Value::Array(ids)) => {
            let want: Vec<&str> = ids.iter().filter_map(Value::as_str).collect();
            if let Some(bad) = want.iter().find(|w| !all.iter().any(|c| c["id"] == **w)) {
                return Err(HostError::bad_request(format!(
                    "there is no waiting change {bad}"
                )));
            }
            all.iter()
                .filter(|c| want.contains(&c["id"].as_str().unwrap_or("")))
                .cloned()
                .collect()
        }
        _ => {
            return Err(HostError::bad_request(
                "take is \"all\" or a list of change ids",
            ))
        }
    };
    if taken.is_empty() {
        return Err(HostError::bad_request(
            "take at least one change, or keep the old version",
        ));
    }
    let ids: Vec<&str> = taken.iter().filter_map(|c| c["id"].as_str()).collect();
    let bible = apply_taken(&bible_of(&published), &all, &|id| ids.contains(&id));
    check_candidate(doc.clan(), &bible, &published["kit"])?;
    let from = pending
        .get("from")
        .cloned()
        .unwrap_or_else(|| json!({ "kind": "upload" }));
    let text = if taken.len() == all.len() {
        summary(&taken)
    } else {
        format!(
            "{} ({} of {} taken)",
            summary(&taken),
            taken.len(),
            all.len()
        )
    };
    let (n, data) = next_data(&published, &bible, ctx, &from, &text, &taken);
    apply(
        store,
        ctx,
        &doc,
        Write {
            data: Some(data.clone()),
            state: (draft, Value::Null),
            version: Some((n, data)),
            action: "brand_clan.accept",
            rationale: format!(
                "accepted {} of {} waiting changes as v{n}",
                taken.len(),
                all.len()
            ),
            pinned: true,
            fields: ids.iter().map(|s| (*s).to_string()).collect(),
        },
    )?;
    view(store, path, None)
}

fn proposal_keep(store: &dyn DocStore, ctx: &Ctx, path: &str) -> HostResult<Value> {
    person(ctx, "keep the old version")?;
    let doc = load(store, path)?;
    let (draft, pending) = state_of(doc.clan())?;
    if !pending.is_null() {
        apply(
            store,
            ctx,
            &doc,
            Write {
                data: None,
                state: (draft, Value::Null),
                version: None,
                action: "brand_clan.keep",
                rationale: "kept the published version; the waiting one is dropped".into(),
                pinned: false,
                fields: vec![],
            },
        )?;
    }
    view(store, path, None)
}

// ── The default, and work ───────────────────────────────────────────────────

fn default_set(
    store: &dyn DocStore,
    ctx: &Ctx,
    client_id: &str,
    input: &Value,
) -> HostResult<Value> {
    person(ctx, "set the default Brand Clan")?;
    let want = input
        .get("document_id")
        .and_then(Value::as_str)
        .ok_or_else(|| HostError::bad_request("missing document_id"))?;
    let client = clients::get(store, client_id)?;
    let ok = store.documents().into_iter().any(|id| {
        store
            .read(&id)
            .ok()
            .and_then(|b| ClanFile::from_bytes(b).ok())
            .is_some_and(|c| {
                let m = c.manifest();
                m.document_id() == want
                    && m.app.as_ref().map(|a| a.app_id.as_str()) == Some(APP_ID)
                    && m.client.as_ref().map(|r| r.id.as_str()) == Some(client.id.as_str())
            })
    });
    if !ok {
        return Err(HostError::new(
            422,
            format!("{want} is not a Brand Clan of {}", client.name),
        ));
    }
    let rec = clients::set_default_brand_clan(store, ctx, client_id, Some(want))?;
    serde_json::to_value(rec).map_err(|e| HostError::internal(e.to_string()))
}

/// The Update chip, pressed: this Brand Clan's published version into one
/// work document, by attach's own `update`, as the person; and the `linked`
/// backref, as `/attach/update` writes it. Nothing else reaches a work document.
fn work_update(store: &dyn DocStore, ctx: &Ctx, path: &str, input: &Value) -> HostResult<Value> {
    person(ctx, "update a document's Brand Clan")?;
    let work_path = input
        .get("work")
        .and_then(Value::as_str)
        .ok_or_else(|| HostError::bad_request("missing work"))?;
    let brand = load(store, path)?;
    let brand_id = brand.clan().manifest().document_id().to_string();
    let wid = DocId::new(work_path);
    if !store.exists(&wid) {
        return Err(HostError::not_found(format!(
            "no such document: {work_path}"
        )));
    }
    let work = Document::load(store.parts(), wid.clone())?;
    let (change, mut reply) =
        library::attach_change(store, ctx, &work, &brand_id, AttachMode::Update)?;
    store.apply(&change)?;
    let after = Document::load(store.parts(), wid)?;
    let decision = reply["decision"].as_str().unwrap_or("").to_string();
    let written = library::write_backrefs(
        store,
        ctx,
        &after,
        &decision,
        &Backref::Linked { source: brand_id },
    );
    reply["backrefs"] = json!(written);
    Ok(reply)
}

// ── Assets ──────────────────────────────────────────────────────────────────

/// Content-prefixed, so no file is ever overwritten and an old version keeps
/// pointing at its own picture.
fn asset_put(
    store: &dyn DocStore,
    ctx: &Ctx,
    path: &str,
    name: &str,
    body: Vec<u8>,
) -> HostResult<Value> {
    person_or_process(ctx, "add a file to a Brand Clan")?;
    let name = ops::sanitize_asset_name(name)
        .ok_or_else(|| HostError::bad_request("that file name cannot be used"))?;
    if body.is_empty() {
        return Err(HostError::bad_request("that file is empty"));
    }
    let doc = load(store, path)?;
    let sha = sha256_prefixed(&body);
    let short: String = sha.trim_start_matches("sha256:").chars().take(10).collect();
    let unique = format!("{short}-{name}");
    let out = edit::upload_asset(ctx, &doc, store.blobs(), &unique, Some("human"), body)?;
    for c in &out.changes {
        store.apply(c)?;
    }
    Ok(json!({ "name": unique, "path": format!("{ASSETS}{unique}") }))
}

fn asset_get(store: &dyn DocStore, path: &str, name: &str) -> HostResult<Reply> {
    let name = ops::sanitize_asset_name(name)
        .ok_or_else(|| HostError::bad_request("that file name cannot be used"))?;
    let doc = load(store, path)?;
    let clan = doc.clan();
    let entry = format!("{ASSETS}{name}");
    let bytes = match clan.manifest().file_by_path(&entry) {
        Some(f) if f.linked => {
            let blobs = store.blobs().ok_or_else(|| {
                HostError::not_found(format!("{entry} is a link and this store holds no files"))
            })?;
            crate::blobs::linked_bytes(blobs, &entry, f.sha256.as_deref().unwrap_or(""))?
        }
        _ => clan
            .read_entry(&entry)
            .map_err(|_| HostError::not_found(format!("{path} has no file {name}")))?,
    };
    Ok(Reply::Bytes {
        content_type: ops::content_type_for(&name).to_string(),
        bytes,
    })
}

// ── The one entry ───────────────────────────────────────────────────────────

fn s<'a>(input: &'a Value, k: &str) -> HostResult<&'a str> {
    input
        .get(k)
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| HostError::bad_request(format!("missing {k}")))
}

/// Run one Brand Clan operation. `input` is the JSON body plus the route's
/// own keys (`client_id`, `path`, `name`, `version`); `body` is a file's bytes
/// for `asset.put`.
pub fn call(
    store: &dyn DocStore,
    ctx: &Ctx,
    op: &str,
    input: &Value,
    body: Vec<u8>,
) -> HostResult<Reply> {
    let json = |v: HostResult<Value>| v.map(Reply::Json);
    match op {
        "list" => json(list(store, s(input, "client_id")?)),
        "create" => json(create(store, ctx, s(input, "client_id")?, input)),
        "default.set" => json(default_set(store, ctx, s(input, "client_id")?, input)),
        "get" => json(view(
            store,
            s(input, "path")?,
            input.get("version").and_then(Value::as_u64),
        )),
        "history" => json(history(store, s(input, "path")?)),
        "draft.save" => json(draft_save(store, ctx, s(input, "path")?, input)),
        "draft.start" => json(draft_start(store, ctx, s(input, "path")?, input)),
        "draft.discard" => json(draft_discard(store, ctx, s(input, "path")?)),
        "publish" => json(publish(store, ctx, s(input, "path")?, input)),
        "proposal.set" => json(proposal_set(store, ctx, s(input, "path")?, input)),
        "proposal.accept" => json(proposal_accept(store, ctx, s(input, "path")?, input)),
        "proposal.keep" => json(proposal_keep(store, ctx, s(input, "path")?)),
        "work.update" => json(work_update(store, ctx, s(input, "path")?, input)),
        "asset.put" => json(asset_put(
            store,
            ctx,
            s(input, "path")?,
            s(input, "name")?,
            body,
        )),
        "asset.get" => asset_get(store, s(input, "path")?, s(input, "name")?),
        other => Err(HostError::bad_request(format!(
            "no such Brand Clan operation: {other}"
        ))),
    }
}

/// `call`, for an op that answers JSON, with the reply as that JSON.
pub fn call_json(store: &dyn DocStore, ctx: &Ctx, op: &str, input: &Value) -> HostResult<Value> {
    call(store, ctx, op, input, Vec::new()).map(Reply::json)
}

#[allow(dead_code)]
fn _unused(_: &Map<String, Value>, _: &str) {
    let _ = MANIFEST_PATH;
}
