//! Move a document to its installed app's newer schema when that is safe.
//!
//! A document carries its own copy of its app's output schema, and every write is checked
//! against that copy ([`clan_sdk::pack`]). An app that later widens its schema leaves the
//! documents made before on the old one for good: on 2026-11-25 a Territories document made
//! before its sources list went from 80 to 1000 refused every result the engine wrote, and sat
//! on "What arrived". Owner decision, the same day ("A is good"): when the installed app's
//! schema accepts everything the document's copy does ([`clan_sdk::schema_compat::Compat::Widens`]),
//! the host gives the document the newer schema before it writes, and records that in the
//! decision chain (what loosened, from which app version). A schema that would refuse anything
//! the copy accepts is left alone: moving it is a deliberate migration, and a write the old copy
//! refuses says the document is on an older contract.
//!
//! Only the installed app of the same app id and major version is consulted (the library view
//! [`crate::view::resolve`] already chose it); without one nothing changes.

use clan_sdk::pack::{AgentOutput, DecisionEntry, PackOptions};
use clan_sdk::schema_compat::{compare, Compat};
use clan_sdk::ClanFile;
use serde_json::Value;

use crate::ctx::Ctx;
use crate::document::Document;
use crate::error::HostResult;
use crate::event::HostEvent;

use super::Outcome;

const DEFAULT_SCHEMA: &str = "agent/output-schema.json";

/// What the installed app's schema means for this document's copy.
#[derive(Debug, Clone, PartialEq)]
pub enum SchemaUpgrade {
    /// No installed app to compare with, or the schemas validate the same documents.
    Current,
    /// The app's schema accepts everything the copy does, and more.
    Safe {
        schema: String,
        changes: Vec<String>,
        app_version: String,
    },
    /// The app's schema would refuse something the copy accepts: left alone.
    Breaking {
        reasons: Vec<String>,
        app_version: String,
    },
}

fn schema_path(clan: &ClanFile) -> String {
    clan.manifest()
        .app
        .as_ref()
        .and_then(|a| a.schema.clone())
        .unwrap_or_else(|| DEFAULT_SCHEMA.into())
}

fn schema_of(clan: &ClanFile) -> Option<(String, Value)> {
    let text = clan.read_entry_string(&schema_path(clan)).ok()?;
    let value = serde_json::from_str(&text).ok()?;
    Some((text, value))
}

/// Compare the document's schema copy with its installed app's.
pub fn plan(doc: &Document) -> SchemaUpgrade {
    let Some(view) = doc.library_view() else {
        return SchemaUpgrade::Current;
    };
    let template = view.template();
    let same_app = match (doc.app_id(), template.manifest().app.as_ref()) {
        (Some(d), Some(a)) => a.app_id == d,
        _ => false,
    };
    if !same_app {
        return SchemaUpgrade::Current;
    }
    let (Some((_, old)), Some((text, new))) = (schema_of(doc.clan()), schema_of(template)) else {
        return SchemaUpgrade::Current;
    };
    let app_version = view.version().to_string();
    match compare(&old, &new) {
        Compat::Same => SchemaUpgrade::Current,
        Compat::Widens(changes) => SchemaUpgrade::Safe {
            schema: text,
            changes,
            app_version,
        },
        Compat::Breaks(reasons) => SchemaUpgrade::Breaking {
            reasons,
            app_version,
        },
    }
}

/// The write that moves `doc` to the safe newer schema, or `None` when there is none to make.
/// Its decision says what loosened and from which app version, so the move is auditable.
pub fn apply(_ctx: &Ctx, doc: &Document) -> HostResult<Option<Outcome>> {
    let SchemaUpgrade::Safe {
        schema,
        changes,
        app_version,
    } = plan(doc)
    else {
        return Ok(None);
    };
    let clan = doc.clan();
    let structured = super::assemble::data_of(clan).unwrap_or(Value::Object(Default::default()));
    let rationale = format!(
        "The installed app (v{app_version}) widened its schema, and this document's copy was \
         moved to it: {}. The new schema accepts everything the old one did.",
        changes.join("; ")
    );
    let output = AgentOutput {
        mode: "data-update".to_string(),
        structured,
        design: None,
        human: None,
        decision: Some(DecisionEntry {
            agent_name: "host".into(),
            action: "schema upgraded".into(),
            rationale,
            pinned: false,
            fields_changed: Some(Vec::new()),
            typed: None,
        }),
    };
    let opts = PackOptions {
        delta: Some(format!("schema upgraded to app v{app_version}")),
        schema_override: Some(schema),
        ..Default::default()
    };
    let bytes = clan_sdk::pack::pack(clan, output, opts, None)?;
    let reply = serde_json::json!({
        "ok": true, "upgraded": true, "app_version": app_version, "changes": changes,
    });
    let change = doc
        .change(bytes)?
        .with_event(HostEvent::DataChanged(reply.clone()));
    Ok(Some(Outcome::changed(reply, change)))
}

/// What a refused write adds when the document's copy is older than its app's schema and the
/// difference is not a safe one: the reason the copy was not moved.
pub fn older_contract_note(doc: &Document) -> Option<String> {
    match plan(doc) {
        SchemaUpgrade::Breaking {
            reasons,
            app_version,
        } => Some(format!(
            "this document is on an older contract than its app (v{app_version}), and moving it \
             needs a migration: {}",
            reasons.join("; ")
        )),
        _ => None,
    }
}
