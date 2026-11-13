// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Who may sign in, and the agencies they belong to (features/people-admin.clan).
//!
//! The roster used to be a TSV baked into the image, so adding a person took a
//! PR and a redeploy. Now it is a store on the server's data volume, changed
//! from the People page by an admin:
//!
//! ```text
//! <data>/_people/people.json     { people: [...], agencies: [...], names: {...} }
//! <data>/_people/changes.jsonl   one line per change: when, who, what
//! <data>/_people/logos/<id>/     basic agencies' cleaned wordmarks (wordmark-<sha256-8>.svg)
//! ```
//!
//! The file is seeded once, from the roster file (`NAPKIN_AUTH_ROSTER`), the
//! first time a server starts without it, so nobody loses access at the
//! switch. After that the store is the roster; the file is only the seed.
//!
//! Every web task mounts the same volume, so a write is a whole-file replace
//! (tmp + rename) and a read notices another task's write by the file's
//! modification time, checked at most every [`RECHECK`].
//!
//! Two tiers of agency (features/agency-looks-admin.clan). `agencies` are the
//! basic ones, made on the page: a name, aliases, base, accent and one SVG
//! wordmark, every change going to a draft until it is published. `names`
//! holds the display names given on the page to agencies kept in code, the
//! only thing about them the page can change. The shell's registry
//! (app/src/shell/agency/palette.ts `AGENCY_COLOURS`, `AGENCY_ALIASES`) keeps
//! the agencies with logos and options; [`CODE_AGENCIES`] and
//! [`CODE_ALIASES`] mirror its ids, names, colours and aliases so an agency is
//! recognised the same way on both sides (app/tests/peopleAdmin.test.ts keeps
//! the two in step).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};

use crate::auth::Account;

/// Who may open the People page and call its routes (owner, 2026-11-12).
/// One list, here; tests pin it.
pub const PEOPLE_ADMINS: &[&str] = &["engineer@napkin"];

/// Whether `username` may manage people.
pub fn is_admin(username: &str) -> bool {
    let u = username.trim().to_ascii_lowercase();
    PEOPLE_ADMINS.contains(&u.as_str())
}

/// The shell registry's agencies: id, name, base, accent (palette.ts `AGENCY_COLOURS`).
pub const CODE_AGENCIES: &[(&str, &str, &str, &str)] = &[
    ("wk", "Wieden+Kennedy", "#1E22AA", "#FFB800"),
    ("tbwa", "TBWA\\Dublin", "#16181D", "#FFD400"),
    ("ogilvy", "Ogilvy", "#E4002B", "#FFD6DD"),
    ("harbour", "Harbour & Co", "#0F6B5C", "#9FE6D8"),
    ("droga", "Droga5", "#16181D", "#C6F432"),
    ("napkin", "Napkin", "#515BFF", "#C8CBFF"),
    ("boysandgirls", "Boys+Girls", "#000000", "#FFFFFF"),
    ("catapult", "Catapult", "#000000", "#C61566"),
    ("pluto", "Pluto", "#000047", "#B2F257"),
    ("acne", "ACNE", "#000000", "#86BC25"),
];

/// Other spellings of the registry's agencies (palette.ts `AGENCY_ALIASES`).
pub const CODE_ALIASES: &[(&str, &str)] = &[
    ("bg", "boysandgirls"),
    ("boysgirls", "boysandgirls"),
    ("b+g", "boysandgirls"),
    ("w+k", "wk"),
];

/// How often a read looks at the file for another server's write.
pub const RECHECK: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersonRec {
    /// `user@agency`, the sign-in name.
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The agency id (the part after the @).
    pub agency: String,
    /// One of [`PEOPLE_ADMINS`] when written.
    #[serde(default)]
    pub admin: bool,
    pub added_by: String,
    pub added_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removed_at: Option<String>,
}

impl PersonRec {
    pub fn active(&self) -> bool {
        self.removed_at.is_none()
    }
}

/// A basic agency's wordmark: a sanitised SVG file under
/// `<store>/logos/<agency id>/`, named by its content (`wordmark-<sha256-8>.svg`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Wordmark {
    pub file: String,
    /// The cleaned file's size.
    pub bytes: usize,
}

/// `Option<Option<T>>` read so that a key given as `null` is `Some(None)`
/// (removed in the draft) and an absent key is `None` (unchanged).
fn present<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

/// What a basic agency's draft changes, field by field; an absent field is the
/// published one. `wordmark: null` takes the published wordmark away.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BasicDraft {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aliases: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub wordmark: Option<Option<Wordmark>>,
}

impl BasicDraft {
    fn is_empty(&self) -> bool {
        *self == BasicDraft::default()
    }
}

fn yes() -> bool {
    true
}

/// A basic agency: made on the People page, its look from two colours and a
/// wordmark. An agency kept before drafts existed has none of the draft
/// fields and reads as published.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgencyRec {
    pub id: String,
    pub name: String,
    pub base: String,
    pub accent: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub wordmark: Option<Wordmark>,
    /// False until the first Publish: then it is not on `/agency-looks` and
    /// people cannot be added to it.
    #[serde(default = "yes")]
    pub published: bool,
    /// Unpublished changes. An unpublished agency always has one (perhaps empty).
    #[serde(default)]
    pub draft: Option<BasicDraft>,
    /// Bumped on every change to this agency; a write naming an older one is refused.
    #[serde(default)]
    pub rev: u64,
    /// The rev the published look was made at (what `/agency-looks` shows, so
    /// a draft is not seen there even as a number).
    #[serde(default)]
    pub published_rev: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
}

/// The look a basic agency's draft would publish: every field, merged.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct BasicLook {
    pub name: String,
    pub aliases: Vec<String>,
    pub base: String,
    pub accent: String,
    pub wordmark: Option<Wordmark>,
}

impl AgencyRec {
    /// The look as published (for an unpublished agency, as created).
    pub fn live(&self) -> BasicLook {
        BasicLook {
            name: self.name.clone(),
            aliases: self.aliases.clone(),
            base: self.base.clone(),
            accent: self.accent.clone(),
            wordmark: self.wordmark.clone(),
        }
    }

    /// The look the draft would publish; None without a draft.
    pub fn drafted(&self) -> Option<BasicLook> {
        let d = self.draft.as_ref()?;
        let l = self.live();
        Some(BasicLook {
            name: d.name.clone().unwrap_or(l.name),
            aliases: d.aliases.clone().unwrap_or(l.aliases),
            base: d.base.clone().unwrap_or(l.base),
            accent: d.accent.clone().unwrap_or(l.accent),
            wordmark: d.wordmark.clone().unwrap_or(l.wordmark),
        })
    }

