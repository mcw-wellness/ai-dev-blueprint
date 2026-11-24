"""A mermaid fence in one line, for a surface without pictures: an xychart's first series from its source, a gantt's
progress and span and a flowchart's nodes and longest path as Mermaid read them. Any other fence, or an xychart this
does not follow, says its type and title."""

import html
import re
from datetime import UTC, datetime
from typing import Any

from fences import body, num, parse_xy, unit_of, unquote

ARROW = " → "


def hhmm(ms: float) -> str:
    return datetime.fromtimestamp(ms / 1000, UTC).strftime("%H:%MZ")


def day(ms: float) -> str:
    return datetime.fromtimestamp(ms / 1000, UTC).strftime("%m-%d")


def front(lines: list[str]) -> tuple[str, list[str]]:
    """The title of a leading `---` block, and the lines after it."""
    if lines[:1] != ["---"] or "---" not in lines[1:]:
        return "", lines
    end = lines.index("---", 1)
    title = next((unquote(x[6:]) for x in lines[1:end] if x.startswith("title:")), "")
    return title, lines[end + 1 :]


def titled(title: str, text: str) -> str:
    return f"{title}: {text}" if title else text


def xychart(lines: list[str], title: str) -> str:
    xy = parse_xy(lines)
    _, pre, post = unit_of(xy.y_title)
    fmt = lambda v: f"{pre}{num(v)}{post}"  # noqa: E731
    first = xy.series[0]
    peak = first.values.index(max(first.values))
    name = f"{first.name} " if first.name else ""
    text = (
        f"{name}{fmt(first.values[0])} at {xy.labels[0]} to {fmt(first.values[-1])} at {xy.labels[-1]}, "
        f"peak {fmt(first.values[peak])} at {xy.labels[peak]}"
    )
    more = len(xy.series) - 1
    return titled(title, text + (f"; {more} more series" if more else ""))


def gantt(name: str, tasks: list[dict[str, Any]]) -> str:
    """A gantt's progress and span, from its tasks as Mermaid read them."""
    t0, t1 = min(t["start"] for t in tasks), max(t["end"] for t in tasks)
    dated = day(t0) != day(t1)
    at = lambda ms: f"{day(ms)} {hhmm(ms)}" if dated else hhmm(ms)  # noqa: E731
    done = sum(t["done"] for t in tasks)
    active = sum(t["active"] for t in tasks)
    text = f"{done} of {len(tasks)} done"
    if active:
        text += f" · {active} active"
    if done < len(tasks):
        text += f" · ends {at(t1)}"
    return titled(name, f"{text}; {at(t0)} to {at(t1)}")


def label(text: str) -> str:
    """A node's text as drawn: a line break a space, tags gone, Mermaid's escapes (`#quot;`, which it keeps as
    `ﬂ°quot¶ß`) and HTML's decoded."""
    text = text.strip("`").replace("ﬂ°°", "&#").replace("ﬂ°", "&").replace("¶ß", ";")
    text = re.sub(r"</?[a-zA-Z][^<>]*>", "", re.sub(r"\s*<br\s*/?>\s*", " ", text))
    return html.unescape(text)


def flowchart(title: str, nodes: list[list[str]], edges: list[list[str]]) -> str:
    """A flowchart's size and longest path, from its nodes and edges as Mermaid read them."""
    names = {n: label(text) for n, text in nodes}
    links = {(a, b) for a, b in edges}
    text = f"flowchart of {len(names)} nodes, {len(links)} links"
    path = [names[n] for n in longest(list(names), links)]
    if not path:
        return titled(title, f"{text}, with a cycle")
    if len(path) < 2:
        return titled(title, text)
    steps = f" ({len(path)} steps)" if len(path) > 5 else ""
    shown = [*path[:2], "…", *path[-2:]] if steps else path
    return titled(title, f"{text}; longest path {ARROW.join(shown)}{steps}")


def longest(nodes: list[str], links: set[tuple[str, str]]) -> list[str]:
    """The longest path along the links, or none when they hold a cycle."""
    into = {n: sum(b == n for _, b in links) for n in nodes}
    ready = [n for n in nodes if not into[n]]
    best = {n: [n] for n in nodes}  # the longest path ending at each node
    done = 0
    while ready:
        n = ready.pop(0)  # in the source's order: of equal paths, the first written
        done += 1
        for a, b in sorted(links):
            if a == n:
                if len(best[n]) + 1 > len(best[b]):
                    best[b] = [*best[n], b]
                into[b] -= 1
                if not into[b]:
                    ready.append(b)
    return max(best.values(), key=len, default=[]) if done == len(nodes) else []


def alt(source: str, drawn: dict[str, Any]) -> str:
    """The fence in one line, from its source and what Mermaid read of it (`drawn`)."""
    title, lines = front(body(source))
    # Mermaid's title, HTML-escaped (`R&amp;D`), is the body's; a front matter's it leaves out.
    title = html.unescape(drawn["title"]) or title
    if drawn.get("tasks"):
        return gantt(title, drawn["tasks"])
    if drawn.get("nodes"):
        return flowchart(title, drawn["nodes"], drawn["edges"])
    kind = lines[0].split()[0]
    if kind == "xychart-beta":
        try:
            return xychart(lines, title)
        except ValueError:
            pass
    return titled(title, f"{kind} diagram")
