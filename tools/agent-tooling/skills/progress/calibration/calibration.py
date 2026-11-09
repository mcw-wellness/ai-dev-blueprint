#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.12"
# ///
"""How agents' finish estimates compare with when the work was done: each turn-ending `Running:`
reply whose first line names a UTC finish, read as the ETA ledger reads it (tools/status/eta.py,
fed by the Stop hook), against the session's next turn-ending `Done.`. A `Not done:`, `Blocked:` or
`Failed:` first closes the estimates open since the last close, and they drop out; so does a
finish already past when it was written. A lead running several strands opens `Done.` for one of
them while still naming the rest's finish; such a reply closes nothing.

`calibration.py [--days N] [--json]` reads every top-level Claude Code transcript and Codex rollout
written in the window and prints the actual/promised ratios of the estimates written in it."""

import argparse
import json
import re
import statistics
import sys
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

# The transcript readers beside session_timeline.py, and the ETA ledger's reading of a finish.
HERE = Path(__file__).resolve().parent
sys.path += [str(HERE.parent / "scripts"), str(HERE.parents[2] / "tools" / "status")]
from claude_transcript import content_blocks  # noqa: E402
from eta import NAMED, TIME, finish  # noqa: E402
from notify_status import verdict  # noqa: E402
from session_timeline import claude_projects_dir, codex_sessions_dir  # noqa: E402
from time_sinks import UUID_RE  # noqa: E402
from timeline_model import parse_ts, result_text  # noqa: E402

# Only a transcript holding a reply that opens with a verdict is parsed; Codex rollouts all quote
# AGENTS.md, so a bare `Running:` would let every one through.
REPLY_RE = re.compile(rb'"(?:text|last_agent_message)": ?"(?:\*\*)?Running:')
REMAINING_RE = re.compile(r"^\W*Remaining:.*$", re.M)
STILL_RE = re.compile(
    r"expected finish|\bleft\b|Remaining:|Running:|done ~|\bETA\b", re.I
)
WAITS_RE = re.compile(
    r"\b(?:CI|checks?|reviews?|pr_review|Releases?|deploy\w*)\b", re.I
)
# The ledger's forward window: a bare finish lies at most this far ahead.
AHEAD = timedelta(hours=18)


@dataclass(frozen=True)
class Estimate:
    session: str
    written_at: datetime
    promised: datetime
    done: datetime
    original: bool  # the first finish since the last close, the one the ledger keeps
    prompts: int  # prompts typed between the estimate and its Done
    waits: bool  # its verdict or Remaining line names CI, review or Release
    line: str  # the verdict line, then the Remaining line if any

    @property
    def promised_min(self) -> float:
        return (self.promised - self.written_at).total_seconds() / 60

    @property
    def actual_min(self) -> float:
        return (self.done - self.written_at).total_seconds() / 60

    @property
    def ratio(self) -> float:
        return self.actual_min / self.promised_min


def entries(data: bytes) -> Iterator[dict[str, Any]]:
    for line in data.splitlines():
        try:
            parsed = json.loads(line)
        except ValueError:
            continue
        if isinstance(parsed, dict):
            yield parsed


def is_prompt(entry: dict[str, Any]) -> bool:
    """A prompt typed, queued or slash-commanded in Claude Code (as parse_claude reads one), or a
    Codex user message."""
    payload = entry.get("payload") or {}
    match entry.get("type"):
        case "user":
            text = result_text(entry.get("message", {}).get("content"))
            return (
                entry.get("promptSource") in ("typed", "queued")
                or (entry.get("origin") or {}).get("kind") == "human"
                or text.startswith("<command-name>")
            )
        case "attachment":
            attachment = entry.get("attachment") or {}
            return (
                attachment.get("type") == "queued_command"
                and (attachment.get("origin") or {}).get("kind") == "human"
            )
        case "event_msg":
            item = payload.get("item") or {}
            return (
                payload.get("type") == "user_message"
                or item.get("type") == "UserMessage"
            )
    return False


def turns(
    transcript: Iterable[dict[str, Any]],
) -> tuple[list[tuple[datetime, str]], list[datetime]]:
    """Each reply that ends a turn, as the Stop hook sees it, with its time, and each prompt's
    time. Claude Code logs a stop_hook_summary at each turn's end, after the turn's last text; a
    Codex turn's task_complete carries its last agent message."""
    replies: list[tuple[datetime, str]] = []
    prompts: list[datetime] = []
    last: tuple[datetime, str] | None = None
    for entry in transcript:
        ts = parse_ts(entry.get("timestamp"))
        if ts is None:
            continue
        payload = entry.get("payload") or {}
        if entry.get("type") == "assistant":
            for block in content_blocks(entry):
                if block.get("type") == "tool_use":
                    last = None
                elif block.get("type") == "text" and block.get("text", "").strip():
                    last = (ts, block["text"].strip())
        elif (
            entry.get("type") == "system"
            and entry.get("subtype") == "stop_hook_summary"
        ):
            if last:
                replies.append(last)
            last = None
        elif payload.get("type") == "task_complete":
            if text := str(payload.get("last_agent_message") or "").strip():
                replies.append((ts, text))
        elif is_prompt(entry):
            prompts.append(ts)
    return replies, prompts


