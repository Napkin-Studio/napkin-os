// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The search index: what the one bar finds (features/one-bar-search.clan).
//!
//! Like the job index it is **read-only and disposable**: [`SearchIndex::build`] makes it from the
//! documents and the job and client registries, nothing writes to it, and deleting it loses nothing
//! (the same documents give the same index; tested). No model, no network, no clock: it is pure, so it
//! builds for the browser too.
//!
//! An entry holds an **allow list** of facts and nothing else (`Entry` below): its kind, title, the
//! client's name, the job number, the tool's name, a date, the names of the people who wrote in it, and
//! an asset's file name and type. It never holds a document's words, a budget, an hour or anything from
//! a timesheet, because nothing here reads them: a document is read only for its manifest, the actors
//! of its chain and the name of the kind of vault a brain is. The words a person typed in a brief are
//! out of reach of this module by construction.
//!
//! Who may find an entry is not decided here. Each entry carries the route that opens it (`route`) and
//! its client; the web layer asks `roles::allowed` of that pair for every entry before ranking and
//! before counting. A person entry is made by the caller from the agency's directory
//! ([`person_entry`]), because this crate knows no directory.
//!
//! Change signal: a [`SearchCache`] keeps the last index and what it learned of each document, by the
//! document's stamp (`PartStore::stamp`), the same way the job index does (os-layer.md 13.3). An
//! unchanged tenant answers with no read and no hash; a changed one reads again only the documents
//! whose stamp moved.

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use clan_sdk::{ClanFile, ClientRef};
use serde::Serialize;
use unicode_normalization::UnicodeNormalization;

use crate::clients;
use crate::error::HostResult;
use crate::jobindex::{IndexCache, JobIndex};
use crate::store::{DocId, DocStore};

/// The kinds of result, in the order the bar lists them.
pub const KINDS: [&str; 8] = [
    "job", "brief", "script", "idea", "document", "asset", "client", "person",
];

/// The kind word a tool's documents are found by: `(app id, kind)`. One table; a tool that wants a
/// better word adds a line. A tool not listed is `document`, and is found by its name all the same.
pub const APP_KINDS: [(&str, &str); 3] = [
    ("ie.napkin.brief-maker", "brief"),
    ("ie.napkin.script-editor", "script"),
    ("ie.napkin.idea-room", "idea"),
];

/// The tool whose documents are a brain: a client's brain pages (planning, account service and the
/// Agency Brain) or the agency's own (the Agency Brain only), by the vault's kind.
pub const BRAIN_APP: &str = "ie.napkin.agency-brain";

/// Money documents: `(word an app id or a document type carries, the path segment of its route)`. The
/// route is what `roles.rs` puts in the Money group, so a role that cannot open money never finds one.
pub const MONEY: [(&str, &str); 4] = [
    ("scope", "scope"),
    ("estimate", "estimates"),
    ("invoice", "invoices"),
    ("change-order", "change-orders"),
];

/// The most a query keeps of what a person typed.
const MAX_QUERY: usize = 200;
const MAX_TERMS: usize = 8;

/// What the index knows of one thing. Every field is an allowed fact; see the module note.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Entry {
    /// One of [`KINDS`].
    pub kind: &'static str,
    /// A job's number, a document's path, an asset's `path#file name`, a client's id, a person's sign-in name.
    pub id: String,
    pub title: String,
    /// One line under the title: the tool, the client, the job.
    pub line: String,
    pub client_id: Option<String>,
    pub job: Option<String>,
    /// The API route that opens this (under `/api`, no tenant): what `roles::allowed` is asked of.
    pub route: String,
    /// What the shell does on Enter.
    pub open: Open,
    /// RFC 3339 or a date: what recency and a month are read from.
    pub updated: String,
    /// A job's owner (a sign-in name): how a person's card lists the jobs they own.
    pub owner: Option<String>,
    /// The words of the title, folded.
    pub title_tokens: Vec<String>,
    /// The words of the other listed facts, folded.
    pub fact_tokens: Vec<String>,
}

/// What opening a result does in the shell.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Open {
    /// `route` (a hash), `document` (a path to open) or `person` (a card).
    pub action: &'static str,
    pub target: String,
}

/// The index of one tenant.
#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub struct SearchIndex {
    pub entries: Vec<Entry>,
}

// ── words ────────────────────────────────────────────────────────────────────

