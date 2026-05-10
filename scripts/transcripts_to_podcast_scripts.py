#!/usr/bin/env python3
"""
Read transcripts JSONL (one object per line: {video_filename: transcript text}),
send each transcript to Gemini (gemini-3.1-flash-lite), and append podcast scripts
to a JSONL file under podcast_scripts/ (same key shape: {video_filename: script}),
plus a human-readable .txt with one section per episode.

Output is ElevenLabs-friendly plain text with fixed cast labels NARRATOR, BEN, LESLIE,
PATRICK (four TTS voices) plus SFX lines (quiet, simple sounds for transitions and light comedy).

Expects GEMINI_API_KEY or GOOGLE_API_KEY in the environment (see .env via python-dotenv).
"""

from __future__ import annotations

import argparse
import json
import os
import random
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import certifi
from dotenv import load_dotenv

GEMINI_MODEL = "gemini-3.1-flash-lite"
GENERATE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)

PROMPT_TEMPLATE = """You are an expert comedy podcast producer and sitcom-style writer. Turn this city/town/government meeting transcript into a funny, sharp episode for everyday listeners — accurate on facts, wild on jokes — not a dry recap.

TRANSCRIPT SCALE (honor this)
- Estimated source length: about {estimated_minutes} minutes of spoken meeting (~{transcript_word_count} words). Script length must stay proportional: short meeting, tighter episode; long meeting, much longer episode.
- Cover ALL significant agenda items, debates, votes, and decisions. Do not skip or vague-out important content for brevity. Do not collapse multiple major topics into one throwaway line.
- Every named official, vote outcome, dollar figure, date, and key debate beat from the transcript should appear somewhere in the episode (hosts can quote or paraphrase clearly).
- If public comment appears in the transcript, include a dedicated stretch where the hosts address what residents raised.
- Include a NUMBERS / decisions recap beat near the end where Ben, Leslie, and Patrick make the key figures and outcomes unmistakable.
- Close with a "what to watch for next" beat and a short sign-off.

FIXED CAST — EXACTLY FOUR SPEAKING ROLES (ElevenLabs: one voice ID each)
Use ONLY these dialogue labels, no others: NARRATOR, BEN, LESLIE, PATRICK.
- NARRATOR: cold open hook, segment teasers, act turns, and outro stinger. Punchy, meta, joke-heavy. Does not join host banter mid-scene; use for transitions and framing only.
- BEN and LESLIE: co-hosts. Warm, curious, rapid back-and-forth; explain jargon in plain language; carry most of the factual retelling through banter.
- PATRICK: recurring guest. Comic wild card — asks blunt or naive questions, spots absurdities, derails politely, plays foil. Not a third host with equal authority; he mostly points, asks, and reacts.

All real meeting roles (chair, staff, commissioners, public) are discussed BY these four only — never add extra SPEAKER_LABELs for real officials, and never simulate extra voices or list-style pseudo speakers.

COMEDY AND SITCOM VOICE
- Laugh-out-loud jokes, misunderstandings, callbacks, B-plots, and escalating absurdity grounded in real transcript beats.
- Setup then punchline; tags where they land. Running gags welcome if they pay off.

SOUND EFFECTS AND TRANSITIONS (SFX lines — keep them easy to generate and QUIET)
- Use SFX lines for light comic punctuation and gentle transitions. Humor comes from timing and dialogue; SFX should sit UNDER speech like TV mix, never steal the scene.
- Every SFX description MUST read as soft and low-level. Start with words like "quiet", "subtle", "gentle", "soft", or "very low volume" and keep the whole line short (one clear idea). Example: SFX: quiet soft paper rustle on desk in small room
- Prefer SIMPLE real-world sounds a generator can do reliably: light paper shuffle or rustle, quiet room tone or HVAC hum, soft chair creak, gentle pen tap, brief soft wood gavel tap, distant hallway footsteps, quiet water sip, subtle low air whoosh. Silly is OK only if it stays gentle (e.g. "quiet soft boing spring toy once").
- AVOID hard or unreliable prompts: record scratch, vinyl scratch, complex layered Hollywood stings, long chains of adjectives, cartoon wah-wah or brass stabs unless described as very quiet and brief, crowds cheering, explosions, sirens, trademarked or iconic stingers, anything "huge" or "massive" or "ear-splitting", multi-sound mashups ("rimshot then crash then laugh track"), and vague lines like "funny sound" or "comedy noise".
- One acoustic event per SFX line. Optional: add "one second" or "two seconds" for length when helpful. Spread several SFX through a long script; do not pack them back-to-back.
- Each SFX is exactly one line, no dialogue: SFX: <description as above>

The script will be fed to ElevenLabs text-to-speech (one API call per line, or stitched segments). Output MUST follow these rules strictly:

LINE DISCIPLINE (CRITICAL — parsers reject anything else)
- After the two metadata lines and one blank line, EVERY following line MUST begin with exactly one of these five prefixes and a colon: NARRATOR:  BEN:  LESLIE:  PATRICK:  SFX:
- FORBIDDEN: bare dialogue lines with no label; continuation paragraphs; lines that start with One:, Two:, Three:, First:, Second:, bullet numbers, or any "Word:" pattern where Word is not one of the five allowed prefixes above.
- FORBIDDEN: extra roles or announcers (no HOST:, MODERATOR:, CLERK:, COMMISSIONER:, CHAIR:, CROWD:, etc.).
- Lists and recaps belong INSIDE normal speech on labeled lines. Example — wrong: a LESLIE line then unlabeled "Two: ...". Right: one or more LESLIE: lines where she speaks the recap in full sentences, or BEN/LESLIE/PATRICK trade short recap lines, each line starting with BEN:, LESLIE:, or PATRICK:.
- If you need a numbered recap, say "first," "second," in flowing prose after a single SPEAKER_LABEL — never start a new line with a number word and a colon.

FORMAT (plain text only)
- Do NOT use Markdown: no **bold**, *italics*, # headings, horizontal rules (---), or underscore emphasis. TTS may read punctuation literally.
- Do NOT use square-bracket production cues like [MUSIC] or [LAUGH]; they may be read aloud.
- Start with two metadata lines (not spoken by default; for filenames/cataloging):
  EPISODE_TITLE: <short catchy title, plain text>
  SHOW_TITLE: <fictional show name, plain text>
- After a blank line, output only lines that match LINE DISCIPLINE. Each spoken line is exactly ONE line:
  SPEAKER_LABEL: spoken words
  SPEAKER_LABEL must be exactly one of: NARRATOR, BEN, LESLIE, PATRICK. No spaces before the colon.
- For long speech, split into multiple consecutive lines with the same SPEAKER_LABEL only — never orphan lines without a label.
- Non-spoken sound cues for ElevenLabs text-to-sound-effects (one line each): SFX: <short plain-text description>. Follow SOUND EFFECTS above: quiet, simple, one idea per line. No dialogue on SFX lines.

SPOKEN CONTENT RULES (TTS-safe)
- Everything after "SPEAKER_LABEL: " is read aloud. No parenthetical stage directions on dialogue lines. Convey tone with wording and punctuation only.
- Do not repeat the speaker name inside the spoken text.
- ASCII quotes are fine; no emojis.

SUGGESTED STORY BEATS (adapt to the transcript)
1) NARRATOR cold open — specific moment from the meeting; optional quiet transition SFX after.
2) BEN and LESLIE intro (Patrick chimes in); preview the full agenda arc; optional soft room-tone or gentle whoosh between intro and first segment.
3) For each major thread: NARRATOR teaser line, optional subtle SFX, then hosts plus Patrick; occasional light SFX after a joke only when it stays quiet and simple.
4) Public comment segment if present in source.
5) Recap key numbers, votes, decisions using only labeled BEN/LESLIE/PATRICK/NARRATOR lines — no unlabeled numbered lists; optional very soft sting if it fits the SFX rules above.
6) What is next for residents; NARRATOR sign-off; optional brief quiet button SFX only if easy and soft.

Source filename (episode title / premise inspiration): {video_name_here}

Transcript:
{transcript_here}"""


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _https_context() -> ssl.SSLContext:
    """CA bundle from certifi (fixes macOS python.org builds missing system certs)."""
    return ssl.create_default_context(cafile=certifi.where())


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
                    "Expected each JSONL row to be a single {filename: value} object; "
                    f"problem line starts: {line[:120]!r}..."
                )
            done.update(obj.keys())
    return done


