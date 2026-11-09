// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The client registry: who the studio works for.
//!
//! One CLAN document per tenant (`document_type: client-registry`) whose
//! `shared/data.yaml` holds `clients`. It is an ordinary document written
//! through [`Change`] and [`PartStore::apply`] like everything else, so the
//! version check and the seal check have one place to live, and it works on
//! every store (the filesystem, a tenant tree, the browser's memory) without
//! this module touching `std::fs`.
//!
//! The registry document lives beside the home app (`Library::home`), not in
//! `documents()`, so it never shows as work in the recent list or the library.
//! It is created lazily by the first write; reading a tenant that has none is
//! an empty list, not an error.
//!
//! Identity is the id (`cli_<8 hex>`, minted here, never derived from a name).
//! A document names its client as `manifest.client {id, name}`; a rename
//! changes the registry only, and the library always answers with the
//! registry's name. Archiving hides a client from the circles and keeps every
//! document linked to it.

use std::sync::Mutex;

use clan_sdk::{
    create, new_client_id, with_client, ClanBuilder, ClanFile, ClientRef, CreateOptions,
};
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

use crate::ctx::Ctx;
use crate::error::{HostError, HostResult};
use crate::store::{Change, DocId, DocStore, Version};

/// The registry's tag in `Library::home`. Bumped only if its layout is ever
/// changed incompatibly.
const REGISTRY_TAG: &str = "clients-v1";
const DATA: &str = "shared/data.yaml";
const DOCUMENT_TYPE: &str = "client-registry";

const MAX_NAME: usize = 60;

/// How a client's circle is finished. A look, not a permission.
pub const MATERIALS: [&str; 4] = ["pearl", "ceramic", "stone", "graphite"];

/// One client of the studio.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ClientRecord {
    /// `cli_` and eight lowercase hex digits.
    pub id: String,
    pub name: String,
    /// Up to three characters for the circle; derived from the name unless
    /// someone set it.
    pub initials: String,
    /// One of [`MATERIALS`].
    pub material: String,
    /// Who opened the client: informational, never a permission.
    pub owner: String,
    pub created_at: String,
    /// When it was archived; absent while it is live.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
}

impl ClientRecord {
    pub fn is_archived(&self) -> bool {
        self.archived_at.is_some()
    }

    /// What goes into a document's manifest.
    pub fn as_ref(&self) -> ClientRef {
        ClientRef {
            id: self.id.clone(),
            name: self.name.clone(),
        }
    }
}

/// What a person may change on a client.
#[derive(Deserialize, Default, Debug)]
pub struct ClientPatch {
    pub name: Option<String>,
    pub initials: Option<String>,
    pub material: Option<String>,
}

/// What [`adopt`] did.
#[derive(Serialize, Debug, PartialEq)]
pub struct Adopted {
    /// Clients made by this call (the ones that already existed are reused).
    pub created: Vec<ClientRecord>,
    /// Documents now linked to a client by this call.
    pub linked: usize,
}

#[derive(Serialize, Deserialize, Default)]
struct Registry {
    #[serde(default)]
    clients: Vec<ClientRecord>,
}

/// Read-modify-write on a registry is one critical section. A process-wide
/// lock is coarse (tenants queue behind each other) and correct: the registry
/// is a few hundred bytes and written by a person clicking.
static WRITE: Mutex<()> = Mutex::new(());

fn registry_id(store: &dyn DocStore) -> HostResult<DocId> {
    store.home(REGISTRY_TAG)
}

fn read_registry(store: &dyn DocStore) -> HostResult<(Registry, Option<Version>)> {
    let id = registry_id(store)?;
    if !store.exists(&id) {
        return Ok((Registry::default(), None));
    }
    let bytes = store.read(&id)?;
    let version = Version::of_archive(&bytes);
    let clan = ClanFile::from_bytes(bytes)?;
    let data = clan.read_entry(DATA)?;
    let reg: Registry = serde_yaml::from_slice(&data)
        .map_err(|e| HostError::internal(format!("the client registry is unreadable: {e}")))?;
    Ok((reg, Some(version)))
}

