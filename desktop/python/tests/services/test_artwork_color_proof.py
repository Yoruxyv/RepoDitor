"""Synthetic checks for the one-control color experiment; no game pixels."""

from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from tools import artwork_color_proof as proof


def test_metrics_separate_foreground_from_transparent_rgb() -> None:
    reference = bytes([0, 0, 0, 255, 0, 0, 0, 0])
    candidate = bytes([255, 0, 0, 255, 255, 255, 255, 0])
    result = proof.rgba_metrics(candidate, reference)
    assert result["referenceForegroundRgbMae255"] == 85
    assert result["referenceForegroundRgbRmse255"] == pytest.approx(255 / math.sqrt(3))
    assert result["alphaIoU128"] == 1
    assert result["alphaMae255"] == 0
    assert result["blackCompositeRgbRmse255"] == pytest.approx(255 / math.sqrt(6))
    assert result["whiteCompositeRgbRmse255"] == result["blackCompositeRgbRmse255"]


def test_metrics_penalize_missing_alpha_and_composition() -> None:
    result = proof.rgba_metrics(bytes([255, 0, 0, 0]), bytes([255, 0, 0, 255]))
    assert result["referenceForegroundRgbMae255"] == 0
    assert result["alphaMae255"] == 255
    assert result["alphaIoU128"] == 0
    assert result["rgbaRmse255"] == 127.5
    assert result["blackCompositeRgbRmse255"] == pytest.approx(255 / math.sqrt(3))
    assert result["whiteCompositeRgbRmse255"] == pytest.approx(255 * math.sqrt(2 / 3))


@pytest.mark.parametrize(
    ("candidate", "reference"), [(b"", b""), (b"123", b"123"), (b"1234", b"12345678")]
)
def test_malformed_rgba_buffers_fail(candidate: bytes, reference: bytes) -> None:
    with pytest.raises(ValueError, match="RGBA"):
        proof.rgba_metrics(candidate, reference)


def test_exact_comparison_does_not_emit_infinity() -> None:
    result = proof.rgba_metrics(bytes([1, 2, 3, 255]), bytes([1, 2, 3, 255]))
    assert result["rgbaRmse255"] == 0
    assert result["rgbaExactPixelFraction"] == 1
    assert result["referenceForegroundRgbPsnrDb"] is None
    json.dumps(result, allow_nan=False)


def material() -> dict:
    return {
        "m_ValidKeywords": ["_EMISSION", "_NORMALMAP"],
        "m_SavedProperties": {
            "m_Floats": [("_Mode", 0), ("_SrcBlend", 1), ("_DstBlend", 0), ("_BumpScale", 1)],
            "m_TexEnvs": [
                ("_MainTex", {"m_Scale": {"x": 1, "y": 1}, "m_Offset": {"x": 0, "y": 0}})
            ],
        },
    }


def test_material_gate_rejects_unimplemented_behavior() -> None:
    proof.validate_material(material())
    changed = material()
    changed["m_ValidKeywords"].append("_ALPHABLEND_ON")
    with pytest.raises(ValueError, match="unsupported shader"):
        proof.validate_material(changed)
    changed = material()
    changed["m_SavedProperties"]["m_TexEnvs"][0][1]["m_Scale"]["x"] = 2
    with pytest.raises(ValueError, match="UV transform"):
        proof.validate_material(changed)


@pytest.mark.parametrize(
    "failure",
    [subprocess.TimeoutExpired(["worker"], 120), subprocess.CalledProcessError(1, ["worker"])],
)
def test_worker_failure_and_timeout_emit_no_partial_result(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    failure: Exception,
) -> None:
    def run(command: list[str], **kwargs: object) -> None:
        assert command == [sys.executable, "-m", "tools.artwork_color_proof", "--worker"]
        assert kwargs["timeout"] == 120
        raise failure

    monkeypatch.setattr(sys, "argv", ["artwork_color_proof"])
    monkeypatch.setattr(proof.subprocess, "run", run)
    with pytest.raises(type(failure)):
        proof.main()
    assert capsys.readouterr().out == ""


def test_sampling_uses_repeat_raw_uv_rows_and_authored_mip() -> None:
    np = pytest.importorskip("numpy")
    level = np.array([[[1, 0, 0, 1], [0, 1, 0, 1]], [[0, 0, 1, 1], [1, 1, 1, 1]]], dtype=np.float32)
    small = np.full((1, 1, 4), 0.5, dtype=np.float32)
    sampled = proof.sample_point(
        np, [level, small], np.array([[-0.1, 1.1], [0.1, 0.75], [0, 0]]), np.array([0, 0, 1])
    )
    assert sampled == pytest.approx(np.array([[0, 1, 0, 1], [0, 0, 1, 1], [0.5] * 4]))
    with pytest.raises(ValueError, match="sample"):
        proof.sample_point(np, [level], np.array([[float("nan"), 0]]), np.array([0]))


