"""A mermaid fence read as mermaid reads it, for its alt text: the grammar every chart shares (its lines, their
first word, quoted text, numbers), an `xychart-beta`'s axes and bar or line series with how its numbers are written;
and a gantt's task and section names made safe to draw, its clock-only times given their days. Mermaid itself reads
a gantt's tasks and every title."""

import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta


class Unsupported(ValueError):
    """What the fence holds that this reads not, said in a few words."""


def words(line: str) -> tuple[str, str]:
    head, _, rest = line.strip().partition(" ")
    return head, rest.strip()


def unquote(text: str) -> str:
    return text.strip().strip('"').strip()


def number(text: str) -> float:
    try:
        return float(text.strip())
    except ValueError:
        raise Unsupported(f"{text.strip()!r} is not a number") from None


def body(source: str) -> list[str]:
    """The fence's lines without blanks and `%%` comments."""
    return [
        x.strip()
        for x in source.splitlines()
        if x.strip() and not x.strip().startswith("%%")
    ]


QUOTED = r'"([^"]*)"'


@dataclass
class Series:
    kind: str  # bar or line
    name: str
    values: list[float]


@dataclass
class XY:
    labels: list[str] = field(default_factory=list)
    y_title: str = ""
    series: list[Series] = field(default_factory=list)


def items(text: str) -> list[str]:
    """`[a, "b c", 3]` as its items."""
    if not (text.startswith("[") and text.endswith("]")):
        raise Unsupported(f"expected [ ... ], got {text[:24]!r}")
    return [
        unquote(x)
        for x in re.findall(
            r'\s*("[^"]*"|[^,\[\]]+)', text[1:-1]
        )  # a quoted item keeps its commas
        if x.strip()
    ]


def named(rest: str) -> tuple[str, str]:
    """An axis's or series's title, quoted or the words before its `[...]` or `lo --> hi`, and what follows it."""
    m = re.match(QUOTED, rest)
    if m:
        return m.group(1), rest[m.end() :].strip()
    m = re.match(r"(.*?)\s*(\[.*|[-+\d.]+\s*-->.*)?$", rest)
    assert m  # every text matches: the title alone at worst
    return m.group(1), m.group(2) or ""


def parse_xy(lines: list[str]) -> XY:
    xy = XY()
    x_range: tuple[float, float] | None = None
    for line in lines[1:]:
        key, rest = words(line)
        # A title, accTitle: or accDescr: says nothing of the values.
        if key == "title" or key.startswith("acc"):
            continue
        if key in ("x-axis", "y-axis"):
            name, rest = named(rest)
            lo, arrow, hi = rest.partition("-->")
            span = (number(lo), number(hi)) if arrow else None
            if key == "x-axis":
                x_range = span
                xy.labels = items(rest) if rest.startswith("[") else []
            else:
                xy.y_title = name
        elif key in ("bar", "line"):
            name, rest = named(rest)
            xy.series.append(Series(key, name, [number(v) for v in items(rest)]))
        else:
            raise Unsupported(f"unsupported {key}")
    if not xy.series:
        raise Unsupported("no bar or line series")
    first = xy.series[0]
    n = len(first.values)
    for s in xy.series:
        if len(s.values) != n or not n:
            raise Unsupported(
                f"{first.kind} has {n} values, {s.kind} has {len(s.values)}"
            )
    if xy.labels and len(xy.labels) != n:
        raise Unsupported(
            f"x-axis has {len(xy.labels)} labels, {first.kind} has {n} values"
        )
    if not xy.labels:
        lo, hi = x_range or (1, n)
        xy.labels = [num(lo + (hi - lo) * i / max(1, n - 1)) for i in range(n)]
    return xy


def num(v: float) -> str:
    """Three significant digits, thousands as K, M and B: `85`, `85.3`, `1.25K`."""
    for div, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if abs(v) >= div:
            return f"{v / div:.3g}{suffix}"
    return str(int(v)) if v == int(v) else f"{v:.3g}"


def unit_of(title: str) -> tuple[str, str, str]:
    """`Latency (ms)` as (`Latency`, prefix, suffix) for its ticks: `$4K`, `80%`, `120 ms`."""
    m = re.match(r"(.*?)\s*\(([^)]{1,8})\)\s*$", title)
    if not m:
        return title, "", ""
    name, unit = m.groups()
    unit = re.sub(r"^in\s+", "", unit)  # `Revenue (in $)`
    if unit in ("$", "€", "£"):
        return name, unit, ""
    return name, "", unit if unit == "%" else f" {unit}"


