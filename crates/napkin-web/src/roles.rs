// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Roles, homes and the one permission check (features/roles-and-homes.clan).
//!
//! A person has one or more roles, kept in the People store (people.rs) and
//! read from it on every request by `crate::live::live_roles`, which puts them
//! on the request's account; the session cookie, a document's token and the
//! identity provider carry none (features/align-needs-lock-people.clan). Two
//! things read them and nothing else does:
//!
//! - [`Table::view`] turns the roles into what the desk shows: at most five
//!   page doors (the row under the greeting, the rest under More) and the tools
//!   the role is offered. The shell draws whatever it is sent.
//! - [`allowed`] is the permission check: `(roles, route, client)`, called by
//!   [`guard`] on every shell API request. Seeing is not permission (v2
//!   section 4): hiding a door in the browser is not enough, so a role that may
//!   not open a route gets 403 from here.
//!
//! The table is data. [`Table::default`] is the v2 section 4 table; an agency
//! may serve its own as `roles/<agency>.json` in the config directory.
//! A signed-in person with no roles holds no role: the routes open to everyone
//! signed in, no page door, no tool, no job rights (features/align-needs-lock-people.clan,
//! after its security review; until then no roles meant every door). Only an
//! anonymous visitor (a server with no accounts: demos and tests) is unrestricted,
//! and is named so by [`ANONYMOUS`], never by an empty list.

use std::path::Path;

use axum::extract::Request;
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use serde::{Deserialize, Serialize};

use crate::auth::Account;

/// No row of page doors has more than five.
pub const MAX_DOORS: usize = 5;

/// What a door opens. A door that opens a document of a client is a tool (landing/tools.ts has it); a door that
/// opens an agency-wide page is a page door. `Desk` is the desk itself: every person lands there, so it has no door.
/// The one place the rule is written: moving a door from one list to the other is a one-word change here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Tool(&'static str),
    Page,
    Desk,
}

/// Every tool the shell has, by its landing/tools.ts id: what a person with no role, an admin and a demo are offered.
pub const ALL_TOOLS: &[&str] = &[
    "brief",
    "research",
    "idea",
    "deck",
    "prod",
    "ads",
    "script",
    "visual",
    "territories",
];

/// The doors onto the Production Tool's screens (v2 section 4: stills, video and motion, formats and in situ):
/// a role whose home has one of them may open `/production` ([`Table::opens_production`]).
pub const PRODUCTION_DOORS: &[&str] = &["stills", "video-motion", "formats-in-situ"];

/// The kind of a door id.
pub fn kind_of(door: &str) -> Kind {
    match door {
        "brief" => Kind::Tool("brief"),
        "research" => Kind::Tool("research"),
        "territories" => Kind::Tool("territories"),
        "presentations" => Kind::Tool("deck"),
        "script-editor" => Kind::Tool("script"),
        "ideas" => Kind::Tool("idea"),
        "clients" => Kind::Desk,
        _ => Kind::Page,
    }
}

/// The role of an admin and of a demo account. Both open every route and see
/// every home through the role switcher; nobody else gets the switcher.
pub const ADMIN: &str = "admin";
pub const DEMO: &str = "demo";

/// The roles an anonymous visitor is checked with (a server with no accounts): unrestricted, as every visitor
/// there always was, but no role switcher. Not a role anyone holds: `parse_roles` and the People store drop
/// it, and no role table knows it.
pub const ANONYMOUS: &str = "(anonymous)";

/// The roles a request is checked with: the signed-in account's (the People store's), or [`ANONYMOUS`].
pub fn of(account: Option<&Account>) -> Vec<String> {
    match account {
        Some(a) => a.roles.clone(),
        None => vec![ANONYMOUS.to_string()],
    }
}

/// Whether `roles` open every route but the admin's own: an admin, a demo, or an anonymous visitor.
pub fn unrestricted(roles: &[String]) -> bool {
    is_switcher(roles) || roles.iter().any(|r| r == ANONYMOUS)
}

/// A door, or a line under More tools: its id (the shell keys the tool and its
/// Empty state on it) and the words on it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub name: String,
}

/// One role's home.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Home {
    pub role: String,
    /// What the home is called: `Planning`, `Creative director`.
    pub title: String,
    /// Whether the home is switched on. All nine of the default table are; nothing reads it yet,
    /// and it is kept as the place for an agency's own table to hide a home.
    pub live: bool,
    pub doors: Vec<Entry>,
    pub more: Vec<Entry>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Table {
    pub homes: Vec<Home>,
}

fn e(id: &str, name: &str) -> Entry {
    Entry {
        id: id.into(),
        name: name.into(),
    }
}

fn home(
    role: &str,
    title: &str,
    live: bool,
    doors: &[(&str, &str)],
    more: &[(&str, &str)],
) -> Home {
    Home {
        role: role.into(),
        title: title.into(),
        live,
        doors: doors.iter().map(|(i, n)| e(i, n)).collect(),
        more: more.iter().map(|(i, n)| e(i, n)).collect(),
    }
}