def estimates(path: Path) -> list[Estimate]:
    data = path.read_bytes()
    if not REPLY_RE.search(data):
        return []
    replies, typed = turns(entries(data))
    name = next(iter(UUID_RE.findall(path.name)), path.stem)
    found, pending, timed = [], [], False
    for ts, text in replies:
        word, first = verdict(text), text.split("\n", 1)[0].strip()
        if word == "Running":
            due = finish(first, ts.timestamp())
            if due is None:
                continue
            if due - ts.timestamp() >= 60:
                remaining = REMAINING_RE.search(text)
                line = first + (f" | {remaining[0].strip()}" if remaining else "")
                promised = datetime.fromtimestamp(due, UTC)
                pending.append((ts, promised, not timed, line))
            timed = True
        elif word == "Done" and not still_running(text, ts):
            found += [
                Estimate(
                    name,
                    at,
                    promised,
                    ts,
                    original,
                    sum(at < p < ts for p in typed),
                    bool(WAITS_RE.search(line)),
                    line,
                )
                for at, promised, original, line in pending
            ]
            pending, timed = [], False
        elif word and word != "Done":
            pending, timed = [], False
    return found


def still_running(text: str, at: datetime) -> bool:
    """Whether a reply names a finish still ahead on a line about time left: a dated time after
    it, a bare one later the same UTC day, or one the line names as a finish (`done ~00:30Z`)
    early tomorrow, within AHEAD. Any other bare time earlier the same day is past ("CI started
    09:00Z"), not tomorrow's."""
    at = at.astimezone(UTC)
    for line in text.splitlines():
        if not STILL_RE.search(line):
            continue
        for m in TIME.finditer(line):
            hour, minute = int(m[2]), int(m[3])
            if hour > 23 or minute > 59:
                continue
            day = (
                datetime.strptime(m[1], "%Y-%m-%d").replace(tzinfo=UTC)
                if m[1]
                else at.replace(hour=0, minute=0, second=0, microsecond=0)
            )
            due = day + timedelta(hours=hour, minutes=minute)
            if not m[1] and due < at:
                named = NAMED.search(line[: m.start()].rstrip(" ~"))
                due += timedelta(days=1)
                if not named or due - at > AHEAD:
                    continue
            if due - at >= timedelta(minutes=1):
                return True
    return False


def recent_transcripts(floor: datetime) -> list[Path]:
    """Top-level Claude Code transcripts and Codex rollouts written since `floor`."""
    paths = [
        *claude_projects_dir().glob("*/*.jsonl"),
        *codex_sessions_dir().glob("**/rollout-*.jsonl"),
    ]
    return [p for p in paths if p.stat().st_mtime >= floor.timestamp()]


def collect(paths: Iterable[Path], floor: datetime | None = None) -> list[Estimate]:
    """Every estimate written since `floor`, once: a forked or resumed session repeats its
    parent's replies."""
    seen: dict[tuple[datetime, str], Estimate] = {}
    for path in paths:
        for e in estimates(path):
            if floor is None or e.written_at >= floor:
                seen.setdefault((e.written_at, e.line), e)
    return sorted(seen.values(), key=lambda e: e.written_at)


def spread(ratios: list[float]) -> str:
    if len(ratios) < 2:
        return f"n={len(ratios)}"
    deciles = statistics.quantiles(ratios, n=10, method="inclusive")
    early = sum(r < 0.5 for r in ratios) / len(ratios)
    return (
        f"n={len(ratios)}  median {statistics.median(ratios):.2f}  p10 {deciles[0]:.2f}"
        f"  p90 {deciles[-1]:.2f}  done in under half the promise {early:.0%}"
    )


def report(found: list[Estimate]) -> str:
    """Ratios for every estimate and for the clean ones: a session's first finish since a close,
    with no prompt typed before its Done, which re-estimates and changed asks cannot skew."""
    clean = [e for e in found if e.original and not e.prompts]
    lines = ["ratio actual/promised minutes"]
    for name, group in (("all estimates", found), ("clean originals", clean)):
        waits = [e for e in group if e.waits]
        rest = [e for e in group if not e.waits]
        lines += [
            f"  {name:<36} {spread([e.ratio for e in group])}",
            f"    naming CI, review or Release     {spread([e.ratio for e in waits])}",
            f"    naming none of them              {spread([e.ratio for e in rest])}",
        ]
    lines.append("session   written  promised  done    prom  act  ratio  verdict line")
    lines += [
        f"{e.session[:8]}  {e.written_at:%m-%d %H:%M}  {e.promised:%H:%MZ}  {e.done:%H:%MZ}"
        f"  {e.promised_min:>5.0f} {e.actual_min:>5.0f} {e.ratio:>5.2f}  {e.line[:100]}"
        for e in found
    ]
    return "\n".join(lines)


def as_json(found: list[Estimate]) -> list[dict]:
    return [
        {
            **asdict(e),
            **{
                k: getattr(e, k).isoformat() for k in ("written_at", "promised", "done")
            },
            "promised_min": round(e.promised_min, 1),
            "actual_min": round(e.actual_min, 1),
            "ratio": round(e.ratio, 3),
        }
        for e in found
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--days", type=float, default=14, help="the window (default 14)"
    )
    parser.add_argument(
        "--json", action="store_true", help="print each estimate as JSON"
    )
    args = parser.parse_args()
    floor = datetime.now(UTC) - timedelta(days=args.days)
    found = collect(recent_transcripts(floor), floor)
    print(json.dumps(as_json(found)) if args.json else report(found))


if __name__ == "__main__":
    main()
