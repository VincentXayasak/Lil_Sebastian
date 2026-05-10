#!/usr/bin/env python3
"""
End-to-end pipeline (does not modify scripts/ implementations):

  1. scripts/convert_uploaded_videos_to_m4a.py
     uploaded_videos_mp4/ -> uploaded_videos_m4a/

  2. scripts/transcribe_uploaded_videos.py
     -> one JSONL (default: automate/.work/pipeline_transcripts.jsonl).
     Each line is a single object: {"<video_filename>.m4a": "<transcript text>"}
     (same shape as the transcribe script). One file for all episodes; fast to
     scan or load into a dict for lookup.

  3. scripts/transcripts_to_podcast_scripts.py --input <that JSONL>
     -> podcast_scripts/<stem>_podcast_scripts.jsonl

  4. podcast_creator.build_podcast for each scripted episode -> podcast_output/*.mp3

Requires: ffmpeg, .env keys as each step needs (ElevenLabs, Gemini), Python deps from repo.
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import sys
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _safe_mp3_slug(key: str) -> str:
    stem = Path(key).stem if key else "episode"
    slug = "".join(
        [
            (
                ch.lower()
                if ch.isalnum()
                else ("_" if ch in (" ", "-", "_") else "")
            )
            for ch in stem
        ]
    ).strip("_")
    slug = re.sub(r"_+", "_", slug)
    return (slug[:80] if slug else "episode")


def run_step(label: str, argv: list[str], *, cwd: Path, dry_run: bool) -> int:
    q = [shlex.quote(a) for a in argv]
    print(f"\n=== {label} ===\n{' '.join(q)}\n", flush=True)
    if dry_run:
        return 0
    r = subprocess.run(argv, cwd=cwd)
    return r.returncode


def build_mp3s_from_podcast_jsonl(
    podcast_jsonl: Path,
    podcast_output: Path,
    *,
    dry_run: bool,
    build_extra: list[str],
) -> int:
    if not podcast_jsonl.is_file():
        if dry_run:
            print(
                "--dry-run: MP3 step skipped until Gemini writes "
                f"{podcast_jsonl}",
                flush=True,
            )
            return 0
        print(f"No podcast scripts JSONL (run Gemini step first): {podcast_jsonl}", file=sys.stderr)
        return 1

    work_scripts_dir = podcast_jsonl.parent.parent / ".work" / "build_scripts"
    if not dry_run:
        work_scripts_dir.mkdir(parents=True, exist_ok=True)

    py = sys.executable
    lines = [ln.strip() for ln in podcast_jsonl.read_text(encoding="utf-8").splitlines() if ln.strip()]
    if not lines:
        if dry_run:
            print(f"--dry-run: podcast scripts JSONL is empty: {podcast_jsonl}", flush=True)
            return 0
        print(f"Empty JSONL: {podcast_jsonl}", file=sys.stderr)
        return 1

    podcast_output = podcast_output.resolve()
    if not dry_run:
        podcast_output.mkdir(parents=True, exist_ok=True)

    failures = 0
    for line_no, line in enumerate(lines, start=1):
        obj = json.loads(line)
        if not isinstance(obj, dict) or len(obj) != 1:
            print(f"Line {line_no}: skip (expected one key per object).", file=sys.stderr)
            failures += 1
            continue
        (video_key, script_text) = next(iter(obj.items()))
        if not isinstance(script_text, str) or not script_text.strip():
            print(f"Line {line_no}: skip (empty script for {video_key!r}).", file=sys.stderr)
            failures += 1
            continue

        stem_key = _safe_mp3_slug(video_key)
        script_path = work_scripts_dir / f"{stem_key}_for_tts.txt"
        if not dry_run:
            script_path.write_text(script_text, encoding="utf-8")
        out_mp3 = podcast_output / f"{stem_key}.mp3"

        argv = [
            py,
            "-m",
            "podcast_creator.build_podcast",
            "--script",
            str(script_path),
            "--out",
            str(out_mp3),
        ] + build_extra

        print(f"\n=== build podcast MP3 ({video_key}) -> {out_mp3.name} ===", flush=True)
        if dry_run:
            print(" ".join(shlex.quote(a) for a in argv), flush=True)
            continue

        r = subprocess.run(argv, cwd=_repo_root())
        if r.returncode != 0:
            failures += 1

    return 1 if failures else 0


def main() -> int:
    root = _repo_root()
    work = root / "automate" / ".work"
    work.mkdir(parents=True, exist_ok=True)

    default_mp4 = root / "uploaded_videos_mp4"
    default_m4a = root / "uploaded_videos_m4a"
    default_transcripts_jsonl = work / "pipeline_transcripts.jsonl"
    default_podcast_scripts_dir = root / "podcast_scripts"
    default_podcast_output = root / "podcast_output"

    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument(
        "--input-mp4-dir",
        type=Path,
        default=default_mp4,
        help=f"Videos folder (default: {default_mp4})",
    )
    p.add_argument(
        "--m4a-dir",
        type=Path,
        default=default_m4a,
        help=f"M4A output folder (default: {default_m4a})",
    )
    p.add_argument(
        "--transcripts-jsonl",
        type=Path,
        default=default_transcripts_jsonl,
        help=(
            f"Transcripts JSONL: one object per line {{video_filename: transcript}} "
            f"(default: {default_transcripts_jsonl})"
        ),
    )
    p.add_argument(
        "--podcast-scripts-dir",
        type=Path,
        default=default_podcast_scripts_dir,
        help=f"Gemini podcast_scripts output folder (default: {default_podcast_scripts_dir})",
    )
    p.add_argument(
        "--podcast-output-dir",
        type=Path,
        default=default_podcast_output,
        help=f"Final MP3 folder (default: {default_podcast_output})",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Print commands only; no ffmpeg, APIs, or file writes.",
    )
    p.add_argument(
        "--skip-convert",
        action="store_true",
        help="Skip ffmpeg step (reuse existing uploaded_videos_m4a).",
    )
    p.add_argument(
        "--skip-transcribe",
        action="store_true",
        help="Skip ElevenLabs STT (reuse existing --transcripts-jsonl).",
    )
    p.add_argument(
        "--skip-gemini",
        action="store_true",
        help="Skip scripts/transcripts_to_podcast_scripts.py.",
    )
    p.add_argument(
        "--skip-mp3",
        action="store_true",
        help="Skip podcast_creator.build_podcast.",
    )
    p.add_argument(
        "--convert-force",
        action="store_true",
        help="Pass --force to convert_uploaded_videos_to_m4a.py.",
    )
    p.add_argument(
        "--transcribe-resume",
        action="store_true",
        help="Pass --resume to transcribe_uploaded_videos.py.",
    )

    passthrough = p.add_argument_group("Forwarded (single string appended to subprocess)")
    passthrough.add_argument(
        "--convert-extra",
        default="",
        help='Extra args for convert script, quoted (e.g. \'--bitrate 64k\').',
    )
    passthrough.add_argument(
        "--transcribe-extra",
        default="",
        help='Extra args for transcribe script (e.g. \'--model scribe_v2\').',
    )
    passthrough.add_argument(
        "--gemini-extra",
        default="",
        help='Extra args for transcripts_to_podcast_scripts.py (e.g. \'--timeout 900\').',
    )
    passthrough.add_argument(
        "--mp3-extra",
        default="",
        help='Extra args for podcast_creator.build_podcast (e.g. \'--tts-model eleven_flash_v2_5\').',
    )

    args = p.parse_args()

    def split_extra(s: str) -> list[str]:
        return shlex.split(s) if s.strip() else []

    py = sys.executable

    code = 0

    if not args.skip_convert:
        cargv = [
            py,
            str(root / "scripts" / "convert_uploaded_videos_to_m4a.py"),
            "--input-dir",
            str(args.input_mp4_dir.resolve()),
            "--output-dir",
            str(args.m4a_dir.resolve()),
        ]
        if args.convert_force:
            cargv.append("--force")
        if args.dry_run:
            cargv.append("--dry-run")
        cargv.extend(split_extra(args.convert_extra))
        code = run_step("convert videos -> m4a", cargv, cwd=root, dry_run=args.dry_run)
        if code != 0:
            return code

    if not args.skip_transcribe:
        targv = [
            py,
            str(root / "scripts" / "transcribe_uploaded_videos.py"),
            "--input-dir",
            str(args.m4a_dir.resolve()),
            "--output",
            str(args.transcripts_jsonl.resolve()),
        ]
        if args.transcribe_resume:
            targv.append("--resume")
        if args.dry_run:
            targv.append("--dry-run")
        targv.extend(split_extra(args.transcribe_extra))
        code = run_step("transcribe m4a -> JSONL", targv, cwd=root, dry_run=args.dry_run)
        if code != 0:
            return code

        if not args.dry_run:
            print(
                "Transcripts JSONL (one object per line, key = video filename): "
                f"{args.transcripts_jsonl.resolve()}",
                flush=True,
            )

    jsonl_input = args.transcripts_jsonl.resolve()
    podcast_scripts_dir = args.podcast_scripts_dir.resolve()
    gemini_out_jsonl = podcast_scripts_dir / f"{jsonl_input.stem}_podcast_scripts.jsonl"

    if not args.skip_gemini:
        gargv = [
            py,
            str(root / "scripts" / "transcripts_to_podcast_scripts.py"),
            "--input",
            str(jsonl_input),
            "--output-dir",
            str(podcast_scripts_dir),
        ]
        gargv.extend(split_extra(args.gemini_extra))
        code = run_step("Gemini: transcripts -> podcast scripts", gargv, cwd=root, dry_run=args.dry_run)
        if code != 0:
            return code

    if not args.skip_mp3:
        code = build_mp3s_from_podcast_jsonl(
            gemini_out_jsonl,
            args.podcast_output_dir,
            dry_run=args.dry_run,
            build_extra=split_extra(args.mp3_extra),
        )
        if code != 0:
            return code

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
