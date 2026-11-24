#!/usr/bin/env python3
"""A tripwire an agent sets on a metric, ported from Kei's Vanna (`box/watch.py`, `herd watch`,
2026-10-29). It alerts nobody: run it with Bash `run_in_background`, and when it exits Claude Code
wakes the session with its note; the agent looks, and its tagged reply is what reaches the owner.

    python3 ~/agent-tooling/skills/progress/tripwire/tripwire.py NAME --cmd CMD --rule RULE
        [--vs CMD] [--every 60] [--desc TEXT]

CMD prints a number as its last line (`--vs`: a second one, the watch takes the difference, such as
paper minus live). Rules: `below X`, `above X`, `drop X in H`, `rise X in H`, `drawdown X [in H]`,
X a number or N% (drop, rise, drawdown), H like 15m, 1h, 1h30m, 1d; drawdown without `in H` runs
from the peak since the watch began. It samples at once, then every `--every` seconds (at least 15),
and exits 0 printing the note when the rule starts to hold, 2 when the command breaks: at its first
sample, or three in a row later, so one network blip does not end an hours-long watch.

Each watch keeps its samples, peak and whether it holds in
`~/.runtime/tripwires/<session>/<NAME>.json` (or `AGENT_TOOLING_TRIPWIRE_DIR`), with what the phone's
Tripwires screen shows: `desc`, `every`, `pid`, `checkedAt` (each attempt), `error` (the last failure,
gone after a sample), `trippedAt`, and `endedAt` and `ended` (`tripped` or `broken`) when it exits
that way, gone at the next run (a watch killed or stopped records nothing: its dead `pid` says so).
It is written before the first attempt. Running the same command again continues its history and,
while the rule still holds, waits for it to clear before it trips again; another command or rule
under the name starts afresh. One run per watch: a second run of the same NAME in the session is
refused. It needs `CLAUDE_CODE_SESSION_ID`, which
Claude Code sets in its shells, since only a session's background shell can wake that session.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MIN_EVERY = 15
BREAKS = 3  # failed samples in a row that end a watch once it has started
TIMEOUT = 60
RULE = re.compile(
    r"^(below|above|drop|rise|drawdown)\s+(-?[\d.]+)(%?)(?:\s+in\s+(\S+))?$"
)
NAME = re.compile(r"[A-Za-z0-9_.-]{1,64}")


class MetricError(Exception):
    pass


def clock(at: float) -> str:
    return datetime.fromtimestamp(at, timezone.utc).strftime("%H:%MZ")


def span(seconds: float) -> str:
    m = int(round(abs(seconds) / 60))
    return f"{m // 60}h{m % 60:02d}m" if m >= 60 else f"{m}m"


def parse_span(text: str) -> int:
    m = re.fullmatch(r"(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?", text)
    if not text or not m or not any(m.groups()):
        raise ValueError(f"bad duration {text!r}: like 45m, 2h, 1h30m, 1d")
    d, h, mi = (int(g or 0) for g in m.groups())
    return ((d * 24 + h) * 60 + mi) * 60


def parse_rule(text: str) -> dict:
    m = RULE.match(" ".join(text.split()).lower())
    if not m:
        raise ValueError(
            f"bad rule {text!r}: below X | above X | drop X in H | rise X in H | drawdown X [in H]"
        )
    kind, x, pct, h = m[1], float(m[2]), bool(m[3]), m[4]
    if kind in ("below", "above") and (pct or h):
        raise ValueError(f"{kind} takes a plain level: `{kind} -500`")
    if kind in ("drop", "rise") and not h:
        raise ValueError(f"{kind} needs a horizon: `{kind} {m[2]} in 1h`")
    if kind in ("drop", "rise", "drawdown") and x <= 0:
        raise ValueError(f"{kind} takes a positive amount")
    return {"kind": kind, "x": x, "pct": pct, "h": parse_span(h) if h else None}


def num(v: float) -> str:
    return f"{v:,.2f}".rstrip("0").rstrip(".")


def evaluate(
    rule: dict, samples: list[list[float]], peak: float | None
) -> tuple[bool, str]:
    """Whether the rule holds at the newest sample, and why. samples: [t, value], oldest first;
    peak: the highest value before them since the watch began (drawdown without a horizon)."""
    t, v = samples[-1]
    kind, x = rule["kind"], rule["x"]
    if kind == "below":
        return v < x, f"{num(v)} is below {num(x)}"
    if kind == "above":
        return v > x, f"{num(v)} is above {num(x)}"
    if kind == "drawdown":
        window = [s[1] for s in samples if rule["h"] is None or s[0] >= t - rule["h"]]
        top = max(window + ([peak] if rule["h"] is None and peak is not None else []))
        down = top - v
        limit = x / 100 * abs(top) if rule["pct"] else x
        where = f"the {span(rule['h'])} peak" if rule["h"] else "the peak"
        return (
            down >= limit and down > 0,
            f"down {num(down)} from {where} {num(top)} (now {num(v)})",
        )
    before = [s for s in samples if s[0] <= t - rule["h"]]
    if not before:
        return False, f"not {span(rule['h'])} of history yet"
    ref = before[-1][1]
    change = v - ref
    limit = x / 100 * abs(ref) if rule["pct"] else x
    holds = change <= -limit if kind == "drop" else change >= limit
    sign = "+" if change >= 0 else ""
    return holds, f"{sign}{num(change)} in {span(rule['h'])} ({num(ref)} → {num(v)})"


def one(cmd: str) -> float:
    try:
        r = subprocess.run(
            ["bash", "-c", cmd], capture_output=True, text=True, timeout=TIMEOUT
        )
    except subprocess.TimeoutExpired:
        raise MetricError(f"`{cmd[:60]}` timed out after {TIMEOUT} s") from None
    if r.returncode:
        raise MetricError(
            f"`{cmd[:60]}` exit {r.returncode}: {(r.stderr or r.stdout).strip()[-200:]}"
        )
    lines = [line for line in r.stdout.strip().splitlines() if line.strip()]
    try:
        v = float(lines[-1].strip().replace(",", "")) if lines else math.nan
    except ValueError:
        v = math.nan
    if not math.isfinite(v):
        raise MetricError(
            f"`{cmd[:60]}` did not end with a number: {r.stdout.strip()[-120:]!r}"
        )
    return v


def metric(cmd: str, vs: str | None) -> float:
    """The watch's value: the last line of `cmd` as a number, less `vs`'s when given."""
    return one(cmd) - (one(vs) if vs else 0.0)


def state_file(name: str) -> Path:
    session = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", session):
        raise ValueError(
            "no CLAUDE_CODE_SESSION_ID: run it from a Claude Code session's shell"
        )
    root = (
        os.environ.get("AGENT_TOOLING_TRIPWIRE_DIR")
        or Path.home() / ".runtime" / "tripwires"
    )
    return Path(root) / session / f"{name}.json"


def save(path: Path, state: dict) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tripwire-")
    with os.fdopen(fd, "w") as out:
        json.dump(state, out)
    os.replace(tmp, path)


def watch(
    name: str,
    cmd: str,
    vs: str | None,
    rule_text: str,
    every: int,
    desc: str,
    path: Path,
    now: Callable[[], float] = time.time,
    sleep: Callable[[float], None] = time.sleep,
    sample: Callable[[str, str | None], float] = metric,
) -> tuple[int, str]:
    """Sample until the rule starts to hold (0) or the command breaks (2); the note for the agent."""
    rule = parse_rule(rule_text)
    if every < MIN_EVERY:
        raise ValueError(f"--every: at least {MIN_EVERY} s")
    spec = {"cmd": cmd, "vs": vs, "rule": rule_text}
    state: dict[str, Any]
    try:
        state = json.loads(path.read_text())
    except (OSError, ValueError):
        state = {}
    if state.get("version") != 1 or state.get("spec") != spec:
        state = {
            "version": 1,
            "spec": spec,
            "samples": [],
            "peak": None,
            "holds": False,
        }
    for gone in ("endedAt", "ended"):  # the last run's end
        state.pop(gone, None)
    state.update(desc=desc, every=every, pid=os.getpid())
    save(path, state)  # before the first attempt, so a screen shows it starting
    what = f" ({desc})" if desc else ""
    failures = 0
    while True:
        try:
            value = sample(cmd, vs)
            failures = 0
        except MetricError as error:
            failures += 1
            state.update(checkedAt=now(), error=str(error))
            if failures >= BREAKS or not state["samples"]:
                state.update(endedAt=state["checkedAt"], ended="broken")
                save(path, state)
                return 2, (
                    f"⚑ tripwire {name!r}{what} is broken: {error}. Fix its command and run it "
                    "again, or tell the owner it no longer watches."
                )
            save(path, state)
            sleep(every)
            continue
        t = now()
        state["checkedAt"] = t
        state.pop("error", None)
        state["samples"] = [
            s
            for s in state["samples"] + [[t, value]]
            if s[0] >= t - ((rule["h"] or 0) + 3600)
        ]
        holds, detail = evaluate(rule, state["samples"], state["peak"])
        state["peak"] = value if state["peak"] is None else max(state["peak"], value)
        was, state["holds"] = state["holds"], holds
        if holds and not was:
            state.update(trippedAt=t, endedAt=t, ended="tripped")
        save(path, state)
        if holds and not was:
            return 0, (
                f"⚑ tripwire {name!r}{what} tripped at {clock(t)}: {detail}; rule `{rule_text}`. "
                "Look at it now, then tell the owner: ring him per the slack-alerts skill when money "
                "or a live system is at risk now, else tag your reply (Trading) when he should know, "
                "and no tag when it is fine. Run the same command in the background again to keep "
                "watching."
            )
        sleep(every)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("name")
    p.add_argument("--cmd", required=True)
    p.add_argument("--rule", required=True)
    p.add_argument("--vs")
    p.add_argument("--every", type=int, default=60)
    p.add_argument("--desc", default="")
    a = p.parse_args(argv)
    if not NAME.fullmatch(a.name):
        p.error("NAME: letters, digits, `.`, `_` and `-`, at most 64")
    try:
        path = state_file(a.name)
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with open(path.with_suffix(".lock"), "w") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                p.error(f"tripwire {a.name!r} already runs in this session")
            code, note = watch(a.name, a.cmd, a.vs, a.rule, a.every, a.desc, path)
    except ValueError as error:
        p.error(str(error))
    print(note, flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
