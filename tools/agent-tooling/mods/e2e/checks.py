"""The checks on each run's final screen: every renderer feature `reply.md` and the session's shell calls exercise."""

import base64
import re
from pathlib import Path

from capture import (
    ALERTS,
    CLAUDE,
    ERROR,
    INACTIVE,
    INVERSE,
    MERGED,
    PERMISSION,
    PLACEHOLDER,
    SUBTLE,
    SUCCESS,
    TEXT,
    TINT,
    WARNING,
    Capture,
)


def check_reply(c: Capture) -> None:
    """Every renderer feature, as `reply.md` and the session's shell calls exercise it."""
    lines = c.text()
    c.check("whole transcript on screen", c.find("❯ blocked?")[0] >= 0)
    # Every verdict word a badge on its role's color.
    for word, bg in ((" Not done: ", ERROR), (" Running: ", CLAUDE)):
        c.styled(
            f"verdict {word.strip()}", word, blank=True, bg=bg, fg=INVERSE, bold=True
        )
    # Shell calls: description, then the command; a failure's exit code and last lines.
    c.styled("shell row description", "Show working tree status", fg=INACTIVE)
    c.styled("shell row command", "· git status --short", fg=SUBTLE)
    y = c.styled("failed shell row", "Run the band tests", fg=INACTIVE)
    c.styled("failed shell exit code", "Exit code 1", after=y, fg=ERROR, bold=True)
    tail = ("collected 3 items", "FAILED tests/t.py::test_pack", "1 failed, 2 passed")
    at = [c.find(t, y)[0] for t in tail]
    c.check(
        "failed shell tail", y < at[0] and at == list(range(at[0], at[0] + 3)), str(at)
    )
    # The line naming the failure red, the rest muted.
    c.styled("failure line red", tail[1], after=y, fg=ERROR)
    c.styled("other tail lines muted", tail[0], after=y, fg=SUBTLE)
    c.check(
        "failed shell head hidden",
        c.find("platform darwin")[0] < 0 and c.find("+1 lines", y)[0] > y,
    )
    stock = c.find("Bash(")[0] >= 0 or c.find("Ran 2 shell")[0] >= 0
    c.check("no stock shell rows", not stock)
    # The leading verdict a badge in its color, the rest of its paragraph plain.
    y = c.styled(
        "verdict badge", " Done. ", blank=True, bg=SUCCESS, fg=INVERSE, bold=True
    )
    rest = "Every renderer feature"
    c.styled("verdict rest", rest, after=y, fg="default", bold=False)
    # `#` and `##` headings: the text bold over a rule.
    for title in ("Renderer check", "Compact table", "Charts"):
        y = next((i for i, line in enumerate(lines) if line.strip() == title), -1)
        if c.check(f"heading {title!r}", y >= 0):
            c.styled(f"heading {title!r} bold", title, after=y, bold=True)
            rule = lines[y + 1].strip()
            ruled = len(rule) > 10 and set(rule) == {"─"}
            c.check(f"heading {title!r} rule", ruled, rule[:20])
            c.styled(f"heading {title!r} rule color", rule[:10], after=y + 1, fg=SUBTLE)
    marks = any(s.lstrip().startswith(("# ", "## ")) for s in lines)
    c.check("no heading marks", not marks)
    # The fitted table: a bold header over a rule, state words and You colored, a muted rule
    # between every two rows, no row shaded.
    y = c.styled("table header", "Feature", bold=True)
    end = c.find("Compact table")[0]
    c.check("table rule", y >= 0 and set(lines[y + 1].strip()) == {"─"})
    c.check("table without pipes", not any("|" in s for s in lines[max(y, 0) : end]))
    # Each state word after its glyph (a no-break space between), both in the state's color, in the first column as
    # /progress writes it; a link in a cell shows its text, not its target.
    c.styled("state Done", "✓\u00a0Done, live", after=y, part="✓\u00a0Done", fg=SUCCESS)
    c.check("link text in a cell", c.find("since #86", y)[0] > y)
    c.check("no link target", not any("https://" in s for s in lines[max(y, 0) : end]))
    running = c.styled("state Running", "◐\u00a0Running", fg=CLAUDE)
    blocked = c.styled("state Blocked", "✗\u00a0Blocked", fg=ERROR)
    c.styled("owner You", "You:", after=y, part="You", fg=MERGED, bold=True)
    for row in (running, blocked):
        ruled = set(lines[row - 1].strip()) == {"─"}
        if c.check(f"rule above row {row - y}", ruled, lines[row - 1]):
            x = lines[row - 1].index("─")
            c.styled(f"row rule {row - y} muted", "─", after=row - 2, fg=SUBTLE)
            edge = len(lines[y]) - len(lines[y].lstrip())
            c.check(f"row rule {row - y} at the table's edge", x == edge)
    for row in (running - 2, running, blocked):
        shaded = any(cell.bg != "default" for cell in c.screen.buffer[row].values())
        c.check(f"row {row - y} unshaded", not shaded)
    # The compact table: a rule between rows too, figures flush right.
    y = c.find("10-25 start")[0]
    compact = ("10-25 start|13|11,745", "10-26 peak|15|13,989", "Now|9|5,555")
    rows = [r.split("|") for r in compact]
    apart = all(r[0] in lines[y + 2 * k] for k, r in enumerate(rows))
    apart &= all(set(lines[y + 2 * k + 1].strip()) == {"─"} for k in range(2))
    if c.check("compact rows a rule apart", apart):
        ends = [
            [c.find(n, y + 2 * k)[1] + len(n) for n in r[1:]]
            for k, r in enumerate(rows)
        ]
        c.check("figures flush right", all(e == ends[0] for e in ends), str(ends))
    # A plain quote stays the engine's; each alert is a round box, its label and border in its level's color.
    y = c.find("A plain quote stays as the engine draws it.")[0]
    if c.check("plain quote shown", y >= 0):
        c.check(
            "plain quote not boxed", "│" not in lines[y] and "╭" not in lines[y - 1]
        )
    for label, color in ALERTS.items():
        badge = f" {label} "
        y = c.styled(f"alert {label} badge", badge, bg=color, fg=INVERSE, bold=True)
        if y >= 0:
            top = c.styled(f"alert {label} top border", "╭─", after=y - 1, fg=color)
            c.check(f"alert {label} border on the line above", top == y - 1)
            # The label leads the body's first line: a one-line alert is three rows.
            body = f"{label} body text." in lines[y] and "╰" in lines[y + 1]
            c.check(f"alert {label} body beside badge", body)
    c.check("no alert marks", not any("[!" in s for s in lines))


