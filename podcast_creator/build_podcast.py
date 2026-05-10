#!/usr/bin/env python3
"""
Build a mixed podcast MP3 from a plain-text script (see podcast_scripts/script1.txt).

Uses ElevenLabs for multi-voice TTS. Scripts from transcripts_to_podcast_scripts.py
use exactly four dialogue roles: NARRATOR, BEN, LESLIE, PATRICK (see voice_map.json).
Sound effects and background music use the
ElevenLabs APIs when your API key has those scopes; otherwise local fallbacks apply
(quiet noise for SFX, simple pad or PODCAST_BACKGROUND_MUSIC file for BGM).

Examples:
  python podcast_creator/build_podcast.py --script podcast_scripts/script1.txt
  python -m podcast_creator.build_podcast --script podcast_scripts/script1.txt

Requires: ffmpeg (for pydub MP3), ELEVENLABS_API_KEY in .env or environment.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

# Allow `python podcast_creator/build_podcast.py` (sibling imports).
_SCRIPT_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _SCRIPT_DIR.parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import elevenlabs_audio as el
from dotenv import load_dotenv
from elevenlabs import ElevenLabs
from pydub import AudioSegment

import script_parser as sp


def _slug(s: str) -> str:
    out = []
    for ch in s.strip().lower():
        if ch.isalnum():
            out.append(ch)
        elif ch in (" ", "-", "_"):
            out.append("_")
    slug = "".join(out).strip("_")[:80]
    return slug or "episode"


def _dialogue_neighbor_texts(
    segments: tuple[sp.Segment, ...], index: int
) -> tuple[str | None, str | None]:
    prev_text: str | None = None
    for j in range(index - 1, -1, -1):
        if segments[j].kind == "dialogue":
            prev_text = segments[j].text
            break
    next_text: str | None = None
    for j in range(index + 1, len(segments)):
        if segments[j].kind == "dialogue":
            next_text = segments[j].text
            break
    return prev_text, next_text


def build(
    *,
    script_path: Path,
    out_path: Path,
    voice_map_path: Path,
    line_gap_ms: int,
    sfx_duration_s: float,
    bgm_gain_db: float,
    tts_model: str,
    music_prompt: str,
    music_file: Path | None,
    use_music_api: bool,
    api_delay_s: float,
) -> None:
    load_dotenv(_REPO_ROOT / ".env")
    parsed = sp.parse_script_path(script_path)
    voice_map = el.load_voice_map(voice_map_path)

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        print("Missing ELEVENLABS_API_KEY (.env or environment).", file=sys.stderr)
        raise SystemExit(1)

    client = ElevenLabs(api_key=api_key)
    timeline: list[AudioSegment] = []
    prev_voice: str | None = None

    for i, seg in enumerate(parsed.segments):
        if seg.kind == "dialogue":
            assert seg.speaker is not None
            vid = el.resolve_voice_id(seg.speaker, voice_map)
            prev_t, next_t = _dialogue_neighbor_texts(parsed.segments, i)
            clip = el.tts_to_segment(
                client,
                text=seg.text,
                voice_id=vid,
                model_id=tts_model,
                previous_text=prev_t,
                next_text=next_t,
            )
            if prev_voice is not None and line_gap_ms > 0:
                timeline.append(AudioSegment.silent(duration=line_gap_ms))
            timeline.append(clip)
            prev_voice = seg.speaker
            if api_delay_s > 0:
                time.sleep(api_delay_s)
        else:
            clip, sfx_src = el.sfx_to_segment(
                client,
                description=seg.text,
                duration_seconds=sfx_duration_s,
            )
            if sfx_src == "placeholder":
                print(
                    f"SFX placeholder used (add sound_generation to API key for: "
                    f"{seg.text!r})",
                    file=sys.stderr,
                )
            if timeline and line_gap_ms > 0:
                timeline.append(AudioSegment.silent(duration=line_gap_ms // 2))
            timeline.append(clip)
            prev_voice = None
            if api_delay_s > 0:
                time.sleep(api_delay_s)

    voice_bus = timeline[0]
    for part in timeline[1:]:
        voice_bus += part

    target_ms = len(voice_bus)
    bg, bg_src = el.build_background_music(
        client,
        target_length_ms=target_ms,
        music_file=music_file,
        music_prompt=music_prompt,
        use_music_api=use_music_api,
    )
    print(f"Background: {bg_src}", file=sys.stderr)
    if bg_src == "synthetic_pad":
        print(
            "Using synthetic underscore (set PODCAST_BACKGROUND_MUSIC to an audio file, "
            "enable music_generation on your key, or pass --music-file).",
            file=sys.stderr,
        )

    bg = bg.apply_gain(bgm_gain_db)
    if len(bg) < target_ms:
        bg = el.loop_to_length(bg, target_ms)
    else:
        bg = bg[:target_ms]

    final = bg.overlay(voice_bus, position=0)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    final.export(out_path, format="mp3", bitrate="192k")
    print(f"Wrote {out_path} ({len(final) / 1000:.1f}s)", file=sys.stderr)


def main() -> int:
    default_script = _REPO_ROOT / "podcast_scripts" / "script1.txt"
    default_out = _REPO_ROOT / "podcast_output" / "episode.mp3"
    default_voice = _SCRIPT_DIR / "voice_map.json"

    p = argparse.ArgumentParser(
        description="Mix multi-voice ElevenLabs TTS with SFX and background music."
    )
    p.add_argument("--script", type=Path, default=default_script, help="Input script path")
    p.add_argument("--out", type=Path, default=None, help="Output MP3 path")
    p.add_argument("--voice-map", type=Path, default=default_voice, help="JSON speaker→voice_id")
    p.add_argument("--line-gap-ms", type=int, default=280, help="Silence between lines")
    p.add_argument(
        "--sfx-duration",
        type=float,
        default=2.5,
        help="Seconds for each ElevenLabs text-to-sound-effects call",
    )
    p.add_argument(
        "--bgm-gain-db",
        type=float,
        default=-20.0,
        help="Attenuation for background music under dialogue",
    )
    p.add_argument(
        "--tts-model",
        default="eleven_multilingual_v2",
        help="ElevenLabs model_id for speech (e.g. eleven_flash_v2_5)",
    )
    p.add_argument(
        "--music-prompt",
        default="Light playful sitcom underscore, bass and soft drums, instrumental",
        help="Prompt when using ElevenLabs Music API",
    )
    p.add_argument(
        "--music-file",
        type=Path,
        default=None,
        help="Optional local MP3/WAV/M4A to loop under the episode (overrides API)",
    )
    p.add_argument(
        "--no-music-api",
        action="store_false",
        dest="use_music_api",
        default=True,
        help="Skip ElevenLabs Music API attempts when no --music-file",
    )
    p.add_argument(
        "--api-delay",
        type=float,
        default=0.15,
        help="Sleep between API calls to reduce rate limits",
    )
    args = p.parse_args()

    out = args.out
    if out is None:
        try:
            parsed = sp.parse_script_path(args.script)
            slug = _slug(parsed.episode_title or args.script.stem)
        except Exception:
            slug = _slug(args.script.stem)
        out = _REPO_ROOT / "podcast_output" / f"{slug}.mp3"

    music_file = args.music_file
    if music_file is None:
        env_path = os.environ.get("PODCAST_BACKGROUND_MUSIC")
        if env_path:
            music_file = Path(env_path)

    build(
        script_path=args.script,
        out_path=out,
        voice_map_path=args.voice_map,
        line_gap_ms=args.line_gap_ms,
        sfx_duration_s=args.sfx_duration,
        bgm_gain_db=args.bgm_gain_db,
        tts_model=args.tts_model,
        music_prompt=args.music_prompt,
        music_file=music_file,
        use_music_api=args.use_music_api,
        api_delay_s=args.api_delay,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
