// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Harvest (Contract 6 §6): what a client-accepted document offers back to
//! the Brand Clan attached to it, and the one write that takes it.
//!
//! The offer is computed here, from the document and the kit as the store
//! holds it now, with no model: the document itself as an approved exemplar
//! (`work.<id>`), and each field the app declares in `app.attach.harvest`,
//! set against what the kit holds. A person ticks what to take. Nothing is
//! trusted from the request body but the ticks: the offer is computed again.
//!
//! The write goes to the **kit**, not to the approved document (which is
//! sealed): one validated patch carrying the items, the kit's next version and
//! a changelog line, recorded as one pinned `publish` decision by the person.

use clan_sdk::{ClanFile, Decision};
use serde_json::{json, Map, Value};

use crate::ctx::Ctx;
use crate::document::Document;
use crate::error::{HostError, HostResult};
use crate::library::{chain_of, find_source, kit_version, locked_error};
use crate::ops::client_review as cr;
use crate::ops::edit::PatchData;
use crate::store::{Change, DocStore};

const DATA: &str = "shared/data.yaml";

/// The newest document-level client answer, when it is one a harvest may
/// follow: `accepted` or `accepted_with_changes` (owner, 2026-10-19).
struct Review {
    decision: Decision,
    answer: String,
    version: String,
    accepted_at: String,
    /// Paths of parts the client asked to change or rejected, on this review.
    flagged_parts: Vec<String>,
}

fn review_of(clan: &ClanFile) -> HostResult<Review> {
    let chain = chain_of(clan);
    let doc_id = clan.document_id().to_string();
    let newest = chain
        .decisions
        .iter()
        .find(|d| {
            d.kind.as_deref() == Some(cr::KIND)
                && d.action == cr::CLIENT_ANSWER
                && cr::extra_str(d, "covers") == Some("document")
        })
        .ok_or_else(|| HostError::conflict("no client answer is recorded on this document"))?;
    let answer = cr::extra_str(newest, "answer")
        .unwrap_or_default()
        .to_string();
    if answer != "accepted" && answer != "accepted_with_changes" {
        return Err(HostError::conflict(format!(
            "the client's answer was {answer}; only an accepted document is offered to the Brand Clan"
        )));
    }
    let id = newest.id.clone().unwrap_or_default();
    let seen = cr::extra_json(newest, "seen");
    let version = seen
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let prefix = format!("{doc_id}#");
    let flagged_parts = chain
        .decisions
        .iter()
        .filter(|d| {
            d.action == cr::CLIENT_ANSWER_PART
                && cr::extra_str(d, "review") == Some(id.as_str())
                && cr::extra_str(d, "answer").is_some_and(|a| a != "accepted")
        })
        .filter_map(|d| d.targets.first())
        .map(|t| t.strip_prefix(&prefix).unwrap_or(t).to_string())
        .collect();
    Ok(Review {
        accepted_at: newest.timestamp.clone(),
        decision: newest.clone(),
        answer,
        version,
        flagged_parts,
    })
}

fn data_of(clan: &ClanFile) -> Value {
    clan.read_entry(DATA)
        .ok()
        .and_then(|b| serde_yaml::from_slice::<serde_yaml::Value>(&b).ok())
        .and_then(|y| serde_json::to_value(y).ok())
        .unwrap_or(Value::Null)
}

fn get<'a>(v: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.')
        .filter(|s| !s.is_empty())
        .try_fold(v, |cur, k| cur.get(k))
}

fn blank(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.trim().is_empty(),
        Some(Value::Array(a)) => a.is_empty(),
        Some(Value::Object(o)) => o.is_empty(),
        _ => false,
    }
}

/// `{a: {b: v}}` for `a.b`, to merge into a patch.
fn nest(path: &str, v: Value) -> Value {
    path.split('.').rev().fold(v, |acc, k| json!({ k: acc }))
}

fn merge(into: &mut Value, from: Value) {
    match (into, from) {
        (Value::Object(a), Value::Object(b)) => {
            for (k, v) in b {
                match a.get_mut(&k) {
                    Some(slot) => merge(slot, v),
                    None => {
                        a.insert(k, v);
                    }
                }
            }
        }
        (slot, v) => *slot = v,
    }
}

fn kind_of(app_id: &str) -> &'static str {
    if app_id.contains("brief") {
        "brief"
    } else if app_id.contains("research") {
        "research"
    } else if app_id.contains("production") || app_id.contains("film") {
        "ad"
    } else {
        "other"
    }
}