    /// Every name the agency answers to or will once its draft is published.
    fn claims(&self) -> Vec<String> {
        let mut out = vec![self.id.clone(), self.name.to_lowercase()];
        out.extend(self.aliases.iter().map(|a| a.to_lowercase()));
        if let Some(d) = &self.draft {
            out.extend(d.name.iter().map(|n| n.to_lowercase()));
            out.extend(d.aliases.iter().flatten().map(|a| a.to_lowercase()));
        }
        out
    }

    /// Drop draft fields that equal the published ones; a published agency's
    /// empty draft goes.
    fn tidy_draft(&mut self) {
        let l = self.live();
        if let Some(d) = &mut self.draft {
            if d.name.as_ref() == Some(&l.name) {
                d.name = None;
            }
            if d.aliases.as_ref() == Some(&l.aliases) {
                d.aliases = None;
            }
            if d.base.as_ref() == Some(&l.base) {
                d.base = None;
            }
            if d.accent.as_ref() == Some(&l.accent) {
                d.accent = None;
            }
            if d.wordmark.as_ref() == Some(&l.wordmark) {
                d.wordmark = None;
            }
            if self.published && d.is_empty() {
                self.draft = None;
            }
        }
    }

    fn touched(&mut self, by: &str) {
        self.rev += 1;
        self.changed_by = Some(by.to_string());
        self.changed_at = Some(now());
    }
}

/// A display name given on the page to an agency kept in code (palette.ts):
/// only the name can change there; the look stays the code's.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NameRec {
    /// The published name (the code's until a draft is first published).
    pub name: String,
    #[serde(default)]
    pub draft_name: Option<String>,
    #[serde(default)]
    pub rev: u64,
    /// The rev the published name was made at.
    #[serde(default)]
    pub published_rev: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Book {
    #[serde(default)]
    pub people: Vec<PersonRec>,
    #[serde(default)]
    pub agencies: Vec<AgencyRec>,
    /// Display names of agencies in code, by code id.
    #[serde(default)]
    pub names: std::collections::BTreeMap<String, NameRec>,
}

/// The code agency `id`'s name in palette.ts.
pub fn code_name(id: &str) -> Option<&'static str> {
    CODE_AGENCIES
        .iter()
        .find(|(i, ..)| *i == id)
        .map(|(_, n, ..)| *n)
}

/// Why a change was refused, as the route answers it.
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    Bad(String),
    Conflict(String),
    NotFound(String),
    Io(String),
}

pub type Change<T> = Result<T, Refusal>;

fn bad<T>(msg: impl Into<String>) -> Change<T> {
    Err(Refusal::Bad(msg.into()))
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// `#rrggbb`, upper case; None when it is not one.
pub fn hex_colour(s: &str) -> Option<String> {
    let t = s.trim();
    let h = t.strip_prefix('#')?;
    (h.len() == 6 && h.chars().all(|c| c.is_ascii_hexdigit()))
        .then(|| format!("#{}", h.to_ascii_uppercase()))
}

/// An agency id made from a name: lower case, `+` read as "and", everything
/// else that is not a letter or digit dropped (`Boys+Girls` → `boysandgirls`,
/// `Rothco` → `rothco`).
pub fn agency_slug(name: &str) -> String {
    name.trim()
        .to_lowercase()
        .replace(['+', '&'], "and")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(40)
        .collect()
}

/// The sign-in user part made from a person's name: their first name, lower case.
pub fn first_name_user(name: &str) -> String {
    name.split_whitespace()
        .next()
        .unwrap_or("")
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || ".-_".contains(*c))
        .collect()
}

impl Book {
    /// The agency id `text` means: an id, a name or an alias, of the shell's
    /// registry (or the display name published for one) or of a published
    /// basic agency, any case. None when nothing matches.
    pub fn recognise(&self, text: &str) -> Option<String> {
        let t = text.trim().to_lowercase();
        if t.is_empty() {
            return None;
        }
        for (id, name, _, _) in CODE_AGENCIES {
            if t == *id || t == name.to_lowercase() {
                return Some(id.to_string());
            }
        }
        for (alias, id) in CODE_ALIASES {
            if t == *alias {
                return Some(id.to_string());
            }
        }
        if let Some((id, _)) = self.names.iter().find(|(_, n)| n.name.to_lowercase() == t) {
            return Some(id.clone());
        }
        self.agencies
            .iter()
            .filter(|a| a.published)
            .find(|a| {
                a.id == t
                    || a.name.to_lowercase() == t
                    || a.aliases.iter().any(|x| x.to_lowercase() == t)
            })
            .map(|a| a.id.clone())
    }

    /// The agency, other than `except`, that already answers to `text` or will
    /// once its draft is published: code ids, names, aliases and display
    /// names (published or drafted), and every basic agency's id, names and
    /// aliases, published or not.
    pub fn claimed(&self, text: &str, except: &str) -> Option<String> {
        let t = text.trim().to_lowercase();
        if t.is_empty() {
            return None;
        }
        for (id, name, _, _) in CODE_AGENCIES {
            if *id != except && (t == *id || t == name.to_lowercase()) {
                return Some(id.to_string());
            }
        }
        for (alias, id) in CODE_ALIASES {
            if *id != except && t == *alias {
                return Some(id.to_string());
            }
        }
        for (id, n) in &self.names {
            if id != except
                && (n.name.to_lowercase() == t
                    || n.draft_name.as_ref().is_some_and(|d| d.to_lowercase() == t))
            {
                return Some(id.clone());
            }
        }
        self.agencies
            .iter()
            .find(|a| a.id != except && a.claims().contains(&t))
            .map(|a| a.id.clone())
    }

    pub fn agency(&self, id: &str) -> Option<&AgencyRec> {
        self.agencies.iter().find(|a| a.id == id)
    }

    pub fn person(&self, id: &str) -> Option<&PersonRec> {
        self.people.iter().find(|p| p.id == id)
    }

    /// Everyone seeded from a roster file's text (`user@agency<TAB>Name`, `#` comments).
    pub fn seeded(roster: &str, at: &str) -> Self {
        let mut people: Vec<PersonRec> = Vec::new();
        for line in roster.lines() {
            let l = line.trim_end_matches('\r');
            if l.trim().is_empty() || l.trim_start().starts_with('#') {
                continue;
            }
            let (user, name) = l.split_once('\t').unwrap_or((l, ""));
            let Some((id, agency)) = Account::parse_username(user) else {
                continue;
            };
            if people.iter().any(|p| p.id == id) {
                continue;
            }
            let name = name.trim();
            people.push(PersonRec {
                admin: is_admin(&id),
                id,
                name: (!name.is_empty()).then(|| name.to_string()),
                agency,
                added_by: "roster".into(),
                added_at: at.to_string(),
                removed_at: None,
            });
        }
        Book {
            people,
            ..Default::default()
        }
    }
}

