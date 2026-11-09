from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

import tripwire

T0 = 1_793_365_200.0  # 2026-10-30T13:00Z


def test_rules_parse_and_refuse() -> None:
    assert tripwire.parse_rule("drawdown 300 in 1h") == {
        "kind": "drawdown",
        "x": 300.0,
        "pct": False,
        "h": 3600,
    }
    assert tripwire.parse_rule("drawdown 5%") == {
        "kind": "drawdown",
        "x": 5.0,
        "pct": True,
        "h": None,
    }
    assert tripwire.parse_rule("below -500")["x"] == -500.0
    for bad in ("drop 200", "below 5%", "sideways 3", "drawdown -3", "below"):
        with pytest.raises(ValueError):
            tripwire.parse_rule(bad)


def test_drawdown_uses_the_peak_inside_its_horizon_or_since_it_began() -> None:
    hourly = tripwire.parse_rule("drawdown 300 in 1h")
    assert tripwire.evaluate(
        hourly, [[T0 - 7200, 1000.0], [T0 - 1800, 500.0], [T0, 150.0]], None
    )[0]
    assert not tripwire.evaluate(hourly, [[T0 - 7200, 1000.0], [T0, 800.0]], None)[0]
    overall = tripwire.parse_rule("drawdown 10%")
    assert tripwire.evaluate(overall, [[T0, 880.0]], 1000.0)[0]
    assert not tripwire.evaluate(overall, [[T0, 950.0]], 1000.0)[0]


def test_drop_compares_with_the_value_a_horizon_ago() -> None:
    r = tripwire.parse_rule("drop 100 in 1h")
    assert tripwire.evaluate(
        r, [[T0 - 3700, 0.0], [T0 - 1000, 50.0], [T0, -120.0]], None
    )[0]
    assert not tripwire.evaluate(r, [[T0 - 1000, 50.0], [T0, -120.0]], None)[0]


def run(
    path: Path, values: list[float], rule: str = "below 0", cmd: str = "pnl"
) -> tuple[int, str, int]:
    """Watch a metric giving the values in turn, a minute apart; the exit, note and samples taken."""
    feed: Iterator[float] = iter(values)
    taken = 0
    clock = [T0]

    def sample(_cmd: str, _vs: str | None) -> float:
        nonlocal taken
        taken += 1
        value = next(feed)
        if value != value:  # NaN stands for a broken command
            raise tripwire.MetricError("`pnl` exit 1: boom")
        return value

    def sleep(seconds: float) -> None:
        clock[0] += seconds

    code, note = tripwire.watch(
        "dd", cmd, None, rule, 60, "PnL", path, lambda: clock[0], sleep, sample
    )
    return code, note, taken


def test_it_exits_when_the_rule_starts_to_hold_and_a_rerun_waits_for_it_to_clear(
    tmp_path: Path,
) -> None:
    path = tmp_path / "dd.json"
    code, note, taken = run(path, [5.0, 2.0, -3.0])
    assert (code, taken) == (0, 3) and note.startswith(
        "⚑ tripwire 'dd' (PnL) tripped at 13:02Z"
    )
    assert "(Trading)" in note and "slack-alerts" in note
    # Run again while it still holds: no trip until it clears and holds again.
    code, note, taken = run(path, [-4.0, -5.0, 1.0, -1.0])
    assert (code, taken) == (0, 4)


def test_a_new_rule_starts_afresh(tmp_path: Path) -> None:
    path = tmp_path / "dd.json"
    run(path, [-3.0])
    assert run(path, [-3.0], rule="below 1")[0] == 0  # another rule: holds at once


def test_a_broken_command_ends_it_at_once_but_a_later_blip_does_not(
    tmp_path: Path,
) -> None:
    nan = float("nan")
    code, note, taken = run(tmp_path / "a.json", [nan])
    assert (code, taken) == (2, 1) and "boom" in note
    assert run(tmp_path / "b.json", [5.0, nan, nan, -1.0])[::2] == (0, 4)
    assert run(tmp_path / "c.json", [5.0, nan, nan, nan])[::2] == (2, 4)