/// Lower case, accents folded (`Séan` is `sean`), split on anything that is not a letter or digit.
pub fn words(s: &str) -> Vec<String> {
    let folded: String = s
        .nfd()
        .filter(|c| !('\u{300}'..='\u{36f}').contains(c))
        .flat_map(|c| c.to_lowercase())
        .collect();
    folded
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

const MONTHS: [&str; 12] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];

/// The month (1 to 12) of an RFC 3339 stamp or a `YYYY-MM-DD` date.
fn month_of(stamp: &str) -> Option<usize> {
    let m: usize = stamp.get(5..7)?.parse().ok()?;
    (1..=12).contains(&m).then_some(m)
}

fn date_words(stamp: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(m) = month_of(stamp) {
        out.push(MONTHS[m - 1].to_string());
    }
    if let Some(y) = stamp
        .get(0..4)
        .filter(|y| y.chars().all(|c| c.is_ascii_digit()))
    {
        out.push(y.to_string());
    }
    out
}

/// `J` and three to six digits, as the job registry has it.
fn is_job_number(w: &str) -> bool {
    let up = w.to_ascii_uppercase();
    up.len() >= 4
        && up.len() <= 7
        && up.starts_with('J')
        && up[1..].chars().all(|c| c.is_ascii_digit())
}

// ── the query ────────────────────────────────────────────────────────────────

/// One thing the person typed, by what it is read as.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Term {
    /// A job number, upper case: `J001`.
    Job(String),
    /// A month name or its usual short form, 1 to 12.
    Month(usize),
    /// A kind word, singular: `brief`, `person`.
    Kind(&'static str),
    /// Anything else, folded: a name, a title word, a file name.
    Word(String),
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Query {
    pub terms: Vec<Term>,
}

impl Query {
    pub fn is_empty(&self) -> bool {
        self.terms.is_empty()
    }
}

fn kind_word(w: &str) -> Option<&'static str> {
    Some(match w {
        "job" | "jobs" => "job",
        "brief" | "briefs" => "brief",
        "script" | "scripts" => "script",
        "idea" | "ideas" => "idea",
        "document" | "documents" | "doc" | "docs" => "document",
        "asset" | "assets" | "file" | "files" => "asset",
        "client" | "clients" => "client",
        "person" | "people" => "person",
        _ => return None,
    })
}

fn month_word(w: &str) -> Option<usize> {
    if let Some(i) = MONTHS.iter().position(|m| *m == w) {
        return Some(i + 1);
    }
    let short = [
        "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    ];
    if w == "sept" {
        return Some(9);
    }
    short.iter().position(|m| *m == w).map(|i| i + 1)
}

/// A small deterministic parser: job numbers, kinds, months and names. Hostile or empty input is an
/// empty query, never an error: only the first 200 characters and the first eight words are read.
pub fn parse(q: &str) -> Query {
    let q: String = q.chars().take(MAX_QUERY).collect();
    let terms = words(&q)
        .into_iter()
        .take(MAX_TERMS)
        .map(|w| {
            if is_job_number(&w) {
                Term::Job(w.to_ascii_uppercase())
            } else if let Some(k) = kind_word(&w) {
                Term::Kind(k)
            } else if let Some(m) = month_word(&w) {
                Term::Month(m)
            } else {
                Term::Word(w)
            }
        })
        .collect();
    Query { terms }
}

// ── ranking ──────────────────────────────────────────────────────────────────

fn token_score(tokens: &[String], w: &str, exact: u32, prefix: u32) -> u32 {
    // One letter or digit is matched whole: `a` of "Client A" must not find every word that starts with a.
    let whole = w.chars().count() < 2;
    tokens
        .iter()
        .map(|t| {
            if t == w {
                exact
            } else if !whole && t.starts_with(w) {
                prefix
            } else {
                0
            }
        })
        .max()
        .unwrap_or(0)
}

/// How well `entry` answers `term`; 0 is no answer.
fn score_term(entry: &Entry, term: &Term) -> u32 {
    let word = |w: &str| {
        token_score(&entry.title_tokens, w, 10, 6).max(token_score(&entry.fact_tokens, w, 4, 2))
    };
    match term {
        Term::Job(n) => {
            // A document filed under the job answers for its number; the job itself answers as its title does.
            let filed = entry.job.as_deref() == Some(n.as_str());
            let by_word = word(&n.to_ascii_lowercase());
            if filed {
                10.max(by_word)
            } else {
                by_word
            }
        }
        Term::Month(m) => {
            let on = month_of(&entry.updated) == Some(*m);
            let by_word = MONTHS
                .get(m - 1)
                .map_or(0, |name| token_score(&entry.title_tokens, name, 10, 0));
            if on {
                3.max(by_word)
            } else {
                by_word
            }
        }
        Term::Kind(k) => {
            // The kind a person names is the strongest word there is: "J001 brief" is the brief, before the job.
            if entry.kind == *k {
                14
            } else {
                word(k)
            }
        }
        Term::Word(w) => word(w),
    }
}

/// The score of `entry` for `query`: every term must answer, and the answers add up. `None` when one
/// does not. A job number typed alone puts that job first.
pub fn score(entry: &Entry, query: &Query) -> Option<u32> {
    if query.is_empty() {
        return None;
    }
    let mut total = 0;
    for t in &query.terms {
        let s = score_term(entry, t);
        if s == 0 {
            return None;
        }
        total += s;
    }
    // A job number on its own is the job: "J001" finds the job before the documents filed under it.
    if let [Term::Job(n)] = query.terms.as_slice() {
        if entry.kind == "job" && entry.id == *n {
            total += 30;
        }
    }
    Some(total)
}

/// What a search answers: the number of entries the person may open that match, and the best
/// `limit` of them, grouped by kind in the bar's order.
#[derive(Debug, PartialEq)]
pub struct Found<'a> {
    pub total: usize,
    pub groups: Vec<(&'static str, Vec<&'a Entry>)>,
}

