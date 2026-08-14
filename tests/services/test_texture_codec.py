from __future__ import annotations

import random
import struct

import pytest

from repo_save_editor.services.texture_codec import (
    TextureDecodeError,
    crop_rgba,
    decode_texture_rgba,
    encode_rgba_png,
    flip_rgba_vertical,
    top_mip_size,
)


def _selectors2(values: list[int]) -> int:
    return sum((value & 0x3) << (2 * index) for index, value in enumerate(values))


def _selectors3(values: list[int]) -> bytes:
    packed = sum((value & 0x7) << (3 * index) for index, value in enumerate(values))
    return packed.to_bytes(6, "little")


def _dxt1(color0: int, color1: int, selectors: list[int] | None = None) -> bytes:
    values = selectors or [0] * 16
    return struct.pack("<HHI", color0, color1, _selectors2(values))


def _dxt5(
    alpha0: int,
    alpha1: int,
    alpha_selectors: list[int],
    *,
    color0: int = 0xFFFF,
    color1: int = 0x0000,
    color_selectors: list[int] | None = None,
) -> bytes:
    return (
        bytes((alpha0, alpha1))
        + _selectors3(alpha_selectors)
        + _dxt1(color0, color1, color_selectors)
    )


def _pixel(rgba: bytes, width: int, x: int, y: int) -> tuple[int, int, int, int]:
    offset = (y * width + x) * 4
    return tuple(rgba[offset : offset + 4])  # type: ignore[return-value]


def test_dxt1_four_color_interpolation_and_selector_ordering() -> None:
    block = _dxt1(0xF800, 0x001F, [0, 1, 2, 3] + [0] * 12)
    rgba = decode_texture_rgba(block, 4, 4, "DXT1")

    assert _pixel(rgba, 4, 0, 0) == (255, 0, 0, 255)
    assert _pixel(rgba, 4, 1, 0) == (0, 0, 255, 255)
    assert _pixel(rgba, 4, 2, 0) == (170, 0, 85, 255)
    assert _pixel(rgba, 4, 3, 0) == (85, 0, 170, 255)


def test_dxt1_three_color_mode_uses_transparent_selector() -> None:
    block = _dxt1(0x0000, 0xFFFF, [0, 1, 2, 3] + [0] * 12)
    rgba = decode_texture_rgba(block, 4, 4, "DXT1")

    assert _pixel(rgba, 4, 0, 0) == (0, 0, 0, 255)
    assert _pixel(rgba, 4, 1, 0) == (255, 255, 255, 255)
    assert _pixel(rgba, 4, 2, 0) == (127, 127, 127, 255)
    assert _pixel(rgba, 4, 3, 0) == (0, 0, 0, 0)


def test_dxt5_alpha_interpolation_when_alpha0_greater() -> None:
    block = _dxt5(210, 70, list(range(8)) + [0] * 8)
    rgba = decode_texture_rgba(block, 4, 4, "DXT5")

    assert [_pixel(rgba, 4, x, 0)[3] for x in range(4)] == [210, 70, 190, 170]
    assert [_pixel(rgba, 4, x, 1)[3] for x in range(4)] == [150, 130, 110, 90]


def test_dxt5_alpha_interpolation_when_alpha0_not_greater() -> None:
    block = _dxt5(10, 110, list(range(8)) + [0] * 8)
    rgba = decode_texture_rgba(block, 4, 4, "DXT5")

    assert [_pixel(rgba, 4, x, 0)[3] for x in range(4)] == [10, 110, 30, 50]
    assert [_pixel(rgba, 4, x, 1)[3] for x in range(4)] == [70, 90, 0, 255]


def test_dxt5_color_block_always_uses_four_color_mode() -> None:
    block = _dxt5(
        255,
        0,
        [0] * 16,
        color0=0x0000,
        color1=0xFFFF,
        color_selectors=[3] + [0] * 15,
    )
    rgba = decode_texture_rgba(block, 4, 4, "DXT5")

    assert _pixel(rgba, 4, 0, 0) == (170, 170, 170, 255)


def test_multi_block_image_uses_each_block_in_raster_order() -> None:
    red = _dxt1(0xF800, 0x0000)
    green = _dxt1(0x07E0, 0x0000)
    rgba = decode_texture_rgba(red + green, 8, 4, "DXT1")

    assert _pixel(rgba, 8, 0, 0) == (255, 0, 0, 255)
    assert _pixel(rgba, 8, 7, 3) == (0, 255, 0, 255)


def test_edge_blocks_are_cropped_to_non_multiple_of_four_dimensions() -> None:
    red = _dxt1(0xF800, 0x0000)
    blue = _dxt1(0x001F, 0x0000)
    rgba = decode_texture_rgba(red + blue, 5, 3, "DXT1")

    assert len(rgba) == 5 * 3 * 4
    assert _pixel(rgba, 5, 3, 2) == (255, 0, 0, 255)
    assert _pixel(rgba, 5, 4, 2) == (0, 0, 255, 255)


def test_truncated_compressed_block_is_rejected() -> None:
    with pytest.raises(TextureDecodeError, match="truncated"):
        decode_texture_rgba(b"\0" * 7, 4, 4, "DXT1")


def test_oversized_dimensions_are_rejected_before_allocation() -> None:
    with pytest.raises(TextureDecodeError, match="safe bound"):
        top_mip_size(2049, 1, "DXT1")


def test_unsupported_format_is_rejected() -> None:
    with pytest.raises(TextureDecodeError, match="Unsupported"):
        top_mip_size(4, 4, "RGBA32")


def test_vertical_flip_reverses_rows_without_changing_columns() -> None:
    top = bytes((255, 0, 0, 255, 0, 255, 0, 255))
    bottom = bytes((0, 0, 255, 255, 255, 255, 0, 255))

    flipped = flip_rgba_vertical(top + bottom, 2, 2)

    assert flipped == bottom + top


def test_vertical_flip_rejects_mismatched_buffer() -> None:
    with pytest.raises(TextureDecodeError, match="does not match"):
        flip_rgba_vertical(b"\0" * 15, 2, 2)


def test_png_encoder_emits_bounded_rgba_png() -> None:
    png = encode_rgba_png(bytes((255, 0, 0, 255)) * 6, 3, 2)

    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    assert struct.unpack_from(">II", png, 16) == (3, 2)


def test_png_encoder_rejects_encoded_output_over_protocol_bound() -> None:
    rgba = random.Random(0).randbytes(768 * 768 * 4)

    with pytest.raises(TextureDecodeError, match="protocol bound"):
        encode_rgba_png(rgba, 768, 768)


def test_crop_rgba_uses_exclusive_bounds_and_preserves_row_order() -> None:
    rgba = bytes(channel for pixel in range(12) for channel in (pixel, 0, 0, 255))

    cropped, width, height = crop_rgba(rgba, 4, 3, 1, 1, 4, 3)

    assert (width, height) == (3, 2)
    assert [_pixel(cropped, width, x, y)[0] for y in range(height) for x in range(width)] == [
        5,
        6,
        7,
        9,
        10,
        11,
    ]


def test_crop_rgba_rejects_empty_or_out_of_bounds_regions() -> None:
    rgba = bytes((0, 0, 0, 255)) * 16

    with pytest.raises(TextureDecodeError, match="crop"):
        crop_rgba(rgba, 4, 4, 2, 1, 2, 3)
    with pytest.raises(TextureDecodeError, match="crop"):
        crop_rgba(rgba, 4, 4, 0, 0, 5, 4)
