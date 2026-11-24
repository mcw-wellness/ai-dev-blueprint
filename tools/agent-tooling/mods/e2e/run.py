#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["pyte==0.8.2", "pillow==12.0.0"]
# ///
"""End to end: the real `claude` resumes a finished synthetic session with this checkout's plugin, and the screen is
checked for every renderer feature at 60, 100 and 200 columns, plus once in a terminal that takes kitty pictures, once
off fullscreen, and, on a short screen, the Reply band's rows once the reply's block scrolls away (60 and 100 columns),
and at 100 a click on a band chip, a click on a reply chip in the reply, a click on the band's `hide` and a redraw,
the pointer over chips, and that the ghost text, Tab and `★ all` leave a recommended grant out.

usage: run.py [--out DIR]   (each capture's .txt and .png go to DIR; to a new temporary folder on a failure)

Nothing but those clicks, pointer moves, wheel scrolls and Tab and a letter at the prompt (never Enter) is sent to the
session, so no prompt ever reaches a model. Only this checkout's plugin loads: the user's settings, which enable the
installed copy, are not read (`--setting-sources project` in a folder without any).
"""

import argparse
import fcntl
import json
import os
import pty
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import termios
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from acts import grant, hide, hover, scrolled
from capture import BAND, PLACEHOLDER, Capture
from checks import (
    check_band_classic,
    check_charts_alt,
    check_charts_kitty,
    check_draft,
    check_hidden,
    check_reply,
    check_reply_band,
)
from PIL import Image, ImageDraw, ImageFont
from session import session
from term import CTTY, Pty, Screen

HERE = Path(__file__).resolve().parent
ROWS = 400  # tall enough that the whole transcript stays on screen at 60 columns
SHORT = 42  # short enough that the reply's block scrolls away
KITTY = {"CLAUDE_CODE_FORCE_TERMINAL_IMAGES": "1"}
# Off fullscreen (the main screen) the terminal reports no clicks.
CLASSIC = {"CLAUDE_CODE_NO_FLICKER": "0"}
RUNS = {
    "w60": (60, {}, ROWS),
    "w100": (100, {}, ROWS),
    "w200": (200, {}, ROWS),
    "kitty": (100, KITTY, ROWS),
    "classic": (100, CLASSIC, ROWS),
    "rows60": (60, {}, SHORT),
    "hide": (100, {}, SHORT),
    "hover": (100, {}, SHORT),
    "grant": (100, {}, ROWS),
}
CONFIG = "config"


def capture(
    name: str, cwd: Path, sid: str, columns: int, extra: dict[str, str], rows: int
) -> Capture:
    """`claude --resume` in a pty until the reply, its charts and the Reply band have drawn and
    the screen is quiet; then the run's act, if it has one."""
    # Not inside tmux, where the renderer leaves chart fences to the engine on purpose.
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("CLAUDE", "TMUX", "ANTHROPIC"))
    }
    # The fullscreen renderer the owner uses: it redraws the transcript, where the classic one prints each row once.
    env.update(TERM="xterm-256color", COLORTERM="truecolor", CLAUDE_CODE_NO_FLICKER="1")
    # Its session files beside it: the host reading ~/.runtime/claude-sessions never sees a run's (killed) sessions.
    env.update(
        TMPDIR=f"{cwd}/",
        CLAUDE_CONFIG_DIR=str(cwd / CONFIG),
        AGENT_TOOLING_SESSION_DIR=str(cwd / "sessions"),
        **extra,
    )
    argv = [*CTTY, "claude", "--resume", sid, "--plugin-dir", str(HERE.parent)]
    argv += ["--setting-sources", "project", "--settings", '{"theme":"light"}']
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
    t = slave
    proc = subprocess.Popen(
        argv, stdin=t, stdout=t, stderr=t, cwd=cwd, env=env, start_new_session=True
    )
    os.close(slave)
    p = Pty(master, proc.pid, Screen(columns, rows))
    c = Capture(name, columns, p.screen, b"")
    try:
        p.read(lambda shown: bool(BAND.search(shown)) and "drawing chart" not in shown)
        if act := ACTS.get(name):
            act(p, c)
    finally:
        os.killpg(proc.pid, 9)
        proc.wait()
        os.close(master)
    c.raw = bytes(p.raw)
    return c