def _extract_text_from_response(body: dict) -> str:
    candidates = body.get("candidates") or []
    if not candidates:
        fb = body.get("promptFeedback")
        raise RuntimeError(
            f"No candidates (promptFeedback={fb!r}); response: {json.dumps(body)[:2000]}"
        )
    parts = (
        (candidates[0].get("content") or {}).get("parts") or []
    )
    texts = [p.get("text", "") for p in parts if isinstance(p, dict)]
    out = "".join(texts).strip()
    if not out:
        raise RuntimeError(f"Empty model text; body snippet: {json.dumps(body)[:2000]}")
    return out


def _generate_content(api_key: str, prompt: str, timeout_s: int) -> str:
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
    }
    data = json.dumps(payload).encode("utf-8")
    url = f"{GENERATE_URL}?key={urllib.parse.quote(api_key, safe='')}"
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(
            req, timeout=timeout_s, context=_https_context()
        ) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {err_body[:4000]}") from e
    body = json.loads(raw)
    return _extract_text_from_response(body)


def _call_with_retries(
    api_key: str,
    prompt: str,
    *,
    timeout_s: int,
    max_retries: int,
) -> str:
    last_err: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            return _generate_content(api_key, prompt, timeout_s=timeout_s)
        except RuntimeError as e:
            msg = str(e)
            retryable = "HTTP 429" in msg or "HTTP 503" in msg or "HTTP 500" in msg
            if not retryable or attempt >= max_retries:
                raise
            last_err = e
            sleep_s = min(60.0, (2**attempt) + random.random())
            time.sleep(sleep_s)
    assert last_err is not None
    raise last_err


