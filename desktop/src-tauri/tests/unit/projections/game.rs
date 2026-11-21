use super::*;
#[test]
fn unknown_is_distinct_and_process_details_are_dropped() {
    for status in ["running", "not_running", "unknown"] {
        let bytes=serde_json::to_vec(&serde_json::json!({"ok":true,"status":status,"running":status=="running","processes":["private"]})).unwrap();
        let value = serde_json::to_value(parse(&bytes).unwrap()).unwrap();
        assert_eq!(value["status"], status);
        assert!(value.get("processes").is_none());
    }
}
#[test]
fn rejects_missing_unrecognized_and_inconsistent_game_states() {
    for raw in [
        serde_json::json!({"ok":true,"status":"unknown","running":true}),
        serde_json::json!({"ok":true,"status":"closed","running":false}),
        serde_json::json!({"ok":true,"status":"not_running","running":0}),
        serde_json::json!({"ok":false,"status":"not_running","running":false}),
        serde_json::json!({"ok":true,"running":false}),
    ] {
        assert_eq!(
            parse(&serde_json::to_vec(&raw).unwrap()).unwrap_err(),
            BackendError::Invalid
        );
    }
    assert_eq!(parse(b"{}\n{}").unwrap_err(), BackendError::Malformed);
}