impl Default for Table {
    /// The doors table of v2 section 4.
    fn default() -> Self {
        let homes = vec![
            home(
                "planning",
                "Planning",
                true,
                &[
                    ("brief", "Brief"),
                    ("research", "Research"),
                    ("territories", "Territories"),
                    ("client-brains", "Client brains"),
                    ("presentations", "Presentations"),
                ],
                &[
                    ("ideas", "Ideas (read only)"),
                    ("case-study-builder", "Case study builder (read only)"),
                ],
            ),
            home(
                "creative-director",
                "Creative director",
                true,
                &[
                    ("ideas", "Ideas"),
                    ("ready-for-review", "Ready for review"),
                    ("judge-scores", "Judge scores"),
                    ("approved-work", "Approved work"),
                    ("direction-notes", "Direction notes"),
                ],
                &[
                    ("brief", "Brief (read and sign)"),
                    ("presentations", "Presentations"),
                    ("traffic-board", "Traffic board (read only)"),
                ],
            ),
            home(
                "account-service",
                "Account service",
                true,
                &[
                    ("clients", "Clients"),
                    ("live-jobs", "Live jobs"),
                    ("approvals", "Approvals"),
                    ("scope-estimates", "Scope and estimates"),
                    ("presentations", "Presentations"),
                ],
                &[
                    ("case-study-builder", "Case study builder"),
                    ("job-memory", "Job memory"),
                    ("compliance-watch", "Compliance night watch"),
                ],
            ),
            home(
                "management",
                "Management",
                true,
                &[
                    ("agency-dashboard", "Agency dashboard"),
                    ("live-jobs", "Live jobs"),
                    ("time-money", "Time and money"),
                    ("clients", "Clients"),
                    ("traffic-board", "Traffic board"),
                ],
                &[
                    ("presentations", "Presentations"),
                    ("agency-brain", "Agency Brain (read only)"),
                ],
            ),
            home(
                "art-director",
                "Art director",
                true,
                &[
                    ("ideas", "Ideas"),
                    ("stills", "Stills"),
                    ("video-motion", "Video and motion"),
                    ("formats-in-situ", "Formats and in situ"),
                    ("shopper-stands", "Shopper stands"),
                ],
                &[
                    ("experiential", "Experiential"),
                    ("presentations", "Presentations"),
                    ("craft-review", "Craft review"),
                ],
            ),
            home(
                "copywriter",
                "Copywriter",
                true,
                &[
                    ("ideas", "Ideas"),
                    ("script-editor", "Script editor"),
                    ("radio", "Radio"),
                    ("video-motion", "Video and motion"),
                    ("formats-in-situ", "Formats and in situ"),
                ],
                &[
                    ("shopper-stands", "Shopper stands"),
                    ("experiential", "Experiential"),
                    ("presentations", "Presentations"),
                    ("craft-review", "Craft review"),
                ],
            ),
            home(
                "producer",
                "Producer",
                true,
                &[
                    ("live-jobs", "Live jobs"),
                    ("video-motion", "Video and motion"),
                    ("radio", "Radio"),
                    ("scope-estimates", "Scope and estimates"),
                    ("timetables", "Timetables"),
                ],
                &[
                    ("formats-in-situ", "Formats and in situ"),
                    ("shopper-stands", "Shopper stands"),
                    ("traffic-board", "Traffic board"),
                ],
            ),
            home(
                "agency-brain",
                "Agency Brain",
                true,
                &[
                    ("client-brains", "Client brains"),
                    ("pitches", "Pitches"),
                    ("awards", "Awards"),
                    ("case-studies", "Case studies"),
                    ("proprietary-data", "Proprietary data"),
                ],
                &[
                    ("judge-scores", "Judge scores (read only)"),
                    ("job-memory", "Job memory"),
                ],
            ),
            home(
                "traffic",
                "Traffic",
                true,
                &[
                    ("traffic-board", "Traffic board"),
                    ("timesheets", "Timesheets"),
                    ("resources", "Resources"),
                    ("live-jobs", "Live jobs"),
                    ("timetables", "Timetables"),
                ],
                &[("scope-estimates", "Scope and estimates (read only)")],
            ),
        ];
        Table { homes }
    }
}

/// A person's roles, as the shell reads them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RoleInfo {
    pub id: String,
    pub title: String,
}

/// What `/api/t/{tenant}/doors` answers: what the desk shows for the roles in the session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HomeView {
    pub roles: Vec<String>,
    /// False for a person with no roles: no row is drawn and nothing is refused.
    pub restricted: bool,
    /// The role on screen: `Planning`, or `Planning and Creative director` for two roles.
    pub title: String,
    /// The role an admin is trying through the account menu's View as, when they are.
    pub view_as: Option<String>,
    /// The page doors, at most five, the person's own role first: the desk's "Your pages" row.
    pub pages: Vec<Entry>,
    /// The page doors that did not fit, as a text list.
    pub more: Vec<Entry>,
    /// The tools the role is offered (landing/tools.ts ids): in the Dial, on the client's page and in Continue in.
    pub tools: Vec<String>,
    /// Every role, for admins; none for anyone else.
    pub switcher: Option<Vec<RoleInfo>>,
    /// What this person may do with jobs; the shell draws a control only when it is true, and the
    /// server refuses the write in any case (features/job-page.clan).
    pub jobs: JobRights,
}

/// What a person may do with jobs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct JobRights {
    /// Open a job; change its title, owner and deadline.
    pub manage: bool,
    /// Set the budget in hours.
    pub budget: bool,
}

pub fn job_rights(roles: &[String]) -> JobRights {
    JobRights {
        manage: may_manage_jobs(roles),
        budget: may_set_budget(roles),
    }
}

pub fn is_switcher(roles: &[String]) -> bool {
    roles.iter().any(|r| r == ADMIN || r == DEMO)
}

