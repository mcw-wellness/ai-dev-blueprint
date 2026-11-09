"""Where a session's wall time went, by category; and, to plan a timeline, how long agents' pull
requests took by repository and size (start to open, open to merge), from subagent transcripts
joined with `gh pr list`.

Time overlapping a wait for a typed prompt is the owner's. The rest splits at every call's
start and end: a gap under GAP is the lead working, a longer one ending at a call's end
was spent waiting on that call, classed by its summary, and a longer one ending at a
call's start is the lead's own long thinking or writing, which counts as active.
"""

import json
import math
import re
import subprocess
import time
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from itertools import pairwise
from pathlib import Path

from timeline_model import Event, Session, fmt, load_jsonl, parse_ts

PROJECTS = Path.home() / ".claude" / "projects"

GAP = timedelta(minutes=2)
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
RERUN_RE = re.compile(r"\bre-?run|\bretry|\bagain\b", re.I)
OWNER, ACTIVE, FAILED = "waiting on owner", "active work", "failed, killed or rerun"
# First match wins; a call matching none is a subagent or a long tool call by its kind.
CLASSES = (
    (
        "other sessions and holds",
        re.compile(r"\bhold\b|other session|\bpeer|until \d", re.I),
    ),
    (
        "CI and deploy",
        re.compile(
            r"\bci\b|checks|gh (pr|run)|release|deploy|dispatch|merge|ssm|image", re.I
        ),
    ),
    ("review rounds", re.compile(r"review|refute|regrade|codex", re.I)),
)
ORDER = (
    OWNER,
    *(name for name, _ in CLASSES),
    "subagent work",
    "long tool calls",
    FAILED,
    ACTIVE,
)

Sinks = tuple[dict[str, timedelta], dict[str, list[tuple[timedelta, Event]]], timedelta]


def classify(call: Event) -> str:
    """A tool call by its words; an agent is subagent work unless it reviews, since its task's
    words ("merge gate", "chart images") name what it works on, not what it waits for."""
    if call.failed or RERUN_RE.search(call.summary):
        return FAILED
    for name, pattern in CLASSES:
        if (call.kind != "agent" or name == "review rounds") and pattern.search(
            call.summary
        ):
            return name
    return "subagent work" if call.kind == "agent" else "long tool calls"


def overlap(
    spans: list[tuple[datetime, datetime]], a: datetime, b: datetime
) -> timedelta:
    return sum(
        (min(e, b) - max(s, a) for s, e in spans if s < b and e > a), timedelta()
    )


def sinks(session: Session) -> Sinks:
    """Time per category, the gaps behind each, and the serial share: gaps with exactly
    one call in flight, which nothing overlapped."""
    work = [c for c in session.events if c.kind != "prompt"]
    ended = defaultdict(list)
    for call in work:
        if call.end is not None:
            ended[call.end].append(call)
    totals: dict[str, timedelta] = defaultdict(timedelta)
    gaps: dict[str, list[tuple[timedelta, Event]]] = defaultdict(list)
    serial = timedelta()
    cuts = {session.start, session.end, *(c.start for c in session.events), *ended}
    for a, b in pairwise(sorted(cuts)):
        owner = overlap(session.waits, a, b)
        totals[OWNER] += owner
        rest = b - a - owner
        if rest <= timedelta():
            continue
        if b - a <= GAP or not ended[b]:
            totals[ACTIVE] += rest
            continue
        name = classify(ended[b][0])
        totals[name] += rest
        gaps[name].append((rest, ended[b][0]))
        # A call with no end never reported back (lost or still running), so it is not counted.
        if sum(c.start <= a and c.end is not None and c.end >= b for c in work) == 1:
            serial += rest
    return totals, gaps, serial


def largest(gaps: list[tuple[timedelta, Event]]) -> list[tuple[timedelta, Event]]:
    return sorted(gaps, key=lambda g: g[0], reverse=True)[:3]


def minutes(delta: timedelta) -> float:
    return round(delta.total_seconds() / 60, 1)


def as_json(session: Session) -> dict:
    """Minutes per class present, in ORDER, with its largest gaps (`Sinks` in mods/types/index.d.ts)."""
    totals, gaps, serial = sinks(session)
    return {
        "wall": minutes(sum(totals.values(), timedelta())),
        "serial": minutes(serial),
        "classes": [
            {
                "name": name,
                "minutes": minutes(totals[name]),
                "gaps": [
                    {
                        "minutes": minutes(rest),
                        "at": call.start.astimezone(UTC).isoformat(),
                        "summary": call.summary,
                    }
                    for rest, call in largest(gaps[name])
                ],
            }
            for name in ORDER
            if totals[name]
        ],
    }


def report(session: Session) -> str:
    totals, gaps, serial = sinks(session)
    wall = sum(totals.values(), timedelta())
    start, end = (t.astimezone(UTC) for t in (session.start, session.end))
    lines = [
        str(session.path),
        f"{start:%Y-%m-%d %H:%MZ} to {end:%Y-%m-%d %H:%MZ}, wall {fmt(wall)}",
    ]
    for name in ORDER:
        if totals[name]:
            share = 100 * totals[name] / wall
            lines.append(f"  {name:<26} {fmt(totals[name]):>7} {share:4.0f}%")
            for rest, call in largest(gaps[name]):
                at = call.start.astimezone(UTC)
                lines.append(
                    f"      {fmt(rest):>6} from {at:%m-%d %H:%MZ}  {call.summary[:90]}"
                )
    lines.append(f"  serial (lead idle, one call in flight) {fmt(serial)}")
    return "\n".join(lines)


