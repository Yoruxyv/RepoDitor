use super::*;
use serde_json::{json, Value};

fn response() -> Value {
    json!({"ok":true,"players":[{"id":"111","name":"Alpha","health":180,"maxHealth":100,"private":"excluded"}]})
}
fn decode(raw: Value) -> Result<Vec<Player>, BackendError> {
    parse(&serde_json::to_vec(&raw).unwrap())
}
#[test]
fn keeps_python_values_order_and_empty_results_without_extra_fields() {
    let value = serde_json::to_value(decode(response()).unwrap()).unwrap();
    assert_eq!(
        value,
        json!([{"id":"111","name":"Alpha","health":180,"maxHealth":100}])
    );
    assert!(decode(json!({"ok":true,"players":[]})).unwrap().is_empty());
    let mut raw = response();
    raw["players"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"222","name":"Beta","health":0,"maxHealth":120}));
    let players = decode(raw).unwrap();
    assert_eq!(players[1].id, "222");
}
#[test]
fn rejects_missing_malformed_and_ambiguous_player_metadata() {
    for (field, value) in [
        ("id", json!("")),
        ("id", json!("../111")),
        ("id", json!("1".repeat(21))),
        ("id", json!("１２３")),
        ("id", json!(111)),
        ("name", json!(" ")),
        ("name", Value::Null),
        ("health", json!(-1)),
        ("health", json!(1.5)),
        ("health", json!(true)),
        ("health", json!(9_007_199_254_740_992i64)),
        ("maxHealth", json!(99)),
        ("maxHealth", json!(9_007_199_254_740_992i64)),
    ] {
        let mut raw = response();
        raw["players"][0][field] = value;
        assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid, "{field}");
    }
    for field in ["id", "name", "health", "maxHealth"] {
        let mut raw = response();
        raw["players"][0].as_object_mut().unwrap().remove(field);
        assert!(decode(raw).is_err());
    }
    let mut raw = response();
    let duplicate = raw["players"][0].clone();
    raw["players"].as_array_mut().unwrap().push(duplicate);
    assert!(decode(raw).is_err());
    for raw in [
        json!({"ok":true}),
        json!({"ok":true,"players":null}),
        json!({"ok":1,"players":[]}),
        json!([]),
    ] {
        assert!(decode(raw).is_err());
    }
    assert_eq!(parse(b" ").unwrap_err(), BackendError::Empty);
    assert_eq!(parse(b"{").unwrap_err(), BackendError::Malformed);
}
#[test]
fn only_accepts_read_failures_and_sanitizes_backend_messages() {
    for code in [
        "invalid_request",
        "save_missing",
        "save_corrupt",
        "save_decrypt_failed",
        "save_unsupported",
        "backend_unavailable",
    ] {
        let result = crate::error::Outcome::<Vec<Player>>::for_service(
            decode(json!({"ok":false,"error":{"code":code,"message":"private path"}})),
            crate::error::Service::Player,
        );
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["error"]["code"], code);
        assert!(!value.to_string().contains("private"));
    }
    for error in [
        json!({"code":"save_write_failed","message":"private"}),
        json!({"code":"save_missing","message":null}),
    ] {
        assert_eq!(
            decode(json!({"ok":false,"error":error})).unwrap_err(),
            BackendError::Invalid
        );
    }
}

#[test]
fn avatar_urls_and_retry_policy_are_narrow_and_bound_to_the_requested_player() {
    let decode_avatar = |avatar: Value| {
        parse_avatar(
            &serde_json::to_vec(&json!({"ok":true,"avatar":avatar})).unwrap(),
            "111",
        )
    };
    let valid = json!({"playerId":"111","avatarUrl":"https://avatars.fastly.steamstatic.com/example.jpg","status":"available","retryAfterMs":null});
    assert!(decode_avatar(valid.clone()).is_ok());
    for url in [
        "http://avatars.fastly.steamstatic.com/a",
        "https://example.com/a",
        "https://avatars.fastly.steamstatic.com.example.com/a",
        "https://user:pass@avatars.fastly.steamstatic.com/a",
        "https://avatars.fastly.steamstatic.com:444/a",
        "file:///image.jpg",
    ] {
        let mut raw = valid.clone();
        raw["avatarUrl"] = json!(url);
        assert!(decode_avatar(raw).is_err());
    }
    for (field, bad) in [
        ("playerId", json!("222")),
        ("status", json!("unknown")),
        ("status", json!("unavailable")),
        ("retryAfterMs", json!(30_000)),
    ] {
        let mut raw = valid.clone();
        raw[field] = bad;
        assert!(decode_avatar(raw).is_err());
    }
    for delay in [Value::Null, json!(30_000), json!(300_000)] {
        assert!(decode_avatar(
            json!({"playerId":"111","avatarUrl":null,"status":"transient","retryAfterMs":delay})
        )
        .is_ok());
    }
    for delay in [
        json!(-1),
        json!(true),
        json!(29_999),
        json!(300_001),
        json!(30_000.5),
    ] {
        assert!(decode_avatar(
            json!({"playerId":"111","avatarUrl":null,"status":"transient","retryAfterMs":delay})
        )
        .is_err());
    }
    assert!(decode_avatar(
        json!({"playerId":"111","avatarUrl":null,"status":"unavailable","retryAfterMs":null})
    )
    .is_ok());
    assert!(matches!(
        parse_avatar(
            br#"{"ok":false,"error":{"code":"invalid_request","message":"private"}}"#,
            "111"
        )
        .unwrap_err(),
        BackendError::Domain {
            code: "invalid_request",
            ..
        }
    ));
}
