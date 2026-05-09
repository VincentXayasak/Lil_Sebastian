#!/usr/bin/env python3
"""
transcript_to_podcast.py
Reads transcripts from the project JSONL file, sends them to Google Gemini,
and writes a podcast script to podcastScript.txt in the project root.

Usage:
  python scripts/transcript_to_podcast.py --filter "Fiscal" --focus "budget deficit" --hosts "Jordan,Taylor" --show-name "Davis Today" --no-interactive
  python scripts/transcript_to_podcast.py --dry-run   # test without API key
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import textwrap
from pathlib import Path

from dotenv import load_dotenv

try:
    from google import genai
    from google.genai import types as genai_types
except ImportError:
    print("google-genai is not installed. Run: pip install google-genai", file=sys.stderr)
    raise SystemExit(1)


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


TRANSCRIPT_PATH = _repo_root() / "transcripts" / "uploaded_video_transcripts.jsonl"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_SHOW_NAME = "The Public Record"
DEFAULT_HOSTS     = ["Alex", "Sam"]
DEFAULT_FOCUS     = "the most important takeaways citizens should know"
DEFAULT_MODEL     = "gemini-3.1-flash-lite"

# ---------------------------------------------------------------------------
# System instruction (Gemini persona)
# ---------------------------------------------------------------------------

SYSTEM_INSTRUCTION = textwrap.dedent("""\
    You are an expert podcast producer who specialises in turning long, dry
    government meeting transcripts into engaging, friendly, and accurate podcast
    episodes for everyday citizens.

    Your episodes:
    - Start with a short cold-open hook that grabs the listener.
    - Use natural back-and-forth dialogue between the two hosts.
    - Explain jargon in plain language without being condescending.
    - Highlight the decisions or debates that affect residents most.
    - Fact-check the key numbers mentioned and repeat them clearly.
    - End with a brief "What to watch for next" segment.
    - Keep a warm, curious, slightly conversational tone.
    - Use [MUSIC FADE IN], [PAUSE], [BOTH LAUGH] sparingly for production cues.
    - A NARRATOR introduces each segment transition with a short, punchy line
      (e.g. "NARRATOR: Coming up — the vote that split the commission down the middle.").
      The NARRATOR never speaks during host dialogue, only at transitions.
    - CRITICAL: These transcripts are often from long meetings (1-3 hours). You must
      cover ALL significant agenda items, discussions, and decisions — do not skip or
      summarise away important content just to keep things short.
    - CRITICAL: Script length must be proportional to the transcript length. A 30-minute
      meeting gets a shorter episode; a 2-hour meeting gets a much longer one. There is
      no word limit — write until every topic from the transcript is fully covered.
    - Every named speaker, vote outcome, dollar figure, and key debate point from the
      transcript must appear somewhere in the script.
