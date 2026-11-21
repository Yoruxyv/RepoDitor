"""Read compatibility evidence and one-edit approvals from private frozen bundles."""

from __future__ import annotations

import base64
import json
import sys
from dataclasses import dataclass
from importlib import import_module
from pathlib import Path
from re import fullmatch
from typing import NamedTuple

from repo_save_editor.services.items.models import ItemRechargeCapability


class Bundle(NamedTuple):
    directory: Path
    public_key: bytes
    build: str
    source_pins: tuple[str, ...]
    live: bool = False
    session: bool = False
    item_unity: str | None = None
    item_sources: tuple[tuple[str, str], ...] = ()
    recharge_identities: frozenset[str] = frozenset()
    cosmetic_sources: tuple[tuple[str, str], ...] = ()
    cosmetic_catalog_digest: str = ""
    save_format_pins: tuple[str, ...] = ()

    @property
    def local_low(self) -> Path:
        return self.directory / "profile/AppData/LocalLow"

    def accepts_build_id(self, build_id: str) -> bool:
        return build_id == self.build or (self.session and bool(self.save_format_pins))

    def reviewed_recharge(self, names: tuple[str, ...]) -> dict[str, ItemRechargeCapability]:
        return {
            name: ItemRechargeCapability.RECHARGEABLE
            for name in names
            if name in self.recharge_identities
        }


def private_bundle() -> Bundle | None:
    if not getattr(sys, "frozen", False):
        return None
    try:
        data = import_module("_repoditor_health_qualification")
    except ModuleNotFoundError as exc:
        if exc.name != "_repoditor_health_qualification":
            raise
        return None
    return Bundle(
        Path(data.DIRECTORY),
        bytes.fromhex(data.PUBLIC_KEY),
        data.BUILD,
        data.SOURCE_PINS,
        getattr(data, "LIVE", False) is True,
        getattr(data, "SESSION", False) is True,
        getattr(data, "ITEM_UNITY", None),
        tuple(getattr(data, "ITEM_SOURCES", {}).items()),
        frozenset(getattr(data, "RECHARGE_IDENTITIES", ())),
        tuple(getattr(data, "COSMETIC_SOURCES", {}).items()),
        getattr(data, "COSMETIC_CATALOG_DIGEST", ""),
        getattr(data, "SAVE_FORMAT_PINS", ()),
    )


@dataclass(frozen=True, slots=True)
class Approval:
    save: str
    fingerprint: str
    identity: list[int]
    namespace: str
    intent: dict[str, object]
    existing_path: Path | None = None

    @property
    def original(self) -> tuple[str, list[int]]:
        return self.fingerprint, self.identity


def read_approval(bundle: Bundle) -> Approval | None:
    """Accept only an exact signed payload from the offline approval key."""
    # Reading a bundle's discovery metadata does not verify an approval ticket.
    from cryptography.exceptions import InvalidSignature  # noqa: PLC0415
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey  # noqa: PLC0415

    try:
        with (bundle.directory / "approval.json").open("rb") as stream:
            raw = stream.read(4097)
        if len(raw) > 4096:
            return None
        envelope = json.loads(raw)
        if not isinstance(envelope, dict) or set(envelope) != {"payload", "signature"}:
            return None
        payload = base64.b64decode(envelope["payload"], validate=True)
        signature = base64.b64decode(envelope["signature"], validate=True)
        Ed25519PublicKey.from_public_bytes(bundle.public_key).verify(signature, payload)
        record = json.loads(payload)
        fields = {
            "version",
            "build",
            "save",
            "fingerprint",
            "identity",
            "namespace",
            "edit",
        }
        if bundle.live:
            fields.add("existingPath")
        if not isinstance(record, dict) or set(record) != fields:
            return None
        if bundle.live and not isinstance(record["existingPath"], str):
            return None
        save, fingerprint, identity, namespace, edit = (
            record["save"],
            record["fingerprint"],
            record["identity"],
            record["namespace"],
            record["edit"],
        )
        if (
            record["version"] != (2 if bundle.live else 1)
            or record["build"] != bundle.build
            or not isinstance(save, str)
            or fullmatch(r"REPO_SAVE_[0-9]{4}(?:_[0-9]{2}){5}", save) is None
            or not isinstance(fingerprint, str)
            or fullmatch(r"[0-9a-f]{64}", fingerprint) is None
            or not isinstance(namespace, str)
            or fullmatch(r"[0-9a-f]{64}", namespace) is None
            or not isinstance(identity, list)
            or len(identity) != 4
            or any(type(i) is not int or i < 0 for i in identity)
            or not isinstance(edit, dict)
            or set(edit) != {"playerId", "before", "value"}
            or not isinstance(edit["playerId"], str)
            or fullmatch(r"[0-9]{1,20}", edit["playerId"]) is None
            or any(
                type(edit[k]) is not int or not 0 <= edit[k] <= 2_147_483_647
                for k in ("before", "value")
            )
            or edit["before"] == edit["value"]
        ):
            return None
        existing_path = Path(record["existingPath"]) if bundle.live else None
        return Approval(save, fingerprint, identity, namespace, {"health": [edit]}, existing_path)
    except (OSError, ValueError, TypeError, RecursionError, InvalidSignature):
        return None
