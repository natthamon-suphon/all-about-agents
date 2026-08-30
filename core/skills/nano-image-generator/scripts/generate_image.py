#!/usr/bin/env python3
"""Safely generate one raster image with an available Gemini image model."""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
from pathlib import Path
import sys
import tempfile
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


API_ROOT = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_MODEL = "gemini-3.1-flash-image"
MAX_JSON_BYTES = 24 * 1024 * 1024
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_BASE64_CHARS = ((MAX_IMAGE_BYTES + 2) // 3) * 4
ASPECT_RATIOS = ("1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9")
IMAGE_SIZES = ("512", "1K", "2K", "4K")


class SafeError(RuntimeError):
    """An error safe to show without including response bodies or credentials."""


def get_api_key() -> str:
    """Return the documented environment key without printing or persisting it."""
    key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not key or not key.strip():
        raise SafeError("GOOGLE_API_KEY or GEMINI_API_KEY is required")
    return key.strip()


def require_prerequisites() -> None:
    if sys.version_info < (3, 10):
        raise SafeError("Python 3.10 or newer is required")


def require_paid_authority(authorized: bool) -> None:
    if not authorized:
        raise SafeError("generation requires explicit --authorize-paid-request authority")


def safe_http_message(status: int, _response_body: str | bytes | None = None) -> str:
    """Return bounded diagnostics while intentionally ignoring the response body."""
    return f"Gemini API request failed with HTTP {status}; response body redacted"


def build_request(method: str, path: str, api_key: str, payload: dict[str, Any] | None = None) -> Request:
    if not api_key or not api_key.strip():
        raise SafeError("API key is required")
    if not path.startswith("/") or "?" in path or "#" in path:
        raise SafeError("invalid Gemini API path")
    headers = {"Accept": "application/json", "x-goog-api-key": api_key}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return Request(f"{API_ROOT}{path}", data=data, headers=headers, method=method)


def _read_limited(response: Any) -> bytes:
    data = response.read(MAX_JSON_BYTES + 1)
    if len(data) > MAX_JSON_BYTES:
        raise SafeError("Gemini API response exceeded the safe size limit")
    return data


def request_json(
    method: str,
    path: str,
    api_key: str,
    payload: dict[str, Any] | None = None,
    opener: Callable[..., Any] = urlopen,
) -> dict[str, Any]:
    request = build_request(method, path, api_key, payload)
    try:
        with opener(request, timeout=180) as response:
            raw = _read_limited(response)
    except HTTPError as exc:
        raise SafeError(safe_http_message(exc.code)) from None
    except (URLError, TimeoutError, OSError):
        raise SafeError("Gemini API request failed due to a redacted network or TLS error") from None
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise SafeError("Gemini API returned invalid JSON; response body redacted") from None
    if not isinstance(decoded, dict):
        raise SafeError("Gemini API returned an unexpected JSON shape")
    return decoded


def validate_model(model: str, api_key: str, opener: Callable[..., Any] = urlopen) -> dict[str, Any]:
    if not model or not model.strip():
        raise SafeError("a non-empty model id is required")
    model_id = model.strip().removeprefix("models/")
    metadata = request_json("GET", f"/models/{quote(model_id, safe='-._')}", api_key, opener=opener)
    methods = metadata.get("supportedGenerationMethods")
    if not isinstance(methods, list) or "generateContent" not in methods:
        raise SafeError("selected model is unavailable or does not support generateContent")
    return metadata


def generation_payload(prompt: str, aspect: str | None, size: str | None) -> dict[str, Any]:
    if not prompt or not prompt.strip():
        raise SafeError("a non-empty prompt is required")
    image: dict[str, str] = {}
    if aspect:
        image["aspectRatio"] = aspect
    if size:
        image["imageSize"] = size
    config: dict[str, Any] = {"responseModalities": ["IMAGE"]}
    if image:
        config["responseFormat"] = {"image": image}
    return {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": config,
    }


def detect_image_format(image_bytes: bytes) -> tuple[str, str]:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", ".png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", ".jpg"
    if len(image_bytes) >= 12 and image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        return "image/webp", ".webp"
    if image_bytes.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif", ".gif"
    raise SafeError("decoded response contains unknown image bytes")


def decode_image_data(encoded: str, reported_mime: str) -> tuple[bytes, str, str]:
    if not isinstance(encoded, str) or not encoded or len(encoded) > MAX_BASE64_CHARS:
        raise SafeError("image base64 is empty or exceeds the safe size limit")
    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise SafeError("image data is not strict base64") from None
    if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
        raise SafeError("decoded image is empty or exceeds the safe size limit")
    actual_mime, extension = detect_image_format(image_bytes)
    if reported_mime != actual_mime:
        raise SafeError("reported image MIME type does not match decoded bytes")
    return image_bytes, actual_mime, extension


def extract_image(result: dict[str, Any]) -> tuple[bytes, str, str]:
    candidates = result.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise SafeError("Gemini API returned no image candidate; response body redacted")
    images: list[tuple[bytes, str, str]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        content = candidate.get("content")
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            continue
        for part in parts:
            if not isinstance(part, dict) or part.get("thought") is True:
                continue
            inline = part.get("inlineData")
            if not isinstance(inline, dict):
                continue
            encoded = inline.get("data")
            mime = inline.get("mimeType")
            if not isinstance(encoded, str) or not isinstance(mime, str):
                raise SafeError("image response is missing base64 data or MIME type")
            images.append(decode_image_data(encoded, mime))
    if not images:
        raise SafeError("Gemini API returned no final image data; response body redacted")
    return images[-1]


def resolve_output(requested: str, extension: str) -> Path:
    if not requested or not requested.strip():
        raise SafeError("an explicit output path is required")
    path = Path(requested).expanduser()
    if path.name in ("", ".", ".."):
        raise SafeError("output path must identify a file")
    if path.suffix:
        if path.suffix.lower() != extension:
            raise SafeError(f"output extension must match detected {extension} format")
        return path
    return path.with_suffix(extension)


def write_atomic(path: Path, data: bytes, overwrite: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, delete=False) as handle:
            temporary = handle.name
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if overwrite:
            os.replace(temporary, path)
            temporary = None
        else:
            try:
                os.link(temporary, path)
            except FileExistsError:
                raise SafeError("output already exists; use --overwrite only with explicit authority") from None
            except OSError:
                if path.exists():
                    raise SafeError("output already exists; use --overwrite only with explicit authority") from None
                raise SafeError("filesystem cannot create the output safely without overwrite") from None
            os.unlink(temporary)
            temporary = None
    finally:
        if temporary:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass


def generate_image(model: str, prompt: str, aspect: str | None, size: str | None, api_key: str) -> tuple[bytes, str, str]:
    model_id = model.strip().removeprefix("models/")
    result = request_json(
        "POST",
        f"/models/{quote(model_id, safe='-._')}:generateContent",
        api_key,
        generation_payload(prompt, aspect, size),
    )
    return extract_image(result)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate one validated raster image through the Gemini API")
    parser.add_argument("prompt", nargs="?", help="image prompt; never printed by this runtime")
    parser.add_argument("--output", "-o", help="explicit output file path")
    parser.add_argument("--model", default=os.environ.get("GEMINI_IMAGE_MODEL", DEFAULT_MODEL))
    parser.add_argument("--aspect", choices=ASPECT_RATIOS)
    parser.add_argument("--size", choices=IMAGE_SIZES)
    parser.add_argument("--check", action="store_true", help="validate prerequisites/model only; no generation")
    parser.add_argument("--authorize-paid-request", action="store_true", help="explicitly authorize one generation request")
    parser.add_argument("--overwrite", action="store_true", help="replace the exact output path")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        require_prerequisites()
        api_key = get_api_key()
        if args.check:
            if args.prompt or args.output or args.authorize_paid_request or args.overwrite:
                raise SafeError("--check cannot be combined with generation or output arguments")
            validate_model(args.model, api_key)
            print(f"Model available for generateContent: {args.model}")
            return 0
        require_paid_authority(args.authorize_paid_request)
        if not args.prompt or not args.output:
            raise SafeError("prompt and --output are required for generation")
        validate_model(args.model, api_key)
        image_bytes, mime, extension = generate_image(args.model, args.prompt, args.aspect, args.size, api_key)
        output = resolve_output(args.output, extension)
        write_atomic(output, image_bytes, args.overwrite)
        print(output)
        print(f"Saved validated {mime} image", file=sys.stderr)
        return 0
    except SafeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
