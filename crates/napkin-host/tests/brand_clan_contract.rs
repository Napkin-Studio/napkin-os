// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Brand Clan contract's machine-checkable half: the schema accepts the
//! published vectors and refuses what the contract says it must
//! (`docs/contracts/brand-clan.md` section 2).

use clan_sdk::AgentOutput;
use serde_json::{json, Value};
use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn schema() -> String {
    std::fs::read_to_string(root().join("app/templates/brand-clan/schema.json")).unwrap()
}

fn vector(name: &str) -> Value {
    let p = root().join("docs/contracts/examples/brand-clan").join(name);
    serde_json::from_str(&std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{p:?}: {e}")))
        .unwrap()
}

fn check(v: &Value) -> Result<(), String> {
    AgentOutput {
        mode: "data-update".into(),
        structured: v.clone(),
        design: None,
        human: None,
        decision: None,
    }
    .validate_schema(&schema())
    .map_err(|e| e.to_string())
}

#[test]
fn the_vectors_validate() {
    check(&vector("data.zero-v2.json")).unwrap();
    check(&vector("data.empty-v1.json")).unwrap();
    // A candidate is the bible without `kit`: with one it is a document.
    let mut cand = vector("candidate.zero-draft-v3.json");
    cand["kit"] = json!({"version": 3});
    check(&cand).unwrap();
}

#[test]
fn the_vector_changes_fit_their_own_shape() {
    // Every change in the vectors validates as a changelog entry's change.
    let mut doc = vector("data.empty-v1.json");
    let mut changes = vector("changes.zero-v2-to-draft-v3.json");
    changes.as_array_mut().unwrap().extend(
        vector("changes.proposal-original.json")
            .as_array()
            .unwrap()
            .clone(),
    );
    doc["kit"]["changelog"][0]["changes"] = changes;
    check(&doc).unwrap();
}

#[test]
fn the_schema_refuses_what_the_contract_forbids() {
    let ok = vector("data.zero-v2.json");
    let bad = |f: &dyn Fn(&mut Value)| {
        let mut v = ok.clone();
        f(&mut v);
        assert!(check(&v).is_err(), "should have been refused: {v}");
    };
    bad(&|v| v["kit"] = json!({})); // a version is required
    bad(&|v| v["kit"]["version"] = json!(0));
    bad(&|v| v["visual"]["colours"][0]["hex"] = json!("silver")); // a real hex
    bad(&|v| v["visual"]["colours"][0]["id"] = json!("Not An Id"));
    bad(&|v| v["visual"]["logos"][0]["asset"] = json!("../x.svg")); // an asset of this document
    bad(&|v| v["visual"]["logos"][0]["variant"] = json!("neon"));
    bad(&|v| v["voice"]["rules"][0]["kind"] = json!("maybe"));
    bad(&|v| v["invented"] = json!(1)); // no unknown section
    bad(&|v| {
        v.as_object_mut().unwrap().remove("name");
    });
}
