#!/usr/bin/env python3
"""
Claims one queued `episodes` row (`status = processing`, no `storage_path`), downloads its
video from Storage (`uploads` bucket), runs `automate/run_pipeline.py` in isolated work dirs,
uploads the resulting MP3 to `podcasts`, then sets `storage_path` + `status = ready`.

Uses the Supabase **service role** key (never ship this to browsers). Configure in `.env`:

  SUPABASE_URL=https://<ref>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=eyJ...
  SUPABASE_UPLOADS_BUCKET=uploads
  SUPABASE_PODCASTS_BUCKET=podcasts

Run once locally (pick first queued row):

  python automate/process_supabase_queue.py --once

Poll every 120s:

  python automate/process_supabase_queue.py --poll-seconds 120

Requires ffmpeg and the same API keys `run_pipeline.py` needs (.env ElevenLabs, Gemini, …).
"""

from __future__ import annotations

import argparse
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _episode_id_str(raw: Any) -> str:
    """Normalize Postgres `id` (bigint, uuid string, etc.) for paths and API filters."""
    if raw is None:
        raise ValueError("episode id is None")
    if isinstance(raw, bool):
        raise ValueError("invalid episode id")
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            raise ValueError("episode id is empty")
        return s
    return str(raw)


def _work_dir(episode_id: str) -> Path:
    return _repo_root() / "automate" / ".work" / "queue" / episode_id


def _connect() -> tuple[Client, str, str]:
    load_dotenv(_repo_root() / ".env")
    url = (os.environ.get("SUPABASE_URL") or "").strip()
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        print(
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env "
            "(project Settings → API → service_role).",
            file=sys.stderr,
        )
        raise SystemExit(2)
    uploads = (os.environ.get("SUPABASE_UPLOADS_BUCKET") or "uploads").strip()
    podcasts = (os.environ.get("SUPABASE_PODCASTS_BUCKET") or "podcasts").strip()
    return create_client(url, key), uploads, podcasts


def _pick_next_row(sb: Client) -> dict[str, Any] | None:
    resp = sb.table("episodes").select("*").eq("status", "processing").order("id").execute()
    rows = resp.data or []
    for row in rows:
        if not (row.get("storage_path") or "").strip():
            return row
    return None


def _claim_row(sb: Client, episode_id: str) -> dict[str, Any] | None:
    resp = (
        sb.table("episodes")
        .update({"status": "pipeline_running"})
        .eq("id", episode_id)
        .eq("status", "processing")
        .select()
        .execute()
    )
    data = resp.data or []
    return data[0] if data else None


def _finalize_done(sb: Client, episode_id: str, storage_path: str) -> None:
    sb.table("episodes").update(
        {"status": "ready", "storage_path": storage_path}
    ).eq("id", episode_id).execute()


def _finalize_failed(sb: Client, episode_id: str) -> None:
    sb.table("episodes").update({"status": "failed"}).eq("id", episode_id).execute()


def _storage_object_path(uploads_bucket: str, sb: Client, rel_path: str) -> bytes:
    resp = sb.storage.from_(uploads_bucket).download(rel_path)
    if resp is None:
        raise RuntimeError(f"download returned empty body for {rel_path!r}")
    return resp if isinstance(resp, (bytes, bytearray)) else bytes(resp)


def _upload_podcast(podcasts_bucket: str, sb: Client, storage_path: str, body: bytes) -> None:
    sb.storage.from_(podcasts_bucket).upload(
        path=storage_path,
        file=body,
        file_options={"content-type": "audio/mpeg", "upsert": "true"},
    )


def _invoke_local_pipeline(local_root: Path, work: Path) -> int:
    mp4_dir = work / "mp4"
    m4a_dir = work / "m4a"
    transcripts = work / "transcripts.jsonl"
    podcast_scripts_dir = work / "podcast_scripts"
    podcast_output = work / "podcast_output"

    argv = [
        sys.executable,
        str(local_root / "automate" / "run_pipeline.py"),
        "--input-mp4-dir",
        str(mp4_dir),
        "--m4a-dir",
        str(m4a_dir),
        "--transcripts-jsonl",
        str(transcripts),
        "--podcast-scripts-dir",
        str(podcast_scripts_dir),
        "--podcast-output-dir",
        str(podcast_output),
        "--convert-force",
    ]

    print("\n=== run_pipeline.py ===\n" + " ".join(shlex.quote(a) for a in argv) + "\n", flush=True)
    r = subprocess.run(argv, cwd=local_root)
    return int(r.returncode)


