// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The agency registry: who works in an agency, with which roles, and its settings
//! (features/agency-setup.clan).
//!
//! A third registry document of the same kind as the clients and the jobs
//! (`clients.rs`, `jobs.rs`): one CLAN document per tenant (`document_type:
//! agency-registry`) whose `shared/data.yaml` holds `settings` and `people`. It is written
//! through [`Change`] and [`DocStore::apply`] under one lock, never touches `std::fs`, and
//! lives beside the home app so it never shows as work.
//!
//! Every change to the people or the settings is one attributed decision on the document's
//! own chain: the person who made it as the agent, the action (`set_roles`, `add_person`,
//! `remove_person`, `edit_person`, `activate`, `import_people`, `set_settings`), and the
//! before and after. A write by anything but a person is refused (`403`), so a permission
//! change is never anonymous. The chain is how the audit view reads a permission change.
//!
//! An agency has a **directory** once it has people. Until then it has none, and the
//! sign-in roster or the identity provider stays the source of roles, as before.
//!
//! Nothing here scores, ranks or measures a person.

use std::sync::Mutex;

use clan_sdk::{create, ClanBuilder, ClanFile, CreateOptions, Decision, DecisionChain};
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

use crate::ctx::Ctx;
use crate::error::{HostError, HostResult};
use crate::store::{Change, DocId, DocStore, Version};

/// The registry's tag in `Library::home`.
const REGISTRY_TAG: &str = "agency-v1";
const DATA: &str = "shared/data.yaml";
const DOCUMENT_TYPE: &str = "agency-registry";
const CHAIN: &str = "agent/decision-chain.yaml";

/// The role of an agency's admin: it edits the people, the settings and reads the audit view.
pub const ADMIN: &str = "admin";

pub const SET_ROLES: &str = "set_roles";
pub const ADD_PERSON: &str = "add_person";
pub const REMOVE_PERSON: &str = "remove_person";
pub const EDIT_PERSON: &str = "edit_person";
pub const ACTIVATE: &str = "activate";
pub const IMPORT_PEOPLE: &str = "import_people";
pub const SET_SETTINGS: &str = "set_settings";

/// Every action a registry decision may carry: the audit view lists these as permission changes.
pub const ACTIONS: [&str; 7] = [
    SET_ROLES,
    ADD_PERSON,
    REMOVE_PERSON,
    EDIT_PERSON,
    ACTIVATE,
    IMPORT_PEOPLE,
    SET_SETTINGS,
];

const MAX_NAME: usize = 120;
const MAX_CAP: f64 = 10_000_000.0;
pub const DEFAULT_TIME_ZONE: &str = "Europe/Dublin";

/// Where a person is in their time with the agency.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum State {
    /// Named by an admin, has not signed in yet.
    #[default]
    Invited,
    Active,
    /// Kept in the list for the record; cannot sign in and holds no door.
    Removed,
}

/// One person of the agency.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Person {
    /// The sign-in name, `user@agency`.
    pub username: String,
    pub name: String,
    pub email: String,
    pub roles: Vec<String>,
    #[serde(default)]
    pub state: State,
    /// Who named the person (a sign-in name, no `human:`).
    pub invited_by: String,
    /// RFC 3339: when the person was named.
    pub at: String,
}

impl Person {
    pub fn is_admin(&self) -> bool {
        self.state != State::Removed && self.roles.iter().any(|r| r == ADMIN)
    }
}

/// The agency's own settings.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Settings {
    #[serde(default)]
    pub name: String,
    /// Euros per calendar month. Stored and shown; nothing enforces it yet (the cost engine will).
    #[serde(default)]
    pub credit_cap_month_eur: f64,
    #[serde(default = "default_zone")]
    pub time_zone: String,
}

fn default_zone() -> String {
    DEFAULT_TIME_ZONE.into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            name: String::new(),
            credit_cap_month_eur: 0.0,
            time_zone: default_zone(),
        }
    }
}

/// What an admin may change in the settings. A field left out is kept.
#[derive(Deserialize, Default, Debug)]
pub struct SettingsPatch {
    pub name: Option<String>,
    pub credit_cap_month_eur: Option<f64>,
    pub time_zone: Option<String>,
}

