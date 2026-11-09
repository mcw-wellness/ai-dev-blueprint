#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow==12.0.0"]
# ///
"""A reply's mermaid fence as a picture: Mermaid's own script draws the body on stdin in Playwright's
chrome-headless-shell, in the plugin's light palette (for a dark terminal, light text and rules on the page), at most
COLUMNS terminal cells wide (and WIDEST, WIDE for a flowchart or gantt) and TALLEST rows tall, a small diagram at its
own size.

    mermaid.py OUT_FILE COLUMNS [light|dark] < fence-body

Prints `{"file", "columns", "rows", "alt"}`: the PNG, the cells it fills and the fence in one line. A body Mermaid
refuses, or a missing shell, exits 1, the reason the last line on stderr. Gantt times are UTC.
"""

import json
import math
import os
import re
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from alt import alt, front
from fences import body, gantt_days, gantt_names, parse_xy
from PIL import Image

# A Ghostty cell at its default 13 pt font on a 2x display (Claude Code's probe reports 16x34 px).
CELL_W, CELL_H = 16, 34
HOUR = 3_600_000
# The website style's light tokens; BG is the light on a filled mark.
BG, INK, MUTED, LINE = "#fffefd", "#20302f", "#6a7976", "#dfe6e3"
ACCENT, WARN = "#2d7168", "#96560d"
WARN_SOFT, ACCENT_SOFT = "#fdf5ea", "#e8f1ef"
ZEBRA = "#f6f8f7"  # Mermaid's section fill
DONE, OWNER, FAILED = "#1f8a5c", "#b8409e", "#d23a20"
TODO, PLAN = "#a3aeab", "#c9d3cf"

# A dark terminal's ink for what sits on the transparent page, its own background: text, axes, rules and section bands
# at 4.5:1 or more on #1e1e1e. Marks keep their light fills and the text drawn on them.
NIGHT_INK, NIGHT_MUTED = "#e3e9e7", "#a3b0ad"
NIGHT_LINE, NIGHT_ZEBRA = "#3b4543", "#272d2c"

# Mermaid 11.4.1's dist/mermaid.min.js from jsdelivr, sha256 a43bc1afd446f9c4cc66ac5dd45d02e8d65e26fc5344ec0ef787f88d6ddb6f9e.
SCRIPT = Path(__file__).resolve().parent / "vendor" / "mermaid-11.4.1.min.js"
# Playwright's browser cache; never Google Chrome.app, whose headless launch took over the owner's browser.
SHELLS = Path.home() / ("Library/Caches" if sys.platform == "darwin" else ".cache") / "ms-playwright"
SHELL = "chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell"
INSTALL = "uvx playwright install chromium-headless-shell"
WIDEST = 100  # cells: a wider chart grows taller with it, past what a reply needs
# A flowchart or gantt may take the transcript's width (owner, 2026-10-27: "take more advantage of its width"): a
# flowchart keeps its own size, so more room only spares it shrinking or turning; a gantt's bars spread out.
WIDE = 200
TALLEST = 120  # rows: a taller diagram is drawn smaller, down to READABLE
READABLE = 0.75  # the smallest scale whose text still reads beside the terminal's
# Pixels per CSS pixel: Mermaid's 16 px text at about 0.85 of the terminal's (owner, 2026-10-27: "oversized symbols").
ZOOM = 1.4
# A reply's series: blue, teal and two slates, none of the hues that mean done, running or failed in the reply's text.
SERIES = ("#2a78d6", "#12968c", "#56606e", "#9aa7b8")
# A running gantt task in the hue the reply's text draws `Running` in.
ACTIVE = "#d77757"
# A flowchart node's state, `A:::done`, in the colors the reply's text draws those words in; a fence's own classDef wins.
STATES = {
    "done": (DONE, BG),
    "running": (ACTIVE, BG),
    "blocked": (FAILED, BG),
    "next": (TODO, INK),
    "you": (OWNER, BG),
}
DAY = 24 * HOUR

