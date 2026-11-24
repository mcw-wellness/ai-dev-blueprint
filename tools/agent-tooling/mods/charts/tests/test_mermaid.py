"""mermaid.py: a reply's mermaid fence drawn by Mermaid in the headless shell to the reply's width, its alt
text read from the source, and a fence Mermaid refuses or a missing shell said in one line."""

import io
import json
import re
import sys
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

import fences
import mermaid
from alt import alt
from mermaid import CELL_H, CELL_W
from fences import body

H = 3_600_000
XY = """xychart-beta
  title "p95 order-ack latency"
  x-axis [Mon, Tue, "Wed 3", Thu]
  y-axis "Latency (ms)"
  %% before and after the pinning change
  line "before" [182, 176, 190, 205]
  bar "after" [121, 118, 96, 88]
"""
GANTT = """gantt
  title Rollout
  dateFormat YYYY-MM-DDTHH:mm
  axisFormat %H:%M
  section Build
  palette :done, p1, 2026-10-26T05:00, 40m
  charts  :active, crit, b1, after p1, 4h
  tables  :a1, 2026-10-26T05:40, 3h
  section Land
  review  :r1, after b1 a1, 1h
  merge   :milestone, 0m
"""


def test_xychart_reads_titles_labels_series_and_unit() -> None:
    xy = fences.parse_xy(body(XY))
    assert (xy.labels, xy.y_title) == (
        ["Mon", "Tue", "Wed 3", "Thu"],
        "Latency (ms)",
    )
    assert [(s.kind, s.name, s.values) for s in xy.series] == [
        ("line", "before", [182, 176, 190, 205]),
        ("bar", "after", [121, 118, 96, 88]),
    ]
    assert fences.unit_of("Latency (ms)") == ("Latency", "", " ms")
    assert fences.unit_of("Cost ($)") == ("Cost", "$", "")
    # A numeric x-axis labels its points across its range; a bare one counts them.
    ranged = fences.parse_xy(body("xychart-beta\n x-axis 0 --> 30\n bar [1, 2, 3, 4]"))
    assert ranged.labels == ["0", "10", "20", "30"]
    assert fences.parse_xy(["xychart-beta", "line [5, 6]"]).labels == ["1", "2"]
    # An unquoted title before a range or a list, as mermaid allows.
    named = fences.parse_xy(
        [
            "xychart-beta",
            "x-axis Time 0 --> 30",
            "y-axis Requests 0 --> 9",
            "line [1, 2]",
        ]
    )
    assert (named.labels, named.y_title) == (["0", "30"], "Requests")
    assert fences.items('["alpha", "beta,gamma", delta]') == [
        "alpha",
        "beta,gamma",
        "delta",
    ]


FLOW = """---
title: Renderer PRs
---
flowchart LR
  A[E2E harness] --> C[Verify]
  B["Stale marker"] --> C
  C --> D(Polish #107) -- then --> E{{Hint and rules}}
  C -->|later| F["Band fix; then hide"]:::running & G
  classDef running fill:#fde8df
"""


@pytest.mark.parametrize(
    ("source", "said"),
    [
        (
            XY,
            "p95 order-ack latency: before 182 ms at Mon to 205 ms at Thu, peak 205 ms at Thu; 1 more series",
        ),
        (
            "---\ntitle: Lines\n---\nxychart-beta\n  bar [1, 2]",
            "Lines: 1 at 1 to 2 at 2, peak 2 at 2",
        ),
        # Another type, or a chart this cannot follow, says its type and title as Mermaid read it.
        (
            "sequenceDiagram\n  title Talk\n  A->>G: merge",
            "Talk: sequenceDiagram diagram",
        ),
        (
            "xychart-beta\n  title t\n  x-axis [a, b, c]\n  bar [1, 2]",
            "t: xychart-beta diagram",
        ),
    ],
)
def test_the_alt_text_says_the_fence_in_one_line(
    source: str, said: str, tmp_path: Path
) -> None:
    _, _, drawn = mermaid.draw(source, 100, tmp_path / "a.png")
    assert alt(source, drawn) == said


