"""A thread's plan laid on the clock, its forecast, what waits on the owner, and the cuts that
would finish it sooner, from `board --status` and the session's events.

Each step gets a baseline window from its first estimates, an actual window from the agents
that did it, and a forecast from both. The prompt hint reads this; it computes none of it. Times
are epoch milliseconds, as the plugin's clock counts.
"""

import re
from datetime import datetime, timedelta
from typing import Any, TypedDict

from timeline_model import Event, fmt

MIN = 60_000
SLIP_MINUTES = 5  # a smaller overrun is noise, not a slip
OVERRUN_FLOOR = 5  # minutes a running step past its estimate is still expected to need
SERIAL_MINUTES = 10
CI_SHARE = 0.15
SPLIT_MINUTES = 60
SPLIT_OVERHEAD = 15  # briefing a second agent and merging its half

TYPE_RE = re.compile(r" \([\w:-]+\)$")
SAVES_RE = re.compile(r"\bsaves? (\d+(?:\.\d+)?) ?(h|m|min)\b")

# `board --status`'s thread and plan step, as it prints them.
Thread = dict[str, Any]
Step = dict[str, Any]


class Strand(TypedDict):
    name: str
    start: float
    end: float | None
    failed: bool


class Placed(TypedDict):
    step: Step
    state: str  # done | running | waiting | todo | failed
    strands: list[Strand]
    planStart: float  # the baseline: when the first estimates said it would run
    planEnd: float
    start: float  # what happened, then what is expected
    end: float
    actualStart: float | None
    slip: float  # minutes its end lies past the baseline's; 0 under SLIP_MINUTES


class Ask(TypedDict, total=False):
    what: str
    since: float
    blocks: int


def ms(t: datetime) -> float:
    return t.timestamp() * 1000


def strands(events: list[Event]) -> list[Strand]:
    """The session's agents, each named without its type suffix."""
    return [
        {
            "name": TYPE_RE.sub("", e.summary),
            "start": ms(e.start),
            "end": ms(e.end) if e.end else None,
            "failed": e.failed,
        }
        for e in events
        if e.kind == "agent"
    ]


def implied(agents: list[Strand], now: float) -> list[Step]:
    """With no `## Plan`, every agent of the session is a step of its own; a description
    launched again is numbered, so two launches hours apart never merge into one step."""
    steps = []
    used: set[str] = set()
    for s in agents:
        took = ((s["end"] or now) - s["start"]) / MIN
        name, n = s["name"], 1
        while (
            name in used
        ):  # numbered past every name taken, a described "(2)" included
            n += 1
            name = f"{s['name']} ({n})"
        used.add(name)
        steps.append(
            {
                "name": name,
                "after": [],
                "estMinutes": took,
                "baseMinutes": took,
                "agents": name,
                "marks": [],
                "note": "",
            }
        )
    return steps


def owners(plan: list[Step], agents: list[Strand]) -> dict[str, list[Strand]]:
    """Each agent goes to the step whose `Agents` prefix of its description is longest."""
    out: dict[str, list[Strand]] = {step["name"]: [] for step in plan}
    for s in agents:
        name = s["name"].lower()
        fits = [p for p in plan if p["agents"] and name.startswith(p["agents"].lower())]
        if fits:
            out[max(fits, key=lambda p: len(p["agents"]))["name"]].append(s)
    return out


def state_of(step: Step, mine: list[Strand], deps_done: bool) -> str:
    if any(s["end"] is None for s in mine):
        return "running"
    if any(s["failed"] for s in mine):
        return "failed"
    if mine or "done" in step["marks"]:
        return "done"
    return "waiting" if deps_done and "you" in step["marks"] else "todo"


def due(end: float, now: float) -> float:
    """A running step's expected end: as estimated, or once past it, as long again as it has
    overrun and at least OVERRUN_FLOOR, so the forecast stays ahead of now while work runs."""
    return end if end > now else now + max(OVERRUN_FLOOR * MIN, now - end)