/// The agency-wide pages an admin has besides the role's own: who signs in, and the audit view.
const ADMIN_PAGES: &[(&str, &str)] = &[("people", "People"), ("audit", "Audit")];

impl Table {
    fn home_of(&self, role: &str) -> Option<&Home> {
        self.homes.iter().find(|h| h.role == role)
    }

    /// Whether `role` is one this table (or the admin kinds) knows.
    pub fn knows(&self, role: &str) -> bool {
        role == ADMIN || role == DEMO || self.home_of(role).is_some()
    }

    /// The home a role lands on. An admin lands on Management's.
    fn landing_role<'a>(&self, role: &'a str) -> &'a str {
        if role == ADMIN || role == DEMO {
            "management"
        } else {
            role
        }
    }

    /// The page doors for `roles`: the first page door of each role in turn, so two roles share the five
    /// fairly; anything left, and each role's More lines that are pages, go to More without repeating a door.
    /// A door that opens a tool is not here (see [`Table::tools_for`]), nor is the desk.
    pub fn home_for(&self, roles: &[String]) -> (Vec<Entry>, Vec<Entry>) {
        let homes: Vec<&Home> = roles
            .iter()
            .filter_map(|r| self.home_of(self.landing_role(r)))
            .collect();
        let pages_of = |h: &Home| -> Vec<Entry> {
            h.doors
                .iter()
                .filter(|d| kind_of(&d.id) == Kind::Page)
                .cloned()
                .collect()
        };
        let own: Vec<Vec<Entry>> = homes.iter().map(|h| pages_of(h)).collect();
        let mut doors: Vec<Entry> = Vec::new();
        let mut spill: Vec<Entry> = Vec::new();
        let deepest = own.iter().map(Vec::len).max().unwrap_or(0);
        for i in 0..deepest {
            for list in &own {
                let Some(d) = list.get(i) else { continue };
                if doors.iter().any(|x| x.id == d.id) {
                    continue;
                }
                if doors.len() < MAX_DOORS {
                    doors.push(d.clone());
                } else if !spill.iter().any(|x| x.id == d.id) {
                    spill.push(d.clone());
                }
            }
        }
        let mut more = spill;
        for h in &homes {
            for m in h.more.iter().filter(|m| kind_of(&m.id) == Kind::Page) {
                let seen = |list: &[Entry]| list.iter().any(|x| x.id == m.id);
                if !seen(&doors) && !seen(&more) {
                    more.push(m.clone());
                }
            }
        }
        more.retain(|m| !doors.iter().any(|d| d.id == m.id));
        (doors, more)
    }

    /// The tools `roles` are offered, in the shell's order: the tool doors of their homes and the tool lines
    /// under More. An admin, a demo and an anonymous visitor are offered every tool; a person with no role none.
    pub fn tools_for(&self, roles: &[String]) -> Vec<String> {
        if unrestricted(roles) {
            return ALL_TOOLS.iter().map(|t| t.to_string()).collect();
        }
        let mut have: Vec<&str> = Vec::new();
        for r in roles {
            let Some(h) = self.home_of(r) else { continue };
            for d in h.doors.iter().chain(&h.more) {
                if let Kind::Tool(t) = kind_of(&d.id) {
                    if !have.contains(&t) {
                        have.push(t);
                    }
                }
            }
        }
        ALL_TOOLS
            .iter()
            .filter(|t| have.contains(t))
            .map(|t| t.to_string())
            .collect()
    }

    /// May `roles` open the Production Tool at `/production` (crate::production)? An admin, a demo and an
    /// anonymous visitor may; anyone else only when one of their homes, as this table writes it, has a door or a
    /// More line onto one of its screens ([`PRODUCTION_DOORS`]). A person with no role may not. An allow list read
    /// from the table, so an agency's own table decides it too.
    pub fn opens_production(&self, roles: &[String]) -> bool {
        if unrestricted(roles) {
            return true;
        }
        roles.iter().any(|r| {
            self.home_of(r).is_some_and(|h| {
                h.doors
                    .iter()
                    .chain(&h.more)
                    .any(|d| PRODUCTION_DOORS.contains(&d.id.as_str()))
            })
        })
    }

    /// What the desk shows for `roles`, or, for an admin or a demo, for the role `as_role` names. A role the
    /// person may not try is ignored.
    pub fn view(&self, roles: &[String], as_role: Option<&str>) -> HomeView {
        let switcher = is_switcher(roles).then(|| {
            self.homes
                .iter()
                .map(|h| RoleInfo {
                    id: h.role.clone(),
                    title: h.title.clone(),
                })
                .collect()
        });
        let view_as = as_role
            .filter(|r| is_switcher(roles) && self.home_of(r).is_some())
            .map(str::to_string);
        let shown: Vec<String> = match &view_as {
            Some(r) => vec![r.clone()],
            None => roles.to_vec(),
        };
        let (mut pages, mut more) = self.home_for(&shown);
        // an admin's own pages come after the role's, under the same five
        if view_as.is_none() && roles.iter().any(|r| r == ADMIN) {
            for (id, name) in ADMIN_PAGES {
                let e = e(id, name);
                if pages.len() < MAX_DOORS {
                    pages.push(e);
                } else {
                    more.push(e);
                }
            }
        }
        let tools = match &view_as {
            Some(r) => self.tools_for(&[r.clone()]),
            None => self.tools_for(roles),
        };
        let title = shown
            .iter()
            .filter_map(|r| self.home_of(self.landing_role(r)).map(|h| h.title.clone()))
            .fold(Vec::<String>::new(), |mut acc, t| {
                if !acc.contains(&t) {
                    acc.push(t);
                }
                acc
            })
            .join(" and ");
        HomeView {
            roles: roles.iter().filter(|r| *r != ANONYMOUS).cloned().collect(),
            restricted: !roles.iter().any(|r| r == ANONYMOUS),
            title,
            view_as,
            pages,
            more,
            tools,
            switcher,
            jobs: job_rights(roles),
        }
    }

    /// An agency's own table from `<dir>/roles/<agency>.json`, else the default.
    /// A file that does not parse, or that has a home with more than five
    /// doors, is ignored with a warning: a broken file must not lock people out.
    pub fn for_agency(dir: Option<&Path>, agency: Option<&str>) -> Table {
        let file = dir
            .zip(agency)
            .map(|(d, a)| d.join("roles").join(format!("{a}.json")));
        let Some(file) = file.filter(|f| f.is_file()) else {
            return Table::default();
        };
        let parsed = std::fs::read(&file)
            .map_err(|e| e.to_string())
            .and_then(|b| serde_json::from_slice::<Table>(&b).map_err(|e| e.to_string()))
            .and_then(
                |t| match t.homes.iter().find(|h| h.doors.len() > MAX_DOORS) {
                    Some(h) => Err(format!("{} has more than {MAX_DOORS} doors", h.role)),
                    None => Ok(t),
                },
            );
        match parsed {
            Ok(t) => t,
            Err(why) => {
                tracing::warn!(file = %file.display(), %why, "role table ignored");
                Table::default()
            }
        }
    }
}

