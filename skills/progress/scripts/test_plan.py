"""Tests for plan.py: a handoff's plan on the clock, its forecast, the owner's asks, the cuts."""

import io
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

import plan
import session_timeline
from timeline_model import Event, Session
from timeline_records import (
    claude_assistant,
    claude_header,
    claude_tool_result,
    write_jsonl,
)


def at(hhmm: str) -> float:
    return plan.ms(datetime.fromisoformat(f"2026-10-25T{hhmm}:00+00:00"))


def agent(start: str, end: str | None, name: str, failed: bool = False) -> Event:
    t = lambda s: datetime.fromisoformat(f"2026-10-25T{s}:00+00:00")  # noqa: E731
    summary = f"{name} (general-purpose)"
    return Event(t(start), t(end) if end else None, "agent", summary, failed=failed)


def step(name: str, est: float, **more: Any) -> dict:
    return {
        "name": name,
        "after": [],
        "estMinutes": est,
        "baseMinutes": est,
        "agents": "",
        "marks": [],
        "note": "",
        **more,
    }


def thread(steps: list[dict], **more: Any) -> dict:
    """A thread as `board --status` prints it, its `finish_at` read from `finish`."""
    t = {
        "name": "cockpit",
        "theme": "tooling",
        "state": "running",
        "finish": "2026-10-25T14:00Z, estimate",
        "slip": "",
        "session": "s1",
        "failing": [],
        "slipping": "",
        "moves": [],
        "plan": steps,
        **more,
    }
    lead = t["finish"].split(",")[0]
    return {
        **t,
        "finish_at": datetime.fromisoformat(lead).timestamp() if lead else None,
    }


PLAN = [
    step("design", 120, agents="Design"),
    step("keys", 10, after=["design"], marks=["you"], note="create the app"),
    step("since", 60, after=["design"], agents="View since"),
    step("board", 60, after=["design"], agents="View board"),
    step(
        "review",
        60,
        after=["since", "board"],
        marks=["branch"],
        note="one round or two",
    ),
]
AGENTS = plan.strands(
    [
        agent("08:00", "10:30", "Design cockpit"),
        agent("10:31", None, "View since"),
        agent("10:31", "11:00", "View board"),
    ]
)


def test_a_plan_on_the_clock() -> None:
    """Done late, waiting on the owner, running past its baseline, parallel steps bracketed."""
    s = plan.schedule(thread(PLAN), AGENTS, at("11:00"))
    by = {p["step"]["name"]: p for p in s["steps"]}
    assert [by[n]["state"] for n in ("design", "keys", "since", "board", "review")] == [
        "done",
        "waiting",
        "running",
        "done",
        "todo",
    ]
    assert by["design"]["slip"] == 30  # two hours estimated, two and a half taken
    assert (
        by["since"]["slip"] == 31
    )  # an hour planned from 10:00, still running at 11:00
    assert s["forecast"] == at("12:31")
    asks = plan.asks(
        thread(PLAN), ["cockpit: pick a palette", "other: not mine"], s["steps"]
    )
    assert asks == [
        {"what": "create the app", "since": at("10:30"), "blocks": 0},
        {"what": "pick a palette", "blocks": 0},
    ]


def test_the_critical_path() -> None:
    """The finish waits on review through since, the later of its two inputs."""
    s = plan.plan(
        thread(PLAN), [], AGENTS, {"wall": 0, "serial": 0, "classes": []}, at("11:00")
    )
    assert s["critical"] == ["review", "since", "design"]


def test_an_agent_goes_to_the_longest_prefix_and_a_failed_one_fails_its_step() -> None:
    steps = [step("views", 60, agents="View"), step("since", 60, agents="View since")]
    events = [
        agent("08:00", "08:30", "View board", failed=True),
        agent("08:00", "08:40", "View since"),
    ]
    by = {
        p["step"]["name"]: p
        for p in plan.schedule(thread(steps), plan.strands(events), at("09:00"))[
            "steps"
        ]
    }
    assert (by["views"]["state"], by["since"]["state"], by["since"]["end"]) == (
        "failed",
        "done",
        at("08:40"),
    )


def test_without_a_plan_each_agent_is_a_step() -> None:
    agents = plan.strands(
        [agent("08:00", "08:20", "Survey friction"), agent("08:05", None, "Build pane")]
    )
    s = plan.schedule(thread([]), agents, at("08:30"))
    assert [(p["step"]["name"], p["state"]) for p in s["steps"]] == [
        ("Survey friction", "done"),
        ("Build pane", "running"),
    ]