/// What an admin may change on a person. A field left out is kept.
#[derive(Deserialize, Default, Debug)]
pub struct PersonPatch {
    pub name: Option<String>,
    pub email: Option<String>,
    pub roles: Option<Vec<String>>,
}

/// The document's contents.
#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct Registry {
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub people: Vec<Person>,
}

impl Registry {
    /// The agency has a directory once it names people.
    pub fn has_directory(&self) -> bool {
        !self.people.is_empty()
    }

    pub fn person(&self, username: &str) -> Option<&Person> {
        self.people.iter().find(|p| p.username == username)
    }
}

/// Read-modify-write on a registry is one critical section, as for clients and jobs.
static WRITE: Mutex<()> = Mutex::new(());

fn registry_id(store: &dyn DocStore) -> HostResult<DocId> {
    store.home(REGISTRY_TAG)
}

/// The version of the registry now, or none when the agency has none yet. Cheap: it is what a
/// cache compares to know whether to read again.
pub fn version(store: &dyn DocStore) -> HostResult<Option<Version>> {
    let id = registry_id(store)?;
    if !store.exists(&id) {
        return Ok(None);
    }
    Ok(Some(store.version(&id)?))
}

/// The registry and its version; an empty registry for an agency that has none.
pub fn read(store: &dyn DocStore) -> HostResult<(Registry, Option<Version>)> {
    let id = registry_id(store)?;
    if !store.exists(&id) {
        return Ok((Registry::default(), None));
    }
    let bytes = store.read(&id)?;
    let version = Version::of_archive(&bytes);
    let clan = ClanFile::from_bytes(bytes)?;
    let data = clan.read_entry(DATA)?;
    let reg: Registry = serde_yaml::from_slice(&data)
        .map_err(|e| HostError::internal(format!("the agency registry is unreadable: {e}")))?;
    Ok((reg, Some(version)))
}

fn data_yaml(reg: &Registry) -> HostResult<Vec<u8>> {
    let mut m = Mapping::new();
    m.insert(
        Value::from("$schema"),
        Value::from("spec/schemas/document.schema.json"),
    );
    for (key, value) in [
        ("settings", serde_yaml::to_value(&reg.settings)),
        ("people", serde_yaml::to_value(&reg.people)),
    ] {
        m.insert(
            Value::from(key),
            value.map_err(|e| HostError::internal(e.to_string()))?,
        );
    }
    serde_yaml::to_string(&Value::Mapping(m))
        .map(String::into_bytes)
        .map_err(|e| HostError::internal(e.to_string()))
}

fn chain_of(clan: &ClanFile) -> HostResult<DecisionChain> {
    Ok(if clan.has_entry(CHAIN) {
        DecisionChain::from_yaml(&clan.read_entry(CHAIN)?)?
    } else {
        DecisionChain::default()
    })
}

fn rebuilt(clan: &ClanFile, data: Vec<u8>, decision: Decision) -> HostResult<Vec<u8>> {
    let mut manifest = clan.manifest().clone();
    manifest.next_revision();
    manifest.updated_at = chrono::Utc::now().to_rfc3339();
    let mut chain = chain_of(clan)?;
    chain.prepend(decision);
    let mut b = ClanBuilder::new(manifest);
    for (path, bytes) in clan.read_all_entries()? {
        if path != "manifest.yaml" && path != DATA && path != CHAIN {
            b.add_entry(path, bytes);
        }
    }
    b.add_entry(DATA, data);
    b.add_entry(CHAIN, chain.to_yaml()?);
    Ok(b.build()?)
}

fn write_registry(
    store: &dyn DocStore,
    reg: &Registry,
    base: Option<Version>,
    decision: Decision,
) -> HostResult<()> {
    let id = registry_id(store)?;
    let data = data_yaml(reg)?;
    let change = match base {
        None => {
            let bytes = create(CreateOptions {
                title: "Agency".into(),
                brief: "The agency's people and settings".into(),
                document_type: Some(DOCUMENT_TYPE.into()),
                no_render: true,
                schema: None,
            })?;
            let clan = ClanFile::from_bytes(bytes)?;
            Change::create(id, rebuilt(&clan, data, decision)?)
        }
        Some(v) => {
            let clan = ClanFile::from_bytes(store.read(&id)?)?;
            let bytes = rebuilt(&clan, data, decision)?;
            if store.version(&id)? != v {
                return Err(HostError::conflict(
                    "the people list changed while you were saving; try again",
                ));
            }
            Change::replace(id, v, bytes)
        }
    };
    store.apply(&change)?;
    Ok(())
}