ACTS = {"rows60": scrolled, "hide": hide, "hover": hover, "grant": grant}


def color(value: str, default: str) -> str:
    return "#" + value if re.fullmatch(r"[0-9a-f]{6}", value) else default


def png(c: Capture, path: Path) -> None:
    """The capture's rows from the prompt down, drawn in the light theme, the fullscreen
    padding above the band cut to one blank row; a picture's cells as a grey block."""
    lines = c.text()
    last = max((i for i, s in enumerate(lines) if s.strip()), default=0)
    first = max(c.find("❯ blocked?")[0], 0)
    keep = [y for y in range(first, last + 1) if lines[y] or lines[y - 1]]
    used = len(keep)
    menlo = "/System/Library/Fonts/Menlo.ttc"
    font, bold = (ImageFont.truetype(menlo, 14, index=i) for i in (0, 1))
    cw, ch = 8.43, 17
    img = Image.new("RGB", (int(c.columns * cw) + 16, used * ch + 16), "white")
    draw = ImageDraw.Draw(img)
    for y, row in enumerate(keep):
        line = c.screen.buffer[row]
        for x in range(c.columns):
            cell, px, py = line[x], 8 + x * cw, 8 + y * ch
            if cell.bg != "default" or cell.data[:1] == PLACEHOLDER:
                draw.rectangle(
                    [px, py, px + cw, py + ch], fill=color(cell.bg, "#dddddd")
                )
            if cell.data.strip() and cell.data[:1] != PLACEHOLDER:
                ink = color(cell.fg, "#1e1e1e")
                draw.text(
                    (px, py), cell.data, fill=ink, font=bold if cell.bold else font
                )
    img.save(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, help="where each capture's .txt and .png go")
    out: Path | None = ap.parse_args().out
    started = time.monotonic()
    reply = (HERE / "reply.md").read_text()
    # Its own folder and `claude` configuration: a run never touches the owner's `~/.claude.json`,
    # where each pty this harness kills would count as a crashed fullscreen launch (3 turn fullscreen off).
    cwd = Path(tempfile.mkdtemp(prefix="agent-tooling-mods-e2e-")).resolve()
    config = cwd / CONFIG
    project = config / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(cwd))
    alt: list[Callable[[Capture], None]] = [
        check_reply,
        check_charts_alt,
        check_draft,
        check_reply_band,
    ]
    checks = {n: alt for n in RUNS}
    checks["kitty"] = [check_charts_kitty]
    checks["classic"] = [check_band_classic]
    checks["hide"] = [check_hidden]
    checks["rows60"] = checks["hover"] = checks["grant"] = []
    caps: list[Capture] = []
    try:
        project.mkdir(parents=True)
        trusted = {str(cwd): {"hasTrustDialogAccepted": True}}
        state = {"hasCompletedOnboarding": True, "projects": trusted}
        (config / ".claude.json").write_text(json.dumps(state))
        # One session per run: a resume appends to its transcript.
        sids = {name: str(uuid.uuid4()) for name in RUNS}
        for sid in sids.values():
            turn = "".join(json.dumps(t) + "\n" for t in session(cwd, sid, reply))
            (project / f"{sid}.jsonl").write_text(turn)
        with ThreadPoolExecutor(len(RUNS)) as pool:
            caps = list(pool.map(lambda n: capture(n, cwd, sids[n], *RUNS[n]), RUNS))
        for c in caps:  # before the folder holding the pictures goes
            for check in checks[c.name]:
                check(c)
    finally:
        shutil.rmtree(cwd, ignore_errors=True)
    failures = [f for c in caps for f in c.failures]
    print("\n".join(failures) or "all checks passed")
    if failures and not out:  # the screens a failure needs
        out = Path(tempfile.mkdtemp(prefix="mods-e2e-captures-"))
    if out:
        out.mkdir(parents=True, exist_ok=True)
        for c in caps:
            (out / f"{c.name}.txt").write_text("\n".join(c.text()).strip("\n") + "\n")
            png(c, out / f"{c.name}.png")
        print(f"captures in {out}", end="; ")
    print(f"{time.monotonic() - started:.0f} s")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