/// Search `entries`. `allow` is asked of every entry **first**: an entry it refuses is not scored, not
/// ranked and not counted, so nothing about it (not even how many there are) reaches the person.
/// The groups come best first: the first item of the first group is the best answer.
pub fn search<'a>(
    entries: impl IntoIterator<Item = &'a Entry>,
    query: &Query,
    allow: impl Fn(&Entry) -> bool,
    limit: usize,
) -> Found<'a> {
    let mut hits: Vec<(u32, &Entry)> = entries
        .into_iter()
        .filter(|e| allow(e))
        .filter_map(|e| score(e, query).map(|s| (s, e)))
        .collect();
    let total = hits.len();
    // Best first; then the newest; then by kind and id so the answer is the same every time.
    hits.sort_by(|(sa, a), (sb, b)| {
        sb.cmp(sa)
            .then_with(|| b.updated.cmp(&a.updated))
            .then_with(|| rank(a.kind).cmp(&rank(b.kind)))
            .then_with(|| a.id.cmp(&b.id))
    });
    hits.truncate(limit);
    // Grouped by kind, the group holding the best answer first (so Enter opens the best answer), then in the
    // bar's own order of kinds; inside a group, best first.
    let mut groups: Vec<(&'static str, Vec<&Entry>)> = Vec::new();
    for (_, e) in &hits {
        match groups.iter_mut().find(|(k, _)| *k == e.kind) {
            Some((_, items)) => items.push(e),
            None => groups.push((e.kind, vec![e])),
        }
    }
    Found { total, groups }
}

fn rank(kind: &str) -> usize {
    KINDS.iter().position(|k| *k == kind).unwrap_or(KINDS.len())
}

// ── entries ──────────────────────────────────────────────────────────────────

fn tokens(parts: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in parts {
        for w in words(p) {
            if !out.contains(&w) {
                out.push(w);
            }
        }
    }
    out
}

/// The part of a sign-in name before the `@`: what is searched, never the whole name, so no agency
/// suffix (and nothing like an email) is kept in a word list.
fn local_of(username: &str) -> &str {
    username.split('@').next().unwrap_or(username)
}

/// A job, from the job index.
fn job_entry(j: &crate::jobindex::JobEntry) -> Entry {
    let title = if j.title.trim().is_empty() || j.title == j.number {
        j.number.clone()
    } else if j.title.starts_with(&j.number) {
        j.title.clone()
    } else {
        format!("{} {}", j.number, j.title)
    };
    Entry {
        kind: "job",
        id: j.number.clone(),
        line: format!("{} · {}", j.client.name, j.stage.label),
        client_id: Some(j.client.id.clone()),
        job: Some(j.number.clone()),
        route: format!("/jobs/{}", j.number),
        open: Open {
            action: "route",
            target: format!("#job-{}", j.number),
        },
        updated: j.opened_on.clone(),
        owner: Some(j.owner.clone()).filter(|o| !o.is_empty()),
        title_tokens: tokens(&[&title]),
        fact_tokens: tokens(&["job", &j.client.name, local_of(&j.owner)]),
        title,
    }
}

