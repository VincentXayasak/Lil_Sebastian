#!/usr/bin/env python3
"""Read cities/uccities_combined.csv and write JSON arrays for web + Expo."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    src = root / "cities" / "uccities_combined.csv"
    if not src.is_file():
        print(f"Missing {src}", file=sys.stderr)
        return 1

    locations: list[str] = []
    with src.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if "location" not in (reader.fieldnames or []):
            print("CSV must have a 'location' column.", file=sys.stderr)
            return 1
        for row in reader:
            loc = (row.get("location") or "").strip()
            if loc:
                locations.append(loc)

    outs = [
        root / "website" / "data" / "locations.json",
        root / "app" / "data" / "locations.json",
    ]
    for path in outs:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(locations, ensure_ascii=False), encoding="utf-8")
        print(f"Wrote {len(locations)} locations → {path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
