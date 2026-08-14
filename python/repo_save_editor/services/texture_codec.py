"""Bounded BC1/BC3 decoding and PNG encoding for local installed-game visuals."""

from __future__ import annotations

import binascii
import struct
import zlib
from typing import Final

MAX_TEXTURE_DIMENSION: Final = 2048
MAX_RGBA_BYTES: Final = MAX_TEXTURE_DIMENSION * MAX_TEXTURE_DIMENSION * 4
MAX_PNG_BYTES: Final = 2 * 1024 * 1024
PNG_SIGNATURE: Final = b"\x89PNG\r\n\x1a\n"


class TextureDecodeError(ValueError):
    """Malformed, unsupported, or over-budget texture data."""


def top_mip_size(width: int, height: int, texture_format: str) -> int:
    """Return the top-level BC-compressed byte size without trusting stream size."""
    _validate_dimensions(width, height)
    block_bytes = {"DXT1": 8, "DXT5": 16}.get(texture_format)
    if block_bytes is None:
        raise TextureDecodeError(f"Unsupported texture format {texture_format!r}.")
    blocks_wide = (width + 3) // 4
    blocks_high = (height + 3) // 4
    return blocks_wide * blocks_high * block_bytes


def decode_texture_rgba(
    data: bytes,
    width: int,
    height: int,
    texture_format: str,
) -> bytes:
    """Decode only the top mip of an evidence-backed DXT1/DXT5 payload."""
    required = top_mip_size(width, height, texture_format)
    if len(data) < required:
        raise TextureDecodeError("Compressed texture data is truncated.")
    rgba_size = width * height * 4
    if rgba_size > MAX_RGBA_BYTES:
        raise TextureDecodeError("Decoded texture allocation exceeds the safe bound.")
    output = bytearray(rgba_size)
    block_bytes = 8 if texture_format == "DXT1" else 16
    cursor = 0
    for block_y in range((height + 3) // 4):
        for block_x in range((width + 3) // 4):
            block = data[cursor : cursor + block_bytes]
            cursor += block_bytes
            pixels = (
                _decode_dxt1_block(block) if texture_format == "DXT1" else _decode_dxt5_block(block)
            )
            for local_y in range(4):
                y = block_y * 4 + local_y
                if y >= height:
                    continue
                for local_x in range(4):
                    x = block_x * 4 + local_x
                    if x >= width:
                        continue
                    source = (local_y * 4 + local_x) * 4
                    target = (y * width + x) * 4
                    output[target : target + 4] = pixels[source : source + 4]
    return bytes(output)


def flip_rgba_vertical(rgba: bytes, width: int, height: int) -> bytes:
    """Convert Unity bottom-up texture rows into top-down image row order."""
    _validate_dimensions(width, height)
    expected = width * height * 4
    if len(rgba) != expected or expected > MAX_RGBA_BYTES:
        raise TextureDecodeError("RGBA pixel buffer does not match the bounded dimensions.")
    stride = width * 4
    output = bytearray(expected)
    for source_y in range(height):
        source = source_y * stride
        target = (height - 1 - source_y) * stride
        output[target : target + stride] = rgba[source : source + stride]
    return bytes(output)


def crop_rgba(
    rgba: bytes,
    width: int,
    height: int,
    left: int,
    top: int,
    right: int,
    bottom: int,
) -> tuple[bytes, int, int]:
    """Return a bounded top-left-origin RGBA crop with exclusive right/bottom edges."""
    _validate_dimensions(width, height)
    expected = width * height * 4
    if len(rgba) != expected or expected > MAX_RGBA_BYTES:
        raise TextureDecodeError("RGBA pixel buffer does not match the bounded dimensions.")
    if (
        not all(isinstance(value, int) for value in (left, top, right, bottom))
        or left < 0
        or top < 0
        or right > width
        or bottom > height
        or left >= right
        or top >= bottom
    ):
        raise TextureDecodeError("RGBA crop is outside the bounded image.")

    cropped_width = right - left
    cropped_height = bottom - top
    cropped_size = cropped_width * cropped_height * 4
    if cropped_size > MAX_RGBA_BYTES:
        raise TextureDecodeError("RGBA crop exceeds the decoded allocation bound.")

    source_stride = width * 4
    row_bytes = cropped_width * 4
    output = bytearray(cropped_size)
    for row in range(cropped_height):
        source = (top + row) * source_stride + left * 4
        target = row * row_bytes
        output[target : target + row_bytes] = rgba[source : source + row_bytes]
    return bytes(output), cropped_width, cropped_height


def encode_rgba_png(rgba: bytes, width: int, height: int) -> bytes:
    """Encode bounded 8-bit RGBA pixels using only the Python standard library."""
    _validate_dimensions(width, height)
    expected = width * height * 4
    if len(rgba) != expected or expected > MAX_RGBA_BYTES:
        raise TextureDecodeError("RGBA pixel buffer does not match the bounded dimensions.")
    stride = width * 4
    fixed_bytes = len(PNG_SIGNATURE) + (12 + 13) + 12 + 12
    compressed_limit = MAX_PNG_BYTES - fixed_bytes
    compressor = zlib.compressobj(level=6)
    compressed_parts: list[bytes] = []
    compressed_size = 0
    for offset in range(0, expected, stride):
        part = compressor.compress(b"\0" + rgba[offset : offset + stride])
        compressed_size += len(part)
        if compressed_size > compressed_limit:
            raise TextureDecodeError("Encoded PNG exceeds the local icon protocol bound.")
        if part:
            compressed_parts.append(part)
    tail = compressor.flush()
    compressed_size += len(tail)
    if compressed_size > compressed_limit:
        raise TextureDecodeError("Encoded PNG exceeds the local icon protocol bound.")
    compressed_parts.append(tail)
    compressed = b"".join(compressed_parts)
    return b"".join(
        (
            PNG_SIGNATURE,
            _png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)),
            _png_chunk(b"IDAT", compressed),
            _png_chunk(b"IEND", b""),
        )
    )