/// The person acting, as a sign-in name. Only a person changes an agency (`403` otherwise).
fn person_of(ctx: &Ctx) -> HostResult<String> {
    match ctx.actor.as_str().strip_prefix("human:") {
        Some(p) if !p.is_empty() => Ok(p.to_string()),
        _ => Err(HostError::new(
            403,
            format!(
                "only a person can change an agency's people or settings; {} is not one",
                ctx.actor
            ),
        )),
    }
}

/// One decision on the registry's chain: `who` did `action` to `target`, from `before` to `after`.
#[allow(clippy::too_many_arguments)]
fn decision(
    ctx: &Ctx,
    who: &str,
    action: &str,
    target: &str,
    field: &str,
    rationale: String,
    before: Value,
    after: Value,
) -> Decision {
    let mut d = crate::ops::attributed(ctx, "", "edit");
    d.id = Some(clan_sdk::decision::new_decision_id());
    d.agent = format!("human:{who}");
    d.action = action.to_string();
    d.targets = vec![target.to_string()];
    d.fields_changed = vec![format!("{target}/{field}")];
    d.rationale = rationale;
    d.timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    d.extra.insert("before".into(), before);
    d.extra.insert("after".into(), after);
    d
}

fn roles_value(roles: &[String]) -> Value {
    Value::Sequence(roles.iter().map(|r| Value::from(r.as_str())).collect())
}

fn join(roles: &[String]) -> String {
    if roles.is_empty() {
        "no roles".into()
    } else {
        roles.join(", ")
    }
}

// ── checking what is given ──────────────────────────────────────────────────

/// A person's display name: trimmed, inner spaces collapsed.
pub fn clean_person_name(raw: &str) -> HostResult<String> {
    let n = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if n.is_empty() {
        return Err(HostError::bad_request("a person needs a name"));
    }
    if n.chars().count() > MAX_NAME || n.chars().any(char::is_control) {
        return Err(HostError::bad_request(format!(
            "a name is at most {MAX_NAME} characters, with no control characters"
        )));
    }
    Ok(n)
}

/// An address as the registry keeps it. A sign-in name like `dara@wk` is accepted too: it has
/// the shape (a name, an `@`, a name), and the import's own file uses one for a test agency.
pub fn clean_email(raw: &str) -> HostResult<String> {
    let e = raw.trim().to_string();
    let ok = matches!(e.split_once('@'), Some((l, r)) if !l.is_empty() && !r.is_empty() && !r.contains('@'))
        && !e.chars().any(|c| c.is_whitespace() || c.is_control())
        && e.chars().count() <= 254;
    if ok {
        Ok(e)
    } else {
        Err(HostError::bad_request("an email looks like name@place"))
    }
}

/// Roles as the registry keeps them: lower case, each once, at least one, each one `known`.
/// A person with no role is unrestricted elsewhere, so a directory never holds one.
pub fn clean_roles(roles: &[String], known: &dyn Fn(&str) -> bool) -> HostResult<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for r in roles {
        let r = r.trim().to_ascii_lowercase();
        if r.is_empty() {
            continue;
        }
        if !known(&r) {
            return Err(HostError::bad_request(format!("{r:?} is not a role")));
        }
        if !out.contains(&r) {
            out.push(r);
        }
    }
    if out.is_empty() {
        return Err(HostError::bad_request("a person needs at least one role"));
    }
    Ok(out)
}