def check_charts_alt(c: Capture) -> None:
    """Without pictures, each chart fence is its one-line alt, never the fence."""
    c.styled("xychart alt", "Lines per PR:", fg=INACTIVE)
    c.styled("gantt alt", "Renderer PRs:", fg=INACTIVE)
    c.styled("flowchart alt", "flowchart of 6 nodes", fg=INACTIVE)
    for mark in (
        "```",
        "xychart-beta",
        "gantt",
        "flowchart LR",
        "drawing chart",
        "⚠ chart",
    ):
        c.check(f"no {mark!r}", c.find(mark)[0] < 0)


def check_charts_kitty(c: Capture) -> None:
    """In a terminal taking kitty pictures, each chart is sent as a PNG file and placed over cells."""
    sent = re.findall(rb"\x1b_G([^;\x1b]*);([^\x1b]*)\x1b\\", c.raw)
    files = [
        Path(base64.b64decode(data).decode())
        for keys, data in sent
        if b"a=T" in keys and b"t=f" in keys
    ]
    c.check("three pictures sent", len(files) == 3, f"{len(files)} sent")
    for f in files:
        c.check(
            "picture is a PNG", f.is_file() and f.read_bytes()[:4] == b"\x89PNG", str(f)
        )
    # A placeholder cell's color names its picture: three colors, each over a block of cells.
    placed: dict[str, int] = {}
    for y in range(max(c.find("Charts")[0], 0), c.screen.lines):
        for cell in c.screen.buffer[y].values():
            if cell.data[:1] == PLACEHOLDER:
                placed[cell.fg] = placed.get(cell.fg, 0) + 1
    each = len(placed) == 3 and min(placed.values()) > 50
    c.check("each picture placed", each, str(placed))
    for alt in ("Lines per PR:", "Renderer PRs:", "flowchart of", "⚠ chart"):
        c.check(f"no alt {alt!r}", c.find(alt)[0] < 0)