/// What adding a person asks for.
#[derive(Debug, Default, Deserialize)]
pub struct NewPerson {
    pub name: String,
    /// An agency id, name or alias.
    pub agency: String,
    /// The sign-in name; made from the first name and the agency when absent.
    #[serde(default)]
    pub username: Option<String>,
}

/// What creating a basic agency asks for. Its id is made from the name
/// ([`agency_slug`]) and fixed from then on.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewAgency {
    /// The name as shown.
    pub name: String,
    pub base: String,
    pub accent: String,
    #[serde(default)]
    pub aliases: Vec<String>,
}

/// A change to an agency's draft. A basic agency takes any of the fields; an
/// agency in code only `name`. `rev` is the agency's as the page last read it.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftEdit {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub aliases: Option<Vec<String>>,
    #[serde(default)]
    pub base: Option<String>,
    #[serde(default)]
    pub accent: Option<String>,
    #[serde(default)]
    pub rev: Option<u64>,
}

/// Publishing asks for the rev the page last read.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Publish {
    #[serde(default)]
    pub rev: Option<u64>,
}

/// Other spellings as kept: trimmed, lower case, once each, none empty.
fn clean_aliases(aliases: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for a in aliases {
        let a = a.trim().to_lowercase();
        if !a.is_empty() && !out.contains(&a) {
            out.push(a);
        }
    }
    out
}

fn colours(base: &str, accent: &str) -> Change<(String, String)> {
    match (hex_colour(base), hex_colour(accent)) {
        (Some(b), Some(a)) => Ok((b, a)),
        _ => bad("The base and accent colours must be #rrggbb."),
    }
}

fn stale<T>(name: &str) -> Change<T> {
    Err(Refusal::Conflict(format!(
        "{name} was changed by someone else since you opened it. Reload it to see their change."
    )))
}

fn need_rev(rev: Option<u64>) -> Change<u64> {
    rev.ok_or_else(|| Refusal::Bad("Say which rev of the agency you are changing.".into()))
}

/// Refuse a name or alias another agency answers to (or will, once published).
fn check_free<'a>(book: &Book, id: &str, texts: impl IntoIterator<Item = &'a str>) -> Change<()> {
    for t in texts {
        if let Some(other) = book.claimed(t, id) {
            return Err(Refusal::Conflict(format!(
                "{t:?} is already the agency {other}."
            )));
        }
    }
    Ok(())
}

/// Which of the two kinds an agency id is.
pub enum Kind {
    Code(&'static str),
    Basic,
}

fn kind_of(book: &Book, id: &str) -> Change<Kind> {
    if let Some(n) = code_name(id) {
        return Ok(Kind::Code(n));
    }
    if book.agency(id).is_some() {
        return Ok(Kind::Basic);
    }
    Err(Refusal::NotFound(format!("There is no agency {id}.")))
}

fn code_only_name<T>() -> Change<T> {
    bad("Only the display name of an agency in code changes here; its look is kept in code.")
}

struct Cache {
    book: Book,
    stamp: Option<Stamp>,
    checked: Instant,
}

/// The store: one JSON file, cached, re-read when another server writes it.
pub struct People {
    dir: PathBuf,
    cache: Mutex<Cache>,
}

impl People {
    /// Open the store in `dir`, seeding it from the roster file `seed` when it
    /// does not exist yet. Refuses a store that cannot be read, and a seed that
    /// names no one: a studio nobody can sign in to is a misconfiguration.
    pub fn open(dir: PathBuf, seed: &Path) -> Result<Self, String> {
        let file = dir.join("people.json");
        if !file.exists() {
            let text = std::fs::read_to_string(seed)
                .map_err(|e| format!("cannot read the roster {}: {e}", seed.display()))?;
            let book = Book::seeded(&text, &now());
            if book.people.is_empty() {
                return Err(format!("the roster {} names no one", seed.display()));
            }
            write_book(&dir, &book).map_err(|e| format!("cannot write {}: {e}", file.display()))?;
            append_change(
                &dir,
                &serde_json::json!({
                    "at": now(), "by": "roster", "what": "seeded",
                    "from": seed.display().to_string(), "people": book.people.len(),
                }),
            );
            tracing::info!(target: "napkin_web::people", from = %seed.display(), people = book.people.len(), "people seeded from the roster");
        }
        let (book, stamp) = read_book(&dir)?;
        if book.people.is_empty() {
            return Err(format!("{} names no one", file.display()));
        }
        Ok(Self {
            dir,
            cache: Mutex::new(Cache {
                book,
                stamp,
                checked: Instant::now(),
            }),
        })
    }

    fn file(&self) -> PathBuf {
        self.dir.join("people.json")
    }

    /// The store as it is now (another server's write included, within [`RECHECK`]).
    pub fn book(&self) -> Book {
        let mut c = self.cache.lock().unwrap();
        if c.checked.elapsed() >= RECHECK {
            c.checked = Instant::now();
            let stamp = stamp_of(&self.file());
            if stamp != c.stamp {
                // A file that will not read keeps the last good copy: nobody is locked out by a bad write.
                match read_book(&self.dir) {
                    Ok((b, s)) => {
                        c.book = b;
                        c.stamp = s;
                    }
                    Err(e) => {
                        tracing::error!(target: "napkin_web::people", error = %e, "people store unreadable; kept the last copy")
                    }
                }
            }
        }
        c.book.clone()
    }

    /// The active person signing in as `username`, if there is one.
    pub fn active(&self, username: &str) -> Option<PersonRec> {
        self.book().person(username).filter(|p| p.active()).cloned()
    }

    /// Change the store: read it fresh, apply `f`, write it, keep the change on the log.
    fn change<T>(
        &self,
        by: &str,
        what: &str,
        f: impl FnOnce(&mut Book) -> Change<(T, serde_json::Value)>,
    ) -> Change<T> {
        let mut c = self.cache.lock().unwrap();
        let (mut book, _) = read_book(&self.dir).map_err(Refusal::Io)?;
        let (out, detail) = f(&mut book)?;
        write_book(&self.dir, &book).map_err(|e| Refusal::Io(e.to_string()))?;
        c.stamp = stamp_of(&self.file());
        c.checked = Instant::now();
        c.book = book;
        drop(c);
        let at = now();
        let mut line = serde_json::json!({ "at": at, "by": by, "what": what });
        if let (Some(o), serde_json::Value::Object(d)) = (line.as_object_mut(), detail.clone()) {
            o.extend(d);
        }
        append_change(&self.dir, &line);
        tracing::info!(target: "napkin_web::people", by, what, detail = %detail, "people changed");
        Ok(out)
    }