def test_an_agent_launched_again_is_a_step_of_its_own_not_one_span_across_both() -> (
    None
):
    """One description launched twice hours apart (session 82737ad7, 10-26 and 10-27) drew one
    step spanning both, "31h33m over"; each launch is its own step, on time."""
    agents = plan.strands(
        [
            agent("01:09", "01:27", "Final audit"),
            agent("08:41", "09:15", "Final audit"),
            agent("09:20", None, "Final audit (2)"),
        ]
    )
    s = plan.schedule(thread([]), agents, at("09:30"))
    assert [
        (p["step"]["name"], p["start"], p["end"], p["slip"]) for p in s["steps"]
    ] == [
        ("Final audit", at("01:09"), at("01:27"), 0),
        ("Final audit (2)", at("08:41"), at("09:15"), 0),
        ("Final audit (2) (2)", at("09:20"), at("09:35"), 0),
    ]


def test_a_step_running_past_its_estimate_keeps_the_forecast_ahead_of_now() -> None:
    """Past its estimate a running step needs as long again as it overran, at least 5 minutes:
    the forecast never sits at now while work runs, and a long overrun turns the verdict late."""
    audit = thread([step("audit", 30, agents="Audit")], finish="2026-10-25T11:20Z")
    agents = plan.strands([agent("10:00", None, "Audit")])
    for now, forecast, late in (("10:31", "10:36", False), ("11:00", "11:30", True)):
        s = plan.schedule(audit, agents, at(now))
        assert s["forecast"] == at(forecast)
        assert plan.finishes(audit, s["forecast"])["late"] is late


def test_a_forecast_past_finish_is_late_with_the_finishes_promised_before() -> None:
    late = thread(PLAN, finish="2026-10-25T11:30Z", moves=[[at("09:00") / 1000, 1800]])
    f = plan.finishes(late, at("12:00"))
    assert (f["promised"], f["first"], f["earlier"], f["late"]) == (
        at("11:30"),
        at("11:00"),
        [at("11:00")],
        True,
    )
    assert plan.finishes(thread([], finish=""), at("12:00"))["promised"] is None


def test_each_cut_rule_fires_once_ranked_by_what_it_saves() -> None:
    """The keys wait on the owner and hold up a two-hour build, then a review of one round or two."""
    steps = [
        step("design", 120, agents="Design"),
        step("keys", 10, after=["design"], marks=["you"], note="create the GitHub App"),
        step("build", 120, after=["keys"], agents="Build"),
        step(
            "review",
            60,
            after=["build"],
            agents="Review",
            marks=["branch"],
            note="one round or two; one round saves 45m",
        ),
    ]
    sinks = {
        "wall": 180,
        "serial": 25,
        "classes": [
            {
                "name": "CI and deploy",
                "minutes": 40,
                "gaps": [
                    {"minutes": 18, "at": "", "summary": "Bash Wait for CI on #12"}
                ],
            }
        ],
    }
    now = at("11:00")
    s = plan.schedule(
        thread(steps), plan.strands([agent("08:00", "10:00", "Design cockpit")]), now
    )
    assert (s["forecast"] - now) / plan.MIN == 190  # keys 10m, build 2h, review 1h
    found = plan.cuts(sinks, s, now)
    assert [
        (c["text"], c["trades"], c["saves"] and round(c["saves"])) for c in found
    ] == [
        ("Answer keys: unblocks 1 step", "nothing", None),
        ("Split build across two agents", "cost", 45),
        ("Decide review for the shorter branch", "verification", 45),
        ("Cut the CI wait", "nothing", round(40 / 180 * 190)),
        ("Background the serial waits", "nothing", round(25 / 180 * 190)),
    ]
    assert (
        found[0]["owner"] and "largest 18m Bash Wait for CI on #12" in found[3]["basis"]
    )


