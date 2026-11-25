//! Native Run and MetaSave transaction transport; Python owns durable writes.
pub(crate) mod meta;
pub(crate) mod recovery;

#[path = "../synthetic/meta_anchor.rs"]
mod meta_anchor;
