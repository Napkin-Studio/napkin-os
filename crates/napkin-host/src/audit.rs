// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The approvals the audit view lists (features/agency-setup.clan): read from the documents' own
//! decision chains each time, never copied, so the view cannot drift from the documents. The same walk
//! over every document that the job index makes. What no chain holds (an export, a sign-in, a link
//! issued) is the web service's own append-only file; permission changes are read from the agency
//! registry's chain (`agency::history`).
//!
//! Three things are approvals: a planner's signature (`sign`), a lock (`approve`), and a client's answer
//! to a document (`client_review`, `client_answer`). Nothing here reads timesheets, signals or corrections.

use clan_sdk::{ClanFile, DecisionChain};
use serde::Serialize;

use crate::error::HostResult;
use crate::ops::client_review;
use crate::store::DocStore;

/// One approval, as a chain records it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Approval {
    /// A sign-in name; the person who made or recorded the decision.
    pub who: String,
    /// `sign`, `lock` or `client`.
    pub action: String,
    /// A plain sentence: `Signed Brief for J001.`
    pub what: String,
    /// The document's id in the store.
    pub doc: String,
    pub title: String,
    /// The document version the decision was made on, as the decision carries it.
    pub version: Option<String>,
    pub at: String,
}

/// Every approval of every document, newest first. A document that cannot be read is skipped.
pub fn approvals(store: &dyn DocStore) -> HostResult<Vec<Approval>> {
    let mut out: Vec<Approval> = Vec::new();
    for id in store.documents() {
        let Ok(bytes) = store.read(&id) else { continue };
        let Ok(clan) = ClanFile::from_bytes(bytes) else {
            continue;
        };
        if !clan.has_entry("agent/decision-chain.yaml") {
            continue;
        }
        let Some(chain) = clan
            .read_entry("agent/decision-chain.yaml")
            .ok()
            .and_then(|b| DecisionChain::from_yaml(&b).ok())
        else {
            continue;
        };
        let title = clan.manifest().title.clone();
        for d in &chain.decisions {
            // A client's answer carries no version of its own: it is the version of the lock it cites.
            let cited = |d: &clan_sdk::Decision| {
                chain
                    .decisions
                    .iter()
                    .find(|x| {
                        x.id.as_ref().is_some_and(|i| d.cites.contains(i)) && x.version.is_some()
                    })
                    .and_then(|x| x.version.clone())
            };
            let action = match (d.kind.as_deref(), d.action.as_str()) {
                (Some(crate::ops::gate::SIGN), _) => "sign",
                (Some("approve"), _) => "lock",
                (Some(client_review::KIND), client_review::CLIENT_ANSWER) => "client",
                _ => continue,
            };
            let who = d
                .actor
                .as_deref()
                .unwrap_or(&d.agent)
                .strip_prefix("human:")
                .unwrap_or_else(|| d.actor.as_deref().unwrap_or(&d.agent))
                .to_string();
            let what = match action {
                "sign" => format!("Signed {title}."),
                "lock" => format!("Locked {title}."),
                _ => d.rationale.clone(),
            };
            out.push(Approval {
                who,
                action: action.into(),
                what,
                doc: id.to_string(),
                title: title.clone(),
                version: d.version.clone().or_else(|| cited(d)),
                at: d.timestamp.clone(),
            });
        }
    }
    out.sort_by(|a, b| b.at.cmp(&a.at));
    Ok(out)
}