fn client_entry(c: &clients::ClientRecord) -> Entry {
    Entry {
        kind: "client",
        id: c.id.clone(),
        title: c.name.clone(),
        line: "Client".into(),
        client_id: Some(c.id.clone()),
        job: None,
        route: "/clients".into(),
        open: Open {
            action: "route",
            target: format!("#client-{}", c.id),
        },
        updated: c.created_at.clone(),
        owner: None,
        title_tokens: tokens(&[&c.name]),
        fact_tokens: tokens(&["client"]),
    }
}

/// A person, from the agency's directory: the name and the roles, `jobs` the numbers of the jobs they
/// own. Never an email, never a score. `role_line` is the roles in words.
pub fn person_entry(username: &str, name: &str, roles: &[String], role_line: &str) -> Entry {
    let mut facts: Vec<&str> = vec!["person", local_of(username)];
    facts.extend(roles.iter().map(String::as_str));
    facts.push(role_line);
    Entry {
        kind: "person",
        id: username.to_string(),
        title: name.to_string(),
        line: role_line.to_string(),
        client_id: None,
        job: None,
        route: "/agency/people".into(),
        open: Open {
            action: "person",
            target: username.to_string(),
        },
        updated: String::new(),
        owner: None,
        title_tokens: tokens(&[name]),
        fact_tokens: tokens(&facts),
    }
}

/// What the index learns of one document, apart from the registries: so it can be kept per stamp and
/// re-learned only when the document moves. The client's *name* is not kept (a rename shows at once).
#[derive(Clone, Debug, PartialEq)]
struct DocFacts {
    id: String,
    title: String,
    app_id: Option<String>,
    tool: Option<String>,
    document_type: Option<String>,
    client: Option<ClientRef>,
    job: Option<String>,
    updated: String,
    /// Sign-in names of the people who wrote in it.
    editors: Vec<String>,
    /// `(file name, content type)` of what sits in its assets folder.
    assets: Vec<(String, String)>,
    /// A brain only: the kind of vault, `client` or `agency`.
    vault: Option<String>,
}

const ASSET_DIR: &str = "human/assets/";

fn facts_of(store: &dyn DocStore, id: &DocId, bytes: Vec<u8>) -> Option<DocFacts> {
    let clan = ClanFile::from_bytes(bytes).ok()?;
    let m = clan.manifest();
    if m.document_type.as_deref() == Some("template") || crate::library::is_blank_in(store, &clan) {
        return None;
    }
    let mut editors: Vec<String> = crate::library::chain_of(&clan)
        .decisions
        .iter()
        .filter_map(|d| d.actor.as_deref()?.strip_prefix("human:").map(String::from))
        .collect();
    editors.sort();
    editors.dedup();
    // What sits in the assets folder, from the archive's own listing (no entry is opened). The type is the
    // manifest's when it registers the file, else the file name's extension.
    let assets = clan
        .entry_paths()
        .unwrap_or_default()
        .iter()
        .filter_map(|path| {
            let name = path.strip_prefix(ASSET_DIR)?;
            if name.is_empty() || name.contains('/') {
                return None;
            }
            let ty = m
                .files
                .iter()
                .find(|f| f.path == *path)
                .map(|f| f.content_type.clone())
                .unwrap_or_else(|| {
                    name.rsplit_once('.')
                        .map_or(String::new(), |(_, e)| e.to_ascii_lowercase())
                });
            Some((name.to_string(), ty))
        })
        .collect::<Vec<_>>();
    let app_id = m.app.as_ref().map(|a| a.app_id.clone());
    // The one fact a brain's route turns on. Nothing else of the data is read.
    let vault = (app_id.as_deref() == Some(BRAIN_APP))
        .then(|| {
            let data: serde_yaml::Value =
                serde_yaml::from_slice(&clan.read_entry("shared/data.yaml").ok()?).ok()?;
            data.get("vault")?.get("kind")?.as_str().map(str::to_string)
        })
        .flatten();
    Some(DocFacts {
        id: id.to_string(),
        title: m.title.clone(),
        tool: m.app.as_ref().map(|a| a.name.clone()),
        app_id,
        document_type: m.document_type.clone(),
        client: m.client.clone(),
        job: m.job.clone(),
        updated: m.updated_at.clone(),
        editors,
        assets,
        vault,
    })
}

