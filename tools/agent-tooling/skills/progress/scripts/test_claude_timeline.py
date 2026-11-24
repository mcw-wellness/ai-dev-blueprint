"""Tests for session_timeline.py on Claude Code transcripts."""

from pathlib import Path

import pytest

import plan
import session_timeline
from timeline_records import (
    claude_assistant,
    claude_header,
    claude_notification,
    claude_tool_result,
    claude_user,
    write_jsonl,
)


def test_claude_tool_duration_by_id_matching(tmp_path: Path) -> None:
    """A tool_use/tool_result pair matched by id yields the measured gap as duration."""
    records = [
        *claude_header(),
        claude_user("2026-01-01T10:00:00.000Z", "please read the file"),
        claude_assistant(
            "2026-01-01T10:00:01.000Z", [("t1", "Read", {"file_path": "a.py"})]
        ),
        claude_tool_result("2026-01-01T10:00:31.000Z", "t1", "contents of a.py"),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_claude(path)
    tool_events = [e for e in session.events if e.kind == "tool"]
    assert len(tool_events) == 1
    event = tool_events[0]
    assert event.end is not None
    assert (event.end - event.start).total_seconds() == 30
    assert "Read" in event.summary and "a.py" in event.summary


def test_claude_collapse_of_short_calls(tmp_path: Path) -> None:
    """Consecutive calls under --min-seconds collapse into one row with a tool mix."""
    records = [*claude_header(), claude_user("2026-01-01T10:00:00.000Z", "go")]
    t = 1
    for i in range(3):
        call_id = f"r{i}"
        records.append(
            claude_assistant(
                f"2026-01-01T10:00:{t:02d}.000Z",
                [(call_id, "Read", {"file_path": f"f{i}.py"})],
            )
        )
        t += 1
        records.append(
            claude_tool_result(f"2026-01-01T10:00:{t:02d}.000Z", call_id, "ok")
        )
        t += 1
    for i in range(2):
        call_id = f"b{i}"
        records.append(
            claude_assistant(
                f"2026-01-01T10:00:{t:02d}.000Z",
                [(call_id, "Bash", {"description": "list"})],
            )
        )
        t += 1
        records.append(
            claude_tool_result(f"2026-01-01T10:00:{t:02d}.000Z", call_id, "ok")
        )
        t += 1
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_claude(path)
    output = session_timeline.render(session, min_seconds=20)
    lines = output.splitlines()
    collapsed = [line for line in lines if "calls:" in line]
    assert len(collapsed) == 1
    assert "5 calls:" in collapsed[0]
    assert "Read×3" in collapsed[0]
    assert "Bash×2" in collapsed[0]
    # The five short calls must not also appear as their own individual rows.
    tool_rows = [line for line in lines if "  tool" in line]
    assert tool_rows == collapsed


def test_claude_collapse_breaks_at_idle_gap(tmp_path: Path) -> None:
    """Short calls separated by a long idle pause become two rows, so no row's
    span hides the pause."""
    records = [
        *claude_header(),
        claude_user("2026-01-01T10:00:00.000Z", "go"),
        claude_assistant("2026-01-01T10:00:01.000Z", [("a", "Read", {})]),
        claude_tool_result("2026-01-01T10:00:02.000Z", "a", "ok"),
        claude_assistant("2026-01-01T10:30:00.000Z", [("b", "Read", {})]),
        claude_tool_result("2026-01-01T10:30:01.000Z", "b", "ok"),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_claude(path)
    output = session_timeline.render(session, min_seconds=20)
    tool_rows = [line for line in output.splitlines() if "  tool" in line]
    assert len(tool_rows) == 2
    assert not any("30m" in line for line in tool_rows)


def test_claude_prompt_typed_mid_turn_is_a_prompt(tmp_path: Path) -> None:
    """A prompt typed while a turn runs is logged as a queued-command attachment.
    Claude Code wraps a paste in pasted_content tags; the tags go, the paste stays."""
    queued = {
        "type": "attachment",
        "timestamp": "2026-01-01T10:00:05.000Z",
        "attachment": {
            "type": "queued_command",
            "prompt": 'also fix <pasted_content id="x">the docs</pasted_content id="x">',
            "origin": {"kind": "human"},
        },
    }
    records = [*claude_header(), claude_user("2026-01-01T10:00:00.000Z", "go"), queued]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_claude(path)
    prompts = [e.summary for e in session.events if e.kind == "prompt"]
    assert prompts == ["go", "also fix the docs"]


def test_claude_queued_user_prompt_is_a_prompt_but_not_a_wait(tmp_path: Path) -> None:
    """Newer Claude Code logs a prompt typed mid-turn as a user entry with
    promptSource "queued". It is a prompt, and the running tool call before it
    is active time, not waiting."""
    records = [
        *claude_header(),
        claude_user("2026-01-01T10:00:00.000Z", "go"),
        claude_assistant(
            "2026-01-01T10:00:05.000Z", [("t1", "Bash", {"command": "make"})]
        ),
        claude_user("2026-01-01T10:01:05.000Z", "also fix the docs", "queued"),
        claude_tool_result("2026-01-01T10:02:05.000Z", "t1", "ok"),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_claude(path)
    prompts = [e.summary for e in session.events if e.kind == "prompt"]
    assert prompts == ["go", "also fix the docs"]
    assert session.waiting().total_seconds() == 0


def test_claude_typed_prompt_with_blocks_ends_a_wait(tmp_path: Path) -> None:
    """A typed prompt with a pasted image has list content; it is a prompt and
    ends the wait before it."""
    blocks = [{"type": "text", "text": "what is this?"}, {"type": "image"}]
    records = [
        *claude_header(),
        claude_user("2026-01-01T10:00:00.000Z", "go"),
        claude_assistant("2026-01-01T10:00:05.000Z", []),
        claude_user("2026-01-01T10:02:05.000Z", blocks),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_claude(path)
    prompts = [e.summary for e in session.events if e.kind == "prompt"]
    assert prompts == ["go", "what is this?"]
    assert session.waiting().total_seconds() == 120


def test_claude_slash_commands_are_prompts(tmp_path: Path) -> None:
    """Slash commands carry no promptSource: older ones only their <command-name>
    tag, newer ones a human origin. Each reads as typed, `/name args`, and ends a
    wait; a task notification is not a prompt."""
    goal = (
        "<command-name>/goal</command-name>\n<command-args>Ship "
        '<pasted_content id="p">it.\nAll of it.</pasted_content id="p"></command-args>'
    )
    progress = claude_user(
        "2026-01-01T10:05:00.000Z",
        "<command-message>progress</command-message>\n<command-name>/progress</command-name>",
        None,
    )
    progress["origin"] = {"kind": "human"}
    records = [
        *claude_header(),
        claude_user("2026-01-01T10:00:00.000Z", goal, None),
        claude_assistant("2026-01-01T10:00:05.000Z", []),
        claude_notification("2026-01-01T10:01:00.000Z", "x", "completed"),
        progress,
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_claude(path)
    prompts = [e.summary for e in session.events if e.kind == "prompt"]
    assert prompts == ["/goal Ship it.\nAll of it.", "/progress"]
    assert session.waiting().total_seconds() == 295


def test_claude_waiting_on_user_excluded_from_active_time(tmp_path: Path) -> None:
    """The gap between an assistant turn's end and the next typed prompt is
    waiting time and must not count as active time."""
    records = [
        *claude_header(),
        claude_user("2026-01-01T10:00:00.000Z", "first prompt"),
        claude_assistant(
            "2026-01-01T10:00:05.000Z", [("t1", "Read", {"file_path": "a.py"})]
        ),
        claude_tool_result("2026-01-01T10:00:10.000Z", "t1", "ok"),
        claude_assistant(
            "2026-01-01T10:00:15.000Z", []
        ),  # assistant's final reply, turn ends here
        # 5 minutes pass while the user is away
        claude_user("2026-01-01T10:05:15.000Z", "second prompt"),
        claude_assistant("2026-01-01T10:05:20.000Z", []),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_claude(path)
    assert session.waiting().total_seconds() == 300
    wall = (session.end - session.start).total_seconds()
    active = wall - session.waiting().total_seconds()
    assert active == pytest.approx(wall - 300)


def test_claude_unmatched_call_shown_as_running(tmp_path: Path) -> None:
    """A tool_use with no tool_result at all is reported as still running."""
    records = [
        *claude_header(),
        claude_user("2026-01-01T10:00:00.000Z", "start a long task"),
        claude_assistant(
            "2026-01-01T10:00:01.000Z", [("t1", "Bash", {"description": "slow build"})]
        ),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_claude(path)
    tool_events = [e for e in session.events if e.kind == "tool"]
    assert len(tool_events) == 1
    assert tool_events[0].end is None
    output = session_timeline.render(session, min_seconds=20)
    assert "running" in output
    assert "tool     Bash slow build" in output


def test_claude_subagent_timing_via_notification(tmp_path: Path) -> None:
    """A background Agent call resolves its real finish time via the
    task-notification that later reports the matching tool-use-id."""
    records = [
        *claude_header(),
        claude_user("2026-01-01T10:00:00.000Z", "run the audit skill"),
        claude_assistant(
            "2026-01-01T10:00:01.000Z",
            [
                (
                    "agent1",
                    "Agent",
                    {
                        "description": "Audit the repo",
                        "subagent_type": "general-purpose",
                    },
                )
            ],
        ),
        claude_tool_result(
            "2026-01-01T10:00:02.000Z",
            "agent1",
            "Async agent launched successfully. agentId: xyz",
        ),
        # unrelated activity while the background agent works
        claude_assistant(
            "2026-01-01T10:00:03.000Z", [("t2", "Read", {"file_path": "b.py"})]
        ),
        claude_tool_result("2026-01-01T10:00:04.000Z", "t2", "ok"),
        claude_notification("2026-01-01T10:45:00.000Z", "agent1", "completed"),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_claude(path)
    agent_events = [e for e in session.events if e.kind == "agent"]
    assert len(agent_events) == 1
    event = agent_events[0]
    assert event.end is not None
    assert (event.end - event.start).total_seconds() == 45 * 60 - 1
    assert "Audit the repo" in event.summary


def test_claude_notification_naming_only_the_task_closes_its_call(
    tmp_path: Path,
) -> None:
    """Some notifications carry only the task id the launch result named (agentId, or a
    background shell's ID): they still end that agent or shell, never another."""
    records = [
        *claude_header(),
        claude_assistant(
            "2026-01-01T10:00:01.000Z",
            [
                ("a1", "Agent", {"description": "Audit"}),
                ("b1", "Bash", {"command": "make", "run_in_background": True}),
                ("a2", "Agent", {"description": "Fix"}),
            ],
        ),
        claude_tool_result(
            "2026-01-01T10:00:02.000Z",
            "a1",
            "Async agent launched successfully. agentId: a18a5acb (internal ID)",
        ),
        claude_tool_result(
            "2026-01-01T10:00:02.000Z",
            "b1",
            "Command running in background with ID: bown1. Output is being written to: /tmp/x",
        ),
        claude_tool_result(
            "2026-01-01T10:00:02.000Z",
            "a2",
            "Async agent launched successfully. agentId: a2b0 (internal ID)",
        ),
        claude_notification("2026-01-01T10:20:00.000Z", None, "completed", "a18a5acb"),
        claude_notification("2026-01-01T10:30:00.000Z", None, "failed", "bown1"),
    ]
    session = session_timeline.parse_claude(write_jsonl(tmp_path / "s.jsonl", records))
    ends = {
        e.summary: (e.end and e.end.strftime("%H:%M"), e.failed) for e in session.events
    }
    assert ends == {
        "Audit": ("10:20", False),
        "Bash make": ("10:30", True),
        "Fix": (None, False),
    }


def test_claude_failed_calls_fail_their_event_and_strand(tmp_path: Path) -> None:
    """A call that errors, or a background one that ends other than completed, is failed,
    however long its description."""
    long = {"description": "Audit " + "x" * 150, "subagent_type": "general-purpose"}
    records = [
        *claude_header(),
        claude_assistant(
            "2026-01-01T10:00:01.000Z",
            [("a1", "Agent", long), ("t1", "Bash", {"command": "false"})],
        ),
        claude_tool_result(
            "2026-01-01T10:00:02.000Z", "a1", "Async agent launched successfully."
        ),
        claude_tool_result("2026-01-01T10:00:03.000Z", "t1", "exit 1", is_error=True),
        claude_notification("2026-01-01T10:45:00.000Z", "a1", "killed"),
    ]
    session = session_timeline.parse_claude(write_jsonl(tmp_path / "s.jsonl", records))
    assert [(e.kind, e.failed) for e in session.events] == [
        ("agent", True),
        ("tool", True),
    ]
    assert [s["failed"] for s in plan.strands(session.events)] == [True]


def test_claude_subagent_finished_mid_turn(tmp_path: Path) -> None:
    """A notification that arrives mid-turn is a queued-command attachment and
    still closes the background call."""
    notice = claude_notification("2026-01-01T10:10:00.000Z", "agent1", "completed")
    queued = {
        "type": "attachment",
        "timestamp": notice["timestamp"],
        "attachment": {
            "type": "queued_command",
            "prompt": notice["message"]["content"],
        },
    }
    records = [
        *claude_header(),
        claude_user("2026-01-01T10:00:00.000Z", "go"),
        claude_assistant(
            "2026-01-01T10:00:01.000Z", [("agent1", "Agent", {"description": "Audit"})]
        ),
        claude_tool_result(
            "2026-01-01T10:00:02.000Z", "agent1", "Async agent launched successfully."
        ),
        queued,
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_claude(path)
    [agent] = [e for e in session.events if e.kind == "agent"]
    assert agent.end is not None
    assert (agent.end - agent.start).total_seconds() == 10 * 60 - 1
    assert [e.kind for e in session.events].count("prompt") == 1


def test_claude_subagent_running_without_notification(tmp_path: Path) -> None:
    """A background Agent call with no notification yet is running, not finished."""
    records = [
        *claude_header(),
        claude_user("2026-01-01T10:00:00.000Z", "run the audit skill"),
        claude_assistant(
            "2026-01-01T10:00:01.000Z", [("agent1", "Agent", {"description": "Audit"})]
        ),
        claude_tool_result(
            "2026-01-01T10:00:02.000Z",
            "agent1",
            "Async agent launched successfully. agentId: xyz",
        ),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_claude(path)
    agent_events = [e for e in session.events if e.kind == "agent"]
    assert len(agent_events) == 1
    assert agent_events[0].end is None
