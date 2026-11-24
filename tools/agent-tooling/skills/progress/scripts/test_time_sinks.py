"""Tests for time_sinks.py: how wall time is charged to the owner, waits on calls and work."""

import json
import re
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

import session_timeline
import time_sinks
from timeline_model import Event, Session

DAY = "2026-01-01T"


def at(hms: str) -> datetime:
    return datetime.fromisoformat(f"{DAY}{hms}+00:00")


def event(start: str, end: str | None, summary: str, kind: str = "tool") -> Event:
    return Event(at(start), at(end) if end else None, kind, summary)


SESSION = Session(
    Path("s.jsonl"),
    at("10:00:00"),
    at("11:00:00"),
    [(at("10:40:00"), at("10:50:00"))],
    [
        event("10:00:00", "10:00:00", "start", kind="prompt"),
        event("10:00:30", "10:20:30", "Bash Wait for CI on #12"),
        event("10:21:00", "10:39:00", "Fix lint (worker)", kind="agent"),
        event("10:21:00", "10:30:00", "Bash Run the tests again"),
        event("10:50:00", "10:50:00", "go on", kind="prompt"),
    ],
)


def test_wall_time_splits_into_owner_waits_call_waits_and_work() -> None:
    """Owner waits come first; a long gap is charged to the call whose end closed it, a long
    gap a new call closed is the lead's own work, and every minute lands somewhere once."""
    totals, gaps, serial = time_sinks.sinks(SESSION)
    minutes = {name: t / timedelta(minutes=1) for name, t in totals.items() if t}
    assert minutes == {
        time_sinks.OWNER: 10,
        "CI and deploy": 20,
        time_sinks.FAILED: 9,
        "subagent work": 9,
        time_sinks.ACTIVE: 12,
    }
    # The CI wait and the agent's last nine minutes ran alone; the rerun ran beside the agent.
    assert serial == timedelta(minutes=29)
    assert gaps["CI and deploy"][0][1].summary == "Bash Wait for CI on #12"


def test_json_is_minutes_per_class_in_order_with_the_largest_gaps() -> None:
    """`Sinks` in mods/types/index.d.ts."""
    out = json.loads(json.dumps(time_sinks.as_json(SESSION)))
    assert (out["wall"], out["serial"]) == (60, 29)
    assert [(c["name"], c["minutes"]) for c in out["classes"]] == [
        (time_sinks.OWNER, 10),
        ("CI and deploy", 20),
        ("subagent work", 9),
        (time_sinks.FAILED, 9),
        (time_sinks.ACTIVE, 12),
    ]
    assert out["classes"][1]["gaps"] == [
        {
            "minutes": 20,
            "at": f"{DAY}10:00:30+00:00",
            "summary": "Bash Wait for CI on #12",
        }
    ]


@pytest.mark.parametrize(
    ("summary", "kind", "expected"),
    [
        (
            "Bash Wait until 16:01Z for the release window",
            "tool",
            "other sessions and holds",
        ),
        ("Bash gh pr checks 12 --watch", "tool", "CI and deploy"),
        ("Bash Run local Codex review for #1415", "tool", "review rounds"),
        ("Probe the venue (general-purpose)", "agent", "subagent work"),
        # An agent's task names what it works on, not what it waits for.
        ("Hunt: guards, merge gate (general-purpose)", "agent", "subagent work"),
        ("Review the cockpit renders (general-purpose)", "agent", "review rounds"),
        ("Bash uv run pytest", "tool", "long tool calls"),
    ],
)
def test_calls_are_classed_by_summary_then_kind(
    summary: str, kind: str, expected: str
) -> None:
    call = Event(datetime(2026, 1, 1, tzinfo=UTC), None, kind, summary)
    assert time_sinks.classify(call) == expected


def test_a_call_that_failed_is_a_failed_attempt_whatever_its_summary() -> None:
    call = Event(
        datetime(2026, 1, 1, tzinfo=UTC),
        None,
        "tool",
        "Bash gh pr checks 12 --watch",
        failed=True,
    )
    assert time_sinks.classify(call) == time_sinks.FAILED