def test_it_runs_once_per_name_and_only_in_a_session(tmp_path: Path) -> None:
    env = {"AGENT_TOOLING_TRIPWIRE_DIR": str(tmp_path), "CLAUDE_CODE_SESSION_ID": "s1"}
    args = [
        sys.executable,
        str(Path(tripwire.__file__)),
        "dd",
        "--cmd",
        "echo 5",
        "--rule",
        "below 0",
    ]
    first = subprocess.Popen(
        args, env=os.environ | env, stdout=subprocess.PIPE, text=True
    )
    try:
        lock = tmp_path / "s1" / "dd.lock"
        for _ in range(100):
            if (tmp_path / "s1" / "dd.json").exists():
                break
            time.sleep(0.05)
        second = subprocess.run(
            args, env=os.environ | env, capture_output=True, text=True
        )
        assert (
            second.returncode == 2 and "already runs" in second.stderr and lock.exists()
        )
    finally:
        first.kill()
        first.wait()
    bare = os.environ | {
        "AGENT_TOOLING_TRIPWIRE_DIR": str(tmp_path),
        "CLAUDE_CODE_SESSION_ID": "",
    }
    alone = subprocess.run(args, env=bare, capture_output=True, text=True)
    assert alone.returncode == 2 and "CLAUDE_CODE_SESSION_ID" in alone.stderr


def test_the_metric_is_the_last_number_less_the_comparison() -> None:
    assert tripwire.metric("echo note; echo 1,012.5", None) == 1012.5
    assert tripwire.metric("echo 10", "echo 4") == 6.0
    for broken in ("echo nan-ish", "exit 3"):
        with pytest.raises(tripwire.MetricError):
            tripwire.metric(broken, None)


def test_a_long_rule_sampled_every_15_s_keeps_its_whole_horizon(tmp_path: Path) -> None:
    # 13 h at 15 s is 3,120 samples: a 3,000-sample cap left `drop X in 13h` without its reference.
    clock = [T0]
    values = iter([100.0] * 3121 + [0.0])

    def sleep(seconds: float) -> None:
        clock[0] += seconds

    code, note = tripwire.watch(
        "day",
        "pnl",
        None,
        "drop 50 in 13h",
        15,
        "",
        tmp_path / "day.json",
        lambda: clock[0],
        sleep,
        lambda _c, _v: next(values),
    )
    assert code == 0 and "in 13h00m" in note


def state(path: Path) -> dict:
    return json.loads(path.read_text())


def test_the_state_tells_a_screen_what_the_watch_is_and_how_it_ended(
    tmp_path: Path,
) -> None:
    path = tmp_path / "dd.json"
    seen: list[dict] = []
    clock = [T0]
    feed = iter([5.0, float("nan"), -1.0])

    def sample(_cmd: str, _vs: str | None) -> float:
        seen.append(state(path))
        value = next(feed)
        if value != value:
            raise tripwire.MetricError("`pnl` exit 1: boom")
        return value

    def sleep(seconds: float) -> None:
        clock[0] += seconds
        seen.append(state(path))

    code, _ = tripwire.watch(
        "dd", "pnl", None, "below 0", 60, "PnL", path, lambda: clock[0], sleep, sample
    )
    assert code == 0
    first = seen[0]  # written before the first attempt
    assert (first["desc"], first["every"], first["pid"]) == ("PnL", 60, os.getpid())
    assert "checkedAt" not in first and "ended" not in first
    assert seen[1]["checkedAt"] == T0 and "error" not in seen[1]
    assert (seen[3]["checkedAt"], seen[3]["error"]) == (T0 + 60, "`pnl` exit 1: boom")
    end = state(path)
    assert "error" not in end  # cleared by the sample after it
    assert (end["checkedAt"], end["trippedAt"], end["endedAt"], end["ended"]) == (
        T0 + 120,
        T0 + 120,
        T0 + 120,
        "tripped",
    )


def test_a_broken_watch_ends_broken_and_the_next_run_clears_it(tmp_path: Path) -> None:
    path = tmp_path / "dd.json"
    assert run(path, [float("nan")])[0] == 2
    end = state(path)
    assert (end["ended"], end["endedAt"], end["error"]) == (
        "broken",
        T0,
        "`pnl` exit 1: boom",
    )
    feed = iter([5.0, -1.0])

    def sample(_cmd: str, _vs: str | None) -> float:
        assert "ended" not in state(path) and "endedAt" not in state(path)
        return next(feed)

    code, _ = tripwire.watch(
        "dd", "pnl", None, "below 0", 60, "", path, lambda: T0, lambda _s: None, sample
    )
    assert code == 0 and state(path)["ended"] == "tripped"