THEME = {
    "background": BG,
    "fontFamily": "system-ui, -apple-system, Helvetica, sans-serif",
    "primaryColor": ACCENT_SOFT,
    "primaryBorderColor": ACCENT,
    "primaryTextColor": INK,
    "secondaryColor": ZEBRA,
    "tertiaryColor": BG,
    "clusterBkg": "transparent",
    "clusterBorder": PLAN,
    "lineColor": MUTED,
    "textColor": INK,
    "noteBkgColor": WARN_SOFT,
    "noteBorderColor": WARN,
    "sectionBkgColor": ZEBRA,
    "altSectionBkgColor": "transparent",
    "sectionBkgColor2": ZEBRA,
    "gridColor": LINE,
    "taskBkgColor": TODO,
    "taskBorderColor": TODO,
    "taskTextColor": INK,
    "taskTextDarkColor": INK,
    "taskTextOutsideColor": INK,
    "doneTaskBkgColor": DONE,
    "doneTaskBorderColor": DONE,
    "activeTaskBkgColor": ACTIVE,
    "activeTaskBorderColor": ACTIVE,
    "critBkgColor": TODO,
    "critBorderColor": INK,
    **{f"pie{i + 1}": c for i, c in enumerate(SERIES)},
    "pieStrokeColor": BG,
    "pieOpacity": "1",
    "xyChart": {
        "backgroundColor": "transparent",
        "plotColorPalette": ", ".join(SERIES),
    },
}
NIGHT = {
    # Mermaid's gantt draws a task's name beside its bar, and a done one's in it, in taskTextDarkColor; PAGE keeps INK
    # in the bar.
    **dict.fromkeys(
        (
            "textColor",
            "titleColor",
            "loopTextColor",
            "taskTextOutsideColor",
            "taskTextDarkColor",
        ),
        NIGHT_INK,
    ),
    "lineColor": NIGHT_MUTED,
    "gridColor": NIGHT_LINE,
    "sectionBkgColor": NIGHT_ZEBRA,
    "sectionBkgColor2": NIGHT_ZEBRA,
    "xyChart": {
        **THEME["xyChart"],
        "titleColor": NIGHT_INK,
        **{
            f"{a}Axis{p}Color": NIGHT_INK
            for a in "xy"
            for p in ("Title", "Label", "Tick", "Line")
        },
    },
}
# Mermaid's script, the fence and its configuration on a page sized to the room; the diagram scaled to fit it, its size
# (with a gantt's title and tasks as Mermaid read them) or why there is none logged on one console line. A gantt's axis
# says clock times for a plan within a day, the day too for a few days, one label a day past that; it marks the time it
# was drawn with Mermaid's red line, dashed (owner, 2026-10-27: a line for the current time); the shell runs in UTC, the
# clock a reply's times are in. Its text should read beside the terminal's (owner, 2026-10-27: "clearly legible") in as
# few rows as it can ("bad use of my screen space"; compact diagrams that use the width): a flowchart is drawn as
# written, tighter and turned the other way, keeping the drawing of fewest rows at READABLE or larger; with none, it
# is refused. A node's first line is its title, bold, as is a group's; the page is transparent, so the picture takes
# the terminal's own background (owner, 2026-10-27). A group, or a node only a `style` line names, is no node.
PAGE = """<!doctype html><meta charset="utf-8">
<style>body {{ margin: 0; background: transparent }} .today {{ stroke-width: 2px; stroke-dasharray: 6 4 }}
.grid .tick line {{ stroke: {line} }} #chart0 text.taskText {{ fill: {ink} !important }} .cluster-label, .nodeLabel p:has(br)::first-line {{ font-weight: 600 }}</style>
<body>
<script src="{script}"></script>
<script>
const [W, H, DAY, READABLE, config, src] = [{w}, {h}, {day}, {readable}, {config}, {source}]
const say = o => console.log('MERMAID ' + JSON.stringify(o))
;(async () => {{
  mermaid.initialize(config)
  const d = await mermaid.mermaidAPI.getDiagramFromText(src)
  const tasks = d.type === 'gantt' ? d.db.getTasks().map(t => ({{ name: t.task.trim(), start: +t.startTime, end: +t.endTime, done: !!t.done, active: !!t.active, section: t.section }})) : null
  const title = d.db.getDiagramTitle?.() || ''
  const flow = d.type.startsWith('flowchart'), groups = new Set(flow ? d.db.getSubGraphs().map(g => g.id) : [])
  const linked = flow ? d.db.getEdges().map(e => [e.start, e.end]) : []
  // A `style` line names a node Mermaid keeps even when nothing else does.
  const styled = new Set([...src.matchAll(/^\\s*style\\s+(\\S+)/gm)].map(m => m[1]))
  const lone = n => styled.has(n.id) && !n.type && !linked.flat().includes(n.id)
  const graph = flow ? {{ nodes: [...d.db.getVertices().values()].filter(n => !groups.has(n.id) && !lone(n)).map(n => [n.id, n.text]), edges: linked.filter(e => !e.some(n => groups.has(n))) }} : {{}}
  if (tasks?.length) {{
    const span = Math.max(...tasks.map(t => t.end)) - Math.min(...tasks.map(t => t.start))
    config.gantt.axisFormat = span <= DAY ? '%H:%M' : span <= 4 * DAY ? '%m-%d %H:%M' : '%m-%d'
    if (span > 4 * DAY && span <= 12 * DAY) config.gantt.tickInterval = '1day'
    // Room left of the bars for the longest section name, which Mermaid's 75 px would print over them.
    config.gantt.leftPadding = Math.max(75, 16 + 8 * Math.max(...tasks.map(t => (t.section || '').length)))
    mermaid.initialize(config)
  }}
  const turned = src.replace(/^(\\s*(?:flowchart(?:-elk)?|graph))(?![\\w:-])(?:[ \\t]+(LR|RL|TB|TD|BT))?/m, (_, head, dir) => `${{head}} ${{/LR|RL/.test(dir) ? 'TB' : 'LR'}}`)
  const tight = {{ ...config, flowchart: config.tight }}
  const tries = graph.nodes ? [[src, config], [src, tight], [turned, config], [turned, tight]] : [[src, config]]
  let best
  for (const [i, [text, c]] of tries.entries()) {{
    mermaid.initialize(c)
    let svg
    try {{
      ({{ svg }} = await mermaid.render(`chart${{i}}`, text))
    }} catch (e) {{
      if (!i) throw e
      continue  // only the fence as written must draw
    }}
    if (svg.includes('Maximum text size')) throw new Error('too long for Mermaid to draw')
    document.body.innerHTML = svg
    const s = document.querySelector('svg'), box = s.getBoundingClientRect(), v = s.viewBox.baseVal
    const [w, h] = v && v.width ? [v.width, v.height] : [box.width, box.height]
    const k = Math.min(1, W / w, H / h)
    // Screen rows are what a reply spends: of the readable drawings the shortest wins, else the largest.
    const readable = k >= READABLE, rows = h * k
    if (!best || (readable && !best.readable) || (readable === best.readable && (readable ? rows < best.rows : k > best.k))) best = {{ svg, w, h, k, readable, rows }}
  }}
  const {{ svg, w, h, k }} = best
  if (k < READABLE) throw new Error(`too big to read at this width (drawn at ${{Math.round(k * 100)}}%): split it`)
  document.body.innerHTML = svg
  const s = document.querySelector('svg')
  s.removeAttribute('style')
  s.setAttribute('width', w * k)
  s.setAttribute('height', h * k)
  say({{ width: w * k, height: h * k, axis: config.gantt.axisFormat, title, tasks, ...graph }})
}})().catch(e => say({{ error: String(e.message || e) }}))
</script>"""
SAID = re.compile(r'"MERMAID (\{.*\})", source:')


