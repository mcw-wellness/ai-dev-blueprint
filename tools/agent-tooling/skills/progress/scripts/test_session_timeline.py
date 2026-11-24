#!/usr/bin/env -S uv run --quiet --with pytest --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for session_timeline.py's session lookup, format detection, rendering and options."""

import io
import json
import os
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

import session_timeline
from timeline_records import (
    claude_assistant,
    claude_header,
    claude_tool_result,
    claude_user,
    codex_session_meta,
    codex_tui_user_message,
    codex_user_message,
    write_jsonl,
)

# A prompt longer than a timeline row, with markup the owner typed on purpose.
MARKUP_PROMPT = (
    'Render <button type="submit">Save</button> and keep <custom_tag>value'
    "</custom_tag>; replace <old_tag> with <new_tag> everywhere.\n\n"
    "Then run the whole suite, fix every failure it reports, and only then "
    "push the branch and open the pull request against main."
)


def test_current_session_is_the_newest_transcript_named_by_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Claude and Codex each export their session id, and a session started from
    another inherits its id too; the transcript written last is the running one."""
    claude_dir, codex_dir = tmp_path / "claude", tmp_path / "codex"
    (claude_dir / "proj").mkdir(parents=True)
    (codex_dir / "2026" / "01" / "02").mkdir(parents=True)
    claude = write_jsonl(claude_dir / "proj" / "c1.jsonl", claude_header())
    codex = write_jsonl(
        codex_dir / "2026" / "01" / "02" / "rollout-2026-01-02T09-00-00-x1.jsonl",
        [codex_session_meta("2026-01-02T09:00:00.000Z")],
    )
    monkeypatch.setattr(session_timeline, "claude_projects_dir", lambda: claude_dir)
    monkeypatch.setattr(session_timeline, "codex_sessions_dir", lambda: codex_dir)
    monkeypatch.setenv("CLAUDE_CODE_SESSION_ID", "c1")
    monkeypatch.setenv("CODEX_THREAD_ID", "x1")
    os.utime(claude, (1, 1))
    assert session_timeline.resolve_session(None) == codex
    os.utime(claude, (2**31, 2**31))
    assert session_timeline.resolve_session(None) == claude
    monkeypatch.delenv("CLAUDE_CODE_SESSION_ID")
    assert session_timeline.resolve_session(None) == codex


def test_is_codex_detects_both_formats(tmp_path: Path) -> None:
    claude_path = write_jsonl(tmp_path / "claude.jsonl", claude_header())
    codex_path = write_jsonl(
        tmp_path / "codex.jsonl", [codex_session_meta("2026-01-02T09:00:00.000Z")]
    )
    assert session_timeline.is_codex(claude_path) is False
    assert session_timeline.is_codex(codex_path) is True


def test_since_scopes_rows_and_totals(tmp_path: Path) -> None:
    """--since drops earlier rows and clips wall and waiting time to the window."""
    records = [
        *claude_header(),
        claude_user("2026-01-01T10:00:00.000Z", "early prompt"),
        claude_assistant("2026-01-01T10:00:10.000Z", []),
        claude_user("2026-01-01T11:00:00.000Z", "late prompt"),
        claude_assistant("2026-01-01T11:00:20.000Z", []),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_claude(path)
    since = datetime.fromisoformat("2026-01-01T10:30:00.000Z")
    output = session_timeline.render(session.since(since), min_seconds=20)
    assert "early prompt" not in output and "late prompt" in output
    assert "wall 30m20s  waiting 30m00s  active 20s" in output


def test_rows_and_since_are_utc_whatever_the_local_zone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Rows read in UTC with a Z, like --sinks and Finish; a bare --since HH:MM is the latest past
    one in UTC."""
    records = [*claude_header(), claude_user("2026-01-01T10:00:00.000Z", "a prompt")]
    session = session_timeline.parse_claude(write_jsonl(tmp_path / "s.jsonl", records))
    monkeypatch.setenv("TZ", "America/Los_Angeles")
    time.tzset()
    try:
        output = session_timeline.render(session, min_seconds=20)
        since = session_timeline.parse_since("10:30")
    finally:
        monkeypatch.undo()
        time.tzset()
    assert "start 2026-01-01 10:00:00Z" in output
    assert any(line.startswith("10:00:00Z ") for line in output.splitlines())
    assert (since.utcoffset(), since.hour, since.minute) == (timedelta(0), 10, 30)
    ahead = datetime.now(UTC) + timedelta(hours=1)
    assert session_timeline.parse_since(f"{ahead:%H:%M}") < datetime.now(UTC)


