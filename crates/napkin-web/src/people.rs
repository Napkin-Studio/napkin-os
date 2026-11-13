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
//! <data>/_people/people.json     { people: [...], agencies: [...] }
//! <data>/_people/changes.jsonl   one line per change: when, who, what
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
//! Agencies here are the ones added from the page. The shell's registry
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgencyRec {
    pub id: String,
    pub name: String,
    pub base: String,
    pub accent: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added_at: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Book {
    #[serde(default)]
    pub people: Vec<PersonRec>,
    #[serde(default)]
    pub agencies: Vec<AgencyRec>,
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
    /// registry or of an added agency, any case. None when nothing matches.
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
        self.agencies
            .iter()
            .find(|a| {
                a.id == t
                    || a.name.to_lowercase() == t
                    || a.aliases.iter().any(|x| x.to_lowercase() == t)
            })
            .map(|a| a.id.clone())
    }

    pub fn person(&self, id: &str) -> Option<&PersonRec> {
        self.people.iter().find(|p| p.id == id)
    }

    /// Everyone seeded from a roster file's text (`user@agency<TAB>Name`, `#` comments; a roles column after the name is not stored here).
    pub fn seeded(roster: &str, at: &str) -> Self {
        let mut people: Vec<PersonRec> = Vec::new();
        for line in roster.lines() {
            let l = line.trim_end_matches('\r');
            if l.trim().is_empty() || l.trim_start().starts_with('#') {
                continue;
            }
            let mut cols = l.splitn(3, '\t');
            let user = cols.next().unwrap_or("");
            let name = cols.next().unwrap_or("");
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
            agencies: Vec::new(),
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

/// What adding an agency asks for.
#[derive(Debug, Default, Deserialize)]
pub struct NewAgency {
    /// The name as shown.
    pub name: String,
    /// The id people sign in under; made from the name when absent.
    #[serde(default)]
    pub id: Option<String>,
    pub base: String,
    pub accent: String,
    #[serde(default)]
    pub aliases: Vec<String>,
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
            let agency = book.recognise(&req.agency).ok_or_else(|| {
                Refusal::Bad(format!(
                    "No agency called {:?}. Add it as a new agency first.",
                    req.agency.trim()
                ))
            })?;
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

    /// Add an agency with its look.
    pub fn add_agency(&self, by: &str, req: &NewAgency) -> Change<AgencyRec> {
        let name = req.name.trim().to_string();
        if name.is_empty() {
            return bad("Give the agency's name as people should see it.");
        }
        let (Some(base), Some(accent)) = (hex_colour(&req.base), hex_colour(&req.accent)) else {
            return bad("The base and accent colours must be #rrggbb.");
        };
        let id = req
            .id
            .as_deref()
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| agency_slug(&name));
        if Account::parse_username(&format!("x@{id}")).map(|(_, a)| a) != Some(id.clone()) {
            return bad(format!(
                "{id:?} cannot be an agency id: letters, digits and hyphens only."
            ));
        }
        let aliases: Vec<String> = req
            .aliases
            .iter()
            .map(|a| a.trim().to_lowercase())
            .filter(|a| !a.is_empty())
            .collect();
        self.change(by, "agency added", |book| {
            for t in [id.as_str(), name.as_str()]
                .into_iter()
                .chain(aliases.iter().map(String::as_str))
            {
                if let Some(other) = book.recognise(t) {
                    return Err(Refusal::Conflict(format!(
                        "{t:?} is already the agency {other}."
                    )));
                }
            }
            let rec = AgencyRec {
                id: id.clone(),
                name: name.clone(),
                base: base.clone(),
                accent: accent.clone(),
                aliases: aliases.clone(),
                added_by: Some(by.to_string()),
                added_at: Some(now()),
            };
            book.agencies.push(rec.clone());
            Ok((
                rec,
                serde_json::json!({ "agency": id, "name": name, "base": base, "accent": accent }),
            ))
        })
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

    #[test]
    fn a_new_agency_has_its_look_and_is_recognised_after() {
        let (_dir, p) = store();
        let by = "engineer@napkin";
        let a = p
            .add_agency(
                by,
                &NewAgency {
                    name: "Rothco".into(),
                    base: "#0f6b5c".into(),
                    accent: "#9FE6D8".into(),
                    aliases: vec!["Roth".into()],
                    id: None,
                },
            )
            .unwrap();
        assert_eq!(
            (a.id.as_str(), a.base.as_str(), a.accent.as_str()),
            ("rothco", "#0F6B5C", "#9FE6D8")
        );
        let b = p.book();
        assert_eq!(b.recognise("ROTHCO").as_deref(), Some("rothco"));
        assert_eq!(b.recognise("roth").as_deref(), Some("rothco"));
        let person = p
            .add(
                by,
                &NewPerson {
                    name: "Aoife Byrne".into(),
                    agency: "Rothco".into(),
                    username: None,
                },
            )
            .unwrap();
        assert_eq!(person.id, "aoife@rothco");
        // a name already taken, a bad colour, a bad id
        assert!(matches!(
            p.add_agency(
                by,
                &NewAgency {
                    name: "Boys+Girls".into(),
                    base: "#000000".into(),
                    accent: "#FFFFFF".into(),
                    ..Default::default()
                }
            ),
            Err(Refusal::Conflict(_))
        ));
        assert!(matches!(
            p.add_agency(
                by,
                &NewAgency {
                    name: "Rothco".into(),
                    base: "#000000".into(),
                    accent: "#FFFFFF".into(),
                    ..Default::default()
                }
            ),
            Err(Refusal::Conflict(_))
        ));
        assert!(matches!(
            p.add_agency(
                by,
                &NewAgency {
                    name: "Kin".into(),
                    base: "red".into(),
                    accent: "#FFFFFF".into(),
                    ..Default::default()
                }
            ),
            Err(Refusal::Bad(_))
        ));
        assert!(matches!(
            p.add_agency(
                by,
                &NewAgency {
                    name: "Kin".into(),
                    id: Some("k/in".into()),
                    base: "#000000".into(),
                    accent: "#FFFFFF".into(),
                    ..Default::default()
                }
            ),
            Err(Refusal::Bad(_))
        ));
        assert_eq!(agency_slug("Boys+Girls"), "boysandgirls");
        assert_eq!(agency_slug("Harbour & Co"), "harbourandco");
        assert_eq!(first_name_user("  Aoife Byrne"), "aoife");
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
    }
}
