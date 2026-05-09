#!/usr/bin/env python3
"""
Transcribe every .m4a in uploaded_videos_m4a/ (see convert_uploaded_videos_to_m4a.py)
via ElevenLabs Speech-to-Text and append JSONL rows (filename -> full transcript).

Mono AAC uploads are small; ElevenLabs still enforces a per-file size limit (see docs).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from elevenlabs import ElevenLabs
from elevenlabs.types.multichannel_speech_to_text_response_model import (
    MultichannelSpeechToTextResponseModel,
)
from elevenlabs.types.speech_to_text_chunk_response_model import (
    SpeechToTextChunkResponseModel,
)
from elevenlabs.types.speech_to_text_webhook_response_model import (
    SpeechToTextWebhookResponseModel,
)

AUDIO_EXTENSIONS = {".m4a"}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _extract_transcript(resp: object) -> str:
    if isinstance(resp, SpeechToTextWebhookResponseModel):
        raise RuntimeError(
            "API returned a webhook acknowledgement; disable webhook async mode "
            "or handle transcription_id polling separately."
        )
    if isinstance(resp, SpeechToTextChunkResponseModel):
        return resp.text.strip()
    if isinstance(resp, MultichannelSpeechToTextResponseModel):
        parts = []
        for i, t in enumerate(resp.transcripts):
            label = getattr(t, "channel_index", None)
            prefix = (
                f"[channel {label}]\n" if label is not None else f"[channel {i}]\n"
            )
            parts.append(prefix + t.text.strip())
        return "\n\n".join(parts).strip()
    raise TypeError(f"Unexpected speech-to-text response type: {type(resp)!r}")


def _load_done_keys(jsonl_path: Path) -> set[str]:
    if not jsonl_path.is_file():
        return set()
    done: set[str] = set()
    with jsonl_path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if not isinstance(obj, dict) or len(obj) != 1:
                raise ValueError(
                    f"Expected each JSONL row to be a single {{filename: transcript}} object; "
                    f"problem line: {line[:120]}..."
                )
            done.update(obj.keys())
    return done


def _iter_m4a(directory: Path) -> list[Path]:
    paths = []
    for p in sorted(directory.iterdir()):
        if p.is_file() and p.suffix.lower() in AUDIO_EXTENSIONS:
            paths.append(p)
    return paths


def main() -> int:
    load_dotenv(_repo_root() / ".env")

    default_in = _repo_root() / "uploaded_videos_m4a"
    default_out = _repo_root() / "transcripts" / "uploaded_video_transcripts.jsonl"

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=default_in,
        help=f"Folder containing .m4a files (default: {default_in})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=default_out,
        help=f"Append-only JSONL path (default: {default_out})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List .m4a files that would be sent; do not call the API.",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip files whose basename already appears as the key on a JSONL line.",
    )
    parser.add_argument(
        "--model",
        default="scribe_v2",
        help='ElevenLabs STT model (default: "scribe_v2")',
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=7200,
        help="HTTP timeout per file (large uploads Transcription may take minutes).",
    )

    args = parser.parse_args()
    input_dir: Path = args.input_dir.expanduser().resolve()
    output_path: Path = args.output.expanduser().resolve()

    if not input_dir.is_dir():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 2

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not args.dry_run and not api_key:
        print(
            "Set ELEVENLABS_API_KEY in .env or the environment.",
            file=sys.stderr,
        )
        return 2

    videos = _iter_m4a(input_dir)
    if not videos:
        print(f"No .m4a files in {input_dir} (run scripts/convert_uploaded_videos_to_m4a.py first).")
        return 0

    already = _load_done_keys(output_path) if args.resume else set()

    pending = []
    for p in videos:
        name = p.name
        if name in already:
            continue
        pending.append(p)

    print(f"Found {len(videos)} .m4a file(s); {len(pending)} pending after resume filter.")

    if args.dry_run:
        for p in pending:
            print(f"Would transcribe: {p.name}")
        return 0

    output_path.parent.mkdir(parents=True, exist_ok=True)
    client = ElevenLabs(api_key=api_key)
    opts = {"timeout_in_seconds": args.timeout_seconds}

    failures = 0
    with output_path.open("a", encoding="utf-8") as out:
        for path in pending:
            print(f"Uploading / transcribing: {path.name} ...", flush=True)
            try:
                with path.open("rb") as fh:
                    result = client.speech_to_text.convert(
                        model_id=args.model,
                        file=fh,
                        tag_audio_events=True,
                        request_options=opts,
                    )
                transcript = _extract_transcript(result)
                row = {path.name: transcript}
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
                out.flush()
                print(f"  OK — wrote transcript ({len(transcript)} chars)")
            except Exception as e:
                failures += 1
                print(f"  FAILED: {path.name}: {e}", file=sys.stderr)

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