    /// Add a person (or bring back one who was removed).
    pub fn add(&self, by: &str, req: &NewPerson) -> Change<PersonRec> {
        let name = req.name.trim().to_string();
        if name.is_empty() {
            return bad("Give the person's name.");
        }
        self.change(by, "added", |book| {
            let Some(agency) = book.recognise(&req.agency) else {
                let t = req.agency.trim().to_lowercase();
                if let Some(a) = book
                    .agencies
                    .iter()
                    .find(|a| !a.published && a.claims().contains(&t))
                {
                    return Err(Refusal::Conflict(format!(
                        "{} is not published yet, so nobody can be added to it. Publish it on the Agencies tab first.",
                        a.drafted().map_or_else(|| a.name.clone(), |l| l.name)
                    )));
                }
                return Err(Refusal::Bad(format!(
                    "No agency called {:?}. Add it as a new agency first.",
                    req.agency.trim()
                )));
            };
            let typed = req
                .username
                .as_deref()
                .map(str::trim)
                .filter(|u| !u.is_empty());
            let raw = match typed {
                Some(u) => u.to_string(),
                None => format!("{}@{agency}", first_name_user(&name)),
            };
            let (id, at_agency) = Account::parse_username(&raw).ok_or_else(|| {
                Refusal::Bad(format!("{raw:?} is not a sign-in name like name@{agency}."))
            })?;
            if at_agency != agency {
                return Err(Refusal::Bad(format!(
                    "The sign-in name ends @{at_agency}, but the agency is {agency}."
                )));
            }
            let rec = PersonRec {
                admin: is_admin(&id),
                id: id.clone(),
                name: Some(name.clone()),
                agency: agency.clone(),
                added_by: by.to_string(),
                added_at: now(),
                removed_at: None,
            };
            match book.people.iter_mut().find(|p| p.id == id) {
                Some(p) if p.active() => {
                    return Err(Refusal::Conflict(format!("{id} can already sign in.")))
                }
                Some(p) => *p = rec.clone(),
                None => book.people.push(rec.clone()),
            }
            Ok((
                rec,
                serde_json::json!({ "person": id, "name": name, "agency": agency }),
            ))
        })
    }

    /// Rename a person: the name people see; the sign-in name stays.
    pub fn rename(&self, by: &str, id: &str, name: &str) -> Change<PersonRec> {
        let name = name.trim().to_string();
        if name.is_empty() {
            return bad("Give the new name.");
        }
        self.change(by, "renamed", |book| {
            let p = book
                .people
                .iter_mut()
                .find(|p| p.id == id && p.active())
                .ok_or_else(|| Refusal::NotFound(format!("{id} is not on the list.")))?;
            let from = p.name.replace(name.clone());
            Ok((
                p.clone(),
                serde_json::json!({ "person": id, "from": from, "to": name }),
            ))
        })
    }

    /// Remove a person: they cannot sign in after this; their documents and decisions stay.
    pub fn remove(&self, by: &str, id: &str) -> Change<PersonRec> {
        if is_admin(id) {
            return Err(Refusal::Conflict(format!(
                "{id} manages people and cannot be removed here."
            )));
        }
        self.change(by, "removed", |book| {
            let p = book
                .people
                .iter_mut()
                .find(|p| p.id == id && p.active())
                .ok_or_else(|| Refusal::NotFound(format!("{id} is not on the list.")))?;
            p.removed_at = Some(now());
            Ok((p.clone(), serde_json::json!({ "person": id })))
        })
    }

    /// Create a basic agency as a draft: nobody sees it, and nobody can be
    /// added to it, until it is published.
    pub fn add_agency(&self, by: &str, req: &NewAgency) -> Change<AgencyRec> {
        let name = req.name.trim().to_string();
        if name.is_empty() {
            return bad("Give the agency's name as people should see it.");
        }
        let (base, accent) = colours(&req.base, &req.accent)?;
        let id = agency_slug(&name);
        if Account::parse_username(&format!("x@{id}")).map(|(_, a)| a) != Some(id.clone()) {
            return bad(format!(
                "{name:?} makes no usable sign-in id: give a name with letters or digits."
            ));
        }
        let aliases = clean_aliases(&req.aliases);
        self.change(by, "agency drafted", |book| {
            check_free(
                book,
                "",
                [id.as_str(), name.as_str()]
                    .into_iter()
                    .chain(aliases.iter().map(String::as_str)),
            )?;
            let at = now();
            let rec = AgencyRec {
                id: id.clone(),
                name: name.clone(),
                base: base.clone(),
                accent: accent.clone(),
                aliases: aliases.clone(),
                wordmark: None,
                published: false,
                draft: Some(BasicDraft::default()),
                rev: 1,
                published_rev: 0,
                added_by: Some(by.to_string()),
                added_at: Some(at.clone()),
                changed_by: Some(by.to_string()),
                changed_at: Some(at),
                published_by: None,
                published_at: None,
            };
            book.agencies.push(rec.clone());
            Ok((
                rec,
                serde_json::json!({ "agency": id, "name": name, "base": base, "accent": accent, "aliases": aliases }),
            ))
        })
    }

