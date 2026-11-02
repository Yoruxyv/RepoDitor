"""Synthetic checks for the opt-in geometry experiment; no installed artwork."""

from __future__ import annotations

import math
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from tools import artwork_probe as probe


def local(*, x: float = 0, sx: float = 1, rotation: dict[str, float] | None = None) -> dict:
    return {
        "m_LocalPosition": {"x": x, "y": 0, "z": 0},
        "m_LocalRotation": rotation or {"x": 0, "y": 0, "z": 0, "w": 1},
        "m_LocalScale": {"x": sx, "y": 1, "z": 1},
    }


def test_composition_preserves_parent_scale_and_child_rotation() -> None:
    turn = {"x": 0, "y": 0, "z": math.sqrt(0.5), "w": math.sqrt(0.5)}
    matrix = probe.multiply(
        probe.transform_matrix(local(x=10, sx=2)), probe.transform_matrix(local(x=3, rotation=turn))
    )
    assert probe.point(matrix, (1, 0, 0)) == pytest.approx((16, 1, 0))
    assert probe.point(matrix, (0, 1, 0)) == pytest.approx((14, 0, 0))


@pytest.mark.parametrize("value", [float("nan"), float("inf")])
def test_nonfinite_transforms_are_rejected(value: float) -> None:
    with pytest.raises(ValueError, match="Nonfinite"):
        probe.transform_matrix(local(x=value))


def test_invalid_quaternion_is_rejected() -> None:
    with pytest.raises(ValueError, match="quaternion"):
        probe.transform_matrix(local(rotation={"x": 0, "y": 0, "z": 0, "w": 2}))


def test_nonfinite_material_sentinels_are_recorded_explicitly() -> None:
    assert probe.reported_number(float("inf")) == "inf"
    assert probe.reported_number(float("-inf")) == "-inf"
    assert probe.reported_number(float("nan")) == "nan"
    assert probe.reported_number(0.5) == 0.5


def test_camera_inverse_and_projection_use_authored_settings() -> None:
    matrix = probe.transform_matrix(local(x=2))
    vertex = probe.camera_point(matrix, (3, 0, 2))
    camera = {
        "near clip plane": 0.3,
        "far clip plane": 10,
        "field of view": 90,
        "orthographic": False,
        "orthographic size": 1,
    }
    assert probe.project(vertex, camera) == pytest.approx((384, 256))
    assert probe.project(vertex, {**camera, "orthographic": True}) == pytest.approx((512, 256))
    with pytest.raises(ValueError, match="Scaled/sheared"):
        probe.camera_point(probe.transform_matrix(local(sx=2)), (0, 0, 1))
    with pytest.raises(ValueError, match="clip plane"):
        probe.project((0, 0, 0.1), camera)


def mesh_fixture(*, base: int = 0, first: int = 0, topology: int = 0, indices: int = 3) -> tuple:
    sub = SimpleNamespace(topology=topology, firstByte=first, indexCount=indices, baseVertex=base)
    mesh = SimpleNamespace(m_SubMeshes=[sub])
    handler = SimpleNamespace(
        m_Use16BitIndices=True,
        m_Vertices=[(0, 0, 0)] * 5,
        m_IndexBuffer=[0, 1, 2],
        get_triangles=lambda: [[(0, 1, 2)]],
    )
    return mesh, handler


def test_submesh_base_vertex_is_applied_to_every_index() -> None:
    assert probe.triangles(*mesh_fixture(base=2)) == [[(2, 3, 4)]]


@pytest.mark.parametrize(
    "options",
    [{"base": 3}, {"base": -1}, {"first": 1}, {"first": 6}, {"topology": 2}, {"indices": 4}],
)
def test_invalid_geometry_fails_closed(options: dict) -> None:
    with pytest.raises(ValueError, match=r"index|topology"):
        probe.triangles(*mesh_fixture(**options))