def _validate_dimensions(width: int, height: int) -> None:
    if not isinstance(width, int) or not isinstance(height, int):
        raise TextureDecodeError("Texture dimensions must be integers.")
    if width <= 0 or height <= 0 or width > MAX_TEXTURE_DIMENSION or height > MAX_TEXTURE_DIMENSION:
        raise TextureDecodeError("Texture dimensions are outside the safe bound.")
    if width * height > MAX_RGBA_BYTES // 4:
        raise TextureDecodeError("Texture dimensions exceed the decoded allocation bound.")


def _rgb565(value: int) -> tuple[int, int, int]:
    r = (value >> 11) & 0x1F
    g = (value >> 5) & 0x3F
    b = value & 0x1F
    return (
        (r * 255 + 15) // 31,
        (g * 255 + 31) // 63,
        (b * 255 + 15) // 31,
    )


def _mix_rgb(
    first: tuple[int, int, int],
    second: tuple[int, int, int],
    first_weight: int,
    second_weight: int,
    divisor: int,
) -> tuple[int, int, int]:
    return tuple(
        (first[index] * first_weight + second[index] * second_weight) // divisor
        for index in range(3)
    )  # type: ignore[return-value]


def _color_palette(
    color0: int, color1: int, *, allow_transparent: bool
) -> tuple[tuple[int, int, int, int], ...]:
    rgb0 = _rgb565(color0)
    rgb1 = _rgb565(color1)
    if color0 > color1 or not allow_transparent:
        rgb2 = _mix_rgb(rgb0, rgb1, 2, 1, 3)
        rgb3 = _mix_rgb(rgb0, rgb1, 1, 2, 3)
        return ((*rgb0, 255), (*rgb1, 255), (*rgb2, 255), (*rgb3, 255))
    rgb2 = _mix_rgb(rgb0, rgb1, 1, 1, 2)
    return ((*rgb0, 255), (*rgb1, 255), (*rgb2, 255), (0, 0, 0, 0))


def _decode_color_block(block: bytes, *, allow_transparent: bool) -> bytes:
    if len(block) != 8:
        raise TextureDecodeError("DXT color block is truncated.")
    color0, color1, selectors = struct.unpack("<HHI", block)
    palette = _color_palette(color0, color1, allow_transparent=allow_transparent)
    output = bytearray(64)
    for index in range(16):
        pixel = palette[(selectors >> (2 * index)) & 0x3]
        output[index * 4 : index * 4 + 4] = bytes(pixel)
    return bytes(output)


def _decode_dxt1_block(block: bytes) -> bytes:
    return _decode_color_block(block, allow_transparent=True)


def _alpha_palette(alpha0: int, alpha1: int) -> tuple[int, ...]:
    if alpha0 > alpha1:
        return (
            alpha0,
            alpha1,
            (6 * alpha0 + alpha1) // 7,
            (5 * alpha0 + 2 * alpha1) // 7,
            (4 * alpha0 + 3 * alpha1) // 7,
            (3 * alpha0 + 4 * alpha1) // 7,
            (2 * alpha0 + 5 * alpha1) // 7,
            (alpha0 + 6 * alpha1) // 7,
        )
    return (
        alpha0,
        alpha1,
        (4 * alpha0 + alpha1) // 5,
        (3 * alpha0 + 2 * alpha1) // 5,
        (2 * alpha0 + 3 * alpha1) // 5,
        (alpha0 + 4 * alpha1) // 5,
        0,
        255,
    )


def _decode_dxt5_block(block: bytes) -> bytes:
    if len(block) != 16:
        raise TextureDecodeError("DXT5 block is truncated.")
    alpha0 = block[0]
    alpha1 = block[1]
    alpha_selectors = int.from_bytes(block[2:8], "little")
    alphas = _alpha_palette(alpha0, alpha1)
    colors = bytearray(_decode_color_block(block[8:], allow_transparent=False))
    for index in range(16):
        colors[index * 4 + 3] = alphas[(alpha_selectors >> (3 * index)) & 0x7]
    return bytes(colors)


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    crc = binascii.crc32(kind)
    crc = binascii.crc32(payload, crc) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", crc)


__all__ = [
    "MAX_PNG_BYTES",
    "MAX_TEXTURE_DIMENSION",
    "TextureDecodeError",
    "crop_rgba",
    "decode_texture_rgba",
    "encode_rgba_png",
    "flip_rgba_vertical",
    "top_mip_size",
]