    /// Change an agency's draft: a basic agency's name, aliases and colours,
    /// an agency in code's display name only.
    pub fn edit_draft(&self, by: &str, id: &str, req: &DraftEdit) -> Change<()> {
        let rev = need_rev(req.rev)?;
        let name = match req.name.as_deref().map(str::trim) {
            Some("") => return bad("Give the agency's name as people should see it."),
            n => n.map(str::to_string),
        };
        let base = match req.base.as_deref() {
            Some(b) => Some(
                hex_colour(b)
                    .ok_or_else(|| Refusal::Bad("The base colour must be #rrggbb.".into()))?,
            ),
            None => None,
        };
        let accent = match req.accent.as_deref() {
            Some(a) => Some(
                hex_colour(a)
                    .ok_or_else(|| Refusal::Bad("The accent colour must be #rrggbb.".into()))?,
            ),
            None => None,
        };
        let aliases = req.aliases.as_deref().map(clean_aliases);
        self.change(by, "agency draft changed", |book| {
            match kind_of(book, id)? {
                Kind::Code(code) => {
                    if aliases.is_some() || base.is_some() || accent.is_some() {
                        return code_only_name();
                    }
                    let current = book.names.get(id).map_or(0, |n| n.rev);
                    if rev != current {
                        return stale(code);
                    }
                    let Some(name) = name.clone() else {
                        return bad("Give the display name.");
                    };
                    check_free(book, id, [name.as_str()])?;
                    let n = book.names.entry(id.to_string()).or_insert_with(|| NameRec {
                        name: code.to_string(),
                        draft_name: None,
                        rev: 0,
                        published_rev: 0,
                        changed_by: None,
                        changed_at: None,
                        published_by: None,
                        published_at: None,
                    });
                    n.draft_name = (name != n.name).then(|| name.clone());
                    n.rev += 1;
                    n.changed_by = Some(by.to_string());
                    n.changed_at = Some(now());
                    let gone = n.draft_name.is_none() && n.name == code;
                    if gone {
                        book.names.remove(id);
                    }
                    Ok(((), serde_json::json!({ "agency": id, "name": name })))
                }
                Kind::Basic => {
                    let i = book.agencies.iter().position(|a| a.id == id).unwrap();
                    let current = &book.agencies[i];
                    if rev != current.rev {
                        return stale(&current.name);
                    }
                    check_free(
                        book,
                        id,
                        name.iter()
                            .map(String::as_str)
                            .chain(aliases.iter().flatten().map(String::as_str)),
                    )?;
                    let a = &mut book.agencies[i];
                    let d = a.draft.get_or_insert_with(BasicDraft::default);
                    if name.is_some() {
                        d.name = name.clone();
                    }
                    if aliases.is_some() {
                        d.aliases = aliases.clone();
                    }
                    if base.is_some() {
                        d.base = base.clone();
                    }
                    if accent.is_some() {
                        d.accent = accent.clone();
                    }
                    a.tidy_draft();
                    a.touched(by);
                    Ok((
                        (),
                        serde_json::json!({ "agency": id, "name": name, "aliases": aliases, "base": base, "accent": accent }),
                    ))
                }
            }
        })
    }

    /// Put a cleaned wordmark into a basic agency's draft. The file is
    /// written first, named by its content, so a refused change leaves only
    /// an unused file behind.
    pub fn set_wordmark(&self, by: &str, id: &str, svg: &str) -> Change<()> {
        if code_name(id).is_some() {
            return Err(Refusal::Conflict(
                "An agency in code keeps its logos in code; only its display name changes here."
                    .into(),
            ));
        }
        if self.book().agency(id).is_none() {
            return Err(Refusal::NotFound(format!("There is no agency {id}.")));
        }
        use sha2::Digest as _;
        let hash = sha2::Sha256::digest(svg.as_bytes());
        let short: String = hash[..4].iter().map(|b| format!("{b:02x}")).collect();
        let file = format!("wordmark-{short}.svg");
        let dir = self.logo_dir(id);
        std::fs::create_dir_all(&dir)
            .and_then(|_| std::fs::write(dir.join(&file), svg))
            .map_err(|e| Refusal::Io(e.to_string()))?;
        let mark = Wordmark {
            file: file.clone(),
            bytes: svg.len(),
        };
        self.change(by, "agency wordmark drafted", |book| {
            let a = book
                .agencies
                .iter_mut()
                .find(|a| a.id == id)
                .ok_or_else(|| Refusal::NotFound(format!("There is no agency {id}.")))?;
            a.draft.get_or_insert_with(BasicDraft::default).wordmark = Some(Some(mark.clone()));
            a.tidy_draft();
            a.touched(by);
            Ok((
                (),
                serde_json::json!({ "agency": id, "file": file, "bytes": svg.len() }),
            ))
        })
    }

    /// Take the wordmark out of a basic agency's draft.
    pub fn remove_wordmark(&self, by: &str, id: &str) -> Change<()> {
        self.change(by, "agency wordmark removed from draft", |book| {
            if let Kind::Code(_) = kind_of(book, id)? {
                return Err(Refusal::Conflict(
                    "An agency in code keeps its logos in code; only its display name changes here."
                        .into(),
                ));
            }
            let a = book.agencies.iter_mut().find(|a| a.id == id).unwrap();
            if a.drafted().unwrap_or_else(|| a.live()).wordmark.is_none() {
                return Err(Refusal::Conflict(format!(
                    "{} has no wordmark to remove.",
                    a.name
                )));
            }
            a.draft.get_or_insert_with(BasicDraft::default).wordmark = Some(None);
            a.tidy_draft();
            a.touched(by);
            Ok(((), serde_json::json!({ "agency": id })))
        })
    }

    /// Make an agency's draft live.
    pub fn publish(&self, by: &str, id: &str, req: &Publish) -> Change<()> {
        let rev = need_rev(req.rev)?;
        self.change(by, "agency published", |book| match kind_of(book, id)? {
            Kind::Code(code) => {
                let n = book.names.get(id).cloned();
                if rev != n.as_ref().map_or(0, |n| n.rev) {
                    return stale(code);
                }
                let Some(name) = n.as_ref().and_then(|n| n.draft_name.clone()) else {
                    return Err(Refusal::Conflict(format!(
                        "{code} has no draft to publish."
                    )));
                };
                check_free(book, id, [name.as_str()])?;
                if name == code {
                    book.names.remove(id);
                } else {
                    let n = book.names.get_mut(id).unwrap();
                    n.name = name.clone();
                    n.draft_name = None;
                    n.rev += 1;
                    let at = now();
                    n.changed_by = Some(by.to_string());
                    n.changed_at = Some(at.clone());
                    n.published_by = Some(by.to_string());
                    n.published_at = Some(at);
                    n.published_rev = n.rev;
                }
                Ok(((), serde_json::json!({ "agency": id, "name": name })))
            }
            Kind::Basic => {
                let i = book.agencies.iter().position(|a| a.id == id).unwrap();
                let a = book.agencies[i].clone();
                if rev != a.rev {
                    return stale(&a.name);
                }
                let Some(look) = a.drafted() else {
                    return Err(Refusal::Conflict(format!(
                        "{} has no draft to publish.",
                        a.name
                    )));
                };
                check_free(
                    book,
                    id,
                    [look.name.as_str()]
                        .into_iter()
                        .chain(look.aliases.iter().map(String::as_str)),
                )?;
                let a = &mut book.agencies[i];
                a.name = look.name.clone();
                a.aliases = look.aliases.clone();
                a.base = look.base.clone();
                a.accent = look.accent.clone();
                a.wordmark = look.wordmark.clone();
                a.published = true;
                a.draft = None;
                a.touched(by);
                a.published_by = Some(by.to_string());
                a.published_at = a.changed_at.clone();
                a.published_rev = a.rev;
                Ok((
                    (),
                    serde_json::json!({ "agency": id, "name": look.name, "aliases": look.aliases,
                        "base": look.base, "accent": look.accent,
                        "wordmark": look.wordmark.map(|w| w.file) }),
                ))
            }
        })
    }

