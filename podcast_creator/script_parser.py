"""Parse sitcom-style podcast scripts (ElevenLabs-friendly format)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

SegmentKind = Literal["dialogue", "sfx"]


@dataclass(frozen=True)
class ParsedScript:
    episode_title: str
    show_title: str
    segments: tuple["Segment", ...]


@dataclass(frozen=True)
class Segment:
    kind: SegmentKind
    speaker: str | None
    text: str


_EPISODE = re.compile(r"^EPISODE_TITLE:\s*(.+)\s*$", re.I)
_SHOW = re.compile(r"^SHOW_TITLE:\s*(.+)\s*$", re.I)
_SFX = re.compile(r"^SFX:\s*(.+)\s*$", re.I)
_DIALOGUE = re.compile(r"^([A-Z0-9_]+):\s*(.*)\s*$")


def parse_script_text(raw: str) -> ParsedScript:
    lines = raw.splitlines()
    episode_title = ""
    show_title = ""
    segments: list[Segment] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        m_ep = _EPISODE.match(stripped)
        if m_ep:
            episode_title = m_ep.group(1).strip()
            continue
        m_sh = _SHOW.match(stripped)
        if m_sh:
            show_title = m_sh.group(1).strip()
            continue

        m_sfx = _SFX.match(stripped)
        if m_sfx:
            desc = m_sfx.group(1).strip()
            if desc:
                segments.append(Segment(kind="sfx", speaker=None, text=desc))
            continue

        m_d = _DIALOGUE.match(stripped)
        if not m_d:
            raise ValueError(f"Unrecognized script line: {stripped!r}")
        speaker, text = m_d.group(1), m_d.group(2).strip()
        segments.append(Segment(kind="dialogue", speaker=speaker, text=text))

    if not segments:
        raise ValueError("Script has no dialogue or SFX segments.")
    return ParsedScript(
        episode_title=episode_title,
        show_title=show_title,
        segments=tuple(segments),
    )


def parse_script_path(path: Path) -> ParsedScript:
    return parse_script_text(path.read_text(encoding="utf-8"))