fn data_yaml(reg: &Registry) -> HostResult<Vec<u8>> {
    let mut m = Mapping::new();
    m.insert(
        Value::from("$schema"),
        Value::from("spec/schemas/document.schema.json"),
    );
    m.insert(
        Value::from("clients"),
        serde_yaml::to_value(&reg.clients).map_err(|e| HostError::internal(e.to_string()))?,
    );
    serde_yaml::to_string(&Value::Mapping(m))
        .map(String::into_bytes)
        .map_err(|e| HostError::internal(e.to_string()))
}

/// The change that makes the registry `reg`, on top of `base`.
fn write_registry(
    store: &dyn DocStore,
    reg: &Registry,
    base: Option<Version>,
    actor: &str,
) -> HostResult<()> {
    let id = registry_id(store)?;
    let data = data_yaml(reg)?;
    let change = match base {
        None => {
            let bytes = create(CreateOptions {
                title: "Clients".into(),
                brief: "The studio's client registry".into(),
                document_type: Some(DOCUMENT_TYPE.into()),
                no_render: true,
                schema: None,
            })?;
            let clan = ClanFile::from_bytes(bytes)?;
            let bytes = rebuilt(&clan, data, actor)?;
            Change::create(id, bytes)
        }
        Some(v) => {
            let clan = ClanFile::from_bytes(store.read(&id)?)?;
            let bytes = rebuilt(&clan, data, actor)?;
            // The version is read again here, not remembered from the read:
            // a write that lost a race is a conflict, never a silent overwrite.
            if store.version(&id)? != v {
                return Err(HostError::conflict(
                    "the client list changed while you were saving; try again",
                ));
            }
            Change::replace(id, v, bytes)
        }
    };
    store.apply(&change)?;
    Ok(())
}

fn rebuilt(clan: &ClanFile, data: Vec<u8>, _actor: &str) -> HostResult<Vec<u8>> {
    let mut manifest = clan.manifest().clone();
    manifest.next_revision();
    manifest.updated_at = chrono::Utc::now().to_rfc3339();
    let mut b = ClanBuilder::new(manifest);
    for (path, bytes) in clan.read_all_entries()? {
        if path != "manifest.yaml" && path != DATA {
            b.add_entry(path, bytes);
        }
    }
    b.add_entry(DATA, data);
    Ok(b.build()?)
}

/// A name as the registry keeps it: trimmed, inner whitespace collapsed.
pub fn clean_name(raw: &str) -> HostResult<String> {
    let name = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(HostError::bad_request("a client needs a name"));
    }
    if name.chars().count() > MAX_NAME {
        return Err(HostError::bad_request(format!(
            "a client's name is at most {MAX_NAME} characters"
        )));
    }
    if name.chars().any(char::is_control) {
        return Err(HostError::bad_request(
            "a client's name cannot hold control characters",
        ));
    }
    Ok(name)
}

/// The key two spellings of one name share: case and spacing do not make a
/// second client.
pub fn name_key(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Circle initials from a name: the first letters of its first two words, or
/// the first two letters of a single word. "Client A" is "CA", "Jameson" "JA".
pub fn initials_of(name: &str) -> String {
    let words: Vec<&str> = name.split_whitespace().collect();
    let up = |s: String| s.to_uppercase();
    match words.as_slice() {
        [] => String::new(),
        [one] => up(one.chars().take(2).collect()),
        [a, b, ..] => up(a
            .chars()
            .take(1)
            .chain(b.chars().take(1))
            .collect::<String>()),
    }
}

fn clean_initials(raw: &str) -> HostResult<String> {
    let s: String = raw.split_whitespace().collect::<String>().to_uppercase();
    if s.is_empty() || s.chars().count() > 3 {
        return Err(HostError::bad_request(
            "initials are one to three characters",
        ));
    }
    Ok(s)
}

fn check_material(m: &str) -> HostResult<()> {
    if MATERIALS.contains(&m) {
        Ok(())
    } else {
        Err(HostError::bad_request(format!(
            "material is one of {}",
            MATERIALS.join(", ")
        )))
    }
}

/// The clients, live ones first in the order they were made. Archived ones
/// only when asked for.
pub fn list(store: &dyn DocStore, include_archived: bool) -> HostResult<Vec<ClientRecord>> {
    let (reg, _) = read_registry(store)?;
    Ok(reg
        .clients
        .into_iter()
        .filter(|c| include_archived || !c.is_archived())
        .collect())
}

/// One client by id, archived or not.
pub fn get(store: &dyn DocStore, id: &str) -> HostResult<ClientRecord> {
    list(store, true)?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| HostError::not_found(format!("no such client: {id}")))
}