/// Everything one harvest knows: the sealed document's review, the kit, and
/// what is on offer.
struct Offer {
    brand: crate::document::Document,
    review: Review,
    work_id: String,
    work: Value,
    work_status: &'static str,
    fields: Vec<Field>,
    app_id: String,
}

struct Field {
    from: String,
    to: String,
    value: Value,
    kit_value: Value,
    status: &'static str,
    flagged: bool,
}

fn compute(
    store: &dyn DocStore,
    ctx: &Ctx,
    doc: &Document,
    app_id: Option<&str>,
) -> HostResult<Offer> {
    let clan = doc.clan();
    let m = clan.manifest();
    let spec = m
        .app
        .as_ref()
        .and_then(|a| a.attach.clone())
        .ok_or_else(|| HostError::new(422, "this document's app attaches nothing"))?;
    let record = m
        .attached()
        .iter()
        .find(|a| app_id.map_or(spec.accepts.contains(&a.app_id), |id| a.app_id == id))
        .cloned()
        .ok_or_else(|| HostError::conflict("no Brand Clan is attached to this document"))?;
    let review = review_of(clan)?;
    let brand = find_source(store, ctx, doc, &record.carried.document_id)?;
    let data = data_of(clan);
    let kit = data_of(brand.clan());

    let doc_id = clan.document_id().to_string();
    let work_id = format!(
        "work_{}",
        doc_id.replace('-', "").chars().take(8).collect::<String>()
    );
    let work = json!({
        "document_id": doc_id,
        "app_id": m.app.as_ref().map(|a| a.app_id.clone()).unwrap_or_default(),
        "title": m.title,
        "kind": kind_of(m.app.as_ref().map_or("", |a| a.app_id.as_str())),
        "version": review.version,
        "client_review": review.decision.id,
        "accepted_at": review.accepted_at,
        "assets": [],
    });
    let held = get(&kit, &format!("work.{work_id}"));
    let work_status = match held {
        None => "new",
        Some(h) if h.get("version") == work.get("version") => "same",
        Some(_) => "changed",
    };

    let mut fields = Vec::new();
    for rule in &spec.harvest {
        let Some(value) = get(&data, &rule.from).filter(|v| !blank(Some(v))).cloned() else {
            continue;
        };
        let kit_value = get(&kit, &rule.to).cloned().unwrap_or(Value::Null);
        let status = if blank(Some(&kit_value)) {
            "new"
        } else if kit_value == value {
            "same"
        } else {
            "changed"
        };
        let flagged = review.answer == "accepted_with_changes"
            && review
                .flagged_parts
                .iter()
                .any(|p| cr::inside(&rule.from, p));
        fields.push(Field {
            from: rule.from.clone(),
            to: rule.to.clone(),
            value,
            kit_value,
            status,
            flagged,
        });
    }
    Ok(Offer {
        brand,
        review,
        work_id,
        work,
        work_status,
        fields,
        app_id: record.app_id,
    })
}

/// `GET /harvest`: what this accepted document offers its Brand Clan. `409`
/// unless the newest client answer is `accepted` or `accepted_with_changes`
/// and a Brand Clan is attached.
pub fn offer(
    store: &dyn DocStore,
    ctx: &Ctx,
    doc: &Document,
    app_id: Option<&str>,
) -> HostResult<Value> {
    let o = compute(store, ctx, doc, app_id)?;
    let bm = o.brand.clan().manifest();
    Ok(json!({
        "ok": true,
        "brand": {
            "document_id": bm.document_id(), "title": bm.title,
            "app_id": o.app_id, "version": kit_version(o.brand.clan()),
            "path": o.brand.id().to_string(),
        },
        "review": {
            "decision": o.review.decision.id, "answer": o.review.answer,
            "accepted_at": o.review.accepted_at, "version": o.review.version,
        },
        "work": { "id": o.work_id, "status": o.work_status, "item": o.work,
                  "selected": o.work_status != "same" },
        "fields": o.fields.iter().map(|f| json!({
            "from": f.from, "to": f.to, "value": f.value, "kit_value": f.kit_value,
            "status": f.status, "flagged": f.flagged,
            "reason": f.flagged.then_some("the client asked for a change here"),
            "selected": f.status != "same" && !f.flagged,
        })).collect::<Vec<_>>(),
    }))
}