fn check_username(username: &str) -> HostResult<()> {
    let ok = matches!(username.split_once('@'), Some((l, r))
        if !l.is_empty() && l.len() <= 64 && !r.is_empty() && r.len() <= 40
            && l.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "._-".contains(c))
            && r.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'));
    if ok {
        Ok(())
    } else {
        Err(HostError::bad_request(
            "a sign-in name is lower case, like dara@agency",
        ))
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// An empty directory's first write names the person writing as its admin, so an agency cannot
/// lock out the person who made it. A directory that already has people is left as it is.
fn bootstrap(reg: &mut Registry, who: &str) {
    if reg.has_directory() || reg.person(who).is_some() {
        return;
    }
    let name = who.split('@').next().unwrap_or(who).to_string();
    reg.people.push(Person {
        username: who.to_string(),
        name,
        email: who.to_string(),
        roles: vec![ADMIN.into()],
        state: State::Active,
        invited_by: who.to_string(),
        at: now(),
    });
}

fn admins(reg: &Registry) -> usize {
    reg.people.iter().filter(|p| p.is_admin()).count()
}

// ── the people ──────────────────────────────────────────────────────────────

/// What a new person is given.
#[derive(Clone, Debug)]
pub struct NewPerson {
    pub username: String,
    pub name: String,
    pub email: String,
    pub roles: Vec<String>,
}

fn new_person(n: NewPerson, who: &str, known: &dyn Fn(&str) -> bool) -> HostResult<Person> {
    check_username(&n.username)?;
    Ok(Person {
        username: n.username,
        name: clean_person_name(&n.name)?,
        email: clean_email(&n.email)?,
        roles: clean_roles(&n.roles, known)?,
        state: State::Invited,
        invited_by: who.to_string(),
        at: now(),
    })
}

/// Name a person: `invited`, with roles. The first person named for an agency with no directory
/// also names the admin who writes. A name already on the list is `409`; a removed person is
/// named again.
pub fn invite(
    store: &dyn DocStore,
    ctx: &Ctx,
    new: NewPerson,
    known: &dyn Fn(&str) -> bool,
) -> HostResult<Person> {
    let who = person_of(ctx)?;
    let person = new_person(new, &who, known)?;
    let _g = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut reg, base) = read(store)?;
    bootstrap(&mut reg, &who);
    let before = reg.person(&person.username).cloned();
    match before {
        Some(p) if p.state != State::Removed => {
            return Err(HostError::conflict(format!(
                "{} is already on the list",
                person.username
            )))
        }
        Some(_) => reg.people.retain(|p| p.username != person.username),
        None => {}
    }
    reg.people.push(person.clone());
    let d = decision(
        ctx,
        &who,
        ADD_PERSON,
        &person.username,
        "roles",
        format!("Named {} with {}.", person.username, join(&person.roles)),
        Value::Null,
        roles_value(&person.roles),
    );
    write_registry(store, &reg, base, d)?;
    Ok(person)
}

/// Change a person's name, address or roles. A roles change is the `set_roles` decision with the
/// roles before and after. The last admin cannot lose the admin role (`409`).
pub fn edit_person(
    store: &dyn DocStore,
    ctx: &Ctx,
    username: &str,
    patch: PersonPatch,
    known: &dyn Fn(&str) -> bool,
) -> HostResult<Person> {
    let who = person_of(ctx)?;
    let _g = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut reg, base) = read(store)?;
    let idx = reg
        .people
        .iter()
        .position(|p| p.username == username)
        .ok_or_else(|| HostError::not_found(format!("{username} is not on the list")))?;
    if reg.people[idx].state == State::Removed {
        return Err(HostError::conflict(format!(
            "{username} was removed; name them again to bring them back"
        )));
    }
    let before = reg.people[idx].clone();
    let mut after = before.clone();
    if let Some(n) = &patch.name {
        after.name = clean_person_name(n)?;
    }
    if let Some(e) = &patch.email {
        after.email = clean_email(e)?;
    }
    if let Some(r) = &patch.roles {
        after.roles = clean_roles(r, known)?;
    }
    if after == before {
        return Ok(before);
    }
    reg.people[idx] = after.clone();
    if before.is_admin() && !after.is_admin() && admins(&reg) == 0 {
        return Err(HostError::conflict(
            "an agency keeps at least one admin; name another admin first",
        ));
    }
    let d = if after.roles != before.roles {
        decision(
            ctx,
            &who,
            SET_ROLES,
            username,
            "roles",
            format!(
                "Changed the roles of {username} from {} to {}.",
                join(&before.roles),
                join(&after.roles)
            ),
            roles_value(&before.roles),
            roles_value(&after.roles),
        )
    } else {
        decision(
            ctx,
            &who,
            EDIT_PERSON,
            username,
            "name",
            format!("Changed the name or address of {username}."),
            Value::from(format!("{} <{}>", before.name, before.email)),
            Value::from(format!("{} <{}>", after.name, after.email)),
        )
    };
    write_registry(store, &reg, base, d)?;
    Ok(after)
}

