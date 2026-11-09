// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Moving a document onto the installed version of its app (OS-layer
//! contract §3 `app_update`, §7.1, §8 `POST /app/update`).
//!
//! Two ways in, one function underneath ([`clan_sdk::upgrade_app`]) and one
//! decision shape:
//!
//! - **On save** ([`catch_up`]): an unlocked document shown with the
//!   installed app's view carries that app from its next write on. The
//!   session applies it before the write; the decision is the host's
//!   (`agent: napkin-host`, the writer as actor, `trigger: save`).
//! - **Update** ([`update`]): a person presses Update on a locked document.
//!   The decision is theirs (`trigger: update`). The lock is not touched: the
//!   `approve` stays the newest unsuperseded one, so `lock_of` and the
//!   client's answers keep their meaning.
//!
//! Either way the decision is pinned (compression never drops it), names
//! the app it moved from and to, and says the content is unchanged.

use clan_sdk::decision::new_decision_id;
use clan_sdk::{ClanBuilder, ClanFile, Decision, DecisionChain, MANIFEST_PATH};

use super::edit::attributed;
use super::review::{now, person};
use super::Outcome;
use crate::ctx::Ctx;
use crate::document::{Change, Document};
use crate::error::{HostError, HostResult};
use crate::event::HostEvent;
use crate::log::log;
use crate::store::DocStore;
use crate::view::{self, AppRef, AppUpdate};

const CHAIN: &str = "agent/decision-chain.yaml";

/// The agent an unlocked document's catch-up is recorded under.
pub const HOST_AGENT: &str = "napkin-host";

/// What set the update off.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trigger {
    /// The document's next write, unlocked.
    Save,
    /// A person pressed Update.
    Update,
}

impl Trigger {
    fn as_str(self) -> &'static str {
        match self {
            Trigger::Save => "save",
            Trigger::Update => "update",
        }
    }
}

fn app_json(r: &AppRef) -> serde_yaml::Value {
    serde_yaml::to_value(serde_json::json!({
        "app_id": r.app_id,
        "version": r.version,
        "digest": r.digest,
        "name": r.name,
    }))
    .unwrap_or(serde_yaml::Value::Null)
}

/// The one `app_update` decision a move records.
fn decision(
    ctx: &Ctx,
    agent: &str,
    doc_id: &str,
    u: &AppUpdate,
    trigger: Trigger,
    locked: bool,
) -> Decision {
    let mut d = attributed(ctx, agent, "app_update");
    d.id = Some(new_decision_id());
    d.agent = agent.to_string();
    d.action = "update_app".into();
    d.targets = vec![doc_id.to_string()];
    d.pinned = true;
    d.timestamp = now();
    d.rationale = match (trigger, locked) {
        (Trigger::Update, true) => format!(
            "Brought the locked version up to {} {}; the content is unchanged.",
            u.to.name, u.to.version
        ),
        (Trigger::Update, false) => format!(
            "Brought this document up to {} {}; the content is unchanged.",
            u.to.name, u.to.version
        ),
        (Trigger::Save, _) => format!(
            "Caught up with {} {} on save; the content is unchanged.",
            u.to.name, u.to.version
        ),
    };
    d.extra.insert("from".into(), app_json(&u.from));
    d.extra.insert("to".into(), app_json(&u.to));
    d.extra.insert(
        "trigger".into(),
        serde_yaml::Value::String(trigger.as_str().into()),
    );
    d
}

/// `bytes` with `d` the newest decision in its chain.
fn with_decision(bytes: Vec<u8>, d: Decision) -> HostResult<Vec<u8>> {
    let clan = ClanFile::from_bytes(bytes)?;
    let mut chain = if clan.has_entry(CHAIN) {
        DecisionChain::from_yaml(&clan.read_entry(CHAIN)?)?
    } else {
        DecisionChain::default()
    };
    chain.prepend(d);
    let mut b = ClanBuilder::new(clan.manifest().clone());
    for (path, bytes) in clan.read_all_entries()? {
        if path != MANIFEST_PATH && path != CHAIN {
            b.add_entry(path, bytes);
        }
    }
    b.add_entry(CHAIN, chain.to_yaml()?);
    Ok(b.build()?)
}

/// The change that brings `doc` onto `template`'s app, with its decision.
fn moved(
    ctx: &Ctx,
    agent: &str,
    doc: &Document,
    template: &ClanFile,
    u: &AppUpdate,
    trigger: Trigger,
) -> HostResult<Change> {
    let bytes = clan_sdk::upgrade_app(doc.clan(), template)?;
    let locked = view::is_locked(doc.clan());
    let d = decision(ctx, agent, doc.clan().document_id(), u, trigger, locked);
    doc.change(with_decision(bytes, d)?)
}

/// The catch-up an unlocked document's next write carries, when it is due:
/// shown with a library view, that app differs from its own, and its data
/// fits. `None` otherwise — including when the upgrade fails, which is logged
/// and leaves the write to go ahead against the document's own app.
pub fn catch_up(ctx: &Ctx, doc: &Document) -> Option<Change> {
    let lv = doc.library_view()?;
    let u = doc.app_update()?;
    if u.blocked.is_some() || view::is_locked(doc.clan()) {
        return None;
    }
    match moved(ctx, HOST_AGENT, doc, lv.template(), u, Trigger::Save) {
        Ok(change) => {
            log(&format!(
                "app_update: {} caught up {} {} -> {} on save",
                doc.id(),
                u.to.app_id,
                u.from.version,
                u.to.version
            ));
            Some(change)
        }
        Err(e) => {
            log(&format!(
                "app_update: {} did not catch up on save: {e}",
                doc.id()
            ));
            None
        }
    }
}

/// `POST /app/update`: a person moves the document onto the installed
/// version of its app. Refused (403) for anyone but a person, 409 when
/// nothing newer is installed or the document already carries it, and 422
/// naming the fields when its data does not fit. A locked document keeps its
/// lock.
pub fn update(
    ctx: &Ctx,
    doc: &Document,
    store: &dyn DocStore,
    public_key: &str,
) -> HostResult<Outcome> {
    let who = person(ctx, "update the app a document runs")?;
    let lv = view::installed(store, doc, public_key)
        .map_err(|why| HostError::conflict(format!("no newer app to update to: {why}")))?;
    let template = lv.template();
    let Some(u) = view::app_update_of(doc.clan(), template) else {
        return Err(HostError::conflict(format!(
            "the document already runs the installed {} {}",
            lv.template()
                .manifest()
                .app
                .as_ref()
                .map(|a| a.name.as_str())
                .unwrap_or("app"),
            lv.version()
        )));
    };
    let change = moved(ctx, &who, doc, template, &u, Trigger::Update)?;
    let id = change
        .decisions
        .first()
        .and_then(|d| d.id.clone())
        .unwrap_or_default();
    let notice = serde_json::json!({
        "ok": true, "source": "app_update", "kind": "app_update", "decision": id,
    });
    Ok(Outcome::changed(
        serde_json::json!({
            "ok": true,
            "decision": id,
            "kind": "app_update",
            "from": u.from,
            "to": u.to,
        }),
        change.with_event(HostEvent::DataChanged(notice)),
    ))
}
