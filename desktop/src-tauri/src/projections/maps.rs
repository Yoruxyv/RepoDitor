//! Validate installed-map display data; Python owns discovery and artwork stays opaque.
use super::saves;
use crate::error::{json, BackendError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledMaps {
    available: bool,
    catalog_path: Option<String>,
    maps: Vec<InstalledMap>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledMap {
    internal_name: String,
    display_name: String,
    known_label: bool,
    #[serde(default, skip_serializing)]
    artwork_revision: Value,
    #[serde(skip_deserializing)]
    icon_token: Option<String>,
}

impl InstalledMaps {
    pub fn artwork_rows(&mut self) -> impl Iterator<Item = (&str, &str, &mut Option<String>)> {
        self.maps.iter_mut().filter_map(|map| {
            Some((
                map.internal_name.as_str(),
                map.artwork_revision.as_str()?,
                &mut map.icon_token,
            ))
        })
    }
}

fn nonblank(value: &str) -> bool {
    // Match Electron's ECMAScript trim, including BOM but excluding NEXT LINE.
    !value
        .trim_matches(|c: char| (c.is_whitespace() && c != '\u{0085}') || c == '\u{feff}')
        .is_empty()
}

pub fn parse(bytes: &[u8]) -> Result<InstalledMaps, BackendError> {
    let raw = json(bytes)?;
    if raw.get("ok") == Some(&Value::Bool(false)) {
        return Err(saves::read_error(&raw)?);
    }
    if raw.get("ok") != Some(&Value::Bool(true)) || raw.get("catalogPath").is_none() {
        return Err(BackendError::Invalid);
    }
    let mut data: InstalledMaps = serde_json::from_value(raw).map_err(|_| BackendError::Invalid)?;
    if data.maps.len() > 128
        || (data.available && !data.catalog_path.as_deref().is_some_and(nonblank))
        || (!data.available && (data.catalog_path.is_some() || !data.maps.is_empty()))
    {
        return Err(BackendError::Invalid);
    }
    let mut identities = HashSet::new();
    for map in &data.maps {
        if map.internal_name.encode_utf16().count() > 64
            || !nonblank(&map.internal_name)
            || map.internal_name.contains(['/', '\\'])
            || map.internal_name.chars().any(|c| c < ' ')
            || !identities.insert(&map.internal_name)
            || map.display_name.encode_utf16().count() > 128
            || !nonblank(&map.display_name)
            || map.display_name.chars().any(|c| c < ' ')
            || !(map.artwork_revision.is_null()
                || map.artwork_revision.as_str().is_some_and(|revision| {
                    revision.len() == 64
                        && revision
                            .bytes()
                            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                }))
        {
            return Err(BackendError::Invalid);
        }
    }
    data.catalog_path = None;
    Ok(data)
}

#[cfg(test)]
#[path = "../../tests/unit/projections/maps.rs"]
mod tests;