def process_one_sb(
    sb: Client, uploads_bucket: str, podcasts_bucket: str, *, dry_run: bool
) -> str:
    root = _repo_root()
    row = _pick_next_row(sb)
    if not row:
        print("No queued episodes (processing + empty storage_path).", flush=True)
        return "idle"

    ep_id_raw = row.get("id")
    try:
        episode_id = _episode_id_str(ep_id_raw)
    except ValueError as e:
        print(f"Row has bad id: {e}", file=sys.stderr)
        return "idle"

    source = (row.get("source_video_storage_path") or "").strip()
    if not source.startswith("incoming/"):
        print(
            f"Episode {episode_id}: invalid source_video_storage_path {source!r}; marking failed.",
            file=sys.stderr,
        )
        if not dry_run:
            _finalize_failed(sb, episode_id)
        return "processed"

    print(f"Picked episode id={episode_id} source={source!r}", flush=True)

    if dry_run:
        print("[dry-run] skip claim / download / pipeline / upload.")
        return "processed"

    claimed = _claim_row(sb, episode_id)
    if not claimed:
        print("Lost claim race another worker claimed this episode.", flush=True)
        return "idle"

    work = _work_dir(episode_id)
    shutil.rmtree(work, ignore_errors=True)
    mp4_dir = work / "mp4"
    mp4_dir.mkdir(parents=True, exist_ok=True)

    safe_leaf = Path(source).name
    safe_leaf = re.sub(r"[^a-zA-Z0-9._-]+", "_", safe_leaf).strip("_") or "video.mp4"
    local_mp4 = mp4_dir / safe_leaf

    try:
        blob = _storage_object_path(uploads_bucket, sb, source)
        local_mp4.write_bytes(blob)

        rc = _invoke_local_pipeline(root, work)
        if rc != 0:
            raise RuntimeError(f"run_pipeline exited {rc}")

        out_dir = work / "podcast_output"
        mp3s = sorted(out_dir.glob("*.mp3"))
        if len(mp3s) != 1:
            raise RuntimeError(
                f"expected exactly one MP3 under {out_dir}; got {[p.name for p in mp3s]}"
            )
        mp3_body = mp3s[0].read_bytes()

        dest = f"published/{episode_id}.mp3"
        _upload_podcast(podcasts_bucket, sb, dest, mp3_body)
        _finalize_done(sb, episode_id, dest)

        print(f"Episode {episode_id} ready · podcasts/{dest}", flush=True)
    except Exception as e:
        print(f"Episode {episode_id} failed: {e}", file=sys.stderr)
        _finalize_failed(sb, episode_id)
        outcome = "failed"
    else:
        outcome = "ok"
    finally:
        shutil.rmtree(work, ignore_errors=True)

    return outcome


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument(
        "--once",
        action="store_true",
        help="Exit after one pass (successful work or idle).",
    )
    p.add_argument(
        "--poll-seconds",
        type=float,
        default=60,
        metavar="SEC",
        help="Sleep between scans when idling (ignored with --once). Default: 60.",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Pick next episode and print; no claim, download, APIs, or DB updates.",
    )
    p.add_argument(
        "--recover-stuck",
        action="store_true",
        help="Reset rows stuck in pipeline_running (e.g. worker crash) back to processing.",
    )
    args = p.parse_args()

    if args.dry_run:
        sb, uploads_bucket, podcasts_bucket = _connect()
        process_one_sb(sb, uploads_bucket, podcasts_bucket, dry_run=True)
        return 0

    try:
        sb_recover, _, _ = _connect()
    except SystemExit:
        raise
    if args.recover_stuck:
        sb_recover.table("episodes").update({"status": "processing"}).eq(
            "status", "pipeline_running"
        ).execute()
        print("--recover-stuck: pipeline_running → processing.", flush=True)

    while True:
        try:
            sb, uploads_bucket, podcasts_bucket = _connect()
        except SystemExit:
            raise

        try:
            outcome = process_one_sb(sb, uploads_bucket, podcasts_bucket, dry_run=False)
        except Exception as e:
            print(f"Worker error: {e}", file=sys.stderr)
            if args.once:
                return 1
            time.sleep(max(5.0, args.poll_seconds))
            continue

        if args.once:
            return 0 if outcome != "failed" else 1

        if outcome == "idle":
            time.sleep(max(5.0, args.poll_seconds))
        elif outcome == "failed":
            time.sleep(5.0)
        else:
            time.sleep(1.0)


if __name__ == "__main__":
    raise SystemExit(main())
