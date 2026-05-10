"""Local fallbacks when ElevenLabs music or sound-generation scopes are unavailable."""

from __future__ import annotations

import random

from pydub import AudioSegment
from pydub.generators import Sine, WhiteNoise


def placeholder_sfx(duration_ms: int = 1400) -> AudioSegment:
    """Short quiet noise burst as a stand-in for text-to-sound-effects."""
    noise = WhiteNoise().to_audio_segment(duration=duration_ms)
    return noise.apply_gain(-42)


def synthetic_bgm(duration_ms: int, *, seed: int = 42) -> AudioSegment:
    """
    Simple looping-style pad (low sine stack). Not a substitute for real music,
    but gives an underscoring bed when the Music API is unavailable.
    """
    rng = random.Random(seed)
    # Root + fifth + octave-ish — keep levels conservative to avoid clipping
    base_hz = 98.0 + rng.uniform(-1.5, 1.5)
    ratios = [1.0, 1.25, 1.5, 2.0]
    mixed = AudioSegment.silent(duration=duration_ms)
    for r in ratios:
        hz = base_hz * r
        layer = Sine(hz).to_audio_segment(duration=duration_ms)
        layer = layer.apply_gain(-28 + rng.uniform(-2.0, 2.0))
        mixed = mixed.overlay(layer)
    return mixed.apply_gain(-6)