    /// Drop an agency's draft. An agency never published goes with it.
    pub fn discard_draft(&self, by: &str, id: &str) -> Change<()> {
        self.change(by, "agency draft discarded", |book| {
            match kind_of(book, id)? {
                Kind::Code(code) => {
                    let Some(n) = book.names.get_mut(id).filter(|n| n.draft_name.is_some()) else {
                        return Err(Refusal::Conflict(format!(
                            "{code} has no draft to discard."
                        )));
                    };
                    n.draft_name = None;
                    n.rev += 1;
                    n.changed_by = Some(by.to_string());
                    n.changed_at = Some(now());
                    if n.name == code {
                        book.names.remove(id);
                    }
                    Ok(((), serde_json::json!({ "agency": id })))
                }
                Kind::Basic => {
                    let i = book.agencies.iter().position(|a| a.id == id).unwrap();
                    let a = &mut book.agencies[i];
                    if !a.published {
                        book.agencies.remove(i);
                        return Ok(((), serde_json::json!({ "agency": id, "unpublished": true })));
                    }
                    if a.draft.is_none() {
                        return Err(Refusal::Conflict(format!(
                            "{} has no draft to discard.",
                            a.name
                        )));
                    }
                    a.draft = None;
                    a.touched(by);
                    Ok(((), serde_json::json!({ "agency": id })))
                }
            }
        })
    }

    /// An agency in code back to the code's name: its published display name
    /// and any draft of one go.
    pub fn reset_name(&self, by: &str, id: &str) -> Change<()> {
        self.change(by, "agency name reset", |book| match kind_of(book, id)? {
            Kind::Code(code) => {
                if book.names.remove(id).is_none() {
                    return Err(Refusal::Conflict(format!("{code} already has the code's name.")));
                }
                Ok(((), serde_json::json!({ "agency": id, "name": code })))
            }
            Kind::Basic => Err(Refusal::Conflict(
                "Only an agency in code has a code name to reset to. Edit this one's name in its draft."
                    .into(),
            )),
        })
    }

    /// Where a basic agency's wordmark files are kept.
    pub fn logo_dir(&self, id: &str) -> PathBuf {
        self.dir.join("logos").join(id)
    }

    /// A kept wordmark's cleaned SVG text; None when it is missing.
    pub fn wordmark_svg(&self, id: &str, w: &Wordmark) -> Option<String> {
        if w.file.contains(['/', '\\']) || w.file.starts_with('.') {
            return None;
        }
        std::fs::read_to_string(self.logo_dir(id).join(&w.file)).ok()
    }
}

/// When the file was last written, and its length: a write by another server changes one of them.
type Stamp = (SystemTime, u64);

fn stamp_of(file: &Path) -> Option<Stamp> {
    std::fs::metadata(file)
        .ok()
        .and_then(|m| Some((m.modified().ok()?, m.len())))
}

fn read_book(dir: &Path) -> Result<(Book, Option<Stamp>), String> {
    let file = dir.join("people.json");
    let bytes = std::fs::read(&file).map_err(|e| format!("cannot read {}: {e}", file.display()))?;
    let book = serde_json::from_slice(&bytes)
        .map_err(|e| format!("cannot read {}: {e}", file.display()))?;
    Ok((book, stamp_of(&file)))
}

fn write_book(dir: &Path, book: &Book) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("people.json.{}.tmp", uuid::Uuid::new_v4().simple()));
    std::fs::write(&tmp, serde_json::to_vec_pretty(book)?)?;
    std::fs::rename(tmp, dir.join("people.json"))
}

