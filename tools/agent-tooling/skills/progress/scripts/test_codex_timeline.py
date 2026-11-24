"""Tests for session_timeline.py on Codex transcripts."""

from datetime import datetime
from pathlib import Path

import session_timeline
from timeline_records import (
    codex_call,
    codex_call_output,
    codex_cell_yield,
    codex_exec_output,
    codex_poll,
    codex_session_meta,
    codex_spawn_call,
    codex_subagent_activity,
    codex_task_complete,
    codex_tui_user_message,
    codex_user_message,
    codex_wait,
    write_jsonl,
)


def test_codex_tool_duration_by_call_id_matching(tmp_path: Path) -> None:
    records = [
        codex_session_meta("2026-01-02T09:00:00.000Z"),
        codex_user_message("2026-01-02T09:00:01.000Z", "list the repo"),
        codex_call("2026-01-02T09:00:02.000Z", "call1", "exec", "ls -la"),
        codex_call_output("2026-01-02T09:00:27.000Z", "call1", "file listing"),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_codex(path)
    tool_events = [e for e in session.events if e.kind == "tool"]
    assert len(tool_events) == 1
    end = tool_events[0].end
    assert end is not None
    assert (end - tool_events[0].start).total_seconds() == 25
    assert "ls -la" in tool_events[0].summary


def test_codex_unmatched_call_shown_as_running(tmp_path: Path) -> None:
    records = [
        codex_session_meta("2026-01-02T09:00:00.000Z"),
        codex_call("2026-01-02T09:00:02.000Z", "call1", "exec", "sleep 100"),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_codex(path)
    tool_events = [e for e in session.events if e.kind == "tool"]
    assert len(tool_events) == 1
    assert tool_events[0].end is None


def test_codex_yielded_commands_end_at_the_poll_that_reports_their_exit(
    tmp_path: Path,
) -> None:
    """Two commands yield, sessions 11 and 22. One poll finds 22 exited and 11
    still running, a later one finds 11 exited: each launch is timed to its own
    exit poll, and the polls stay rows of their own."""
    records = [
        codex_session_meta("2026-01-02T09:00:00.000Z"),
        codex_call("2026-01-02T09:00:00.000Z", "a", "exec", "make test"),
        codex_exec_output("2026-01-02T09:00:01.000Z", "a", {"session_id": 11}),
        codex_call("2026-01-02T09:00:02.000Z", "b", "exec", "make lint"),
        codex_exec_output("2026-01-02T09:00:03.000Z", "b", {"session_id": 22}),
        codex_poll("2026-01-02T09:05:00.000Z", "p1", 11, 22),
        codex_exec_output(
            "2026-01-02T09:05:01.000Z", "p1", {"session_id": 11}, {"exit_code": 0}
        ),
        codex_poll("2026-01-02T09:20:00.000Z", "p2", 11),
        codex_exec_output("2026-01-02T09:20:01.000Z", "p2", {"exit_code": 1}),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    events = session_timeline.parse_codex(path).events
    seconds = {e.summary: (e.end - e.start).total_seconds() for e in events if e.end}
    assert seconds["exec make test"] == 20 * 60 + 1
    assert seconds["exec make lint"] == 5 * 60 - 1
    assert sum("write_stdin" in summary for summary in seconds) == 2


def test_codex_yielded_command_without_exit_poll_is_running(tmp_path: Path) -> None:
    """Session 11 is still running at its last poll. Neither a poll that finds
    another session exited, though its script mentions 11, nor one whose output
    holds no exit result ends it."""
    poll_other = codex_poll("2026-01-02T09:05:00.000Z", "p1", 22)
    poll_other["payload"]["input"] += " // session 11 is the test run"
    records = [
        codex_session_meta("2026-01-02T09:00:00.000Z"),
        codex_call("2026-01-02T09:00:00.000Z", "a", "exec", "make test"),
        codex_exec_output("2026-01-02T09:00:01.000Z", "a", {"session_id": 11}),
        codex_call("2026-01-02T09:00:02.000Z", "b", "exec", "make lint"),
        codex_exec_output("2026-01-02T09:00:03.000Z", "b", {"session_id": 22}),
        poll_other,
        codex_exec_output("2026-01-02T09:05:01.000Z", "p1", {"exit_code": 0}),
        codex_poll("2026-01-02T09:06:00.000Z", "p2", 11),
        codex_exec_output("2026-01-02T09:06:01.000Z", "p2", {"session_id": 11}),
        codex_poll("2026-01-02T09:07:00.000Z", "p3", 11),
        codex_call_output("2026-01-02T09:07:01.000Z", "p3", "still compiling"),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    ends = {e.summary: e.end for e in session_timeline.parse_codex(path).events}
    assert ends["exec make test"] is None
    assert ends["exec make lint"] is not None


def test_codex_yielded_cell_ends_with_the_wait_that_returns_its_results(
    tmp_path: Path,
) -> None:
    """A polling cell can itself yield; its results, here session 11's exit,
    arrive with the wait call that names its cell, and both end there. A cell
    no wait has finished is still running."""
    records = [
        codex_session_meta("2026-01-02T09:00:00.000Z"),
        codex_call("2026-01-02T09:00:00.000Z", "a", "exec", "make test"),
        codex_exec_output("2026-01-02T09:00:01.000Z", "a", {"session_id": 11}),
        codex_poll("2026-01-02T09:05:00.000Z", "p1", 11),
        codex_cell_yield("2026-01-02T09:05:10.000Z", "p1", "7"),
        codex_wait("2026-01-02T09:05:11.000Z", "w1", "7"),
        codex_exec_output("2026-01-02T09:06:01.000Z", "w1", {"exit_code": 0}),
        codex_call("2026-01-02T09:07:00.000Z", "b", "exec", "make docs"),
        codex_cell_yield("2026-01-02T09:07:10.000Z", "b", "8"),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    ends = {e.summary: e.end for e in session_timeline.parse_codex(path).events}
    assert ends["exec make docs"] is None
    [poll_end] = [end for summary, end in ends.items() if "write_stdin" in summary]
    finish = datetime.fromisoformat("2026-01-02T09:06:01.000Z")
    assert ends["exec make test"] == poll_end == finish


def test_codex_yielded_cell_keeps_results_reported_before_it_yielded(
    tmp_path: Path,
) -> None:
    """A wait returns only a cell's newer results: session 11, reported running
    before the cell yielded, is still running after the wait."""
    records = [
        codex_session_meta("2026-01-02T09:00:00.000Z"),
        codex_call("2026-01-02T09:00:00.000Z", "a", "exec", "make test"),
        codex_exec_output("2026-01-02T09:00:01.000Z", "a", {"session_id": 11}),
        codex_poll("2026-01-02T09:05:00.000Z", "p1", 11),
        codex_cell_yield("2026-01-02T09:05:10.000Z", "p1", "7", {"session_id": 11}),
        codex_wait("2026-01-02T09:05:11.000Z", "w1", "7"),
        codex_exec_output("2026-01-02T09:06:01.000Z", "w1", {"exit_code": 0}),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    ends = {e.summary: e.end for e in session_timeline.parse_codex(path).events}
    assert ends["exec make test"] is None


def test_codex_waiting_on_user_excluded_from_active_time(tmp_path: Path) -> None:
    records = [
        codex_session_meta("2026-01-02T09:00:00.000Z"),
        codex_user_message("2026-01-02T09:00:01.000Z", "first"),
        codex_task_complete("2026-01-02T09:00:10.000Z"),
        codex_user_message("2026-01-02T09:02:10.000Z", "second, two minutes later"),
        codex_task_complete("2026-01-02T09:02:15.000Z"),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_codex(path)
    assert session.waiting().total_seconds() == 120


def test_codex_interactive_prompts_are_user_message_events(tmp_path: Path) -> None:
    """Interactive Codex sessions log prompts as `user_message` events, not items."""
    records = [
        codex_session_meta("2026-01-02T09:00:00.000Z"),
        codex_tui_user_message("2026-01-02T09:00:01.000Z", "first"),
        codex_task_complete("2026-01-02T09:00:10.000Z"),
        codex_tui_user_message("2026-01-02T09:01:10.000Z", "second"),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_codex(path)
    assert [e.summary for e in session.events if e.kind == "prompt"] == [
        "first",
        "second",
    ]
    assert session.waiting().total_seconds() == 60


def test_codex_subagent_timing(tmp_path: Path) -> None:
    records = [
        codex_session_meta("2026-01-02T09:00:00.000Z"),
        codex_spawn_call("2026-01-02T09:00:01.000Z", "sub1"),
        codex_subagent_activity(
            "2026-01-02T09:00:01.500Z", "sub1", "started", "/root/cleanup"
        ),
        codex_subagent_activity(
            "2026-01-02T09:20:01.500Z", "sub1", "completed", "/root/cleanup"
        ),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_codex(path)
    agent_events = [e for e in session.events if e.kind == "agent"]
    assert len(agent_events) == 1
    event = agent_events[0]
    assert event.end is not None
    assert (event.end - event.start).total_seconds() == 20 * 60
    assert "/root/cleanup" in event.summary


def test_codex_subagent_running_without_completion(tmp_path: Path) -> None:
    records = [
        codex_session_meta("2026-01-02T09:00:00.000Z"),
        codex_spawn_call("2026-01-02T09:00:01.000Z", "sub1"),
        codex_subagent_activity("2026-01-02T09:00:01.500Z", "sub1", "started"),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_codex(path)
    agent_events = [e for e in session.events if e.kind == "agent"]
    assert len(agent_events) == 1
    assert agent_events[0].end is None
