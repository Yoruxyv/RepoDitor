"""Resolve the save-relevant subset of the reviewed Sunstone Unity layout."""

from hashlib import sha256
from pathlib import Path

from repo_save_editor.services.game.installed_build import owned_file
from repo_save_editor.services.game.write_evidence import RECHARGE_UNITY
from repo_save_editor.services.unity_presentation import PresentationFileIndex
from repo_save_editor.services.unity_serialized import (
    RESOURCE_MANAGER_CLASS_ID,
    PPtr,
    UnityMetadataError,
    parse_mono_behaviour_prefix,
    parse_mono_script,
    read_pptr,
)

MANAGERS = "REPO_Data/globalgamemanagers"
RESOURCES = "REPO_Data/resources.assets"
SCRIPTS = "REPO_Data/globalgamemanagers.assets"
BUILD_SETTINGS_CLASS = 141
# These are typed object bodies, independent of their file offsets and unrelated
# ResourceManager entries. The bodies are interpreted with the reviewed managed
# game and ES3 code, whose bytes must also match before writes are available.
SUNSTONE_ES3_DEFAULTS = "1a72cc2f0ea9c29d90570a940257138e620d36261df004538bee59d259dd9eb8"
SUNSTONE_BUILD_SETTINGS = "571cc104539e15eb3fbabc55b248b07664c267e958265c512a1d7af97b86a7fd"


def _defaults_pointer(managers: PresentationFileIndex) -> PPtr:
    records = tuple(managers.iter_records(frozenset({RESOURCE_MANAGER_CLASS_ID})))
    if len(records) != 1:
        raise UnityMetadataError("The save settings resource map is ambiguous.")
    reader = managers.object_reader(records[0])
    count = reader.i32()
    if not 1 <= count <= 65_536:
        raise UnityMetadataError("The save settings resource map exceeds its bounds.")
    defaults = []
    for _ in range(count):
        key = reader.aligned_string()
        target = read_pptr(reader)
        if key.casefold() == "es3/es3defaults":
            defaults.append(target)
    if len(defaults) != 1 or set(managers.external_names(defaults[0].file_id)) != {
        "resources.assets"
    }:
        raise UnityMetadataError("The save settings resource target is ambiguous.")
    return defaults[0]


def inspect_save_settings(root: Path) -> tuple[str, str | None]:
    """Identify the full typed ES3Defaults object and the optional scene settings."""
    with (
        PresentationFileIndex(owned_file(root, root / MANAGERS)) as managers,
        PresentationFileIndex(owned_file(root, root / RESOURCES)) as resources,
        PresentationFileIndex(owned_file(root, root / SCRIPTS)) as scripts,
    ):
        if any(index.unity_version != RECHARGE_UNITY for index in (managers, resources, scripts)):
            raise UnityMetadataError("Unsupported save settings layout.")
        pointer = _defaults_pointer(managers)
        target = resources.find_records({pointer.path_id})[pointer.path_id]
        if not 0 < target.byte_size <= 16_384:
            raise UnityMetadataError("The save settings object exceeds its bounds.")
        prefix = parse_mono_behaviour_prefix(resources, target)
        if prefix.game_object != PPtr(0, 0) or set(
            resources.external_names(prefix.script.file_id)
        ) != {"globalgamemanagers.assets"}:
            raise UnityMetadataError("Unsupported save settings script source.")
        script = parse_mono_script(
            scripts, scripts.find_records({prefix.script.path_id})[prefix.script.path_id]
        )
        if (script.class_name, script.namespace, script.assembly_name) != (
            "ES3Defaults",
            "",
            "Assembly-CSharp-firstpass",
        ):
            raise UnityMetadataError("Unsupported save settings script identity.")
        body = resources.object_reader(target)
        body.skip(prefix.field_offset)
        defaults = sha256(body.bytes(body.remaining)).hexdigest()
        scenes = tuple(managers.iter_records(frozenset({BUILD_SETTINGS_CLASS})))
        if len(scenes) != 1 or not 0 < scenes[0].byte_size <= 16_384:
            return defaults, None
        scene_data = managers.object_reader(scenes[0])
        return defaults, sha256(scene_data.bytes(scene_data.remaining)).hexdigest()