// ── the permission check ─────────────────────────────────────────────────────

/// The routes a role may not open, in groups. A route no group names is open
/// to everyone signed in (the documents, the library, the clients).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Group {
    /// Scope, estimates, invoices and change orders: producers, account service, management.
    /// Traffic reads scope (its More tools line); no route writes it yet.
    Money,
    /// Client brains and pitches: planning, account service and the Agency Brain.
    Brains,
    /// Proprietary data: the Agency Brain only.
    Proprietary,
    /// Making and withdrawing the client's own link: account service sends it, the planner may
    /// (features/client-confirm-link.clan).
    ClientLink,
    /// The agency dashboard: management (an admin or a demo opens everything).
    Management,
    /// Naming who approves each stage of a job and by when (features/approval-route.clan):
    /// account service, and management.
    Approvals,
    /// An agency's setup, import and audit view (features/agency-setup.clan): its admin only. A
    /// person with no role is refused here, not let through.
    Admin,
    /// The control list of agencies: a napkin-admin of the home agency (checked where it is served).
    Control,
    Open,
}

impl Group {
    fn roles(self) -> &'static [&'static str] {
        match self {
            Group::Money => &["producer", "account-service", "management", "traffic"],
            Group::Brains => &["planning", "account-service", "agency-brain"],
            Group::Proprietary => &["agency-brain"],
            Group::ClientLink => &["account-service", "planning"],
            Group::Management => &["management"],
            Group::Approvals => &["account-service", "management"],
            Group::Admin => &[ADMIN],
            Group::Control => &["napkin-admin"],
            Group::Open => &[],
        }
    }
}

/// Which group a route belongs to. `route` is the path under `/api`, either
/// `/t/{tenant}/jobs/J001/scope` or the same without the tenant.
pub fn group_of(route: &str) -> Group {
    let mut parts = route.trim_matches('/').split('/').filter(|s| !s.is_empty());
    let mut first = parts.next();
    if first == Some("t") {
        parts.next(); // the tenant
        first = parts.next();
    }
    let rest: Vec<&str> = parts.collect();
    match first {
        Some("jobs") if rest.get(1).copied() == Some("route") => Group::Approvals,
        Some("jobs")
            if matches!(
                rest.get(1).copied(),
                Some("scope" | "estimates" | "invoices" | "change-orders")
            ) =>
        {
            Group::Money
        }
        Some("scope" | "estimates" | "invoices" | "change-orders" | "time-money") => Group::Money,
        Some("d")
            if matches!(
                rest.get(1).copied(),
                Some("client-link" | "client-links" | "client-review")
            ) =>
        {
            Group::ClientLink
        }
        Some("client-brains" | "pitches") => Group::Brains,
        Some("proprietary") => Group::Proprietary,
        Some("dashboard") => Group::Management,
        // what Judge's telemetry holds leaves the vault by this one export, for management and admin
        Some("judge") if rest.first().copied() == Some("telemetry") => Group::Management,
        Some("audit" | "setup") => Group::Admin,
        Some("agency") if rest.first().copied() == Some("accounts.tsv") => Group::Admin,
        Some("control") => Group::Control,
        _ => Group::Open,
    }
}

/// May a person with `roles` open `route`, for `client` (unused in Phase 1:
/// the signature is where per-client rules would go, so they do not need a new check)?
/// An admin, a demo or an anonymous visitor opens everything but the admin's own groups; a
/// person with no roles opens only the routes open to everyone signed in.
pub fn allowed(roles: &[String], route: &str, _client: Option<&str>) -> bool {
    let group = group_of(route);
    if matches!(group, Group::Admin | Group::Control) {
        return roles.iter().any(|r| group.roles().contains(&r.as_str()));
    }
    if unrestricted(roles) {
        return true;
    }
    group == Group::Open || roles.iter().any(|r| group.roles().contains(&r.as_str()))
}