def test_json_with_board_on_stdin_is_the_hints_one_input(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    sid = "2eff9726-4b8c-4b95-9f5d-3a808968d2b9"
    path = write_jsonl(
        tmp_path / f"{sid}.jsonl",
        [
            *claude_header(),
            claude_assistant(
                "2026-10-25T08:00:00.000Z",
                [
                    (
                        "a1",
                        "Agent",
                        {
                            "description": "Design cockpit",
                            "subagent_type": "general-purpose",
                        },
                    )
                ],
            ),
            claude_tool_result("2026-10-25T09:00:00.000Z", "a1", "done"),
        ],
    )
    board = {
        "threads": [thread([step("design", 60, agents="Design")], session=sid)],
        "needs_you": [],
    }
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(board)))
    monkeypatch.setattr(
        sys, "argv", ["session_timeline.py", str(path), "--json", "--board", "-"]
    )
    session_timeline.main()
    out = json.loads(capsys.readouterr().out)
    assert out["plan"]["thread"]["name"] == "cockpit"
    assert [(p["step"]["name"], p["state"]) for p in out["plan"]["steps"]] == [
        ("design", "done")
    ]
    # Only what readers use: the plugin reads `plan`, the progress skill `sinks` and `plan.cuts`;
    # a long session's events once took the output past the plugin's 4 MiB read (COR-1).
    assert out.keys() == {"sinks", "plan"}


FIXTURE = Path(__file__).resolve().parents[3] / "mods/hooks/fixtures/timeline.ts"


def test_the_plugins_fixture_is_this_librarys_output() -> None:
    """The plugin's tests read `mods/hooks/fixtures/timeline.ts`; it must be what this library
    prints, so a schema change fails here. `UPDATE_FIXTURE=1` rewrites it."""
    sid = "2eff9726-4b8c-4b95-9f5d-3a808968d2b9"
    t = lambda s: datetime.fromisoformat(f"2026-10-25T{s}:00+00:00")  # noqa: E731
    prompt = lambda s, text: Event(t(s), t(s), "prompt", text)  # noqa: E731
    events = [
        prompt("08:00", "go"),
        agent("08:00", "10:30", "Design cockpit"),
        prompt("10:00", "ship the views"),
        agent("10:31", None, "View since"),
        agent("10:31", "11:00", "View board"),
        Event(t("10:35"), t("10:55"), "tool", "Bash Wait for CI on #12"),
        Event(t("10:40"), t("10:41"), "tool", "Bash Run the view tests", failed=True),
    ]
    waits = [(t("09:10"), t("09:50"))]  # the owner away, the lead idle
    session = Session(Path(f"{sid}.jsonl"), t("08:00"), t("11:00"), waits, events)
    steps = [
        step("design", 120, agents="Design"),
        step("keys", 60, after=["design"], marks=["you"], note="create the app"),
        step("since", 60, after=["design"], agents="View since"),
        step("board", 60, after=["design"], agents="View board"),
        step(
            "review",
            60,
            after=["since", "keys"],
            marks=["branch"],
            note="one round or two; one round saves 45m",
        ),
    ]
    moves = [[at("09:00") / 1000, 3600], [at("10:05") / 1000, 1800]]

    def other(name: str, **more: object) -> dict:
        return thread([], **{"name": name, "session": "", "finish": "", **more})

    board = {
        "at": at("11:00") / 1000,
        "threads": [
            other("running-late", finish="2026-10-25T09:30Z"),
            other(
                "tomorrow",
                finish="2026-10-26T13:00Z, basis",
                plan=[
                    step("spec", 60, marks=["done"]),
                    step("approve", 20, after=["spec"], marks=["you"]),
                    step("build", 240, after=["approve"]),
                ],
            ),
            thread(steps, session=sid, moves=moves),
            other("no-finish"),
            other("asks", state="waiting on you", finish="2026-10-25T12:00Z"),
            other(
                "alerts",
                finish="2026-10-25T16:30Z",
                slipping="finish slipping, 2 later moves, 1.5 h: stop adding work",
                moves=moves,
            ),
        ],
        "needs_you": [
            "cockpit: pick a palette",
            "asks: waiting on you, to turn Tardis back on",
            "(by 2026-10-28) **Renew the key**: before then",
            "**Pick a venue**: one of two",
        ],
    }
    out = session_timeline.as_json(session, board, now=at("11:00"))
    text = (
        "// Written by skills/progress/scripts/test_plan.py: session_timeline.py's --json for one\n"
        "// session at 11:00Z. Regenerate with UPDATE_FIXTURE=1 rather than edit it.\n"
        "import type { Timeline } from '../../types'\n\n"
        f"export const NOW = {int(at('11:00'))}\n"
        f"export const SESSION = '{sid}'\n"
        f"export const TIMELINE: Timeline = {json.dumps(out, indent=1, ensure_ascii=False)}\n"
    )
    if os.environ.get("UPDATE_FIXTURE"):
        FIXTURE.parent.mkdir(exist_ok=True)
        FIXTURE.write_text(text)
    assert FIXTURE.read_text() == text