class Refused(Exception):
    """Why no picture: the reason in one line."""


def shell() -> Path:
    found = sorted(
        SHELLS.glob(SHELL), key=lambda p: int(re.sub(r"\D", "", p.parts[-3]) or 0)
    )
    if not found:
        raise Refused(f"no chrome-headless-shell under {SHELLS}: run {INSTALL}")
    return found[-1]


def from_zero(source: str, fence: list[str]) -> str:
    """An xychart's bars measured from zero: Mermaid starts an axis it is not given near the smallest value, so the
    bars overstate differences (owner's /demo, 2026-10-27). `fence`: its lines after any front matter. Mermaid draws
    every bar up from the plot's bottom, so bars on an axis below zero, theirs or a line's, are refused."""
    lines = source.splitlines()
    try:
        xy = parse_xy(fence)
    except ValueError:
        return source
    values = [v for s in xy.series for v in s.values]
    axis = [i for i, x in enumerate(lines) if x.strip().startswith("y-axis")]
    if not any(s.kind == "bar" for s in xy.series):
        return source
    if min(values) < 0:
        raise Refused(
            "mermaid: bars below zero are drawn up from the axis's bottom: draw every series as a line"
        )
    if any("-->" in lines[i] for i in axis):
        return source
    top = Decimal(
        repr(max(values) or 1)
    ).normalize()  # all zero: an axis to 1, not around 0
    span = f"0 --> {format(top, 'f')}"  # Mermaid reads no exponent
    if axis:
        lines[axis[0]] += f" {span}"
    else:
        head = next(
            i for i, x in enumerate(lines) if x.strip().startswith("xychart-beta")
        )
        lines.insert(head + 1, f"  y-axis {span}")
    return "\n".join(lines)


