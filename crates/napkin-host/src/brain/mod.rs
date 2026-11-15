// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The Napkin Brain (features/napkin-brain.clan, approach A2): what an agency has decided, as pages of
//! cited lines in one brain document per client and one for the agency. Pure and wasm-clean.
//!
//! A derived line stores ids, a rule and typed slots, never words from a source; the sentence is made
//! when a page is read. This module holds the page format ([`page`]); the rules, the render and the
//! rest follow in their own records.

pub mod page;

pub use page::{
    line_id, open, Brain, Cite, Line, LineKind, LineState, Page, PageType, Slot, Source, Vault,
    VaultKind, BRAIN_APP,
};
