"""Puts the timeline fixtures beside session_timeline.py on the path, as calibration.py does."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