def test_collapsed_row_spans_to_the_latest_finish(tmp_path: Path) -> None:
    """Overlapping short calls collapse into a row that ends at the latest
    finish, not at the finish of the call that started last."""
    records = [
        *claude_header(),
        claude_assistant("2026-01-01T10:00:01.000Z", [("a", "Bash", {})]),
        claude_assistant("2026-01-01T10:00:05.000Z", [("b", "Read", {})]),
        claude_tool_result("2026-01-01T10:00:06.000Z", "b", "ok"),
        claude_tool_result("2026-01-01T10:00:19.000Z", "a", "ok"),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    session = session_timeline.parse_claude(path)
    output = session_timeline.render(session, min_seconds=20)
    [collapsed] = [line for line in output.splitlines() if "calls:" in line]
    assert " 18s  tool     2 calls" in collapsed


def test_collapsed_row_counts_its_failed_calls(tmp_path: Path) -> None:
    """A failed call folded into a collapsed row still shows, as a count."""
    records = [
        *claude_header(),
        claude_assistant("2026-01-01T10:00:01.000Z", [("a", "Bash", {})]),
        claude_tool_result("2026-01-01T10:00:02.000Z", "a", "boom", is_error=True),
        claude_assistant("2026-01-01T10:00:03.000Z", [("b", "Read", {})]),
        claude_tool_result("2026-01-01T10:00:04.000Z", "b", "ok"),
    ]
    session = session_timeline.parse_claude(write_jsonl(tmp_path / "s.jsonl", records))
    output = session_timeline.render(session, min_seconds=20)
    [collapsed] = [line for line in output.splitlines() if "calls:" in line]
    assert collapsed.endswith("[1 failed]")


def test_prompts_option_prints_prompts_in_full(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    """--prompts prints the transcript path and each prompt in full; the
    timeline shows a prompt's first line."""
    records = [
        *claude_header(),
        claude_user("2026-01-01T10:00:00.000Z", "fix the parser\nand its tests"),
        claude_assistant("2026-01-01T10:00:01.000Z", [("t1", "Read", {})]),
        claude_tool_result("2026-01-01T10:00:02.000Z", "t1", "ok"),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    monkeypatch.setattr(sys, "argv", ["session_timeline.py", str(path), "--prompts"])
    session_timeline.main()
    output = capsys.readouterr().out
    assert output.startswith(f"{path}\n\n")
    assert output.endswith("fix the parser\nand its tests\n")
    assert "Read" not in output
    timeline = session_timeline.render(
        session_timeline.parse_claude(path), min_seconds=20
    )
    assert "fix the parser" in timeline and "and its tests" not in timeline


def test_prompts_option_respects_since_inclusively(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    records = [
        *claude_header(),
        claude_user("2026-01-01T09:59:59Z", "earlier task"),
        claude_user("2026-01-01T10:00:00Z", "current task"),
        claude_user("2026-01-01T10:00:01Z", "follow-up"),
    ]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "session_timeline.py",
            str(path),
            "--prompts",
            "--since",
            "2026-01-01T10:00:00Z",
        ],
    )
    session_timeline.main()
    output = capsys.readouterr().out
    assert output.startswith(f"{path}\n\n")
    assert "earlier task" not in output
    assert "current task" in output and "follow-up" in output


@pytest.mark.parametrize("client", ["claude", "codex"])
def test_prompts_option_joins_all_text_blocks(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    client: str,
) -> None:
    blocks = [
        {"type": "text", "text": "First\nparagraph."},
        {"type": "image"},
        {"type": "text", "text": "Second paragraph."},
    ]
    ts = "2026-01-01T10:00:00Z"
    if client == "claude":
        records = [*claude_header(), claude_user(ts, blocks)]
    else:
        prompt = codex_user_message(ts, "")
        prompt["payload"]["item"]["content"] = blocks
        records = [codex_session_meta(ts), prompt]
    path = write_jsonl(tmp_path / "s.jsonl", records)
    monkeypatch.setattr(sys, "argv", ["session_timeline.py", str(path), "--prompts"])
    session_timeline.main()
    assert capsys.readouterr().out.endswith("\nFirst\nparagraph. Second paragraph.\n")


@pytest.mark.parametrize(
    "records",
    [
        [*claude_header(), claude_user("2026-01-01T10:00:00.000Z", MARKUP_PROMPT)],
        [
            codex_session_meta("2026-01-01T10:00:00.000Z"),
            codex_tui_user_message("2026-01-01T10:00:01.000Z", MARKUP_PROMPT),
        ],
        [
            codex_session_meta("2026-01-01T10:00:00.000Z"),
            codex_user_message("2026-01-01T10:00:01.000Z", MARKUP_PROMPT),
        ],
    ],
    ids=["claude", "codex-interactive", "codex-exec"],
)
def test_prompts_option_keeps_typed_markup_and_length(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture,
    records: list[dict],
) -> None:
    """--prompts prints a prompt exactly as typed, however long and whatever
    tags it contains; only the clients' own wrappers are removed."""
    path = write_jsonl(tmp_path / "s.jsonl", records)
    monkeypatch.setattr(sys, "argv", ["session_timeline.py", str(path), "--prompts"])
    session_timeline.main()
    assert capsys.readouterr().out.endswith(f"\n{MARKUP_PROMPT}\n")


def test_compact_hook_hands_back_the_objective_and_latest_prompts_within_the_hook_limit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """As a SessionStart hook after compaction it reads the transcript from the hook's JSON and
    prints the first prompt and the latest ones, under the size Claude Code shows in full."""
    path = tmp_path / "s.jsonl"
    prompts = [f"prompt {i}: " + "x" * 1_500 for i in range(12)] + [
        "long: " + "y" * 3_000
    ]
    write_jsonl(
        path,
        [
            claude_user(f"2026-10-10T08:{i:02}:00.000Z", p)
            for i, p in enumerate(prompts)
        ],
    )
    monkeypatch.setattr(sys, "argv", ["session_timeline.py", "--compact-hook"])
    monkeypatch.setattr(
        sys, "stdin", io.StringIO(json.dumps({"transcript_path": str(path)}))
    )
    session_timeline.main()
    out = capsys.readouterr().out
    assert len(out) < 10_000
    assert out.startswith("This session was just compacted.")
    assert prompts[0] in out and prompts[-2] in out and prompts[1] not in out
    assert "y" * 1_900 + "y" * 50 in out and "y" * 2_000 not in out and "y [cut]" in out
    assert (
        out.index(prompts[0])
        < out.index("earlier prompts left out")
        < out.index("long: ")
    )