# What opens a gantt's keyword lines, which hold no task: Mermaid reads a keyword before a space (`Title: x` is a
# task), the accessibility ones before a colon.
KEYWORDS = {"acctitle:", "accdescr:"} | {
    k.lower()
    for k in (
        "gantt",
        "title",
        "dateFormat",
        "axisFormat",
        "tickInterval",
        "todayMarker",
        "displayMode",
        "weekday",
        "weekend",
        "section",
        "excludes",
        "includes",
        "inclusiveEndDates",
        "topAxis",
        "click",
        "vert",
        "accDescr",
    )
}


def task_line(line: str) -> tuple[str, str] | None:
    """A gantt task's name and data, split at its first colon followed by neither a space nor a clock time's minutes
    (`08:50`), else at its first colon; None without one.

    Mermaid splits at the first colon, so a name such as `You: approve` cut the task short (owner, 2026-10-27)."""
    colons = [i for i, c in enumerate(line) if c == ":"]
    data = [
        i
        for i in colons
        if not line[i + 1 : i + 2].isspace()
        and not (line[i - 1 : i].isdigit() and line[i + 1 : i + 2].isdigit())
    ]
    at = (data or colons or [None])[0]
    return None if at is None else (line[:at], line[at + 1 :])


def gantt_lines(source: str) -> Iterator[tuple[str, str]]:
    """Each line of a gantt fence and what it holds: `as written` (front matter, a `%%` directive, a blank), `section`,
    `keyword` or `task`."""
    front = False
    for i, x in enumerate(source.splitlines()):
        head = (x.split(None, 1) or [""])[0]
        if head == "---" and (front or not i):
            front = not front
            yield x, "as written"
        elif front or not head or head.startswith("%%"):
            yield x, "as written"
        elif head.lower() == "section":
            yield x, "section"
        else:
            yield x, "keyword" if head.lower() in KEYWORDS else "task"


def gantt_names(source: str, widest: int) -> str:
    """A gantt fence with each task name's colons drawn as `∶`, which Mermaid reads as text, and each section name
    cut to `widest` characters; front matter, `%%` directives and other keyword lines stay as written."""
    out = []
    for x, kind in gantt_lines(source):
        if kind == "section":
            head = x.split(None, 1)[0]
            lead, _, name = x.partition(head)
            if len(name.strip()) > widest:
                x = f"{lead}{head} {name.strip()[: widest - 1].rstrip()}…"
        elif kind == "task":
            split = task_line(x)
            if split and ":" in split[0]:
                x = f"{split[0].replace(':', '∶')}:{split[1]}"
        out.append(x)
    return "\n".join(out)


CLOCK_FORMAT = re.compile(r"(\s*dateFormat\s+)(H{1,2}:mm(?::ss)?)\s*", re.I)
BACK = timedelta(hours=6)  # how far a clock time may lie before the one before it
CLOCK = re.compile(r"(\s*)(\d{1,2}):(\d{2})(?::(\d{2}))?(\s*)")


def gantt_days(source: str, now: datetime) -> str:
    """A gantt fence dated in clock times only (`dateFormat HH:mm`) with each time given its day: its occurrence in
    the day from BACK before the time before it, the first's from BACK before `now`, so a plan past midnight runs on
    into the next day, a plan for tonight lies ahead and a section listed after a later one may start before it.
    Mermaid puts every clock time on the day it draws, which drew 03:05 twenty hours before the 23:45 step it follows
    (owner, 2026-10-27)."""
    if not any(CLOCK_FORMAT.fullmatch(x) for x in source.splitlines()):
        return source
    out, last = [], now
    for x, kind in gantt_lines(source):
        clock = CLOCK_FORMAT.fullmatch(x) if kind == "keyword" else None
        if clock:
            x = f"{clock[1]}YYYY-MM-DD {clock[2]}"
        elif kind == "task" and (split := task_line(x)):
            fields = split[1].split(",")
            for i, field in enumerate(fields):
                if t := CLOCK.fullmatch(field):
                    pad, h, m, sec, tail = t.groups()
                    since = last - BACK
                    last = since.replace(
                        hour=int(h), minute=int(m), second=int(sec or 0), microsecond=0
                    )
                    last += timedelta(days=last < since)
                    fields[i] = f"{pad}{last:%Y-%m-%d} {field.strip()}{tail}"
            x = f"{split[0]}:{','.join(fields)}"
        out.append(x)
    return "\n".join(out)
