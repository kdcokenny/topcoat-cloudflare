//! The upstream demo's six seeded drinks, bundled for zero-setup deployments.
//!
//! The native demo uses Toasty with in-memory SQLite. Keeping its read-only menu
//! in the Worker avoids a database binding; ordering still calls a real server
//! procedure. Replace `load_menu` with a binding-backed query for a dynamic menu.

use serde::Deserialize;
use topcoat::context::{Cx, memoize};

#[derive(Debug, Deserialize)]
pub struct Drink {
    pub slug: String,
    pub name: String,
    pub tasting_notes: String,
    /// The price in dollars, matching the upstream menu.
    pub price: f64,
    pub roast: Roast,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Roast {
    Light,
    Medium,
    Dark,
}

/// Parse the catalog once per request, shared by the page and its layout.
#[memoize(as_ref)]
fn load_menu(cx: &Cx) -> topcoat::Result<Vec<Drink>> {
    let _ = cx;
    Ok(serde_json::from_str(include_str!("menu.json"))?)
}

pub fn drinks(cx: &Cx) -> topcoat::Result<&[Drink]> {
    load_menu(cx)
        .map(Vec::as_slice)
        .map_err(|error| std::io::Error::other(error.to_string()).into())
}
