from __future__ import annotations

import base64
import pathlib
import re
import zlib
from dataclasses import dataclass

SIGNATURE = bytes.fromhex("05278d")
PACK_PREFIX_NIBBLE = 0xA
BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


@dataclass
class DecodedConfig:
    expected_size: int
    signature: bytes
    packed_bytes: bytes
    xml_bytes: bytes


def decode_xml_text(xml_bytes: bytes) -> str:
    encodings = ("utf-16", "utf-16le", "utf-8-sig", "utf-8")
    last_error: Exception | None = None
    for encoding in encodings:
        try:
            return xml_bytes.decode(encoding)
        except Exception as exc:
            last_error = exc
    raise ValueError("XML 파일 인코딩을 해석할 수 없습니다.") from last_error


def validate_supported_xml(xml_bytes: bytes) -> None:
    text = decode_xml_text(xml_bytes)
    text = text.strip("\ufeff\x00\r\n\t ")
    text = re.sub(r"^<\?xml[^>]*>\s*", "", text, flags=re.IGNORECASE)
    text = text.strip("\ufeff\x00\r\n\t ")

    starts_with_options = re.match(r"^<options(?:\s[^>]*)?>", text, flags=re.IGNORECASE) is not None
    ends_with_options = re.search(r"</options>\s*$", text, flags=re.IGNORECASE) is not None
    starts_with_ui = re.match(r"^<ui(?:\s[^>]*)?>", text, flags=re.IGNORECASE) is not None
    ends_with_ui = re.search(r"</ui>\s*$", text, flags=re.IGNORECASE) is not None

    if not ((starts_with_options and ends_with_options) or (starts_with_ui and ends_with_ui)):
        raise ValueError(
            "올바른 형식의 XML 파일이 아닙니다. <options>...</options> 또는 <ui>...</ui> 형식이어야 합니다."
        )


def normalize_xml_bytes(xml_bytes: bytes) -> bytes:
    text = decode_xml_text(xml_bytes)
    text = text.lstrip("\ufeff")

    if "\r\n" in text:
        newline = "\r\n"
    else:
        newline = "\n"

    option_match = re.search(r"</options>", text, flags=re.IGNORECASE)
    ui_match = re.search(r"</ui>", text, flags=re.IGNORECASE)
    closing_match = option_match or ui_match

    if closing_match is not None:
        text = text[: closing_match.end()]
        text = text.rstrip("\r\n\t \x00") + newline + "\x00"

    return text.encode("utf-16le")


def _try_decode_payload(payload: str) -> bytes:
    padding = "=" * ((4 - len(payload) % 4) % 4)
    return base64.b64decode(payload + padding)


def _decode_with_trailing_trim(payload: str, expected_size: int) -> tuple[bytes, bytes, int]:
    attempts: list[tuple[str, object]] = []

    for trim_count in range(0, min(8, len(payload))):
        candidate = payload[:-trim_count] if trim_count else payload
        try:
            packed_bytes = _try_decode_payload(candidate)
            raw_deflate = unpack_shifted_deflate(packed_bytes, header_bytes=len(SIGNATURE), bit_shift=4)
            xml_bytes = zlib.decompress(raw_deflate, -15)
            if len(xml_bytes) != expected_size:
                attempts.append((f"trim={trim_count}", f"size={len(xml_bytes)}"))
                continue
            return packed_bytes, xml_bytes, trim_count
        except Exception as exc:
            attempts.append((f"trim={trim_count}", exc))

    last_error = attempts[-1][1] if attempts else "unknown error"
    raise ValueError(
        "Base64 본문을 해석하지 못했습니다. 파일 끝부분에 불필요한 문자가 붙었거나 일부가 손상되었을 수 있습니다. "
        f"payload 길이={len(payload)}, 끝부분={payload[-16:]!r}, 마지막 오류={last_error}"
    )


def unpack_shifted_deflate(data: bytes, header_bytes: int = 3, bit_shift: int = 4) -> bytes:
    body = data[header_bytes:]
    if len(body) < 2:
        raise ValueError("decoded payload is too short")
    return bytes(
        (((body[index] << bit_shift) & 0xFF) | (body[index + 1] >> (8 - bit_shift)))
        for index in range(len(body) - 1)
    )


