"""ElevenLabs TTS, optional sound effects and music, with permission-aware fallbacks."""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

from elevenlabs import ElevenLabs
from elevenlabs.core.api_error import ApiError
from pydub import AudioSegment

from fallback_audio import placeholder_sfx, synthetic_bgm

OUTPUT_FORMAT = "mp3_44100_128"


def _iter_to_bytes(chunks: Any) -> bytes:
    return b"".join(chunks)


def _bytes_to_segment(data: bytes) -> AudioSegment:
    return AudioSegment.from_file(io.BytesIO(data), format="mp3")


def _api_error_detail(err: ApiError) -> str:
    body = err.body
    if isinstance(body, dict):
        d = body.get("detail")
        if isinstance(d, dict):
            return str(d.get("message") or d.get("status") or body)
    return str(body)


def _missing_permission(err: ApiError, token: str) -> bool:
    if err.status_code not in (401, 403):
        return False
    detail = _api_error_detail(err).lower()
    return "missing_permissions" in detail or token.lower() in detail


def load_voice_map(path: Path) -> dict[str, str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("voice map JSON must be an object")
    out: dict[str, str] = {}
    for k, v in data.items():
        if isinstance(k, str) and isinstance(v, str):
            out[k.upper() if k != "__default__" else "__default__"] = v
    if "__default__" not in out:
        raise ValueError('voice map must include "__default__" voice id')
    return out


def resolve_voice_id(speaker: str, voice_map: dict[str, str]) -> str:
    return voice_map.get(speaker.upper(), voice_map["__default__"])


def tts_to_segment(
    client: ElevenLabs,
    *,
    text: str,
    voice_id: str,
    model_id: str,
    previous_text: str | None,
    next_text: str | None,
) -> AudioSegment:
    kwargs: dict[str, Any] = {
        "voice_id": voice_id,
        "text": text,
        "model_id": model_id,
        "output_format": OUTPUT_FORMAT,
    }
    if previous_text is not None:
        kwargs["previous_text"] = previous_text
    if next_text is not None:
        kwargs["next_text"] = next_text
    raw = _iter_to_bytes(client.text_to_speech.convert(**kwargs))
    return _bytes_to_segment(raw)


def sfx_to_segment(
    client: ElevenLabs,
    *,
    description: str,
    duration_seconds: float,
) -> tuple[AudioSegment, str]:
    """
    Returns (audio, source) where source is 'api' or 'placeholder'.
    """
    try:
        raw = _iter_to_bytes(
            client.text_to_sound_effects.convert(
                text=description,
                duration_seconds=duration_seconds,
                output_format=OUTPUT_FORMAT,
            )
        )
        return _bytes_to_segment(raw), "api"
    except ApiError as e:
        if _missing_permission(e, "sound_generation"):
            return placeholder_sfx(int(duration_seconds * 1000)), "placeholder"
        raise RuntimeError(_api_error_detail(e)) from e


def music_to_segment(
    client: ElevenLabs,
    *,
    prompt: str,
    length_ms: int,
) -> tuple[AudioSegment | None, str]:
    """
    Returns (audio or None, source) where source is 'api', 'failed', or skipped upstream.
    """
    try:
        raw = _iter_to_bytes(
            client.music.compose(
                prompt=prompt,
                music_length_ms=max(3000, min(length_ms, 300_000)),
                force_instrumental=True,
                output_format=OUTPUT_FORMAT,
            )
        )
        return _bytes_to_segment(raw), "api"
    except ApiError as e:
        if _missing_permission(e, "music_generation"):
            return None, "missing_permission"
        raise RuntimeError(_api_error_detail(e)) from e


def load_music_file(path: Path) -> AudioSegment:
    suffix = path.suffix.lower().lstrip(".")
    if suffix == "mp3":
        return AudioSegment.from_file(path, format="mp3")
    if suffix in ("wav", "wave"):
        return AudioSegment.from_file(path, format="wav")
    if suffix == "m4a":
        return AudioSegment.from_file(path, format="m4a")
    return AudioSegment.from_file(path)


def loop_to_length(track: AudioSegment, length_ms: int) -> AudioSegment:
    if len(track) <= 0:
        return AudioSegment.silent(duration=length_ms)
    out = AudioSegment.empty()
    while len(out) < length_ms:
        out += track
    return out[:length_ms]


def build_background_music(
    client: ElevenLabs | None,
    *,
    target_length_ms: int,
    music_file: Path | None,
    music_prompt: str,
    use_music_api: bool,
) -> tuple[AudioSegment, str]:
    """
    Prefer user-supplied file, then Music API, then synthetic pad.
    Returns (segment, source_label).
    """
    if music_file is not None and music_file.is_file():
        tr = load_music_file(music_file)
        return loop_to_length(tr, target_length_ms), f"file:{music_file.name}"

    if client is not None and use_music_api:
        seg, src = music_to_segment(
            client, prompt=music_prompt, length_ms=target_length_ms
        )
        if seg is not None and src == "api":
            # API may return slightly short/long; normalize
            if len(seg) < target_length_ms:
                seg = loop_to_length(seg, target_length_ms)
            else:
                seg = seg[:target_length_ms]
            return seg, "elevenlabs_music"

    pad = synthetic_bgm(target_length_ms)
    return pad, "synthetic_pad"
