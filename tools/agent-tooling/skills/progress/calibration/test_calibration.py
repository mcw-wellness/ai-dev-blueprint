#!/usr/bin/env -S uv run --quiet --with pytest --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for calibration.py: which turn-ending `Running:` finishes a session's verdicts close."""

from datetime import UTC, datetime
from pathlib import Path

import calibration
from timeline_records import (
    claude_assistant,
    claude_header,
    claude_reply,
    claude_tool_result,
    claude_user,
    write_jsonl,
)


def turn(ts: str, text: str) -> list[dict]:
    """A reply that ends its turn: Claude Code logs the Stop hook's summary right after it."""
    stop = {"type": "system", "subtype": "stop_hook_summary", "timestamp": ts}
    return [claude_reply(ts, text), stop]


def found(
    tmp_path: Path, *records: dict | list[dict]
) -> list[tuple[float, float, bool]]:
    flat = [r for rec in records for r in (rec if isinstance(rec, list) else [rec])]
    path = write_jsonl(tmp_path / "s1.jsonl", [*claude_header("s1"), *flat])
    return [
        (e.promised_min, e.actual_min, e.original) for e in calibration.collect([path])
    ]


def test_a_done_closes_the_finishes_open_since_the_last_close_unless_it_names_one_ahead(
    tmp_path: Path,
) -> None:
    path = write_jsonl(
        tmp_path / "s1.jsonl",
        [
            *claude_header("s1"),
            claude_user("2026-11-01T09:55:00Z", "ship it"),
            # Dropped: a Not done closes it.
            *turn("2026-11-01T09:56:00Z", "Running: CI, done ~10:30Z."),
            *turn("2026-11-01T09:58:00Z", "Not done: CI is red."),
            *turn("2026-11-01T10:00:00Z", "Running: review then merge, done ~10:40Z."),
            *turn(
                "2026-11-01T10:10:00Z",
                "**Running:** CI 5 → Release 10, done ~10:50Z.\n\n"
                "Remaining: ~40 min = CI 5 → Release 10 → host check 25",
            ),
            # A strand's Done that still names the rest's finish closes nothing.
            *turn(
                "2026-11-01T10:15:00Z",
                "Done: the docs PR merged.\n\nAbout 35 min left; expected finish 10:50Z.",
            ),
            claude_user("2026-11-01T10:16:00Z", "also bump the version"),
            *turn("2026-11-01T10:20:00Z", "Done. Merged and released."),
            # Dropped: the finish was already past when written.
            *turn("2026-11-01T10:30:00Z", "Running: verifying, done ~10:25Z."),
            *turn("2026-11-01T10:31:00Z", "Done. Verified."),
        ],
    )
    estimates = calibration.collect([path])
    assert [
        (e.promised_min, e.actual_min, e.original, e.prompts) for e in estimates
    ] == [
        (40, 20, True, 1),
        (40, 10, False, 1),
    ]
    assert [e.ratio for e in estimates] == [0.5, 0.25]
    assert [e.waits for e in estimates] == [True, True]


def test_only_the_reply_ending_a_turn_counts_not_notes_between_tool_calls(
    tmp_path: Path,
) -> None:
    assert found(
        tmp_path,
        turn("2026-11-01T10:00:00Z", "Running: review, done ~10:40Z."),
        claude_reply("2026-11-01T10:05:00Z", "Done. Step one; now the next."),
        claude_assistant("2026-11-01T10:05:01Z", [("t1", "Bash", {"command": "ls"})]),
        claude_tool_result("2026-11-01T10:05:02Z", "t1", "ok"),
        claude_reply("2026-11-01T10:06:00Z", "Running: rebuild, done ~11:30Z."),
        claude_assistant("2026-11-01T10:06:01Z", [("t2", "Bash", {"command": "ls"})]),
        claude_tool_result("2026-11-01T10:06:02Z", "t2", "ok"),
        turn("2026-11-01T10:20:00Z", "Done. Reviewed and merged."),
    ) == [(40, 20, True)]


def test_a_bare_time_earlier_that_day_in_a_done_is_past_not_tomorrows_finish(
    tmp_path: Path,
) -> None:
    assert found(
        tmp_path,
        turn("2026-11-01T16:30:00Z", "Running: the Release, done ~17:30Z."),
        turn(
            "2026-11-01T17:00:00Z",
            "Done. Released.\n\nNothing left; CI started 09:00Z.",
        ),
    ) == [(60, 30, True)]
    # Named as a finish, the same time early tomorrow is the rest still running.
    assert not found(
        tmp_path,
        turn("2026-11-01T16:30:00Z", "Running: the Release, done ~17:30Z."),
        turn("2026-11-01T17:00:00Z", "Done: docs.\n\nThe rest is left; done ~09:00Z."),
    )


def test_a_finish_already_past_still_makes_the_next_one_a_move_not_an_original(
    tmp_path: Path,
) -> None:
    assert found(
        tmp_path,
        turn("2026-11-01T10:00:00Z", "Running: CI, done ~09:50Z."),
        turn("2026-11-01T10:01:00Z", "Running: CI, done ~10:41Z."),
        turn("2026-11-01T10:21:00Z", "Done. CI passed."),
    ) == [(40, 20, False)]


def test_the_window_holds_estimates_written_in_it_not_every_one_of_a_recent_file(
    tmp_path: Path,
) -> None:
    path = write_jsonl(
        tmp_path / "s1.jsonl",
        [
            *claude_header("s1"),
            *turn("2026-10-01T10:00:00Z", "Running: CI, done ~10:40Z."),
            *turn("2026-10-01T10:20:00Z", "Done. CI passed."),
            *turn("2026-11-01T10:00:00Z", "Running: CI, done ~10:40Z."),
            *turn("2026-11-01T10:20:00Z", "Done. CI passed."),
        ],
    )
    floor = datetime(2026, 10, 25, tzinfo=UTC)
    assert [
        e.written_at.date().isoformat() for e in calibration.collect([path], floor)
    ] == ["2026-11-01"]