/// The kind a tool's documents are found as.
fn kind_of(app_id: Option<&str>) -> &'static str {
    app_id
        .and_then(|a| APP_KINDS.iter().find(|(id, _)| *id == a))
        .map_or("document", |(_, k)| k)
}

/// Which money segment a document belongs to, by its app id (`ie.napkin.scope`, `ie.napkin.scope-…`)
/// or its document type.
fn money_of(f: &DocFacts) -> Option<&'static str> {
    MONEY.iter().find_map(|(word, seg)| {
        let by_app = f.app_id.as_deref().is_some_and(|a| {
            a.strip_prefix("ie.napkin.")
                .is_some_and(|rest| rest == *word || rest.starts_with(&format!("{word}-")))
        });
        let by_type = f.document_type.as_deref() == Some(*word);
        (by_app || by_type).then_some(*seg)
    })
}

/// The route that opens a document: the one `roles.rs` has a group for, so the permission check is
/// the one the route itself meets. A brain whose vault is not plainly a client's is read as the
/// agency's (the stricter group).
fn route_of(f: &DocFacts) -> String {
    if let Some(seg) = money_of(f) {
        return match &f.job {
            Some(job) => format!("/jobs/{job}/{seg}"),
            None => format!("/{seg}/{}", f.id),
        };
    }
    if f.app_id.as_deref() == Some(BRAIN_APP) {
        return if f.vault.as_deref() == Some("client") {
            format!("/client-brains/{}", f.id)
        } else {
            format!("/proprietary/{}", f.id)
        };
    }
    format!("/d/{}", f.id)
}