/// The client a request names, when it names one. An absent id and an empty
/// one both mean "no client"; an unknown id is a `404`. Every host reads a
/// request's optional `client_id` through this, so they cannot drift apart.
pub fn get_named(store: &dyn DocStore, id: Option<&str>) -> HostResult<Option<ClientRecord>> {
    match id.map(str::trim).filter(|s| !s.is_empty()) {
        Some(id) => get(store, id).map(Some),
        None => Ok(None),
    }
}

/// Open a client. A name already in the registry (whatever its case or
/// spacing, archived or not) is a `409`.
pub fn create_client(
    store: &dyn DocStore,
    ctx: &Ctx,
    name: &str,
    material: Option<&str>,
) -> HostResult<ClientRecord> {
    let name = clean_name(name)?;
    if let Some(m) = material {
        check_material(m)?;
    }
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut reg, base) = read_registry(store)?;
    if reg
        .clients
        .iter()
        .any(|c| name_key(&c.name) == name_key(&name))
    {
        return Err(HostError::conflict(format!(
            "there is already a client called \"{name}\""
        )));
    }
    let record = new_record(&reg, ctx, &name, material);
    reg.clients.push(record.clone());
    write_registry(store, &reg, base, ctx.actor.as_str())?;
    Ok(record)
}

fn new_record(reg: &Registry, ctx: &Ctx, name: &str, material: Option<&str>) -> ClientRecord {
    ClientRecord {
        id: loop {
            let id = new_client_id();
            if !reg.clients.iter().any(|c| c.id == id) {
                break id;
            }
        },
        name: name.to_string(),
        initials: initials_of(name),
        // Without a choice the materials take turns, so neighbours differ.
        material: material
            .map(String::from)
            .unwrap_or_else(|| MATERIALS[reg.clients.len() % MATERIALS.len()].to_string()),
        owner: ctx.actor.as_str().to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        archived_at: None,
    }
}

/// Rename a client, or change its initials or material.
pub fn update_client(
    store: &dyn DocStore,
    ctx: &Ctx,
    id: &str,
    patch: ClientPatch,
) -> HostResult<ClientRecord> {
    let name = patch.name.as_deref().map(clean_name).transpose()?;
    let initials = patch.initials.as_deref().map(clean_initials).transpose()?;
    if let Some(m) = patch.material.as_deref() {
        check_material(m)?;
    }
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut reg, base) = read_registry(store)?;
    if let Some(n) = &name {
        if reg
            .clients
            .iter()
            .any(|c| c.id != id && name_key(&c.name) == name_key(n))
        {
            return Err(HostError::conflict(format!(
                "there is already a client called \"{n}\""
            )));
        }
    }
    let c = reg
        .clients
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(|| HostError::not_found(format!("no such client: {id}")))?;
    if let Some(n) = name {
        // Initials follow the name unless they were set by hand.
        if c.initials == initials_of(&c.name) {
            c.initials = initials_of(&n);
        }
        c.name = n;
    }
    if let Some(i) = initials {
        c.initials = i;
    }
    if let Some(m) = patch.material {
        c.material = m;
    }
    let out = c.clone();
    write_registry(store, &reg, base, ctx.actor.as_str())?;
    Ok(out)
}

/// Hide a client from the circles (`archive`), or bring it back. Its
/// documents stay linked either way. Doing either twice is not an error.
pub fn set_archived(
    store: &dyn DocStore,
    ctx: &Ctx,
    id: &str,
    archived: bool,
) -> HostResult<ClientRecord> {
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut reg, base) = read_registry(store)?;
    let c = reg
        .clients
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(|| HostError::not_found(format!("no such client: {id}")))?;
    if archived == c.is_archived() {
        return Ok(c.clone());
    }
    c.archived_at = archived.then(|| chrono::Utc::now().to_rfc3339());
    let out = c.clone();
    write_registry(store, &reg, base, ctx.actor.as_str())?;
    Ok(out)
}