fn append_change(dir: &Path, line: &serde_json::Value) {
    use std::io::Write as _;
    let r = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("changes.jsonl"))
        .and_then(|mut f| writeln!(f, "{line}"));
    if let Err(e) = r {
        tracing::error!(target: "napkin_web::people", error = %e, "the change log could not be written");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROSTER: &str = "# the studio\nengineer@napkin\tShrey\nann@napkin\tAnn Murphy\n\nmock@napkin\nnot a name\tX\nplu@pluto\tPluto Test\r\nengineer@napkin\tTwice\n";

    fn store() -> (tempfile::TempDir, People) {
        let dir = tempfile::tempdir().unwrap();
        let seed = dir.path().join("accounts.tsv");
        std::fs::write(&seed, ROSTER).unwrap();
        let p = People::open(dir.path().join("_people"), &seed).unwrap();
        (dir, p)
    }

    #[test]
    fn only_engineer_at_napkin_manages_people() {
        assert_eq!(PEOPLE_ADMINS, &["engineer@napkin"]);
        assert!(is_admin("engineer@napkin"));
        assert!(is_admin(" Engineer@Napkin "));
        for other in [
            "ann@napkin",
            "plu@pluto",
            "engineer@pluto",
            "shrey@napkin",
            "",
        ] {
            assert!(!is_admin(other), "{other}");
        }
    }

    #[test]
    fn the_seed_imports_every_roster_line_once_and_only_once() {
        let (dir, p) = store();
        let b = p.book();
        let ids: Vec<_> = b.people.iter().map(|x| x.id.as_str()).collect();
        assert_eq!(
            ids,
            ["engineer@napkin", "ann@napkin", "mock@napkin", "plu@pluto"]
        );
        assert_eq!(
            b.person("plu@pluto").unwrap().name.as_deref(),
            Some("Pluto Test")
        );
        assert_eq!(b.person("mock@napkin").unwrap().name, None);
        assert!(b.person("engineer@napkin").unwrap().admin);
        assert!(!b.person("ann@napkin").unwrap().admin);
        assert!(b
            .people
            .iter()
            .all(|x| x.added_by == "roster" && x.active()));
        // a second start does not seed again, even from a different file
        let seed = dir.path().join("accounts.tsv");
        std::fs::write(&seed, "someone@else\tNew\n").unwrap();
        let again = People::open(dir.path().join("_people"), &seed).unwrap();
        assert!(again.active("someone@else").is_none());
        assert!(again.active("ann@napkin").is_some());
        // a roster that names no one, or is missing, stops a first start
        let empty = dir.path().join("empty.tsv");
        std::fs::write(&empty, "# nobody\n").unwrap();
        assert!(People::open(dir.path().join("a"), &empty).is_err());
        assert!(People::open(dir.path().join("b"), &dir.path().join("missing.tsv")).is_err());
    }

    #[test]
    fn an_agency_is_recognised_by_id_name_or_alias_in_any_case() {
        let b = Book::default();
        for (t, want) in [
            ("napkin", "napkin"),
            ("Napkin", "napkin"),
            ("bg", "boysandgirls"),
            ("BG", "boysandgirls"),
            ("Boys+Girls", "boysandgirls"),
            ("b+g", "boysandgirls"),
            ("boysgirls", "boysandgirls"),
            ("Wieden+Kennedy", "wk"),
            ("Harbour & Co", "harbour"),
            ("droga5", "droga"),
            (" pluto ", "pluto"),
        ] {
            assert_eq!(b.recognise(t).as_deref(), Some(want), "{t}");
        }
        assert_eq!(b.recognise("Rothco"), None);
        assert_eq!(b.recognise(""), None);
    }

    #[test]
    fn add_rename_remove_and_bring_back() {
        let (dir, p) = store();
        let by = "engineer@napkin";
        let a = p
            .add(
                by,
                &NewPerson {
                    name: "Shaunagh Kelly".into(),
                    agency: "Napkin".into(),
                    username: None,
                },
            )
            .unwrap();
        assert_eq!(
            (a.id.as_str(), a.agency.as_str()),
            ("shaunagh@napkin", "napkin")
        );
        assert_eq!(a.added_by, by);
        assert!(p.active("shaunagh@napkin").is_some());
        // an alias makes the canonical id
        let b = p
            .add(
                by,
                &NewPerson {
                    name: "Jo Bloggs".into(),
                    agency: "bg".into(),
                    username: None,
                },
            )
            .unwrap();
        assert_eq!(b.id, "jo@boysandgirls");
        // a typed sign-in name wins, but must be at the agency
        let c = p
            .add(
                by,
                &NewPerson {
                    name: "Sai Eeshwar".into(),
                    agency: "napkin".into(),
                    username: Some("sai.e@napkin".into()),
                },
            )
            .unwrap();
        assert_eq!(c.id, "sai.e@napkin");
        assert!(matches!(
            p.add(
                by,
                &NewPerson {
                    name: "X".into(),
                    agency: "napkin".into(),
                    username: Some("x@pluto".into())
                }
            ),
            Err(Refusal::Bad(_))
        ));
        assert!(matches!(
            p.add(
                by,
                &NewPerson {
                    name: "Shaunagh".into(),
                    agency: "napkin".into(),
                    username: None
                }
            ),
            Err(Refusal::Conflict(_))
        ));
        assert!(matches!(
            p.add(
                by,
                &NewPerson {
                    name: "Aoife".into(),
                    agency: "Rothco".into(),
                    username: None
                }
            ),
            Err(Refusal::Bad(_))
        ));

        let r = p.rename(by, "shaunagh@napkin", "Shaunagh K").unwrap();
        assert_eq!(r.name.as_deref(), Some("Shaunagh K"));
        p.remove(by, "shaunagh@napkin").unwrap();
        assert!(p.active("shaunagh@napkin").is_none());
        assert!(p
            .book()
            .person("shaunagh@napkin")
            .unwrap()
            .removed_at
            .is_some());
        assert!(matches!(
            p.remove(by, "shaunagh@napkin"),
            Err(Refusal::NotFound(_))
        ));
        assert!(matches!(
            p.remove(by, "engineer@napkin"),
            Err(Refusal::Conflict(_))
        ));
        // added again, they are back
        p.add(
            by,
            &NewPerson {
                name: "Shaunagh Kelly".into(),
                agency: "napkin".into(),
                username: None,
            },
        )
        .unwrap();
        assert!(p.active("shaunagh@napkin").is_some());

        // every change is on the log, with who made it
        let log = std::fs::read_to_string(dir.path().join("_people/changes.jsonl")).unwrap();
        let whats: Vec<String> = log
            .lines()
            .map(|l| serde_json::from_str::<serde_json::Value>(l).unwrap())
            .map(|v| {
                format!(
                    "{} {}",
                    v["what"].as_str().unwrap(),
                    v["by"].as_str().unwrap()
                )
            })
            .collect();
        assert_eq!(whats[0], "seeded roster");
        assert!(whats[1..].iter().all(|w| w.ends_with(by)));
        assert_eq!(whats.len(), 1 + 3 + 1 + 1 + 1);
    }

    fn person(name: &str, agency: &str) -> NewPerson {
        NewPerson {
            name: name.into(),
            agency: agency.into(),
            username: None,
        }
    }

    fn rothco() -> NewAgency {
        NewAgency {
            name: "Rothco".into(),
            base: "#0f6b5c".into(),
            accent: "#9FE6D8".into(),
            aliases: vec!["Roth".into(), " roth ".into(), "".into()],
        }
    }

    #[test]
    fn a_new_agency_is_a_draft_until_published_then_recognised() {
        let (_dir, p) = store();
        let by = "engineer@napkin";
        let a = p.add_agency(by, &rothco()).unwrap();
        assert_eq!(
            (a.id.as_str(), a.base.as_str(), a.accent.as_str()),
            ("rothco", "#0F6B5C", "#9FE6D8")
        );
        assert_eq!(a.aliases, ["roth"]);
        assert!(!a.published);
        assert_eq!(a.rev, 1);
        assert_eq!(a.draft, Some(BasicDraft::default()));
        // unpublished: not offered for new people, and adding one says why
        let b = p.book();
        assert_eq!(b.recognise("rothco"), None);
        assert_eq!(b.claimed("ROTH", ""), Some("rothco".into()));
        match p.add(by, &person("Aoife Byrne", "Rothco")) {
            Err(Refusal::Conflict(m)) => assert!(m.contains("not published"), "{m}"),
            other => panic!("{other:?}"),
        }
        p.publish(by, "rothco", &Publish { rev: Some(1) }).unwrap();
        let b = p.book();
        let r = b.agency("rothco").unwrap();
        assert!(r.published && r.draft.is_none());
        assert_eq!(r.rev, 2);
        assert_eq!(r.published_by.as_deref(), Some(by));
        assert_eq!(b.recognise("ROTHCO").as_deref(), Some("rothco"));
        assert_eq!(b.recognise("roth").as_deref(), Some("rothco"));
        assert_eq!(
            p.add(by, &person("Aoife Byrne", "Rothco")).unwrap().id,
            "aoife@rothco"
        );
        // a name already taken, a bad colour, a name with no id in it
        for (req, conflict) in [
            (
                NewAgency {
                    name: "Boys+Girls".into(),
                    base: "#000000".into(),
                    accent: "#FFFFFF".into(),
                    ..Default::default()
                },
                true,
            ),
            (
                NewAgency {
                    name: "Rothco".into(),
                    base: "#000000".into(),
                    accent: "#FFFFFF".into(),
                    ..Default::default()
                },
                true,
            ),
            (
                NewAgency {
                    name: "Kin".into(),
                    base: "#000000".into(),
                    accent: "#FFFFFF".into(),
                    aliases: vec!["W+K".into()],
                },
                true,
            ),
            (
                NewAgency {
                    name: "Kin".into(),
                    base: "red".into(),
                    accent: "#FFFFFF".into(),
                    ..Default::default()
                },
                false,
            ),
            (
                NewAgency {
                    name: "!!".into(),
                    base: "#000000".into(),
                    accent: "#FFFFFF".into(),
                    ..Default::default()
                },
                false,
            ),
        ] {
            match p.add_agency(by, &req) {
                Err(Refusal::Conflict(_)) if conflict => {}
                Err(Refusal::Bad(_)) if !conflict => {}
                other => panic!("{}: {other:?}", req.name),
            }
        }
        assert_eq!(agency_slug("Boys+Girls"), "boysandgirls");
        assert_eq!(agency_slug("Harbour & Co"), "harbourandco");
        assert_eq!(first_name_user("  Aoife Byrne"), "aoife");
    }

    #[test]
    fn a_draft_is_sparse_and_tidies_itself_away() {
        let (_dir, p) = store();
        let by = "engineer@napkin";
        p.add_agency(by, &rothco()).unwrap();
        p.publish(by, "rothco", &Publish { rev: Some(1) }).unwrap();
        let edit = |rev, accent: &str| DraftEdit {
            accent: Some(accent.into()),
            rev: Some(rev),
            ..Default::default()
        };
        p.edit_draft(by, "rothco", &edit(2, "#ffffff")).unwrap();
        let r = p.book().agency("rothco").unwrap().clone();
        assert_eq!(
            r.draft,
            Some(BasicDraft {
                accent: Some("#FFFFFF".into()),
                ..Default::default()
            })
        );
        assert_eq!(r.accent, "#9FE6D8", "the published look is untouched");
        // stale rev
        assert!(matches!(
            p.edit_draft(by, "rothco", &edit(2, "#000000")),
            Err(Refusal::Conflict(_))
        ));
        // back to the published value: no draft left
        p.edit_draft(by, "rothco", &edit(3, "#9fe6d8")).unwrap();
        assert_eq!(p.book().agency("rothco").unwrap().draft, None);
        // a name another agency answers to, even one only drafted
        p.edit_draft(
            by,
            "pluto",
            &DraftEdit {
                name: Some("Plutonic".into()),
                rev: Some(0),
                ..Default::default()
            },
        )
        .unwrap();
        for taken in ["Plutonic", "Ogilvy", "b+g"] {
            assert!(
                matches!(
                    p.edit_draft(
                        by,
                        "rothco",
                        &DraftEdit {
                            name: Some(taken.into()),
                            rev: Some(4),
                            ..Default::default()
                        }
                    ),
                    Err(Refusal::Conflict(_))
                ),
                "{taken}"
            );
        }
        // an agency in code takes its name only
        assert!(matches!(
            p.edit_draft(
                by,
                "pluto",
                &DraftEdit {
                    base: Some("#000000".into()),
                    rev: Some(1),
                    ..Default::default()
                }
            ),
            Err(Refusal::Bad(_))
        ));
        assert!(matches!(
            p.set_wordmark(by, "pluto", "<svg/>"),
            Err(Refusal::Conflict(_))
        ));
        assert!(matches!(
            p.remove_wordmark(by, "pluto"),
            Err(Refusal::Conflict(_))
        ));
        // published name of a code agency is recognised; reset takes it away
        p.publish(by, "pluto", &Publish { rev: Some(1) }).unwrap();
        let b = p.book();
        assert_eq!(b.recognise("plutonic").as_deref(), Some("pluto"));
        assert_eq!(b.recognise("pluto").as_deref(), Some("pluto"));
        p.reset_name(by, "pluto").unwrap();
        assert!(p.book().names.is_empty());
        assert!(matches!(
            p.reset_name(by, "pluto"),
            Err(Refusal::Conflict(_))
        ));
        assert!(matches!(
            p.reset_name(by, "rothco"),
            Err(Refusal::Conflict(_))
        ));
        assert!(matches!(
            p.edit_draft(by, "nobody", &edit(0, "#000000")),
            Err(Refusal::NotFound(_))
        ));
    }

    #[test]
    fn an_agency_kept_before_drafts_reads_as_published() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("_people");
        std::fs::create_dir_all(&store).unwrap();
        std::fs::write(
            store.join("people.json"),
            r##"{"people":[{"id":"engineer@napkin","agency":"napkin","admin":true,"added_by":"roster","added_at":"2026-11-12T10:00:00Z"}],
                "agencies":[{"id":"rothco","name":"Rothco","base":"#0F6B5C","accent":"#9FE6D8","aliases":["roth"],"added_by":"engineer@napkin","added_at":"2026-11-12T10:00:00Z","later":"ignored"}]}"##,
        )
        .unwrap();
        let p = People::open(store, &dir.path().join("no-seed.tsv")).unwrap();
        let b = p.book();
        let r = b.agency("rothco").unwrap();
        assert!(r.published);
        assert_eq!(
            (r.draft.clone(), r.wordmark.clone(), r.rev),
            (None, None, 0)
        );
        assert!(b.names.is_empty());
        assert_eq!(b.recognise("roth").as_deref(), Some("rothco"));
        // and it can be drafted from rev 0
        p.edit_draft(
            "engineer@napkin",
            "rothco",
            &DraftEdit {
                name: Some("Rothco Dublin".into()),
                rev: Some(0),
                ..Default::default()
            },
        )
        .unwrap();
    }

    #[test]
    fn another_servers_write_is_seen_without_a_restart() {
        let (dir, p) = store();
        let seed = dir.path().join("accounts.tsv");
        let other = People::open(dir.path().join("_people"), &seed).unwrap();
        other
            .add(
                "engineer@napkin",
                &NewPerson {
                    name: "Ciara".into(),
                    agency: "napkin".into(),
                    username: None,
                },
            )
            .unwrap();
        // this server's cache catches up within RECHECK
        p.cache.lock().unwrap().checked = Instant::now() - RECHECK;
        // a write in the same second keeps the mtime on some filesystems; force a different stamp
        p.cache.lock().unwrap().stamp = None;
        assert!(p.active("ciara@napkin").is_some());
        // and so is another server's publish
        other.add_agency("engineer@napkin", &rothco()).unwrap();
        other
            .publish("engineer@napkin", "rothco", &Publish { rev: Some(1) })
            .unwrap();
        assert!(p.book().agency("rothco").is_none(), "not before RECHECK");
        p.cache.lock().unwrap().checked = Instant::now() - RECHECK;
        p.cache.lock().unwrap().stamp = None;
        assert!(p.book().agency("rothco").is_some_and(|a| a.published));
    }
}
