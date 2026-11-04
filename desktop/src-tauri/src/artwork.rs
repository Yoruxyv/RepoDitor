//! Optional artwork metadata validation; no native artwork transport or authority.
use serde_json::Value;

pub fn valid_icon_key(value: &Value) -> bool {
    let Some(key) = value.as_str() else {
        return value.is_null();
    };
    let Some(stem) = key.strip_suffix(".png") else {
        return false;
    };
    (1..=256).contains(&stem.encode_utf16().count())
        && key != "..png"
        && !key.contains(['/', '\\', '\0'])
        && key == key.to_lowercase()
}