def pack_shifted_deflate(raw_deflate: bytes) -> bytes:
    if not raw_deflate:
        return b""

    packed = bytearray(len(raw_deflate) + 1)
    packed[0] = (PACK_PREFIX_NIBBLE << 4) | (raw_deflate[0] >> 4)
    for index in range(1, len(raw_deflate)):
        packed[index] = ((raw_deflate[index - 1] & 0x0F) << 4) | (raw_deflate[index] >> 4)
    packed[-1] = (raw_deflate[-1] & 0x0F) << 4
    return bytes(packed[:-1])


def encode_game_base64(data: bytes, trailing_pad_nibble: int = 0x0F) -> str:
    encoded = base64.b64encode(data).decode("ascii")
    if encoded.endswith("=="):
        trimmed = encoded[:-2]
        last_value = BASE64_ALPHABET.index(trimmed[-1])
        return trimmed[:-1] + BASE64_ALPHABET[last_value | (trailing_pad_nibble & 0x0F)]
    if encoded.endswith("="):
        trimmed = encoded[:-1]
        last_value = BASE64_ALPHABET.index(trimmed[-1])
        return trimmed[:-1] + BASE64_ALPHABET[last_value | 0x03]
    return encoded


def decode_config_bytes(encoded_file_bytes: bytes) -> DecodedConfig:
    text = encoded_file_bytes.decode("utf-16")
    expected_size_text, payload = text.split(";", 1)
    expected_size = int(expected_size_text)
    try:
        packed_bytes, xml_bytes, _trim_count = _decode_with_trailing_trim(payload, expected_size)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return DecodedConfig(
        expected_size=expected_size,
        signature=packed_bytes[: len(SIGNATURE)],
        packed_bytes=packed_bytes,
        xml_bytes=xml_bytes,
    )


def encode_config_bytes(xml_bytes: bytes, signature: bytes = SIGNATURE, compress_level: int = 9) -> bytes:
    compressor = zlib.compressobj(level=compress_level, wbits=-15)
    raw_deflate = compressor.compress(xml_bytes) + compressor.flush()
    adler32_bytes = (zlib.adler32(xml_bytes) & 0xFFFFFFFF).to_bytes(4, "big")
    packed_source = raw_deflate + adler32_bytes
    packed = signature + pack_shifted_deflate(packed_source)
    payload = encode_game_base64(packed, trailing_pad_nibble=packed_source[-1] & 0x0F)
    text = f"{len(xml_bytes)};{payload}"
    return text.encode("utf-16")


def get_backup_target(path: pathlib.Path) -> pathlib.Path | None:
    if not path.exists():
        return None

    backup_path = path.with_name(path.name + ".bak")
    while backup_path.exists():
        backup_path = backup_path.with_name(backup_path.name + ".bak")
    return backup_path


def backup_existing_file(path: pathlib.Path) -> pathlib.Path | None:
    backup_path = get_backup_target(path)
    if backup_path is None:
        return None
    path.rename(backup_path)
    return backup_path


def decode_file(input_path: pathlib.Path, output_path: pathlib.Path | None = None) -> pathlib.Path:
    decoded = decode_config_bytes(input_path.read_bytes())
    output = output_path or default_decode_output(input_path)
    backup_existing_file(output)
    output.write_bytes(decoded.xml_bytes)
    return output


def encode_file(input_path: pathlib.Path, output_path: pathlib.Path | None = None) -> pathlib.Path:
    input_bytes = input_path.read_bytes()
    validate_supported_xml(input_bytes)
    xml_bytes = normalize_xml_bytes(input_bytes)
    encoded = encode_config_bytes(xml_bytes)
    output = output_path or default_encode_output(input_path)
    backup_existing_file(output)
    output.write_bytes(encoded)
    return output


def default_decode_output(input_path: pathlib.Path) -> pathlib.Path:
    if input_path.suffix.lower() == ".xml":
        return input_path.with_name(f"{input_path.stem}.decoded.xml")
    return input_path.with_name(f"{input_path.name}.decoded.xml")


def default_encode_output(input_path: pathlib.Path) -> pathlib.Path:
    name = input_path.name
    if name.endswith(".decoded.xml"):
        return input_path.with_name(name.replace(".decoded.xml", ".xml"))
    if input_path.suffix.lower() == ".xml":
        return input_path.with_name(f"{input_path.stem}.encoded.xml")
    return input_path.with_name(f"{input_path.name}.encoded.xml")