/// Take a person off the list: they cannot sign in and hold no door, and the record keeps them.
/// The last admin cannot be removed (`409`).
pub fn remove_person(store: &dyn DocStore, ctx: &Ctx, username: &str) -> HostResult<Person> {
    let who = person_of(ctx)?;
    let _g = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut reg, base) = read(store)?;
    let idx = reg
        .people
        .iter()
        .position(|p| p.username == username && p.state != State::Removed)
        .ok_or_else(|| HostError::not_found(format!("{username} is not on the list")))?;
    let before = reg.people[idx].clone();
    reg.people[idx].state = State::Removed;
    if before.is_admin() && admins(&reg) == 0 {
        return Err(HostError::conflict(
            "an agency keeps at least one admin; name another admin first",
        ));
    }
    let d = decision(
        ctx,
        &who,
        REMOVE_PERSON,
        username,
        "state",
        format!("Removed {username} (had {}).", join(&before.roles)),
        roles_value(&before.roles),
        Value::Sequence(Vec::new()),
    );
    let removed = reg.people[idx].clone();
    write_registry(store, &reg, base, d)?;
    Ok(removed)
}

/// A first sign-in turns `invited` into `active`. Done by the person themselves, as a decision.
/// Does nothing for anyone not invited.
pub fn activate(store: &dyn DocStore, ctx: &Ctx, username: &str) -> HostResult<()> {
    let who = person_of(ctx)?;
    let _g = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut reg, base) = read(store)?;
    let Some(p) = reg
        .people
        .iter_mut()
        .find(|p| p.username == username && p.state == State::Invited)
    else {
        return Ok(());
    };
    p.state = State::Active;
    let d = decision(
        ctx,
        &who,
        ACTIVATE,
        username,
        "state",
        format!("{username} signed in for the first time."),
        Value::from("invited"),
        Value::from("active"),
    );
    write_registry(store, &reg, base, d)
}

/// What a bulk write of people did.
#[derive(Serialize, Debug, PartialEq, Eq, Default, Clone)]
pub struct Upserted {
    pub created: usize,
    pub updated: usize,
    pub unchanged: usize,
}

/// Name many people in **one** registry write (the CSV import): a person not yet on the list is
/// created `invited`; one already on it takes the row's name, address and roles; a row that
/// changes nothing changes nothing, and a file that changes nothing writes nothing. A removed
/// person named again comes back. Roles in the file replace the person's; the writer is never
/// demoted by their own file (`409`), and the last admin cannot be lost.
pub fn upsert_people(
    store: &dyn DocStore,
    ctx: &Ctx,
    rows: Vec<NewPerson>,
    known: &dyn Fn(&str) -> bool,
) -> HostResult<Upserted> {
    let who = person_of(ctx)?;
    let rows = rows
        .into_iter()
        .map(|r| new_person(r, &who, known))
        .collect::<HostResult<Vec<_>>>()?;
    let _g = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut reg, base) = read(store)?;
    let was_empty = !reg.has_directory();
    bootstrap(&mut reg, &who);
    let mut out = Upserted::default();
    let mut changed = was_empty;
    for row in rows {
        match reg.people.iter().position(|p| p.username == row.username) {
            None => {
                reg.people.push(row);
                out.created += 1;
                changed = true;
            }
            Some(i) => {
                let p = &mut reg.people[i];
                let revive = p.state == State::Removed;
                if !revive && p.name == row.name && p.email == row.email && p.roles == row.roles {
                    out.unchanged += 1;
                    continue;
                }
                p.name = row.name;
                p.email = row.email;
                p.roles = row.roles;
                if revive {
                    p.state = State::Invited;
                    out.created += 1;
                } else {
                    out.updated += 1;
                }
                changed = true;
            }
        }
    }
    if !changed {
        return Ok(out);
    }
    if admins(&reg) == 0 {
        return Err(HostError::conflict(
            "an agency keeps at least one admin; the file would leave none",
        ));
    }
    if reg.person(&who).is_some_and(|p| !p.is_admin()) {
        return Err(HostError::conflict(
            "the file would take your own admin role away; keep yourself as an admin in it",
        ));
    }
    let d = decision(
        ctx,
        &who,
        IMPORT_PEOPLE,
        "people",
        "people",
        format!(
            "Imported people: {} new, {} changed, {} the same.",
            out.created, out.updated, out.unchanged
        ),
        Value::from(out.unchanged as u64 + out.updated as u64),
        Value::from(out.created as u64 + out.updated as u64 + out.unchanged as u64),
    );
    write_registry(store, &reg, base, d)?;
    Ok(out)
}