def test_handoff_gives_its_finish_gates_blockers_and_sessions(tmp_path: Path) -> None:
    handoff = tmp_path / "h.md"
    handoff.write_text(
        "# Thread\n\nStatus: running\n"
        "Session: claude 2eff9726-4b8c-4b95-9f5d-3a808968d2b9. Before: c7fe0727-20af-44e9-9ef2-4cd254e6a8aa\n"
        "Finish: 2026-10-25T09:30Z, CI then release\n"
        "Gate: capture | s3://b/STATUS.json --profile vvs-research | 2026-10-26T04:15Z\n\n"
        "## Blockers\n\n- Owner: approve the restart.\n\n## Log\n\n- Gate: not a header line\n"
    )
    lines, sessions = time_sinks.handoff_lines(handoff)
    assert lines == [
        "Status: running",
        "Finish: 2026-10-25T09:30Z, CI then release",
        "Gate: capture | s3://b/STATUS.json --profile vvs-research | 2026-10-26T04:15Z",
        "Blockers:",
        "- Owner: approve the restart.",
    ]
    assert sessions == [
        "2eff9726-4b8c-4b95-9f5d-3a808968d2b9",
        "c7fe0727-20af-44e9-9ef2-4cd254e6a8aa",
    ]


def test_sinks_option_reads_a_transcript(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """End to end: `session_timeline.py --sinks` over a transcript."""
    records = [
        {
            "type": "user",
            "timestamp": f"{DAY}10:00:00Z",
            "promptSource": "typed",
            "message": {"role": "user", "content": "ship it"},
        },
        {
            "type": "assistant",
            "timestamp": f"{DAY}10:00:10Z",
            "message": {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "t1",
                        "name": "Bash",
                        "input": {"description": "Wait for CI on #7"},
                    }
                ],
            },
        },
        {
            "type": "user",
            "timestamp": f"{DAY}10:30:10Z",
            "message": {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "green"}
                ],
            },
        },
    ]
    path = tmp_path / "s.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in records) + "\n")
    monkeypatch.setattr(sys, "argv", ["session_timeline.py", str(path), "--sinks"])
    session_timeline.main()
    out = capsys.readouterr().out
    assert "wall 30m" in out
    assert re.search(
        r"CI and deploy +30m +99%\n +30m from 01-01 10:00Z  Bash Wait for CI on #7", out
    )


def _call(at: str, kind: str, tid: str, body: str) -> dict:
    key = "input" if kind == "tool_use" else "content"
    value = {"command": body} if kind == "tool_use" else body
    idkey = "id" if kind == "tool_use" else "tool_use_id"
    return {
        "timestamp": at,
        "message": {"content": [{"type": kind, idkey: tid, key: value}]},
    }


def test_a_subagent_s_pull_request_counts_from_its_start_or_previous_pr_to_the_create(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    sub = tmp_path / "proj" / "session" / "subagents"
    sub.mkdir(parents=True)
    lines = [
        {"timestamp": "2026-10-27T10:00:00Z", "message": {"content": "brief"}},
        _call("2026-10-27T10:30:00Z", "tool_use", "t1", "gh pr create --fill"),
        _call(
            "2026-10-27T10:31:00Z",
            "tool_result",
            "t1",
            "https://github.com/acme/repo.a/pull/7",
        ),
        _call(
            "2026-10-27T11:00:00Z",
            "tool_result",
            "other",
            "https://github.com/acme/repo.a/pull/8",
        ),
        _call("2026-10-27T11:20:00Z", "tool_use", "t2", "gh pr create --fill"),
        _call(
            "2026-10-27T11:21:00Z",
            "tool_result",
            "t2",
            "https://github.com/acme/repo.a/pull/9",
        ),
    ]
    (sub / "agent.jsonl").write_text("\n".join(json.dumps(x) for x in lines))
    monkeypatch.setattr(time_sinks, "PROJECTS", tmp_path)
    assert time_sinks.implementations(days=3650, owner="acme") == {
        ("repo.a", 7): 30.0,
        ("repo.a", 9): 49.0,
    }
