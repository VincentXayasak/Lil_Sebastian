#!/usr/bin/env python3
"""
Strip audio from videos in uploaded_videos/ and write mono AAC .m4a files to
uploaded_videos_m4a/ (smaller uploads for ElevenLabs STT).

Requires ffmpeg on PATH.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpeg", ".mpg"}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _iter_videos(directory: Path) -> list[Path]:
    out = []
    for p in sorted(directory.iterdir()):
        if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS:
            out.append(p)
    return out


def _run_ffmpeg(
    ffmpeg: str,
    src: Path,
    dst: Path,
    bitrate: str,
) -> None:
    cmd = [
        ffmpeg,
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        str(src),
        "-vn",
        "-ac",
        "1",
        "-c:a",
        "aac",
        "-b:a",
        bitrate,
        "-movflags",
        "+faststart",
        str(dst),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def main() -> int:
    default_in = _repo_root() / "uploaded_videos"
    default_out = _repo_root() / "uploaded_videos_m4a"

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=default_in,
        help=f"Folder containing source videos (default: {default_in})",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=default_out,
        help=f"Folder for .m4a outputs (default: {default_out})",
    )
    parser.add_argument(
        "--bitrate",
        default="96k",
        help='AAC bitrate (default: "96k", mono speech)',
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-encode even if the .m4a already exists.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List conversions only; do not run ffmpeg.",
    )

    args = parser.parse_args()
    input_dir = args.input_dir.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()

    if not input_dir.is_dir():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 2

    ffmpeg_exe = shutil.which("ffmpeg")
    if not args.dry_run and ffmpeg_exe is None:
        print(
            "ffmpeg not found on PATH. Install ffmpeg (e.g. brew install ffmpeg).",
            file=sys.stderr,
        )
        return 2
    ffmpeg_exe = ffmpeg_exe or "ffmpeg"

    videos = _iter_videos(input_dir)
    if not videos:
        print(f"No videos with extensions {sorted(VIDEO_EXTENSIONS)} in {input_dir}")
        return 0

    output_dir.mkdir(parents=True, exist_ok=True)

    todo = []
    for src in videos:
        dst = output_dir / (src.stem + ".m4a")
        if dst.is_file() and not args.force:
            continue
        todo.append((src, dst))

    print(
        f"Found {len(videos)} video(s); "
        f"{len(todo)} to encode ({len(videos) - len(todo)} skipped, use --force to redo)."
    )

    if args.dry_run:
        for src, dst in todo:
            print(f"Would write: {dst.name}  <--  {src.name}")
        return 0

    failures = 0
    for src, dst in todo:
        print(f"Encoding: {src.name} -> {dst.name} ...", flush=True)
        try:
            _run_ffmpeg(ffmpeg_exe, src, dst, args.bitrate)
            print(f"  OK: {dst}")
        except subprocess.CalledProcessError as e:
            failures += 1
            err = (e.stderr or e.stdout or "").strip()
            print(f"  FAILED: {src.name}: {err or e}", file=sys.stderr)

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