fn doc_entries(f: &DocFacts, names: &BTreeMap<String, String>) -> Vec<Entry> {
    let kind = kind_of(f.app_id.as_deref());
    let client_name = f
        .client
        .as_ref()
        .map(|c| names.get(&c.id).cloned().unwrap_or_else(|| c.name.clone()));
    let tool = f.tool.clone().unwrap_or_default();
    let route = route_of(f);
    let line = [
        Some(tool.as_str()).filter(|t| !t.is_empty()),
        client_name.as_deref(),
        f.job.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");
    let editors: Vec<&str> = f.editors.iter().map(|e| local_of(e)).collect();
    let open = Open {
        action: "document",
        target: f.id.clone(),
    };
    let client_id = f.client.as_ref().map(|c| c.id.clone());
    let dates = date_words(&f.updated).join(" ");
    let mut facts: Vec<&str> = vec![kind, &tool];
    if let Some(n) = &client_name {
        facts.push(n);
    }
    if let Some(j) = &f.job {
        facts.push(j);
    }
    facts.push(&dates);
    facts.extend(editors.iter().copied());
    let mut out = vec![Entry {
        kind,
        id: f.id.clone(),
        title: f.title.clone(),
        line,
        client_id: client_id.clone(),
        job: f.job.clone(),
        route: route.clone(),
        open: open.clone(),
        updated: f.updated.clone(),
        owner: None,
        title_tokens: tokens(&[&f.title]),
        fact_tokens: tokens(&facts),
    }];
    for (name, ty) in &f.assets {
        let mut afacts: Vec<&str> = vec!["asset", ty, &f.title];
        if let Some(n) = &client_name {
            afacts.push(n);
        }
        if let Some(j) = &f.job {
            afacts.push(j);
        }
        afacts.push(&dates);
        out.push(Entry {
            kind: "asset",
            id: format!("{}#{name}", f.id),
            title: name.clone(),
            line: format!("{ty} in {}", f.title),
            client_id: client_id.clone(),
            job: f.job.clone(),
            route: route.clone(),
            open: open.clone(),
            updated: f.updated.clone(),
            owner: None,
            title_tokens: tokens(&[name]),
            fact_tokens: tokens(&afacts),
        });
    }
    out
}

impl SearchIndex {
    /// Build the index from the documents and the registries, reading every document.
    pub fn build(store: &dyn DocStore, jobs: &JobIndex) -> HostResult<SearchIndex> {
        Self::build_from(store, jobs, |id| {
            store.read(id).ok().and_then(|b| facts_of(store, id, b))
        })
    }

    /// [`build`](Self::build), with each document's facts from `facts`: read afresh, or kept per
    /// stamp by [`SearchCache`]. The answer is the same either way.
    fn build_from(
        store: &dyn DocStore,
        jobs: &JobIndex,
        mut facts: impl FnMut(&DocId) -> Option<DocFacts>,
    ) -> HostResult<SearchIndex> {
        let records = clients::list(store, true)?;
        let names: BTreeMap<String, String> = records
            .iter()
            .map(|c| (c.id.clone(), c.name.clone()))
            .collect();
        let mut entries: Vec<Entry> = jobs.jobs.iter().map(job_entry).collect();
        entries.extend(
            records
                .iter()
                .filter(|c| !c.is_archived())
                .map(client_entry),
        );
        for id in store.documents() {
            if let Some(f) = facts(&id) {
                entries.extend(doc_entries(&f, &names));
            }
        }
        // The same documents give the same index, whatever order the store listed them in.
        entries.sort_by(|a, b| (rank(a.kind), &a.id).cmp(&(rank(b.kind), &b.id)));
        Ok(SearchIndex { entries })
    }
}

// ── the cache ────────────────────────────────────────────────────────────────

type Kept = HashMap<String, (String, Option<DocFacts>)>;

/// What an index was built from (each document's id and stamp) and the index.
type Built = (Vec<(String, String)>, Arc<SearchIndex>);

/// The last index and what it was built from. One beside each tenant's store (`Workspace.search`).
#[derive(Default)]
pub struct SearchCache {
    last: Mutex<Option<Built>>,
    /// What each document taught the index, by the stamp it was read at.
    facts: Mutex<Kept>,
    builds: AtomicUsize,
}

impl SearchCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// The current index: the last one when no document and neither registry has moved (a stat of
    /// each, no read and no hash), else a rebuild that reads again only the documents whose stamp
    /// moved. The job index is read through `jobs`, so a job's stage and client are never worked out
    /// twice. The first call after a start is one full build.
    pub fn get(
        &self,
        store: &dyn DocStore,
        jobs: &IndexCache,
        now: chrono::DateTime<chrono::Utc>,
    ) -> HostResult<Arc<SearchIndex>> {
        let stamps: HashMap<String, String> = store
            .documents()
            .into_iter()
            .filter_map(|id| {
                store
                    .stamp(&id)
                    .ok()
                    .map(|v| (id.to_string(), v.as_str().to_string()))
            })
            .collect();
        let mut stamp: Vec<(String, String)> =
            stamps.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        for reg in ["jobs-v1", "clients-v1"] {
            if let Ok(id) = store.home(reg) {
                if let Ok(v) = store.stamp(&id) {
                    stamp.push((reg.into(), v.as_str().to_string()));
                }
            }
        }
        stamp.sort();
        let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((s, index)) = last.as_ref() {
            if *s == stamp {
                return Ok(index.clone());
            }
        }
        // No entry says how late a job is, so the day does not change what is found; the job index
        // is read through its own cache, which reads again only what moved.
        let job_index = jobs.get(store, now)?;
        let mut kept = self.facts.lock().unwrap_or_else(|e| e.into_inner());
        kept.retain(|id, _| stamps.contains_key(id));
        let index = SearchIndex::build_from(store, &job_index, |id| {
            let key = id.to_string();
            let now_at = stamps.get(&key);
            if let Some((at, f)) = kept.get(&key) {
                if Some(at) == now_at {
                    return f.clone();
                }
            }
            let bytes = store.read(id).ok()?;
            let f = facts_of(store, id, bytes);
            if let Some(at) = now_at {
                kept.insert(key, (at.clone(), f.clone()));
            }
            f
        })?;
        let index = Arc::new(index);
        self.builds.fetch_add(1, Ordering::Relaxed);
        *last = Some((stamp, index.clone()));
        Ok(index)
    }

    /// Delete the index: the next [`get`](Self::get) rebuilds it from the documents, every one read again.
    pub fn delete(&self) {
        *self.last.lock().unwrap_or_else(|e| e.into_inner()) = None;
        self.facts.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }

    /// How many times it has been built.
    pub fn builds(&self) -> usize {
        self.builds.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(q: &str) -> Vec<Term> {
        parse(q).terms
    }

    #[test]
    fn the_parser_reads_job_numbers_kinds_months_and_names() {
        assert_eq!(t("J001"), [Term::Job("J001".into())]);
        assert_eq!(
            t("j001 brief"),
            [Term::Job("J001".into()), Term::Kind("brief")]
        );
        assert_eq!(
            t("J0012345"),
            [Term::Word("j0012345".into())],
            "too many digits is a word"
        );
        assert_eq!(
            t("J12"),
            [Term::Word("j12".into())],
            "too few digits is a word"
        );
        assert_eq!(t("briefs"), [Term::Kind("brief")]);
        assert_eq!(t("People"), [Term::Kind("person")]);
        assert_eq!(t("Ideas"), [Term::Kind("idea")]);
        assert_eq!(t("march"), [Term::Month(3)]);
        assert_eq!(t("Sept"), [Term::Month(9)]);
        assert_eq!(t("brief march"), [Term::Kind("brief"), Term::Month(3)]);
        assert_eq!(
            t("Client A radio"),
            [
                Term::Kind("client"),
                Term::Word("a".into()),
                Term::Word("radio".into())
            ]
        );
        assert_eq!(
            t("Séan Ó Brién"),
            [
                Term::Word("sean".into()),
                Term::Word("o".into()),
                Term::Word("brien".into())
            ],
            "accents are folded"
        );
        assert_eq!(
            t("mood-1.png"),
            [
                Term::Word("mood".into()),
                Term::Word("1".into()),
                Term::Word("png".into())
            ]
        );
    }

    #[test]
    fn empty_and_hostile_input_is_an_empty_or_bounded_query() {
        assert!(parse("").is_empty());
        assert!(parse("   \t\n").is_empty());
        assert!(parse("%%% ... ---").is_empty());
        assert!(parse("'; DROP TABLE x; --").terms.len() <= MAX_TERMS);
        assert_eq!(parse(&"a ".repeat(500)).terms.len(), MAX_TERMS.min(100));
        assert!(parse(&"x".repeat(100_000)).terms.len() <= 1);
        assert_eq!(parse("\u{0}\u{7}<img>").terms, [Term::Word("img".into())]);
        assert_eq!(
            score(&job("J001", "x"), &parse("")),
            None,
            "an empty query finds nothing"
        );
    }

    fn job(number: &str, title: &str) -> Entry {
        Entry {
            kind: "job",
            id: number.into(),
            title: format!("{number} {title}"),
            line: String::new(),
            client_id: Some("cli_aaaaaaaa".into()),
            job: Some(number.into()),
            route: format!("/jobs/{number}"),
            open: Open {
                action: "route",
                target: format!("#job-{number}"),
            },
            updated: "2026-03-10".into(),
            owner: None,
            title_tokens: tokens(&[number, title]),
            fact_tokens: tokens(&["job", "Client A"]),
        }
    }

    #[test]
    fn every_term_must_answer_and_a_prefix_answers_but_one_letter_is_whole() {
        let e = job("J001", "Autumn launch");
        assert!(score(&e, &parse("autu")).is_some());
        assert!(
            score(&e, &parse("autumn zzz")).is_none(),
            "all terms must answer"
        );
        assert!(score(&e, &parse("client a")).is_some());
        assert!(score(&e, &parse("client b")).is_none());
        assert!(
            score(&e, &parse("client l")).is_none(),
            "one letter is matched whole"
        );
        assert!(score(&e, &parse("march")).is_some(), "a month by the date");
        assert!(score(&e, &parse("april")).is_none());
    }

    #[test]
    fn the_job_is_first_for_its_own_number() {
        let j = job("J001", "Autumn launch");
        let mut doc = job("J001", "x");
        doc.kind = "brief";
        doc.id = "doc-1".into();
        doc.title = "J001 brief".into();
        doc.title_tokens = tokens(&["J001 brief"]);
        let q = parse("J001");
        assert!(score(&j, &q) > score(&doc, &q));
    }

    #[test]
    fn a_refused_entry_is_not_ranked_and_not_counted() {
        let a = job("J001", "Autumn launch");
        let b = job("J002", "Autumn sale");
        let all = [a.clone(), b.clone()];
        let q = parse("autumn");
        let seen = search(all.iter(), &q, |_| true, 10);
        assert_eq!(seen.total, 2);
        let seen = search(all.iter(), &q, |e| e.id != "J002", 10);
        assert_eq!(seen.total, 1, "the total never counts a hidden entry");
        assert_eq!(seen.groups.len(), 1);
        let limited = search(all.iter(), &q, |_| true, 1);
        assert_eq!((limited.total, limited.groups[0].1.len()), (2, 1));
    }
}
