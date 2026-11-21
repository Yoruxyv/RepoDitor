//! Reviewed fixture bytes compiled only into synthetic hosts (and the build verifier).
pub const PIN: &str = "8197a7fbf037664c44994c16c5d8b33bf88680d9d37934ad1aeb62619bd95610";
const SOURCE: &str =
    include_str!("../../../python/repo_save_editor/services/cosmetics/synthetic_fixture.py");

pub fn manifest() -> &'static str {
    let python_pin = SOURCE
        .rsplit_once("\nPIN = \"")
        .unwrap()
        .1
        .split_once('"')
        .unwrap()
        .0;
    assert_eq!(
        python_pin, PIN,
        "Rust and Python MetaSave fixture pins disagree"
    );
    SOURCE
        .split_once("MANIFEST = b\"\"\"")
        .unwrap()
        .1
        .split_once("\"\"\"")
        .unwrap()
        .0
}