def schedule(thread: Thread | None, agents: list[Strand], now: float) -> dict:
    planned = thread is not None and bool(thread["plan"])
    plan = thread["plan"] if thread and planned else implied(agents, now)
    # Unplanned, each step is its agent: no prefix match hands one launch's strand to another.
    doing = (
        owners(plan, agents)
        if planned
        else {p["name"]: [s] for p, s in zip(plan, agents, strict=True)}
    )
    starts = [s["start"] for ss in doing.values() for s in ss]
    anchor = min(starts) if starts else now
    placed: dict[str, Placed] = {}
    for step in plan:
        deps = [placed[n] for n in step["after"] if n in placed]
        mine = doing.get(step["name"], [])
        actual = min(s["start"] for s in mine) if mine else None
        # Without a plan the baseline is what happened.
        plan_start = (
            max([anchor, *(d["planEnd"] for d in deps)])
            if planned
            else (actual if actual is not None else anchor)
        )
        deps_end = max([anchor, *(d["end"] for d in deps)])
        state = state_of(step, mine, all(d["state"] == "done" for d in deps))
        est = step["estMinutes"] * MIN
        if actual is not None:
            start = actual
            ends = [s["end"] or now for s in mine]
            end = due(start + est, now) if state == "running" else max(ends)
        elif state == "done":
            start = end = deps_end
        else:
            start = deps_end if state == "waiting" else max(now, deps_end)
            end = max(now, start) + est
        plan_end = plan_start + step["baseMinutes"] * MIN
        placed[step["name"]] = {
            "step": step,
            "state": state,
            "strands": mine,
            "planStart": plan_start,
            "planEnd": plan_end,
            "start": start,
            "end": end,
            "actualStart": actual,
            "slip": slip if (slip := (end - plan_end) / MIN) > SLIP_MINUTES else 0,
        }
    steps = list(placed.values())
    return {
        "steps": steps,
        "anchor": anchor,
        "forecast": max([now, *(p["end"] for p in steps)]),
        "baseline": max([anchor, *(p["planEnd"] for p in steps)]),
    }


def finishes(thread: Thread | None, forecast: float) -> dict:
    """The promised finish, the first one promised, earlier ones, and the forecast against it."""
    at = thread["finish_at"] if thread else None
    promised = at * 1000 if at is not None else None
    moves = thread["moves"] if thread else []
    if promised is None:
        return {"promised": None, "first": None, "earlier": [], "late": False}
    first = promised - sum(m[1] * 1000 for m in moves)
    earlier = [first]
    for m in moves[:-1]:
        earlier.append(earlier[-1] + m[1] * 1000)
    return {
        "promised": promised,
        "first": first,
        "earlier": earlier if moves else [],
        "late": forecast - promised > SLIP_MINUTES * MIN,
    }


def asks(thread: Thread, needs_you: list[str], steps: list[Placed]) -> list[Ask]:
    """What waits on the owner, oldest first: steps blocked on them, then Needs-you items."""
    out: list[Ask] = [
        {
            "what": p["step"]["note"] or p["step"]["name"],
            "since": p["start"],
            "blocks": sum(p["step"]["name"] in q["step"]["after"] for q in steps),
        }
        for p in steps
        if p["state"] == "waiting"
    ]
    prefix = f"{thread['name']}: "
    out += [
        {"what": item[len(prefix) :].replace("**", ""), "blocks": 0}
        for item in needs_you
        if item.startswith(prefix)
    ]
    return out


def critical_path(steps: list[Placed]) -> list[Placed]:
    """The steps the forecast waits on, last first, through each latest dependency."""
    by_name = {p["step"]["name"]: p for p in steps}
    path: list[Placed] = []
    here = steps
    while here:
        last = max(here, key=lambda p: p["end"])
        path.append(last)
        here = [by_name[n] for n in last["step"]["after"] if n in by_name]
    return path