/// Is a person with `roles` in `group`? Used to decide which fields of a job they are sent. An admin, a demo
/// and an anonymous visitor are in every group; a person with no roles in none.
pub fn in_group(roles: &[String], group: Group) -> bool {
    unrestricted(roles) || roles.iter().any(|r| group.roles().contains(&r.as_str()))
}

/// The roles that may open a job and change its title, owner and deadline (features/job-page.clan):
/// planning (the planner opens the job at step 1 of v2 section 3), account service, management and
/// producers. Creative roles, the Agency Brain and traffic may not. An allow list: a role added later is
/// left out until it is named here. A person with no role is unrestricted, as everywhere; an admin too.
pub const JOB_MANAGERS: &[&str] = &["planning", "account-service", "management", "producer"];

pub fn may_manage_jobs(roles: &[String]) -> bool {
    unrestricted(roles) || roles.iter().any(|r| JOB_MANAGERS.contains(&r.as_str()))
}

/// The budget in hours is money (the owner's answer is open; the design's default): only the Money roles
/// set it, and only those of them who manage jobs.
pub fn may_set_budget(roles: &[String]) -> bool {
    may_manage_jobs(roles) && in_group(roles, Group::Money)
}

/// The middleware: a signed-in person's roles (the People store's, put on the
/// account by `crate::live::live_roles` just before) against the route. 403
/// when the roles may not open it; everyone else passes through.
pub async fn guard(request: Request, next: Next) -> Response {
    let roles = of(request.extensions().get::<Account>());
    if !allowed(&roles, request.uri().path(), None) {
        let body = serde_json::json!({
            "ok": false,
            "error": "Your role cannot open this.",
        })
        .to_string();
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header(header::CONTENT_TYPE, "application/json")
            .body(body.into())
            .unwrap();
    }
    next.run(request).await
}