def _parse_args(repo_root: Path) -> argparse.Namespace:
    default_in = repo_root / "transcripts" / "uploaded_video_transcripts.jsonl"
    default_out_dir = repo_root / "podcast_scripts"
    p = argparse.ArgumentParser(
        description="Convert meeting transcripts JSONL to podcast scripts via Gemini."
    )
    p.add_argument(
        "--input",
        type=Path,
        default=default_in,
        help=f"Input JSONL path (default: {default_in})",
    )
    p.add_argument(
        "--output-dir",
        type=Path,
        default=default_out_dir,
        help=(
            f"Directory for outputs: JSONL and companion .txt (default: {default_out_dir})"
        ),
    )
    p.add_argument(
        "--timeout",
        type=int,
        default=600,
        help="Per-request timeout in seconds (default: 600).",
    )
    p.add_argument(
        "--max-retries",
        type=int,
        default=5,
        help="Retries on transient HTTP errors (default: 5).",
    )
    return p.parse_args()


def _rewrite_txt_from_jsonl(jsonl_path: Path, txt_path: Path) -> None:
    """Write human-readable .txt from all rows in the JSONL (keeps txt in sync)."""
    parts: list[str] = []
    if jsonl_path.is_file():
        with jsonl_path.open(encoding="utf-8") as jf:
            for line in jf:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                if not isinstance(obj, dict) or len(obj) != 1:
                    continue
                (video_name, script) = next(iter(obj.items()))
                if not isinstance(script, str):
                    continue
                parts.append(
                    f"{'=' * 80}\n"
                    f"Source: {video_name}\n"
                    f"{'=' * 80}\n\n"
                    f"{script.rstrip()}\n"
                )
    body = "\n\n".join(parts)
    if body:
        body += "\n"
    txt_path.write_text(body, encoding="utf-8")


def main() -> int:
    load_dotenv(_repo_root() / ".env")
    repo_root = _repo_root()
    args = _parse_args(repo_root)

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print(
            "Missing GEMINI_API_KEY or GOOGLE_API_KEY in environment.",
            file=sys.stderr,
        )
        return 1

    input_path: Path = args.input
    if not input_path.is_file():
        print(f"Input not found: {input_path}", file=sys.stderr)
        return 1

    args.output_dir.mkdir(parents=True, exist_ok=True)
    stem = input_path.stem
    output_path: Path = args.output_dir / f"{stem}_podcast_scripts.jsonl"
    output_txt_path: Path = args.output_dir / f"{stem}_podcast_scripts.txt"
    done = _load_done_keys(output_path)

    with input_path.open(encoding="utf-8") as inf, output_path.open(
        "a", encoding="utf-8"
    ) as outf:
        for line_no, line in enumerate(inf, start=1):
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if not isinstance(obj, dict) or len(obj) != 1:
                print(
                    f"Line {line_no}: expected one key per object, skipping.",
                    file=sys.stderr,
                )
                continue
            (video_name, transcript) = next(iter(obj.items()))
            if not isinstance(transcript, str):
                print(
                    f"Line {line_no}: transcript for {video_name!r} is not a string.",
                    file=sys.stderr,
                )
                continue
            if video_name in done:
                print(f"Skip (already done): {video_name}", file=sys.stderr)
                continue

            words = len(transcript.split())
            est_minutes = max(1, round(words / 130))
            prompt = (
                PROMPT_TEMPLATE.replace("{transcript_here}", transcript)
                .replace("{video_name_here}", video_name)
                .replace("{transcript_word_count}", f"{words:,}")
                .replace("{estimated_minutes}", str(est_minutes))
            )
            print(f"Generating podcast script for: {video_name}", file=sys.stderr)
            script = _call_with_retries(
                api_key,
                prompt,
                timeout_s=args.timeout,
                max_retries=args.max_retries,
            )
            outf.write(json.dumps({video_name: script}, ensure_ascii=False) + "\n")
            outf.flush()
            done.add(video_name)

    _rewrite_txt_from_jsonl(output_path, output_txt_path)
    print(
        f"Wrote/updated: {output_path} and {output_txt_path}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())