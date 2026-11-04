//! Validate installed-map display data; Python owns discovery and artwork stays opaque.
use crate::{
    error::{json, BackendError},
    saves,
};
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
    let data: InstalledMaps = serde_json::from_value(raw).map_err(|_| BackendError::Invalid)?;
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
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn response() -> Value {
        json!({"ok":true,"available":true,"catalogPath":"E:/synthetic/catalog.json","maps":[
            {"internalName":"Arctic","displayName":"McJannek Station","knownLabel":true,"artworkRevision":"a".repeat(64),"iconToken":"https://untrusted"},
            {"internalName":"Modded Moon","displayName":"Modded Moon","knownLabel":false}
        ]})
    }

    fn decode(raw: Value) -> Result<InstalledMaps, BackendError> {
        parse(&serde_json::to_vec(&raw).unwrap())
    }

    #[test]
    fn preserves_dynamic_maps_without_artwork_authority() {
        let value = serde_json::to_value(decode(response()).unwrap()).unwrap();
        assert_eq!(value["available"], true);
        assert_eq!(value["catalogPath"], "E:/synthetic/catalog.json");
        assert_eq!(value["maps"][1]["internalName"], "Modded Moon");
        assert_eq!(value["maps"][1]["knownLabel"], false);
        for map in value["maps"].as_array().unwrap() {
            assert!(map["iconToken"].is_null());
            assert!(map.get("artworkRevision").is_none());
        }
        for revision in [Value::Null, json!("0123456789abcdef".repeat(4))] {
            let mut raw = response();
            raw["maps"][0]["artworkRevision"] = revision;
            assert!(decode(raw).is_ok());
        }
    }

    #[test]
    fn distinguishes_unavailable_and_available_empty_catalogs() {
        for (available, path) in [(false, Value::Null), (true, json!("E:/catalog.json"))] {
            let data =
                decode(json!({"ok":true,"available":available,"catalogPath":path,"maps":[]}))
                    .unwrap();
            assert_eq!(data.available, available);
            assert!(data.maps.is_empty());
        }
        let mut raw = response();
        raw["maps"] = json!((0..128).map(|i| json!({"internalName":format!("Map{i}"),"displayName":"Dynamic","knownLabel":false})).collect::<Vec<_>>());
        assert!(decode(raw.clone()).is_ok());
        raw["maps"]
            .as_array_mut()
            .unwrap()
            .push(json!({"internalName":"Extra","displayName":"Extra","knownLabel":false}));
        assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid);
    }

    #[test]
    fn rejects_invalid_identities_labels_and_artwork_revisions() {
        for (field, value) in [
            ("internalName", json!("")),
            ("internalName", json!(" \u{feff}")),
            ("internalName", json!("../map")),
            ("internalName", json!("map\\name")),
            ("internalName", json!("bad\nname")),
            ("internalName", json!("x".repeat(65))),
            ("internalName", json!("🗺".repeat(33))),
            ("displayName", json!(" ")),
            ("displayName", json!("bad\0name")),
            ("displayName", json!("x".repeat(129))),
            ("displayName", json!("🗺".repeat(65))),
            ("knownLabel", json!(1)),
            ("artworkRevision", json!(true)),
            ("artworkRevision", json!("A".repeat(64))),
            ("artworkRevision", json!("g".repeat(64))),
            ("artworkRevision", json!("a".repeat(63))),
            ("artworkRevision", json!("https://private")),
        ] {
            let mut raw = response();
            raw["maps"][0][field] = value;
            assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid, "{field}");
        }
        for field in ["internalName", "displayName", "knownLabel"] {
            let mut raw = response();
            raw["maps"][0].as_object_mut().unwrap().remove(field);
            assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid, "{field}");
        }
        let mut raw = response();
        raw["maps"][1] = raw["maps"][0].clone();
        assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid);
        let mut raw = response();
        raw["maps"][0]["internalName"] = json!("🗺".repeat(32));
        raw["maps"][0]["displayName"] = json!("🗺".repeat(64));
        assert!(decode(raw).is_ok());
    }

    #[test]
    fn rejects_bad_framing_and_inconsistent_catalogs() {
        for raw in [
            Value::Null,
            json!([]),
            json!({"ok":1}),
            json!({"ok":false}),
            json!({"ok":false,"error":{"code":"invented","message":"private"}}),
        ] {
            assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid);
        }
        for (field, value) in [
            ("available", json!(1)),
            ("catalogPath", Value::Null),
            ("catalogPath", json!(" ")),
            ("catalogPath", json!(3)),
            ("maps", Value::Null),
            ("available", json!(false)),
        ] {
            let mut raw = response();
            raw[field] = value;
            assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid, "{field}");
        }
        let mut raw = response();
        raw["available"] = json!(false);
        raw["catalogPath"] = Value::Null;
        assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid);
        for field in ["ok", "available", "catalogPath", "maps"] {
            let mut raw = response();
            raw.as_object_mut().unwrap().remove(field);
            assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid, "{field}");
        }
        assert_eq!(parse(b" ").unwrap_err(), BackendError::Empty);
        assert_eq!(parse(b"{").unwrap_err(), BackendError::Malformed);
        let error = crate::error::Outcome::for_service(
            decode(
                json!({"ok":false,"error":{"code":"backend_unavailable","message":"private path"}}),
            ),
            crate::error::Service::Maps,
        );
        let public = serde_json::to_value(error).unwrap();
        assert_eq!(public["error"]["code"], "backend_unavailable");
        assert!(!public.to_string().contains("private"));
    }
}