def check_reply_band(c: Capture) -> None:
    """The reply's Needs you badge and chips, so the band's title alone below the transcript; the tab's title 🔴."""
    y = c.styled(
        "Needs you badge", " Needs you ", blank=True, bg=ERROR, fg=INVERSE, bold=True
    )
    c.check("Needs you badge without its marks", "Needs you:" not in c.text()[y])
    # Its offered replies drawn as the band's chips: the recommended one bold on its green, the other on the gray tint.
    c.styled("reply chip reloaded", "[ ★ reloaded ]", y, "reloaded", bold=True)
    c.styled("go badge", " Your go ", y, blank=True, bg=WARNING, fg=INVERSE, bold=True)
    c.styled("reply chip later in the reply", "[ later ]", y, "later", fg=TEXT, bg=TINT)
    # Draft fences in a row under a decision are its replies: chips, never frames.
    c.styled("fenced reply chip", "[ glue in interface/ ]", y, "glue", fg=TEXT, bg=TINT)
    y = c.styled("band title", "Needs you  ", after=y + 1, fg=ERROR, bold=True)
    c.check("band counts", "4 decisions · 2 drafts" in c.text()[y], c.text()[y])
    c.check("band title alone", not c.rows() and c.find("Draft: Renderer:", y)[0] < 0)
    c.check("tab title leads with 🔴", c.screen.title.startswith("🔴 "), c.screen.title)


def check_band(c: Capture) -> None:
    """The Reply band's rows, the reply's block and draft off screen: numbers, points, chips, `explain`, the draft's row."""
    y = c.styled("band title", "Needs you  ", after=c.band(), fg=ERROR, bold=True)
    if y >= 0:
        row = c.styled("band row number", " 1 ", after=y + 1, bg=ERROR)
        c.check("band row names the decision", "Reload the renderer" in c.text()[row])
        second = c.styled("band second row number", " 2 ", after=row + 1, bg=ERROR)
        c.check("band row 2 point", "Keep the demo" in c.text()[second])
        c.styled("band go badge", " Your go ", second + 1, blank=True, bg=WARNING)
        # The recommended reply bold on its green, the other on the chips' gray tint.
        c.styled("band reply reloaded", "[ ★ reloaded ]", y, "reloaded", bold=True)
        c.styled("band reply later", "[ later ]", y, "later", fg=TEXT, bg=TINT)
        c.check("band explain", c.find("explain", y)[0] > y)
        # The draft's row after the decisions: its number in blue and its copy chip on the chips' tint.
        row = c.styled("band draft row number", " 5 ", after=second + 3, bg=PERMISSION)
        c.check("band draft row names the draft", "Draft: Renderer:" in c.text()[row])
        c.styled("band copy chip", "[ copy ]", row, "copy", fg=TEXT, bg=TINT)


def check_draft(c: Capture) -> None:
    """A draft fence: framed in blue under its label and copy chip, its markdown drawn, never the fence."""
    y = c.styled(
        "draft label", " Draft ", blank=True, bg=PERMISSION, fg=INVERSE, bold=True
    )
    if y < 0:
        return
    c.styled("draft copy chip", "[ copy ]", y, "copy", fg=TEXT, bg=TINT)
    c.styled("draft frame top", "╭─", after=y - 1, fg=PERMISSION)
    c.check("draft frame on the line above", c.find("╭─", y - 1)[0] == y - 1)
    c.styled("draft body bold", "Renderer:", after=y, bold=True)
    item = c.find("Alerts are boxes", y)[0]
    c.check("draft list item framed", item > y and "│" in c.text()[item])
    c.check("draft frame bottom", c.find("╰─", item)[0] == item + 1)
    c.check("no draft fence", c.find("```draft")[0] < 0)
    # A one-line draft's frame fits its header and line; the long one's its widest line (owner, 2026-10-27).
    for line, width in (("Paper restarts at 10:00Z.", 29), ("Renderer: tables", 61)):
        width = min(width, c.columns - 2)
        top = c.text()[c.find(line)[0] - 2].strip()
        c.check(f"draft frame {width} wide", len(top) == width and top[0] == "╭", top)


def check_band_classic(c: Capture) -> None:
    """Off fullscreen no click reaches the band: its hint names the chord that hides it."""
    y = c.band()
    hint = c.text()[y] if y >= 0 else "no band"
    c.check("classic band hint names the chord", "ctrl+x ctrl+a hides" in hint, hint)
    c.check("classic band keeps its rows", c.rows())


def check_hidden(c: Capture) -> None:
    """One click on `hide` puts the band away, and a redraw does not bring it back."""
    y = c.band()
    c.check("band gone after hide and a redraw", y < 0, c.text()[y])
    c.check("reply still shown", c.find("Reload the renderer")[0] >= 0)