/// `POST /harvest/apply {work?: bool, fields?: [from...], summary?}`: take the
/// ticked items into the Brand Clan as one published version. Returns the
/// change to the kit and the reply; the caller applies it. Refused: for a
/// process (`403`), a locked kit (`409`), an item not on offer or already the
/// kit's (`400`), nothing ticked (`400`).
pub fn apply(
    store: &dyn DocStore,
    ctx: &Ctx,
    doc: &Document,
    body: &Value,
) -> HostResult<(Change, Value)> {
    if !ctx.actor.is_human() {
        return Err(HostError::new(
            403,
            format!(
                "only a person can add to a Brand Clan; {} is not one",
                ctx.actor
            ),
        ));
    }
    let o = compute(store, ctx, doc, body.get("app_id").and_then(Value::as_str))?;
    if let Some(e) = locked_error(o.brand.clan()) {
        return Err(e);
    }
    let take_work = body.get("work").and_then(Value::as_bool).unwrap_or(false);
    let ticked: Vec<String> = body
        .get("fields")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if !take_work && ticked.is_empty() {
        return Err(HostError::bad_request(
            "nothing is ticked to take into the Brand Clan",
        ));
    }
    if take_work && o.work_status == "same" {
        return Err(HostError::bad_request(
            "this document is already in the Brand Clan at this version",
        ));
    }
    let who = ctx.actor.to_string();
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let kit = data_of(o.brand.clan());
    let mut patch = Value::Object(Map::new());

    let mut taken = Vec::new();
    for from in &ticked {
        let f = o
            .fields
            .iter()
            .find(|f| &f.from == from)
            .ok_or_else(|| HostError::bad_request(format!("{from} is not on offer")))?;
        if f.status == "same" {
            return Err(HostError::bad_request(format!(
                "{from} already matches the Brand Clan"
            )));
        }
        merge(&mut patch, nest(&f.to, f.value.clone()));
        // A value taken from an approved document is a confirmed one: its
        // earlier span or pins no longer describe it.
        if let Some(env) = f.to.strip_suffix(".value") {
            let prior = get(&kit, &format!("{env}.origin")).and_then(Value::as_str);
            let mut e = json!({ "origin": "confirmed", "by": who });
            // Cleared only where the kit holds them: the merge would write a
            // null where there is nothing to remove.
            for stale in ["source", "fact_ids"] {
                if get(&kit, &format!("{env}.{stale}")).is_some() {
                    e[stale] = Value::Null;
                }
            }
            if let Some(p) = prior.filter(|p| matches!(*p, "extracted" | "proposed" | "stated")) {
                e["confirmed_from"] = json!(p);
            }
            merge(&mut patch, nest(env, e));
        }
        taken.push(f.from.clone());
    }
    if take_work {
        let mut item = o.work.clone();
        item["origin"] = json!("confirmed");
        item["by"] = json!(who);
        if let Some(s) = body
            .get("summary")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
        {
            item["summary"] = json!(s.trim());
        }
        merge(&mut patch, nest(&format!("work.{}", o.work_id), item));
    }

    let version = kit_version(o.brand.clan()).unwrap_or(0) + 1;
    let title = doc.clan().manifest().title.clone();
    let summary = format!(
        "{}{}{} from \"{title}\" (client {}).",
        if take_work {
            "the approved document"
        } else {
            ""
        },
        if take_work && !taken.is_empty() {
            " and "
        } else {
            ""
        },
        if taken.is_empty() {
            String::new()
        } else {
            format!("{} field(s)", taken.len())
        },
        o.review.answer.replace('_', " "),
    );
    merge(
        &mut patch,
        json!({ "kit": {
            "version": version,
            "published": { "by": who, "at": now },
            "changelog": { format!("v{version}"): {
                "version": version, "at": now, "by": who, "summary": summary,
            } },
        } }),
    );
    let action = format!("publish v{version}: took {summary}");
    let rationale = format!(
        "{who} took {summary} Approved document {}, client review {}.",
        doc.clan().document_id(),
        o.review.decision.id.clone().unwrap_or_default()
    );
    let input = PatchData::parse(
        &json!({ "agent": "human", "action": action, "rationale": rationale,
                 "pinned": true, "patch": patch })
        .to_string(),
    )?;
    let outcome = crate::ops::edit::patch_data(ctx, &o.brand, input)?;
    let change = outcome
        .changes
        .into_iter()
        .next()
        .ok_or_else(|| HostError::internal("harvest wrote no change"))?;
    let decision = change.decisions.first().and_then(|d| d.id.clone());
    let reply = json!({
        "ok": true, "published": version, "decision": decision,
        "brand": o.brand.clan().manifest().document_id(),
        "work": take_work.then_some(o.work_id), "fields": taken,
    });
    Ok((change, reply))
}