/// Roles as written on a roster line or in a Cognito attribute: separated by
/// commas, semicolons or spaces, lower case, each once.
pub fn parse_roles(raw: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in raw
        .split(|c: char| c == ',' || c == ';' || c.is_whitespace())
        .map(|r| r.trim().to_ascii_lowercase())
        .filter(|r| !r.is_empty() && r != ANONYMOUS)
    {
        if !out.contains(&r) {
            out.push(r);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(s: &[&str]) -> Vec<String> {
        s.iter().map(|x| x.to_string()).collect()
    }
    fn names(v: &[Entry]) -> Vec<&str> {
        v.iter().map(|e| e.name.as_str()).collect()
    }

    fn tools(v: &HomeView) -> Vec<&str> {
        v.tools.iter().map(String::as_str).collect()
    }

    #[test]
    fn each_live_role_gets_the_page_doors_of_the_v2_table_and_its_tools_apart() {
        let t = Table::default();
        let v = |role: &str| t.view(&r(&[role]), None);
        assert_eq!(names(&v("planning").pages), ["Client brains"]);
        assert_eq!(
            tools(&v("planning")),
            ["brief", "research", "idea", "deck", "territories"]
        );
        assert_eq!(
            names(&v("creative-director").pages),
            [
                "Ready for review",
                "Judge scores",
                "Approved work",
                "Direction notes"
            ]
        );
        assert_eq!(tools(&v("creative-director")), ["brief", "idea", "deck"]);
        assert_eq!(
            names(&v("account-service").pages),
            ["Live jobs", "Approvals", "Scope and estimates"]
        );
        assert_eq!(tools(&v("account-service")), ["deck"]);
        assert_eq!(
            names(&v("management").pages),
            [
                "Agency dashboard",
                "Live jobs",
                "Time and money",
                "Traffic board"
            ]
        );
        assert_eq!(
            names(&v("planning").more),
            ["Case study builder (read only)"]
        );
        // the desk is every person's landing, so no role has a Clients door
        for h in &t.homes {
            let seen = t.view(&r(&[&h.role]), None);
            assert!(
                !seen
                    .pages
                    .iter()
                    .chain(&seen.more)
                    .any(|e| e.id == "clients"),
                "{}",
                h.role
            );
        }
    }

    #[test]
    fn no_row_has_more_than_five_pages_even_merged_and_none_is_twice() {
        let t = Table::default();
        for h in &t.homes {
            assert!(h.doors.len() <= MAX_DOORS, "{}", h.role);
        }
        let ids: Vec<String> = t.homes.iter().map(|h| h.role.clone()).collect();
        for a in &ids {
            for b in &ids {
                let (doors, more) = t.home_for(&r(&[a, b]));
                assert!(doors.len() <= MAX_DOORS, "{a} + {b}");
                for d in &doors {
                    assert!(
                        !more.iter().any(|m| m.id == d.id),
                        "{} twice for {a} + {b}",
                        d.id
                    );
                }
                let seen: Vec<&str> = doors.iter().chain(&more).map(|e| e.id.as_str()).collect();
                let mut unique = seen.clone();
                unique.sort_unstable();
                unique.dedup();
                assert_eq!(seen.len(), unique.len(), "{a} + {b}: a page twice");
            }
        }
    }

    #[test]
    fn two_roles_share_one_row_the_first_role_first_and_what_did_not_fit_is_under_more() {
        let t = Table::default();
        let v = t.view(&r(&["planning", "creative-director"]), None);
        assert_eq!(
            names(&v.pages),
            [
                "Client brains",
                "Ready for review",
                "Judge scores",
                "Approved work",
                "Direction notes"
            ]
        );
        assert_eq!(v.title, "Planning and Creative director");
        // the tools of both roles are offered, once each
        assert_eq!(
            tools(&v),
            ["brief", "research", "idea", "deck", "territories"]
        );
        // a seven-page pair: five in the row, the rest in More and none lost
        let c = t.view(&r(&["copywriter", "traffic"]), None);
        assert_eq!(c.pages.len(), MAX_DOORS);
        assert_eq!(names(&c.pages)[..2], ["Radio", "Traffic board"]);
        for left in ["Resources", "Live jobs", "Timetables"] {
            assert!(names(&c.more).contains(&left), "{left} is in More");
        }
    }

    #[test]
    fn an_admin_has_people_and_audit_after_the_role_pages_under_the_same_five() {
        let t = Table::default();
        let admin = t.view(&r(&["admin"]), None);
        assert_eq!(
            names(&admin.pages),
            [
                "Agency dashboard",
                "Live jobs",
                "Time and money",
                "Traffic board",
                "People"
            ]
        );
        assert_eq!(names(&admin.more), ["Agency Brain (read only)", "Audit"]);
        assert_eq!(
            admin.tools.len(),
            ALL_TOOLS.len(),
            "an admin is offered every tool"
        );
        // trying a role leaves the admin's own pages out: the row is that role's
        let as_cd = t.view(&r(&["admin"]), Some("creative-director"));
        assert!(!as_cd.pages.iter().any(|e| e.id == "people"));
        assert_eq!(tools(&as_cd), ["brief", "idea", "deck"]);
        assert_eq!(as_cd.view_as.as_deref(), Some("creative-director"));
    }

    #[test]
    fn only_admins_and_demos_have_the_switcher_and_it_changes_the_row() {
        let t = Table::default();
        assert!(t.view(&r(&["planning"]), None).switcher.is_none());
        assert!(
            t.view(&r(&["planning"]), Some("management"))
                .view_as
                .is_none(),
            "a planner cannot switch"
        );
        let a = t.view(&r(&["admin"]), Some("copywriter"));
        assert!(a.switcher.is_some());
        assert_eq!(
            names(&a.pages),
            ["Radio", "Video and motion", "Formats and in situ"]
        );
        assert_eq!(tools(&a), ["idea", "deck", "script"]);
        assert!(t.view(&r(&["demo"]), None).switcher.is_some());
    }

    #[test]
    fn every_door_is_a_tool_or_a_page_or_the_desk_and_a_tool_has_no_page() {
        let t = Table::default();
        for h in &t.homes {
            for d in h.doors.iter().chain(&h.more) {
                match kind_of(&d.id) {
                    Kind::Tool(id) => {
                        assert!(ALL_TOOLS.contains(&id), "{} names no tool", d.id);
                        let v = t.view(&r(&[&h.role]), None);
                        assert!(
                            !v.pages.iter().chain(&v.more).any(|e| e.id == d.id),
                            "{} is a tool and a page for {}",
                            d.id,
                            h.role
                        );
                        assert!(
                            v.tools.iter().any(|x| x == id),
                            "{id} offered to {}",
                            h.role
                        );
                    }
                    Kind::Page | Kind::Desk => {}
                }
            }
        }
    }

    #[test]
    fn a_person_with_no_role_holds_no_role_and_only_an_anonymous_visitor_is_unrestricted() {
        let t = Table::default();
        // signed in with no role: the routes open to everyone signed in, no door, no tool, no job rights
        let v = t.view(&[], None);
        assert!(v.restricted);
        assert!(v.pages.is_empty() && v.tools.is_empty());
        assert_eq!(
            v.jobs,
            JobRights {
                manage: false,
                budget: false
            }
        );
        assert!(allowed(&[], "/t/x/jobs/J001", None));
        for route in [
            "/t/x/jobs/J001/scope",
            "/t/x/proprietary/data",
            "/t/x/dashboard",
            "/t/x/client-brains",
        ] {
            assert!(!allowed(&[], route, None), "{route}");
        }
        for g in [
            Group::Money,
            Group::Brains,
            Group::Approvals,
            Group::Management,
        ] {
            assert!(!in_group(&[], g), "{g:?}");
        }
        assert!(!may_manage_jobs(&[]) && !may_set_budget(&[]));
        // an anonymous visitor (no accounts on the server) is as every visitor was
        let anon = r(&[ANONYMOUS]);
        let v = t.view(&anon, None);
        assert!(!v.restricted);
        assert!(v.roles.is_empty() && v.switcher.is_none());
        assert_eq!(v.tools.len(), ALL_TOOLS.len());
        assert!(allowed(&anon, "/t/x/jobs/J001/scope", None));
        assert!(allowed(&anon, "/t/x/proprietary/data", None));
        assert!(!allowed(&anon, "/t/x/audit", None));
        assert!(may_set_budget(&anon));
        // nobody is given the marker: it is not a role a roster or the store keeps
        assert!(parse_roles("planning,(anonymous)")
            .iter()
            .all(|x| x != ANONYMOUS));
        assert!(!t.knows(ANONYMOUS));
        // a roles column with only a typo is a role nobody knows: no privilege, not every privilege
        assert!(!allowed(&r(&["plannign"]), "/t/x/jobs/J001/scope", None));
        assert!(!t.knows("plannign"));
    }

    #[test]
    fn each_role_against_each_route_group() {
        let routes = [
            ("/t/x/jobs/J001/scope", Group::Money),
            ("/t/x/jobs/J001/estimates", Group::Money),
            ("/t/x/jobs/J001/invoices", Group::Money),
            ("/t/x/client-brains/c1", Group::Brains),
            ("/t/x/pitches", Group::Brains),
            ("/t/x/proprietary/rates", Group::Proprietary),
            ("/t/x/clients", Group::Open),
            ("/t/x/d/doc_1/patch", Group::Open),
            ("/t/x/library", Group::Open),
            ("/session", Group::Open),
        ];
        for (route, group) in routes {
            assert_eq!(group_of(route), group, "{route}");
        }
        // role, then the groups it opens: money, brains, proprietary
        let table: [(&str, [bool; 3]); 9] = [
            ("planning", [false, true, false]),
            ("creative-director", [false, false, false]),
            ("account-service", [true, true, false]),
            ("management", [true, false, false]),
            ("art-director", [false, false, false]),
            ("copywriter", [false, false, false]),
            ("producer", [true, false, false]),
            ("agency-brain", [false, true, true]),
            ("traffic", [true, false, false]),
        ];
        for (role, [money, brains, prop]) in table {
            let roles = r(&[role]);
            assert_eq!(
                allowed(&roles, "/t/x/jobs/J001/scope", None),
                money,
                "{role} money"
            );
            assert_eq!(
                allowed(&roles, "/t/x/client-brains/c1", None),
                brains,
                "{role} brains"
            );
            assert_eq!(
                allowed(&roles, "/t/x/proprietary/rates", None),
                prop,
                "{role} proprietary"
            );
            assert!(allowed(&roles, "/t/x/clients", None), "{role} open routes");
        }
        for admin in ["admin", "demo"] {
            assert!(allowed(&r(&[admin]), "/t/x/proprietary/rates", None));
        }
        // two roles: either may open it
        assert!(allowed(
            &r(&["planning", "management"]),
            "/t/x/jobs/J001/scope",
            None
        ));
    }

    #[test]
    fn only_management_opens_the_dashboard_and_everyone_opens_their_own_needs() {
        assert_eq!(group_of("/t/x/dashboard"), Group::Management);
        assert_eq!(group_of("/dashboard"), Group::Management);
        for role in [
            "planning",
            "creative-director",
            "account-service",
            "producer",
            "traffic",
        ] {
            assert!(!allowed(&r(&[role]), "/t/x/dashboard", None), "{role}");
            assert!(allowed(&r(&[role]), "/t/x/needs", None), "{role} needs");
            assert!(allowed(&r(&[role]), "/t/x/jobs", None), "{role} jobs");
        }
        assert!(allowed(&r(&["management"]), "/t/x/dashboard", None));
        assert!(allowed(&r(&["admin"]), "/t/x/dashboard", None));
        assert!(allowed(&r(&["demo"]), "/t/x/dashboard", None));
        assert!(!allowed(&[], "/t/x/dashboard", None));
        assert!(allowed(&r(&[ANONYMOUS]), "/t/x/dashboard", None));
    }

    #[test]
    fn only_account_service_and_management_name_a_route() {
        assert_eq!(group_of("/t/x/jobs/J001/route"), Group::Approvals);
        assert_eq!(group_of("/jobs/J001/route"), Group::Approvals);
        // reading a job, its stage and the list stays open to everyone signed in
        assert_eq!(group_of("/t/x/jobs/J001"), Group::Open);
        assert_eq!(group_of("/t/x/jobs/J001/stage"), Group::Open);
        for role in [
            "planning",
            "creative-director",
            "producer",
            "traffic",
            "copywriter",
        ] {
            assert!(
                !allowed(&r(&[role]), "/t/x/jobs/J001/route", None),
                "{role}"
            );
        }
        for role in ["account-service", "management", "admin", "demo"] {
            assert!(allowed(&r(&[role]), "/t/x/jobs/J001/route", None), "{role}");
        }
    }

    #[test]
    fn roles_are_read_from_a_line_whatever_the_separator() {
        assert_eq!(
            parse_roles("Planning, creative-director;planning"),
            ["planning", "creative-director"]
        );
        assert!(parse_roles("  ").is_empty());
    }

    #[test]
    fn an_agency_table_overrides_the_default_and_a_broken_one_does_not() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("roles")).unwrap();
        let mut t = Table::default();
        t.homes[0].doors.truncate(2);
        std::fs::write(
            dir.path().join("roles/wk.json"),
            serde_json::to_vec(&t).unwrap(),
        )
        .unwrap();
        std::fs::write(dir.path().join("roles/bad.json"), b"{ not json").unwrap();
        assert_eq!(
            Table::for_agency(Some(dir.path()), Some("wk")).homes[0]
                .doors
                .len(),
            2
        );
        assert_eq!(
            Table::for_agency(Some(dir.path()), Some("bad")),
            Table::default()
        );
        assert_eq!(
            Table::for_agency(Some(dir.path()), Some("none")),
            Table::default()
        );
        assert_eq!(Table::for_agency(None, None), Table::default());
    }

    #[test]
    fn all_nine_homes_are_live_with_the_page_doors_of_the_v2_table() {
        let t = Table::default();
        assert_eq!(t.homes.len(), 9);
        assert!(t.homes.iter().all(|h| h.live), "no home is marked not live");
        let v = |role: &str| t.view(&r(&[role]), None);
        let check = |role: &str, doors: &[&str], more: &[&str], tools_of: &[&str]| {
            assert_eq!(names(&v(role).pages), doors, "{role} pages");
            assert_eq!(names(&v(role).more), more, "{role} more");
            assert_eq!(tools(&v(role)), tools_of, "{role} tools");
        };
        check(
            "art-director",
            &[
                "Stills",
                "Video and motion",
                "Formats and in situ",
                "Shopper stands",
            ],
            &["Experiential", "Craft review"],
            &["idea", "deck"],
        );
        check(
            "copywriter",
            &["Radio", "Video and motion", "Formats and in situ"],
            &["Shopper stands", "Experiential", "Craft review"],
            &["idea", "deck", "script"],
        );
        check(
            "producer",
            &[
                "Live jobs",
                "Video and motion",
                "Radio",
                "Scope and estimates",
                "Timetables",
            ],
            &["Formats and in situ", "Shopper stands", "Traffic board"],
            &[],
        );
        check(
            "agency-brain",
            &[
                "Client brains",
                "Pitches",
                "Awards",
                "Case studies",
                "Proprietary data",
            ],
            &["Judge scores (read only)", "Job memory"],
            &[],
        );
        check(
            "traffic",
            &[
                "Traffic board",
                "Timesheets",
                "Resources",
                "Live jobs",
                "Timetables",
            ],
            &["Scope and estimates (read only)"],
            &[],
        );
    }

    #[test]
    fn the_permission_groups_hold_for_the_five_new_roles() {
        let scope = "/t/x/jobs/J001/scope";
        let prop = "/t/x/proprietary/rates";
        let brains = "/t/x/client-brains/c1";
        assert!(!allowed(&r(&["copywriter"]), scope, None));
        assert!(allowed(&r(&["producer"]), scope, None));
        assert!(allowed(&r(&["traffic"]), scope, None));
        assert!(allowed(&r(&["agency-brain"]), brains, None));
        assert!(allowed(&r(&["agency-brain"]), prop, None));
        assert!(!allowed(&r(&["art-director"]), brains, None));
        assert!(!allowed(&r(&["art-director"]), prop, None));
        assert!(!allowed(&r(&["copywriter"]), prop, None));
        // a Phase 1 role with a Phase 2 role: either may open it
        assert!(allowed(&r(&["copywriter", "agency-brain"]), prop, None));
    }

    /// The server's table and the shell's door content must not drift: every id a home lists
    /// (door or More tools) has its own Empty content in doors.ts, and doors.ts names no other id.
    #[test]
    fn every_door_has_its_content_in_the_shell() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../app/src/components/states/doors.ts"
        );
        let text = std::fs::read_to_string(path).expect("doors.ts");
        let in_shell: Vec<&str> = text
            .lines()
            .filter_map(|l| l.trim_start().strip_prefix("{ id: '"))
            .filter_map(|l| l.split('\'').next())
            .collect();
        let t = Table::default();
        let mut wanted: Vec<&str> = Vec::new();
        for h in &t.homes {
            for e in h.doors.iter().chain(&h.more) {
                if !wanted.contains(&e.id.as_str()) {
                    wanted.push(&e.id);
                }
            }
        }
        for id in &wanted {
            assert!(in_shell.contains(id), "doors.ts has no entry for {id}");
        }
        for id in &in_shell {
            assert!(
                wanted.contains(id),
                "doors.ts names {id}, which no home lists"
            );
        }
        // the admin's own pages (People, Audit) are real pages of the shell: they have no Empty content
        for (id, _) in ADMIN_PAGES {
            assert!(!in_shell.contains(id), "{id} is a page, not an Empty state");
        }
    }

    #[test]
    fn the_admin_routes_are_for_an_admin_only_and_never_for_no_role_or_a_demo() {
        let admin = r(&["admin"]);
        for route in [
            "/t/x/audit",
            "/t/x/setup/import/people",
            "/t/x/audit/verify",
        ] {
            assert!(allowed(&admin, route, None), "{route}");
            for who in [
                r(&[]),
                r(&["management"]),
                r(&["demo"]),
                r(&["planning", "traffic"]),
            ] {
                assert!(!allowed(&who, route, None), "{who:?} {route}");
            }
        }
        // the control list needs napkin-admin; an agency admin is not one
        assert!(!allowed(&admin, "/control/agencies", None));
        assert!(allowed(&r(&["napkin-admin"]), "/control/agencies", None));
        // the people list is open to everyone signed in (emails are cut in the handler)
        assert!(allowed(&r(&["traffic"]), "/t/x/agency/people", None));
    }

    #[test]
    fn production_opens_for_the_roles_whose_homes_have_one_of_its_doors() {
        let t = Table::default();
        for yes in [
            "producer",
            "art-director",
            "copywriter",
            ADMIN,
            DEMO,
            ANONYMOUS,
        ] {
            assert!(t.opens_production(&r(&[yes])), "{yes}");
        }
        for no in [
            "planning",
            "creative-director",
            "account-service",
            "management",
            "agency-brain",
            "traffic",
            "napkin-admin",
            "someone-new",
        ] {
            assert!(!t.opens_production(&r(&[no])), "{no}");
        }
        // no role means no role
        assert!(!t.opens_production(&[]));
        // one role that opens it is enough
        assert!(t.opens_production(&r(&["planning", "producer"])));
    }
}