/// The name a document's own data gives for who it is for, from the places
/// the tools have always kept it as free text: Brief Maker and Advertising
/// Studio's `client`, Research's `campaign.brand` and `client_org`.
pub fn legacy_name(clan: &ClanFile) -> Option<String> {
    let data: Value = serde_yaml::from_slice(&clan.read_entry(DATA).ok()?).ok()?;
    let text = |v: Option<&Value>| {
        v.and_then(Value::as_str)
            .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|s| !s.is_empty())
    };
    let campaign = data.get("campaign");
    text(data.get("client"))
        .or_else(|| text(data.get("client_org")))
        .or_else(|| text(campaign.and_then(|c| c.get("client_org"))))
        .or_else(|| text(campaign.and_then(|c| c.get("brand"))))
}

/// Turn the free-text names in `names` into clients, and link to each the
/// documents that have no client and whose own data names it. A name that is
/// already a client (any case or spacing) is reused, not duplicated; a blank
/// name is skipped. Documents that already have a client are never touched.
///
/// Only the names the person chose are adopted: nothing is guessed from the
/// documents and nothing links silently.
pub fn adopt(store: &dyn DocStore, ctx: &Ctx, names: &[String]) -> HostResult<Adopted> {
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut reg, base) = read_registry(store)?;
    let mut created = Vec::new();
    let mut chosen: Vec<ClientRecord> = Vec::new();
    for raw in names {
        let Ok(name) = clean_name(raw) else { continue };
        let key = name_key(&name);
        if chosen.iter().any(|c| name_key(&c.name) == key) {
            continue;
        }
        match reg.clients.iter().find(|c| name_key(&c.name) == key) {
            Some(existing) => chosen.push(existing.clone()),
            None => {
                let rec = new_record(&reg, ctx, &name, None);
                reg.clients.push(rec.clone());
                created.push(rec.clone());
                chosen.push(rec);
            }
        }
    }
    if !created.is_empty() {
        write_registry(store, &reg, base, ctx.actor.as_str())?;
    }
    let mut linked = 0;
    for doc in store.documents() {
        let Ok(bytes) = store.read(&doc) else {
            continue;
        };
        let version = Version::of_archive(&bytes);
        let Ok(clan) = ClanFile::from_bytes(bytes) else {
            continue;
        };
        if clan.manifest().client.is_some() {
            continue;
        }
        let Some(legacy) = legacy_name(&clan) else {
            continue;
        };
        let Some(client) = chosen
            .iter()
            .find(|c| name_key(&c.name) == name_key(&legacy))
        else {
            continue;
        };
        let bytes = with_client(&clan, Some(client.as_ref()))?;
        if store.apply(&Change::replace(doc, version, bytes)).is_ok() {
            linked += 1;
        }
    }
    Ok(Adopted { created, linked })
}

/// Free-text client names the documents carry that no client has yet, with
/// how many documents each names: what "Adopt clients" offers. Sorted by
/// count, then name.
pub fn legacy_names(store: &dyn DocStore) -> HostResult<Vec<(String, usize)>> {
    let known: Vec<String> = list(store, true)?
        .iter()
        .map(|c| name_key(&c.name))
        .collect();
    let mut counts: std::collections::BTreeMap<String, (String, usize)> = Default::default();
    for doc in store.documents() {
        let Ok(bytes) = store.read(&doc) else {
            continue;
        };
        let Ok(clan) = ClanFile::from_bytes(bytes) else {
            continue;
        };
        if clan.manifest().client.is_some() {
            continue;
        }
        if let Some(name) = legacy_name(&clan) {
            let key = name_key(&name);
            if known.contains(&key) {
                continue;
            }
            let seen = counts.entry(key).or_insert((name.clone(), 0));
            // Of several spellings the first in sort order is offered, so the
            // answer does not depend on the order the store lists documents.
            if name < seen.0 {
                seen.0 = name;
            }
            seen.1 += 1;
        }
    }
    let mut out: Vec<(String, usize)> = counts.into_values().collect();
    out.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    Ok(out)
}

/// One free-text client name on offer to "Adopt clients", and how many
/// documents carry it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LegacyName {
    pub name: String,
    pub documents: usize,
}

/// [`legacy_names`] as the hosts return it to the shell.
pub fn legacy_offer(store: &dyn DocStore) -> HostResult<Vec<LegacyName>> {
    Ok(legacy_names(store)?
        .into_iter()
        .map(|(name, documents)| LegacyName { name, documents })
        .collect())
}