def handoff_lines(path: Path) -> tuple[list[str], list[str]]:
    """The handoff's Status, Finish, Gate, Rounds and Blockers lines, and its session ids."""
    text = path.read_text()
    keep = [
        line
        for line in text.splitlines()
        if re.match(r"(Finish|Gate|Rounds|Status):", line)
    ]
    blockers = re.search(r"^## Blockers\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    if blockers:
        keep += [
            "Blockers:",
            *[line for line in blockers.group(1).splitlines() if line.strip()],
        ]
    session_line = next(
        (line for line in text.splitlines() if line.startswith("Session:")), ""
    )
    return keep, UUID_RE.findall(session_line)


BUCKETS = (
    (0, 100, "<=100"),
    (101, 400, "101-400"),
    (401, 1500, "401-1500"),
    (1501, 10**9, ">1500"),
)


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s)


def _q(values: list[float], p: float) -> str:
    """Nearest-rank quantile."""
    if not values:
        return "-"
    v = sorted(values)
    return f"{v[max(0, math.ceil(p * len(v)) - 1)]:.0f}"


def implementations(days: float, owner: str) -> dict[tuple[str, int], float]:
    """(repo, pr) -> minutes a subagent worked on it: from its first event, or from the result of its
    previous `gh pr create`, to the `gh pr create` that opened it."""
    pat = re.compile(rf"github\.com/{re.escape(owner)}/([\w.\-]+)/pull/(\d+)")
    out: dict[tuple[str, int], float] = {}
    cutoff = time.time() - days * 86400
    for f in PROJECTS.glob("*/*/subagents/*.jsonl"):
        if f.stat().st_mtime < cutoff:
            continue
        since: datetime | None = None
        asked: dict[str, datetime] = {}
        for d in load_jsonl(f):
            t = parse_ts(d.get("timestamp"))
            if t is None:
                continue
            since = since or t
            content = d.get("message", {}).get("content")
            if not isinstance(content, list):
                continue
            for x in content:
                if x.get("type") == "tool_use" and "gh pr create" in str(
                    x.get("input", {}).get("command", "")
                ):
                    asked[x["id"]] = t
                elif x.get("type") == "tool_result" and x.get("tool_use_id") in asked:
                    for repo, n in pat.findall(json.dumps(x.get("content"))):
                        minutes = (asked[x["tool_use_id"]] - since).total_seconds() / 60
                        out.setdefault((repo, int(n)), minutes)
                        since = t
    return out


def merged(owner: str, repo: str) -> dict[int, tuple[int, float]]:
    """pr -> (lines changed, minutes from opening to merge)."""
    raw = subprocess.run(
        [
            "gh",
            "pr",
            "list",
            "-R",
            f"{owner}/{repo}",
            "--state",
            "merged",
            "--limit",
            "400",
            "--json",
            "number,additions,deletions,createdAt,mergedAt",
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return {
        x["number"]: (
            x["additions"] + x["deletions"],
            (_ts(x["mergedAt"]) - _ts(x["createdAt"])).total_seconds() / 60,
        )
        for x in json.loads(raw)
    }


def pr_samples(
    repos: list[str], days: float, owner: str
) -> dict[str, dict[str, list[tuple[float, float]]]]:
    """repo -> size bucket -> [(start to open, open to merge)] in minutes, for the merged pull requests
    a subagent opened in the window; repos empty means every repository agents opened one in."""
    impl = implementations(days, owner)
    out: dict[str, dict[str, list[tuple[float, float]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for repo in repos or sorted({r for r, _ in impl}):
        prs = merged(owner, repo)
        for (r, n), minutes in impl.items():
            if r == repo and n in prs:
                size, review = prs[n]
                bucket = next(name for lo, hi, name in BUCKETS if lo <= size <= hi)
                out[repo][bucket].append((minutes, review))
    return out


def pr_report(samples: dict[str, dict[str, list[tuple[float, float]]]]) -> str:
    lines = [
        "| Repository | Lines | PRs | Start to open p50 | p90 | Open to merge p50 | p90 | Start to merge p50 | p90 |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for repo, buckets in sorted(samples.items()):
        for bucket, v in sorted(buckets.items()):
            work, review = [x for x, _ in v], [y for _, y in v]
            total = [x + y for x, y in v]
            lines.append(
                f"| {repo} | {bucket} | {len(v)} | {_q(work, 0.5)} | {_q(work, 0.9)} | {_q(review, 0.5)}"
                f" | {_q(review, 0.9)} | {_q(total, 0.5)} | {_q(total, 0.9)} |"
            )
    return "\n".join(
        [
            *lines,
            "",
            "Minutes; merged pull requests a subagent opened, by repository and size.",
        ]
    )