""")

# ---------------------------------------------------------------------------
# JSONL loading
# ---------------------------------------------------------------------------

def load_transcripts(jsonl_path: Path) -> dict[str, str]:
    if not jsonl_path.is_file():
        raise FileNotFoundError(f"Transcript file not found: {jsonl_path}")
    records: dict[str, str] = {}
    with jsonl_path.open(encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Bad JSON on line {lineno}: {exc}") from exc
            if not isinstance(obj, dict) or len(obj) != 1:
                raise ValueError(f"Line {lineno}: expected a single {{filename: transcript}} object.")
            records.update(obj)
    return records


def filter_transcripts(records: dict[str, str], keyword: str | None) -> dict[str, str]:
    if not keyword:
        return records
    kw = keyword.lower()
    filtered = {k: v for k, v in records.items() if kw in k.lower()}
    if not filtered:
        available = "\n  ".join(records.keys())
        raise SystemExit(f"No transcripts match --filter '{keyword}'.\nAvailable:\n  {available}")
    return filtered

# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------

def build_prompt(transcripts: dict[str, str], focus: str, hosts: list[str], show_name: str) -> str:
    host_a, host_b = hosts[0], hosts[1]
    sections = [f"=== SOURCE: {name} ===\n{text.strip()}\n=== END SOURCE ===" for name, text in transcripts.items()]
    combined = "\n\n".join(sections)

    total_words = sum(len(t.split()) for t in transcripts.values())
    # Rough estimate: spoken meetings average ~130 words per minute
    estimated_minutes = round(total_words / 130)

    return textwrap.dedent(f"""\
        Below are {len(transcripts)} raw government meeting transcript(s). These may be
        from city council sessions, fiscal commission meetings, school board hearings,
        town halls, or similar long public meetings.

        Estimated meeting length: approximately {estimated_minutes} minutes
        ({total_words:,} words of transcript).

        {combined}

        Your task:
        Write a COMPLETE, DETAILED podcast episode script for the show "{show_name}".
        Host A is {host_a}. Host B is {host_b}. There is also a NARRATOR who announces
        segment transitions — never during host dialogue, only between segments.

        STRICT REQUIREMENTS:
        - Script length must be proportional to the transcript. A ~{estimated_minutes}-minute
          meeting deserves a thorough episode — do not truncate or rush. There is no word
          limit; write until every topic is fully and faithfully covered.
        - Do NOT skip any significant agenda item, discussion, vote, or public comment.
        - Do NOT collapse multiple topics into a vague one-liner — each deserves its own segment.
        - Quote or closely paraphrase specific things speakers said when they are notable.
        - Include all dollar figures, dates, vote counts, and named individuals.
        - If the meeting had public comment, dedicate a segment to what residents said.

        Structure:
        1. [COLD OPEN]      - A punchy 2-3 sentence hook referencing a specific moment from the meeting.
        2. [INTRO]          - Hosts introduce themselves and preview everything that will be covered.
        3. [SEGMENT 1]      - Most important topic (usually what the focus parameter specifies).
                              Begin with: NARRATOR: [short teaser line announcing the topic]
        4. [SEGMENT 2+]     - One segment per major agenda item or discussion thread.
                              Each segment begins with: NARRATOR: [short teaser line]
                              Add as many segments as needed — do not stop early.
        5. [PUBLIC COMMENT] - If applicable, a full segment on what residents raised.
                              Begin with: NARRATOR: [teaser line]
        6. [NUMBERS RECAP]  - Hosts recap all key figures, votes, and decisions in one exchange.
                              Begin with: NARRATOR: [teaser line]
        7. [WHAT'S NEXT]    - What residents should watch for in coming weeks.
        8. [OUTRO]          - Brief sign-off and call-to-action.
                              End with: NARRATOR: [sign-off line, e.g. "Davis Today is produced by..."]

        Label every spoken line as {host_a.upper()}:, {host_b.upper()}:, or NARRATOR:
        Do NOT include any commentary or stage directions outside the script itself.
        Do NOT truncate or cut the script short — write until every topic is covered.
    """)

# ---------------------------------------------------------------------------
# Gemini call
# ---------------------------------------------------------------------------

def call_gemini(api_key: str, system_instruction: str, user_prompt: str, model_name: str) -> str:
    client = genai.Client(api_key=api_key)
    print(f"Sending to Gemini ({model_name}), please wait...")
    response = client.models.generate_content(
        model=model_name,
        contents=user_prompt,
        config=genai_types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=0.7,
            max_output_tokens=4096,
        ),
    )
    return response.text

# ---------------------------------------------------------------------------
# Interactive helper
# ---------------------------------------------------------------------------

def ask(question: str, default: str) -> str:
    answer = input(f"{question} [{default}]: ").strip()
    return answer if answer else default

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    load_dotenv(_repo_root() / ".env", override=True)
    load_dotenv(override=False)

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--filter",          metavar="KEYWORD",    help="Only include transcripts whose filename contains this keyword.")
    parser.add_argument("--focus",           metavar="TEXT",       help=f'What to focus the episode on. Default: "{DEFAULT_FOCUS}"')
    parser.add_argument("--hosts",           metavar="NAME1,NAME2",help=f"Two comma-separated host names. Default: {','.join(DEFAULT_HOSTS)}")
    parser.add_argument("--show-name",       metavar="NAME",       default=DEFAULT_SHOW_NAME, help=f'Podcast show name. Default: "{DEFAULT_SHOW_NAME}"')
    parser.add_argument("--model",           metavar="MODEL",      default=DEFAULT_MODEL, help=f"Gemini model. Default: {DEFAULT_MODEL}")
    parser.add_argument("--no-interactive",  action="store_true",  help="Skip all interactive questions.")
    parser.add_argument("--transcript-path", type=Path,            default=TRANSCRIPT_PATH)
    parser.add_argument("--dry-run",         action="store_true",  help="Show what would be sent to Gemini without calling the API.")
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key and not args.dry_run:
        print(
            "ERROR: GEMINI_API_KEY not set.\n"
            "Add it to your .env file:  GEMINI_API_KEY=your-key-here\n"
            "Get a key at https://aistudio.google.com/app/apikey\n"
            "Tip: run with --dry-run to test without a key.",
            file=sys.stderr,
        )
        return 1

    # Load transcripts
    transcript_path: Path = args.transcript_path.expanduser().resolve()
    print(f"Loading transcripts from: {transcript_path}")
    all_records = load_transcripts(transcript_path)
    print(f"Found {len(all_records)} transcript(s):")
    for name in all_records:
        print(f"  - {name}")

    # Filter
    filter_kw = args.filter
    if not filter_kw and not args.no_interactive and len(all_records) > 1:
        filter_kw = ask("\nFilter by filename keyword (leave blank to use all)", default="")

    selected = filter_transcripts(all_records, filter_kw or None)
    if len(selected) < len(all_records):
        print(f"Using {len(selected)} transcript(s):")
        for name in selected:
            print(f"  - {name}")

    # Personalisation
    if args.no_interactive:
        focus     = args.focus or DEFAULT_FOCUS
        raw_hosts = args.hosts or ",".join(DEFAULT_HOSTS)
        show_name = args.show_name
    else:
        print()
        focus     = args.focus or ask("What should the episode focus on? (e.g. 'budget crisis')", default=DEFAULT_FOCUS)
        raw_hosts = args.hosts or ask("Host names (comma-separated)", default=",".join(DEFAULT_HOSTS))
        show_name = ask("Podcast show name", default=args.show_name)

    hosts = [h.strip() for h in raw_hosts.split(",")]
    if len(hosts) < 2:
        hosts.append(DEFAULT_HOSTS[1])
    hosts = hosts[:2]

    print(f"\nConfig:")
    print(f"  Show   : {show_name}")
    print(f"  Hosts  : {hosts[0]} & {hosts[1]}")
    print(f"  Focus  : {focus}")
    print(f"  Source : {len(selected)} transcript(s)")

    # Dry run
    if args.dry_run:
        total_words = sum(len(t.split()) for t in selected.values())
        print(f"\nDry run - no API call made.")
        print(f"  {len(selected)} transcript(s), ~{total_words:,} words total")
        print(f"  Would generate: " + ", ".join(
            f"podcastScript{i+1}.txt" if len(selected) > 1 else "podcastScript.txt"
            for i in range(len(selected))
        ))
        print(f"  Add GEMINI_API_KEY to .env and re-run without --dry-run.")
        return 0

    # Each transcript gets its own Gemini call and its own output file.
    # 1 transcript  -> podcastScript.txt
    # 2+ transcripts -> podcastScript1.txt, podcastScript2.txt, ...
    items = list(selected.items())
    use_numbered = len(items) > 1

    for i, (filename, transcript_text) in enumerate(items, start=1):
        print(f"\n[{i}/{len(items)}] Processing: {filename}")
        single = {filename: transcript_text}
        user_prompt = build_prompt(single, focus, hosts, show_name)
        podcast_script = call_gemini(api_key, SYSTEM_INSTRUCTION, user_prompt, args.model)

        output_name = f"podcastScript{i}.txt" if use_numbered else "podcastScript.txt"
        output_path = _repo_root() / output_name
        with output_path.open("w", encoding="utf-8") as fh:
            fh.write(podcast_script)
        print(f"Saved: {output_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())