def run(
    source: str,
    out: Path,
    columns: int,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> dict[str, Any]:
    monkeypatch.setattr(sys, "argv", ["mermaid.py", str(out), str(columns)])
    monkeypatch.setattr(sys, "stdin", io.StringIO(source))
    mermaid.main()
    return json.loads(capsys.readouterr().out)


@pytest.mark.parametrize(
    ("source", "columns", "cap"),
    [(FLOW, 60, None), (GANTT, 98, 98), (GANTT, 160, 160), (XY, 200, mermaid.WIDEST)],
)
def test_main_draws_the_fence_in_the_shell_within_the_reply_width(
    source: str,
    columns: int,
    cap: int | None,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    out = tmp_path / "reply" / "0.png"
    said = run(source, out, columns, monkeypatch, capsys)
    assert said["file"] == str(out.resolve())
    image = Image.open(out)
    # Whole cells within the reply; a gantt fills it, an xychart up to WIDEST, a flowchart keeps its own size.
    assert image.size == (said["columns"] * CELL_W, said["rows"] * CELL_H)
    assert 0 < said["columns"] <= (cap or columns)
    if cap:
        assert said["columns"] == cap
    # Drawn, not blank: the diagram's fills, lines and text.
    assert len(image.convert("RGB").getcolors(1 << 20) or []) > 20


def test_a_fence_mermaid_refuses_says_why_in_one_line(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(SystemExit, match=r"^mermaid: Parse error on line 2$"):
        run("flowchart LR\n  A --> --> B", tmp_path / "x.png", 100, monkeypatch, capsys)
    assert not (tmp_path / "x.png").exists()


def test_without_the_shell_it_says_how_to_install_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(mermaid, "SHELLS", tmp_path)
    with pytest.raises(
        SystemExit,
        match="no chrome-headless-shell under .*: run uvx playwright install",
    ):
        run(FLOW, tmp_path / "x.png", 100, monkeypatch, capsys)


@pytest.mark.parametrize(
    ("source", "axis", "said"),
    [
        (
            GANTT,
            "%H:%M",
            "Rollout: 1 of 5 done · 1 active · ends 10:40Z; 05:00Z to 10:40Z",
        ),
        # Finished, it says so without an empty active count or an end it already reached.
        (
            "gantt\n  dateFormat HH:mm\n  a :done, 05:00, 06:00\n  b :done, 06:00, 07:00",
            "%H:%M",
            "2 of 2 done; 05:00Z to 07:00Z",
        ),
        # Whatever Mermaid reads, this reads: a zone in the dateFormat, excluded days, a title in front matter.
        (
            (
                "---\ntitle: Plan\n---\ngantt\n  dateFormat YYYY-MM-DDTHH:mmZ\n  excludes weekends\n"
                "  a :done, 2026-10-27T05:00Z, 2h\n  b :active, 2026-10-27T07:00Z, 1h"
            ),
            "%H:%M",
            "Plan: 1 of 2 done · 1 active · ends 08:00Z; 05:00Z to 08:00Z",
        ),
        (
            "gantt\n a :2026-10-26, 2d",
            "%m-%d %H:%M",
            "0 of 1 done · ends 10-28 00:00Z; 10-26 00:00Z to 10-28 00:00Z",
        ),
        (
            "gantt\n a :2026-10-26, 9d",
            "%m-%d",
            "0 of 1 done · ends 11-04 00:00Z; 10-26 00:00Z to 11-04 00:00Z",
        ),
    ],
)
def test_a_gantt_is_read_by_mermaid_its_axis_labelled_by_its_span(
    source: str, axis: str, said: str, tmp_path: Path
) -> None:
    """The alt text and the axis come from the tasks as Mermaid read them: clock times within a day, the day too for a
    few days, one label a day past that."""
    _, _, drawn = mermaid.draw(source, 100, tmp_path / "g.png")
    assert (drawn["axis"], alt(source, drawn)) == (axis, said)


@pytest.mark.parametrize(
    ("source", "said"),
    [
        # The longest path names each node by its text; a cycle has none.
        (
            FLOW,
            "Renderer PRs: flowchart of 7 nodes, 6 links; longest path E2E harness → Verify → Polish #107 → Hint and rules",
        ),
        (
            "flowchart LR; A --> B; B --> A; C --> B",
            "flowchart of 3 nodes, 3 links, with a cycle",
        ),
        (
            "graph TD\n" + "".join(f"  n{i} --> n{i + 1}\n" for i in range(9)),
            "flowchart of 10 nodes, 9 links; longest path n0 → n1 → … → n8 → n9 (10 steps)",
        ),
        # Whatever Mermaid reads: a shape in `@{}`, a quoted label holding brackets.
        (
            'flowchart LR\n  A@{ shape: circle, label: "Start" } --> B["Step (b) ok"] --> C',
            "flowchart of 3 nodes, 2 links; longest path Start → Step (b) ok → C",
        ),
        (
            "flowchart LR\n  A[R&D] --> B[a < b]",
            "flowchart of 2 nodes, 1 links; longest path R&D → a < b",
        ),
        # Text as drawn, without tags or Mermaid's own escapes; a group or a style line is no node.
        (
            'flowchart LR\n  subgraph grp [Pipeline]\n    A["<b>Fetch</b><br>prices & fills"] --> B["Score #quot;fast#quot;"]\n'
            "  end\n  B --> C\n  grp --> E\n  style D fill:#f00\n  F",
            'flowchart of 5 nodes, 2 links; longest path Fetch prices & fills → Score "fast" → C',
        ),
    ],
)
def test_a_flowchart_is_read_by_mermaid(source: str, said: str, tmp_path: Path) -> None:
    _, _, drawn = mermaid.draw(source, 100, tmp_path / "f.png")
    assert alt(source, drawn) == said


@pytest.mark.parametrize(
    ("tasks", "after"),
    [
        # Past midnight, a section listed before an earlier one: Mermaid put 03:05 on the day it drew.
        (
            "  section Live\n  Check :h, 23:10, 10m\n  section Fix\n  Fix :active, f1, 22:45, 105m\n"
            "  Re-pin :f2, after f1, 20m\n  Uploader :u, 23:45, 30m\n  Night :n, 03:05, 100m\n  Last :c, 04:50, 5m",
            [0, -25, 80, 35, 235, 340],
        ),
        # A day's plan more than half a day long.
        ("  First :m, 08:00, 10h\n  Last :e, 21:00, 1h", [0, 780]),
    ],
)
def test_a_gantt_in_clock_times_runs_on_past_midnight(
    tasks: str, after: list[int], tmp_path: Path
) -> None:
    """Each step's start in minutes after the first listed, whenever the fence is drawn."""
    source = f"gantt\n  dateFormat HH:mm\n{tasks}"
    _, _, drawn = mermaid.draw(source, 100, tmp_path / "g.png")
    starts = [t["start"] // 60_000 for t in drawn["tasks"]]
    assert [s - starts[0] for s in starts] == after


def test_a_gantt_marks_now_with_a_dashed_line() -> None:
    today = re.search(r"\.today \{([^}]*)\}", mermaid.page(GANTT, 100)[0])
    assert today and "dasharray" in today[1] and "display" not in today[1]


def test_a_diagram_too_big_to_read_or_to_draw_says_so(tmp_path: Path) -> None:
    """Below half size its text cannot be read; past Mermaid's text limit it draws an error box, not the diagram."""
    # Twelve chains of twelve: too wide one way and the other, however tightly drawn.
    chain = "flowchart LR\n" + "".join(
        "  " + " --> ".join(f"n{r}_{i}[step {i}]" for i in range(12)) + "\n"
        for r in range(12)
    )
    with pytest.raises(
        mermaid.Refused,
        match=r"^mermaid: too big to read at this width \(drawn at \d+%\): split it$",
    ):
        mermaid.draw(chain, 60, tmp_path / "wide.png")
    long = "flowchart TD\n" + "".join(
        f"  n{i}[{'label ' * 30}] --> n{i + 1}\n" for i in range(300)
    )
    with pytest.raises(
        mermaid.Refused, match=r"^mermaid: too long for Mermaid to draw$"
    ):
        mermaid.draw(long, 100, tmp_path / "long.png")


def test_a_reply_chart_draws_its_series_in_no_status_hue() -> None:
    """Green, orange and red mean done, running and failed in the reply's text; a series is none of them."""
    import colorsys

    def hue(color: str) -> float:
        r, g, b = (int(color[i : i + 2], 16) / 255 for i in (1, 3, 5))
        h, _, sat = colorsys.rgb_to_hls(r, g, b)
        return h * 360 if sat > 0.25 else -1  # a grey has no hue to clash

    status = [(0, 50), (90, 160), (330, 360)]  # red to orange, green, crimson
    assert not [c for c in mermaid.SERIES if any(a <= hue(c) <= b for a, b in status)]


def test_on_a_dark_terminal_titles_read_and_the_light_drawing_is_unchanged(
    tmp_path: Path,
) -> None:
    """The page is transparent (owner, 2026-10-27), so a dark terminal gets light text: 4.5:1 or more on #1e1e1e."""

    def luminance(rgb: Any) -> float:  # an RGBA pixel
        c = [v / 255 for v in rgb[:3]]
        r, g, b = (
            v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c
        )
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    dark = luminance((0x1E, 0x1E, 0x1E))
    for name, source in (("xy", XY), ("gantt", GANTT)):
        mermaid.draw(source, 100, tmp_path / f"{name}.png", dark=True)
        with Image.open(tmp_path / f"{name}.png") as drawn:
            shown = Image.new("RGBA", drawn.size, "#1e1e1e")
            shown.alpha_composite(drawn.convert("RGBA"))
        title = shown.crop((0, 0, shown.width, 2 * CELL_H)).getdata()
        assert max((luminance(px) + 0.05) / (dark + 0.05) for px in title) >= 4.5, name
        assert mermaid.NIGHT_INK not in mermaid.page(source, 100)[0]


def test_a_gantt_task_named_with_a_colon_keeps_its_whole_name(tmp_path: Path) -> None:
    """Mermaid ends a task's name at its first colon; `you: approve :08:50, 09:05` was refused (owner, 2026-10-27)."""
    source = "gantt\n  dateFormat HH:mm\n  you: create, approve :08:50, 09:05\n  b :09:05, 09:25"
    _, _, drawn = mermaid.draw(source, 100, tmp_path / "g.png")
    assert [(t["name"], t["end"] - t["start"]) for t in drawn["tasks"]] == [
        ("you∶ create, approve", 15 * 60_000),
        ("b", 20 * 60_000),
    ]
    assert (
        fences.gantt_names(source, 40).splitlines()[2]
        == "  you∶ create, approve :08:50, 09:05"
    )
    # Colons Mermaid reads as written: in a task's data, a clock time, front matter, directives and keywords.
    kept = (
        "---\nconfig: {gantt: {barHeight: 40}}\n---\ngantt\n%%{init: {'theme': 'base'}}%%\nDATEFORMAT\tHH:mm:ss\n"
        "accTitle: Plan: today\ntitle Plan: today\na :done, build:one, 2026-10-26, 1d\nstage1:05:00, 06:00"
    )
    assert fences.gantt_names(kept, 40) == kept
    assert fences.task_line("stage1:05:00, 06:00") == ("stage1", "05:00, 06:00")
    # A task named like a keyword is a task: Mermaid reads a keyword only before a space.
    for name in ("Weekend", "Title", "Section"):
        assert fences.gantt_names(f"gantt\n  {name}: freeze :a1, 08:00, 1h", 40) == (
            f"gantt\n  {name}∶ freeze :a1, 08:00, 1h"
        )


def test_a_long_section_name_is_cut_so_the_bars_keep_the_width(tmp_path: Path) -> None:
    """Mermaid's section gutter grows with the longest name; at 40 cells one name took the whole width."""
    name = "A very long section name for the rollout phase"
    source = f"gantt\n  dateFormat HH:mm\n  section {name}\n  Build :b1, 08:00, 2h\n  Ship :b2, 10:00, 2h"
    assert fences.gantt_names(source, 12).splitlines()[2] == "  section A very long…"
    assert (
        name in mermaid.page(source, 200)[0] and name not in mermaid.page(source, 40)[0]
    )
    _, _, drawn = mermaid.draw(source, 40, tmp_path / "g.png")
    assert len(drawn["tasks"][0]["section"]) < len(name) / 2


def zero(source: str) -> str:
    return mermaid.from_zero(source, source.splitlines())


@pytest.mark.parametrize(
    ("source", "axis"),
    [
        (
            'xychart-beta\n  x-axis [a, b]\n  y-axis "Words"\n  bar [247, 312]',
            '  y-axis "Words" 0 --> 312',
        ),
        ("xychart-beta\n  bar [2, 3]", "  y-axis 0 --> 3"),
        ("xychart-beta\n  bar [1234567, 2]", "  y-axis 0 --> 1234567"),
        ("xychart-beta\n  bar [2.5, 1]", "  y-axis 0 --> 2.5"),
        ("xychart-beta\n  bar [0.00005, 0.00001]", "  y-axis 0 --> 0.00005"),
        # All zero: bars of no height on an axis from 0, not half-height ones around it.
        ("xychart-beta\n  bar [0, 0, 0]", "  y-axis 0 --> 1"),
    ],
)
def test_bars_start_at_zero(source: str, axis: str) -> None:
    """Bars from an axis near the smallest value overstate differences (owner's /demo, 2026-10-27)."""
    assert axis in zero(source).splitlines()


def test_bars_below_zero_are_refused() -> None:
    """Mermaid draws every bar up from the plot's bottom, so -5 would read as a small gain (PnL, for one)."""
    for given in (
        "\n  bar [-5, 3, 10]",
        "\n  y-axis -10 --> 10\n  bar [-5, 3, 10]",
        "\n  bar [1, 2]\n  line [-1, 2]",
    ):
        with pytest.raises(mermaid.Refused, match=r"^mermaid: bars below zero"):
            zero(f"xychart-beta{given}")
    assert zero("xychart-beta\n  line [-5, 3]") == "xychart-beta\n  line [-5, 3]"


def test_bars_keep_a_given_axis_and_lines_their_own() -> None:
    for kept in (
        "xychart-beta\n  y-axis 100 --> 400\n  bar [247, 312]",
        "xychart-beta\n  line [247, 312]",
    ):
        assert zero(kept) == kept


def test_flowchart_state_classes_have_the_reply_colors_unless_the_fence_defines_them() -> (
    None
):
    page = mermaid.page(
        "flowchart LR\n  A:::done --> B:::running --> C:::next\n  classDef running,next fill:#000",
        100,
    )[0]
    fill, _ = mermaid.STATES["done"]
    assert f"classDef done fill:{fill}" in page
    assert "classDef running fill:" not in page and "classDef next fill:" not in page


def test_a_flowchart_too_wide_to_read_is_turned_and_its_titles_bold(
    tmp_path: Path,
) -> None:
    """Text as large as the terminal's (owner, 2026-10-27): a long chain across is drawn down instead, transparent."""
    # Its front matter's `flowchart:` key is left alone.
    chain = (
        "---\nconfig:\n  flowchart:\n    curve: linear\n---\nflowchart LR\n  "
        + " --> ".join(f"n{i}[step {i}<br>detail]" for i in range(12))
    )
    cols, rows, _ = mermaid.draw(chain, 60, tmp_path / "chain.png")
    assert rows > cols / 2  # drawn down, not shrunk across
    with Image.open(tmp_path / "chain.png") as im:
        assert im.mode == "RGBA" and im.getpixel((0, 0))[3] == 0
    assert "::first-line { font-weight: 600 }" in mermaid.page(chain, 60)[0]


def test_a_wide_reply_keeps_a_flowchart_across_at_full_size(tmp_path: Path) -> None:
    """The transcript's width is used (owner, 2026-10-27): a chain fitting 160 cells is neither turned nor shrunk."""
    chain = "flowchart LR\n  " + " --> ".join(f"n{i}[step {i}]" for i in range(12))
    cols, rows, _ = mermaid.draw(chain, 160, tmp_path / "wide.png")
    assert cols > mermaid.WIDEST and rows < 8


def test_a_chain_readable_across_stays_across_rather_than_turned_tall(
    tmp_path: Path,
) -> None:
    """Fewest rows at READABLE or larger (owner, 2026-10-27: compact diagrams that use the width): a chain a little too
    wide for 100 cells is shrunk a little, not turned into a column of 30 rows."""
    chain = "flowchart LR\n  " + " --> ".join(f"n{i}[Stage {i}]" for i in range(12))
    cols, rows, _ = mermaid.draw(chain, 100, tmp_path / "chain.png")
    assert rows <= 4 and cols <= 100


def test_a_chain_written_down_is_laid_across_when_that_takes_fewer_rows(
    tmp_path: Path,
) -> None:
    """Screen rows are what a reply spends (owner, 2026-10-27: "bad use of my screen space")."""
    chain = "flowchart TD\n  " + " --> ".join(
        f"n{i}[step {i}<br>detail]" for i in range(6)
    )
    cols, rows, _ = mermaid.draw(chain, 125, tmp_path / "down.png")
    assert rows < cols / 8