def page(source: str, columns: int, dark: bool = False) -> tuple[str, int, int]:
    """The page drawing the fence in `columns` cells and TALLEST rows, and its window's size in CSS pixels; `dark`: for
    a dark terminal."""
    lines = front(body(source))[1]
    kind = lines[0].split()[0] if lines else ""
    graph = kind in ("flowchart", "flowchart-elk", "graph")
    columns = max(20, min(columns, WIDE if graph or kind == "gantt" else WIDEST))
    w, h = math.floor(columns * CELL_W / ZOOM), math.floor(TALLEST * CELL_H / ZOOM)
    # An xychart fills the width at the reply's proportions, a wide and short picture rather than a page.
    aspect = min(0.55, 0.36 + (WIDEST - columns) * 0.0045)
    gantt = {"fontSize": 14, "sectionFontSize": 14, "barHeight": 22, "useWidth": w}
    drawn = source
    if kind == "gantt":
        # A section name at most a third of the width, so the bars keep the rest (the page's gutter is 8 px a letter).
        drawn = gantt_names(
            gantt_days(source, datetime.now(UTC)), round((w / 3 - 16) / 8)
        )
    elif kind == "xychart-beta":
        drawn = from_zero(source, lines)
    elif graph:
        own = {
            c for d in re.findall(r"classDef\s+([\w,]+)", source) for c in d.split(",")
        }
        drawn += "".join(
            f"\n  classDef {c} fill:{fill},stroke:{fill},color:{ink}"
            for c, (fill, ink) in STATES.items()
            if c not in own
        )
    config = {
        "startOnLoad": False,
        "theme": "base",
        "themeVariables": {**THEME, **NIGHT} if dark else THEME,
        "gantt": {**gantt, "axisFormat": "%Y-%m-%d"},
        # Compact: nodes and ranks closer than Mermaid's 50 px, labels padded 8 px, not 15 (owner, 2026-10-27).
        "flowchart": {"nodeSpacing": 30, "rankSpacing": 40, "padding": 8},
        # The retry for a flowchart too wide to read.
        "tight": {
            "nodeSpacing": 20,
            "rankSpacing": 28,
            "padding": 6,
            "wrappingWidth": 160,
        },
        "xyChart": {"width": w, "height": round(w * aspect)},
    }
    html = PAGE.format(
        line=NIGHT_LINE if dark else LINE,
        ink=INK,
        script=SCRIPT.as_uri(),
        w=w,
        h=h,
        day=DAY,
        readable=READABLE,
        config=json.dumps(config),
        source=json.dumps(drawn).replace("</", "<\\/"),
    )
    return html, w, h


def draw(
    source: str, columns: int, out: Path, dark: bool = False
) -> tuple[int, int, dict[str, Any]]:
    """The fence drawn into `out` at most `columns` cells wide; the cells it fills, and what Mermaid read."""
    html, w, h = page(source, columns, dark)
    with tempfile.TemporaryDirectory() as tmp:
        url, shot = Path(tmp) / "page.html", Path(tmp) / "shot.png"
        url.write_text(html)
        argv = [
            str(shell()),
            f"--screenshot={shot}",
            f"--window-size={w},{h}",
            f"--force-device-scale-factor={ZOOM}",
            "--default-background-color=00000000",
        ]
        # Ubuntu's AppArmor refuses Chromium's user-namespace sandbox (SIGTRAP, exit -5); the page is our own file.
        if sys.platform == "linux":
            argv.append("--no-sandbox")
        argv += [
            "--virtual-time-budget=5000",
            "--hide-scrollbars",
            "--enable-logging=stderr",
            "--v=0",
            url.as_uri(),
        ]
        ran = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=30,
            env={**os.environ, "TZ": "UTC"},
        )
        said = SAID.search(ran.stderr)
        if not said or not shot.is_file():
            raise Refused(f"chrome-headless-shell drew nothing (exit {ran.returncode})")
        size = json.loads(said.group(1))
        if "error" in size:
            raise Refused(f"mermaid: {size['error'].splitlines()[0].rstrip(':')[:120]}")
        pw, ph = math.ceil(size["width"] * ZOOM), math.ceil(size["height"] * ZOOM)
        cols, rows = math.ceil(pw / CELL_W), math.ceil(ph / CELL_H)
        # Whole cells, the slack of the last row split above and below.
        picture = Image.new("RGBA", (cols * CELL_W, rows * CELL_H))
        with Image.open(shot) as drawn:
            picture.paste(
                drawn.convert("RGBA").crop((0, 0, pw, ph)),
                (0, (rows * CELL_H - ph) // 2),
            )
    out.parent.mkdir(parents=True, exist_ok=True)
    picture.save(out)
    return cols, rows, size


def main() -> None:
    out, columns, dark = Path(sys.argv[1]), int(sys.argv[2]), sys.argv[3:] == ["dark"]
    source = sys.stdin.read()
    try:
        cols, rows, said = draw(source, columns, out, dark)
    except Refused as e:
        sys.exit(str(e))
    print(
        json.dumps(
            {
                "file": str(out.resolve()),
                "columns": cols,
                "rows": rows,
                "alt": alt(source, said),
            }
        )
    )


if __name__ == "__main__":
    main()