def test_triangle_budget_is_checked_before_decoder(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(probe, "MAX_TRIANGLES", 0)
    with pytest.raises(ValueError, match="budget"):
        probe.triangles(*mesh_fixture())


def test_source_change_and_missing_file_are_detected(tmp_path: Path) -> None:
    source = tmp_path / "source.bin"
    source.write_bytes(b"before")
    experiment = probe.Probe(tmp_path, SimpleNamespace())
    experiment.watch(source)
    source.write_bytes(b"changed")
    with pytest.raises(ValueError, match="changed"):
        experiment.watch(source)
    source.unlink()
    with pytest.raises(FileNotFoundError):
        experiment.watch(source)


def test_access_time_changes_do_not_invalidate_read_only_sources(tmp_path: Path) -> None:
    source = tmp_path / "manifest.acf"
    source.write_bytes(b"synthetic")
    before = probe.source_stamp(source)
    info = source.stat()
    os.utime(source, ns=(info.st_atime_ns + 10**9, info.st_mtime_ns))
    assert probe.source_stamp(source) == before


def test_external_source_escape_is_rejected_before_open(tmp_path: Path) -> None:
    data = tmp_path / "REPO_Data"
    data.mkdir()
    resolver = SimpleNamespace(resolve=lambda *_: pytest.fail("Unsafe source was opened"))
    experiment = probe.Probe(tmp_path, resolver)
    outside = tmp_path.parent / (tmp_path.name + "-outside.bin")
    outside.write_bytes(b"synthetic")
    try:
        index = SimpleNamespace(external_names=lambda _: (str(outside),))
        with pytest.raises(ValueError, match=r"subpath|relative"):
            experiment.resolve(index, {"m_FileID": 1, "m_PathID": 1})
    finally:
        outside.unlink()


def test_native_file_budget_precedes_unitypy_import(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source.bin"
    source.write_bytes(b"synthetic")
    experiment = probe.Probe(tmp_path, SimpleNamespace())
    monkeypatch.setattr(probe, "MAX_INPUT_BYTES", 1)
    monkeypatch.setattr(probe, "import_module", lambda _: pytest.fail("Decoder was loaded"))
    with pytest.raises(ValueError, match="budget"):
        experiment.native(SimpleNamespace(path=source), 1)


def test_stream_bounds_are_enforced_on_synthetic_data(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = tmp_path / "REPO_Data"
    data.mkdir()
    (data / "source.resS").write_bytes(b"abcdef")
    experiment = probe.Probe(tmp_path, SimpleNamespace())
    assert experiment.stream("source.resS", 1, 3) == b"bcd"
    with pytest.raises(ValueError, match="range"):
        experiment.stream("source.resS", 5, 3)
    monkeypatch.setattr(probe, "MAX_STREAM_BYTES", 3)
    with pytest.raises(ValueError, match="budget"):
        experiment.stream("source.resS", 0, 1)


def test_unreviewed_installation_never_starts_decoder(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(probe, "_installation", lambda _: None)
    monkeypatch.setattr(probe, "import_module", lambda _: pytest.fail("Decoder was loaded"))
    with pytest.raises(ValueError, match="reviewed"):
        probe.capture(None)


@pytest.mark.parametrize(
    "failure",
    [subprocess.TimeoutExpired(["worker"], 120), subprocess.CalledProcessError(1, ["worker"])],
)
def test_worker_timeout_and_failure_publish_no_partial_report(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    failure: Exception,
) -> None:
    def run(command: list[str], **kwargs: object) -> None:
        assert command == [sys.executable, "-m", "tools.artwork_probe", "--worker"]
        assert kwargs["timeout"] == 120
        assert kwargs["check"] is True
        raise failure

    monkeypatch.setattr(sys, "argv", ["artwork_probe"])
    monkeypatch.setattr(probe.subprocess, "run", run)
    with pytest.raises(type(failure)):
        probe.main()
    assert capsys.readouterr().out == ""


@pytest.mark.parametrize("count", [-1, probe.MAX_VERTICES + 1])
def test_native_mesh_budget_precedes_decompression(count: int) -> None:
    mesh = SimpleNamespace(m_VertexData=SimpleNamespace(m_VertexCount=count))
    with pytest.raises(ValueError, match="Vertex budget"):
        probe.validate_mesh_budget(mesh)


def test_compressed_mesh_budget_precedes_decompression() -> None:
    mesh = SimpleNamespace(
        m_VertexData=SimpleNamespace(m_VertexCount=3),
        m_SubMeshes=[],
        m_CompressedMesh=SimpleNamespace(m_Vertices=SimpleNamespace(m_NumItems=10**9)),
    )
    with pytest.raises(ValueError, match="Compressed mesh budget"):
        probe.validate_mesh_budget(mesh)
