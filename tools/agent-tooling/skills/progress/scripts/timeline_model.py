"""The timeline's events and session, and the JSONL reading both transcript parsers share."""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


def fmt(delta: timedelta, seconds: bool = False) -> str:
    """`1h05m`, else `12m`, or with `seconds` `12m05s` and `40s`; never negative."""
    total = delta.total_seconds()
    s = max(0, int(total) if seconds else round(total / 60) * 60)
    hours, minutes, secs = s // 3600, s // 60 % 60, s % 60
    if hours:
        return f"{hours}h{minutes:02d}m"
    if not seconds:
        return f"{minutes}m"
    return f"{minutes}m{secs:02d}s" if minutes else f"{secs}s"


@dataclass(frozen=True)
class Event:
    start: datetime
    end: datetime | None  # None: no result yet, i.e. still running
    kind: str  # "prompt" | "tool" | "agent"
    summary: str
    command: str = (
        ""  # a shell call's command, so its outcome (a PR, a merge) can be read
    )
    failed: bool = (
        False  # it errored, or ran in the background and failed, was killed or stopped
    )


@dataclass(frozen=True)
class Session:
    path: Path
    start: datetime
    end: datetime
    waits: list[tuple[datetime, datetime]]  # from a turn's end to the next prompt
    events: list[Event]

    def since(self, floor: datetime | None) -> "Session":
        """The session from `floor` on: later events, waits cut at it."""
        if floor is None or floor <= self.start:
            return self
        return Session(
            self.path,
            floor,
            self.end,
            [(max(s, floor), e) for s, e in self.waits if e > floor],
            [e for e in self.events if e.start >= floor],
        )

    def waiting(self) -> timedelta:
        return sum((end - start for start, end in self.waits), timedelta())


def load_jsonl(path: Path, limit: int | None = None) -> Iterator[dict[str, Any]]:
    with path.open() as handle:
        for n, line in enumerate(handle):
            if limit is not None and n >= limit:
                return
            line = line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                yield parsed


def parse_ts(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def result_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return ""