def minutes(m: float) -> str:
    return fmt(timedelta(minutes=m))


def cuts(sinks: dict, s: dict, now: float) -> list[dict]:
    """Ways to finish sooner that rules over measured data find, largest saving first; `saves`
    is minutes, None when the data cannot size it; `owner` marks one only the owner clears."""
    out: list[dict] = []
    path = critical_path(s["steps"])
    left = max(0.0, (s["forecast"] - now) / MIN)
    # An owner wait on the critical path moves the finish by every minute it waits: it ranks first.
    for p in (q for q in path if q["state"] == "waiting"):
        name = p["step"]["name"]
        blocks = sum(name in q["step"]["after"] for q in s["steps"])
        waited = minutes((now - p["start"]) / MIN)
        out.append(
            {
                "text": f"Answer {name}: unblocks {blocks} step{'' if blocks == 1 else 's'}",
                "saves": None,
                "owner": True,
                "trades": "nothing",
                "basis": f"{p['step']['note'] or name}; waiting {waited}, the finish moves with each minute",
            }
        )
    wall = sinks["wall"]
    if wall > 0 and left > 0:
        if sinks["serial"] > SERIAL_MINUTES:
            out.append(
                {
                    "text": "Background the serial waits",
                    "saves": sinks["serial"] / wall * left,
                    "trades": "nothing",
                    "basis": f"{minutes(sinks['serial'])} of {minutes(wall)} sat on one call, scaled to the {minutes(left)} left",
                }
            )
        ci = next((c for c in sinks["classes"] if c["name"] == "CI and deploy"), None)
        if ci and ci["minutes"] > CI_SHARE * wall:
            gap = ci["gaps"][0] if ci["gaps"] else None
            biggest = (
                f", largest {minutes(gap['minutes'])} {gap['summary']}" if gap else ""
            )
            out.append(
                {
                    "text": "Cut the CI wait",
                    "saves": ci["minutes"] / wall * left,
                    "trades": "nothing",
                    "basis": f"CI {minutes(ci['minutes'])} of {minutes(wall)}{biggest}",
                }
            )
    alone = [
        (p, (p["end"] - max(now, p["start"])) / MIN)
        for p in path
        if p["step"]["agents"]
        and len(p["strands"]) <= 1
        and p["state"] not in ("done", "failed")
    ]
    alone = [x for x in alone if x[1] >= SPLIT_MINUTES]
    if alone:
        p, rest = max(alone, key=lambda x: x[1])
        out.append(
            {
                "text": f"Split {p['step']['name']} across two agents",
                "saves": rest / 2 - SPLIT_OVERHEAD,
                "trades": "cost",
                "basis": f"{minutes(rest)} left on the critical path, one agent on it",
            }
        )
    for p in path:
        if "branch" in p["step"]["marks"] and p["state"] != "done":
            note = p["step"]["note"]
            stated = SAVES_RE.search(note)
            out.append(
                {
                    "text": f"Decide {p['step']['name']} for the shorter branch",
                    "saves": float(stated[1]) * (60 if stated[2] == "h" else 1)
                    if stated
                    else None,
                    "trades": "verification",
                    "basis": note or "no decision text in the plan",
                }
            )
    return sorted(
        out,
        key=lambda c: (c.get("owner", False), -1 if c["saves"] is None else c["saves"]),
        reverse=True,
    )


def plan(
    thread: Thread | None,
    needs_you: list[str],
    agents: list[Strand],
    sinks: dict,
    now: float,
) -> dict:
    """This session's thread on the clock: what the Timeline, Since and Speedup views and the
    status line draw."""
    s = schedule(thread, agents, now)
    return {
        **s,
        **finishes(thread, s["forecast"]),
        "asks": asks(thread, needs_you, s["steps"]) if thread else [],
        "cuts": cuts(sinks, s, now),
        "agents": agents,
        "critical": [p["step"]["name"] for p in critical_path(s["steps"])],
    }