// ── the settings ────────────────────────────────────────────────────────────

/// Change the agency's name, monthly credit cap or time zone, as one `set_settings` decision.
/// A cap that is below zero or not a finite number is `400`.
pub fn set_settings(store: &dyn DocStore, ctx: &Ctx, patch: SettingsPatch) -> HostResult<Settings> {
    let who = person_of(ctx)?;
    let _g = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut reg, base) = read(store)?;
    let before = reg.settings.clone();
    let mut after = before.clone();
    if let Some(n) = &patch.name {
        let n = n.split_whitespace().collect::<Vec<_>>().join(" ");
        if n.chars().count() > MAX_NAME || n.chars().any(char::is_control) {
            return Err(HostError::bad_request(format!(
                "the agency's name is at most {MAX_NAME} characters"
            )));
        }
        after.name = n;
    }
    if let Some(c) = patch.credit_cap_month_eur {
        if !c.is_finite() || !(0.0..=MAX_CAP).contains(&c) {
            return Err(HostError::bad_request(
                "the monthly credit cap is an amount in euros, not below zero",
            ));
        }
        after.credit_cap_month_eur = c;
    }
    if let Some(z) = &patch.time_zone {
        let z = z.trim();
        if z.is_empty()
            || z.len() > 64
            || !z
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "/_+-".contains(c))
        {
            return Err(HostError::bad_request(
                "a time zone looks like Europe/Dublin",
            ));
        }
        after.time_zone = z.to_string();
    }
    if after == before {
        return Ok(before);
    }
    reg.settings = after.clone();
    let as_value = |s: &Settings| {
        let mut m = Mapping::new();
        m.insert(Value::from("name"), Value::from(s.name.as_str()));
        m.insert(
            Value::from("credit_cap_month_eur"),
            Value::from(s.credit_cap_month_eur),
        );
        m.insert(Value::from("time_zone"), Value::from(s.time_zone.as_str()));
        Value::Mapping(m)
    };
    let d = decision(
        ctx,
        &who,
        SET_SETTINGS,
        "settings",
        "settings",
        "Changed the agency's settings.".to_string(),
        as_value(&before),
        as_value(&after),
    );
    write_registry(store, &reg, base, d)?;
    Ok(after)
}

// ── reading the chain ───────────────────────────────────────────────────────

/// One change to the people or the settings, as the registry's chain records it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Edit {
    /// The decision's own id, so a copy of it can be told from the original.
    pub id: Option<String>,
    /// The sign-in name of the person who made it.
    pub who: String,
    pub action: String,
    pub target: String,
    pub what: String,
    /// RFC 3339-like, as the decision has it.
    pub at: String,
    pub before: serde_json::Value,
    pub after: serde_json::Value,
}

/// Every decision on the registry's chain, newest first. Empty when the agency has no registry.
pub fn history(store: &dyn DocStore) -> HostResult<Vec<Edit>> {
    let id = registry_id(store)?;
    if !store.exists(&id) {
        return Ok(Vec::new());
    }
    let clan = ClanFile::from_bytes(store.read(&id)?)?;
    let chain = chain_of(&clan)?;
    let conv = |v: Option<&Value>| {
        v.and_then(|v| serde_json::to_value(v).ok())
            .unwrap_or(serde_json::Value::Null)
    };
    Ok(chain
        .decisions
        .iter()
        .map(|d| Edit {
            id: d.id.clone(),
            who: d
                .agent
                .strip_prefix("human:")
                .unwrap_or(&d.agent)
                .to_string(),
            action: d.action.clone(),
            target: d.targets.first().cloned().unwrap_or_default(),
            what: d.rationale.clone(),
            at: d.timestamp.clone(),
            before: conv(d.extra.get("before")),
            after: conv(d.extra.get("after")),
        })
        .collect())
}