def test_zbuffer_rejects_backfaces_and_preserves_near_surface() -> None:
    np = pytest.importorskip("numpy")
    vertices = np.zeros((931, 3), dtype=np.float32)
    screen = np.zeros((931, 2), dtype=np.float32)
    screen[:6] = [[10, 10], [20, 10], [10, 20]] * 2
    z = np.full(931, 2.0)
    z[3:6] = 1
    faces = np.zeros((657, 3), dtype=np.int32)
    faces[:3] = [[0, 1, 2], [3, 4, 5], [0, 2, 1]]
    depth, ids, weights = proof.rasterize(np, vertices, screen, z, faces)
    assert ids[12, 12] == 1
    assert depth[12, 12] == 1
    assert weights[12, 12].sum() == pytest.approx(1)
    assert ids[0, 0] == -1
    with pytest.raises(ValueError, match="reviewed control"):
        proof.rasterize(np, vertices[:3], screen, z, faces)


def test_float4_normals_match_shader_float3_input() -> None:
    np = pytest.importorskip("numpy")
    vertices = np.zeros((931, 3), dtype=np.float32)
    vertices[:, 2] = 2
    vertices[:3] = [[-0.2, 0.2, 2], [0.2, 0.2, 2], [-0.2, -0.2, 2]]
    faces = [[(0, 1, 2)] + [(0, 0, 0)] * 656]
    mesh = SimpleNamespace(
        m_SubMeshes=[SimpleNamespace(topology=0, firstByte=0, indexCount=657 * 3, baseVertex=0)]
    )
    handler = SimpleNamespace(
        m_Vertices=vertices.tolist(),
        m_Normals=np.tile([0, 0, -1, 0], (931, 1)),
        m_Tangents=np.tile([1, 0, 0, 1], (931, 1)),
        m_UV0=np.zeros((931, 2)),
        m_IndexBuffer=[0] * (657 * 3),
        m_Use16BitIndices=True,
        get_triangles=lambda: [[*faces[0]]],
    )
    identity = np.eye(4).tolist()
    row = {"worldMatrix": identity}
    camera = {"worldMatrix": identity, "components": {"Camera": {"field of view": 90}}}
    texture = np.ones((1, 1, 4), dtype=np.float32)
    normal = np.array([[[1, 0.5, 1, 0.5]]], dtype=np.float32)
    textures = {"_MainTex": [texture], "_EmissionMap": [texture * 0], "_BumpMap": [normal]}
    props = {
        "m_SavedProperties": {
            "m_Floats": [("_Metallic", 0), ("_Glossiness", 0.5)],
            "m_Colors": [
                ("_Color", dict.fromkeys("rgb", 1)),
                ("_EmissionColor", dict.fromkeys("rgb", 0)),
            ],
        }
    }
    first, _ = proof.render_control(
        np, mesh, handler, row, camera, textures, props, [], [0, 0, 0, 0]
    )
    handler.m_Normals = handler.m_Normals[:, :3]
    second, _ = proof.render_control(
        np, mesh, handler, row, camera, textures, props, [], [0, 0, 0, 0]
    )
    assert first == second
    assert set(first[3::4]) == {0, 255}


def test_local_export_does_not_overwrite_previous_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    image = pytest.importorskip("PIL.Image")
    game = tmp_path / "synthetic-game"
    game.mkdir()
    save = game / "save.es3"
    save.write_bytes(b"untouched synthetic save")
    monkeypatch.chdir(game)
    monkeypatch.setattr(proof, "__file__", str(tmp_path / "tools/artwork_color_proof.py"))
    rgba = bytes([1, 2, 3, 255]) * (proof.SIDE**2)
    first = proof.save_local_comparison(image, rgba, rgba)
    before = (tmp_path / first / "health-pack-small-candidate.png").read_bytes()
    second = proof.save_local_comparison(image, rgba, rgba)
    assert first != second
    assert (tmp_path / first / "health-pack-small-candidate.png").read_bytes() == before
    assert save.read_bytes() == b"untouched synthetic save"
    assert list(game.iterdir()) == [save]
