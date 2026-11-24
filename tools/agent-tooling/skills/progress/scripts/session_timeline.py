#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.12"
# ///
"""Turn an agent session transcript into a compact, timestamped timeline.

Reads a Claude Code (`~/.claude/projects/*/<id>.jsonl`) or Codex
(`~/.codex/sessions/**/rollout-*.jsonl`) transcript and prints one row per
prompt, tool call, or subagent, with measured durations. Consecutive short
tool calls collapse into a single row so long sessions stay small. `--sinks`
prints where the wall time went; `--json` prints that and the plan's schedule,
forecast and cuts (the plan's thread from `--board`): the one JSON the prompt
hint reads.
"""

import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path

import plan
import time_sinks
from claude_transcript import parse_claude
from codex_transcript import parse_codex
from timeline_model import Event, Session, fmt, load_jsonl

# Short calls separated by more idle time than this start a new collapsed row,
# so a row's span never hides a pause such as waiting on a background agent.
IDLE_BREAK = timedelta(minutes=2)
# Claude Code puts hook output over 10,000 characters in a file and shows the session only a short
# preview, and showed 9,629 in full (measured 2026-10-10); it also prefixes a "hook success" label.
HOOK_LIMIT = 9_500
PROMPT_CAP = 2_000


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "sessions",
        nargs="*",
        help="session ids or .jsonl transcript paths; default the current session",
    )
    parser.add_argument(
        "--since",
        help="only count events from this UTC HH:MM (the latest past one) or ISO time",
    )
    parser.add_argument(
        "--handoff",
        type=Path,
        help="print its Status, Finish, Gate, Rounds and Blockers; default sessions",
    )
    parser.add_argument(
        "--prompts", action="store_true", help="print the path and the prompts in full"
    )
    parser.add_argument(
        "--sinks", action="store_true", help="print where the wall time went"
    )
    parser.add_argument(
        "--pr-timings",
        nargs="*",
        metavar="REPO",
        help="print agents' pull request durations by repository and size (JSON with --json),"
        " to plan a timeline; no REPO means every one agents opened pull requests in",
    )
    parser.add_argument(
        "--days", type=float, default=4, help="with --pr-timings: the window"
    )
    parser.add_argument(
        "--owner", default="vvs-capital", help="with --pr-timings: the GitHub owner"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="print the time sinks and plan, or the PR timings, as JSON, for other tools",
    )
    parser.add_argument(
        "--board",
        help="with --json: `board --status` output (a file, or - for stdin) for the"
        " plan and every thread",
    )
    parser.add_argument(
        "--compact-hook",
        action="store_true",
        help="as Claude Code's SessionStart hook after compaction: take the transcript from the"
        " hook's JSON on stdin and print the owner's prompts, which a summary can drop",
    )
    parser.add_argument(
        "--min-seconds",
        type=int,
        default=20,
        help="tool/agent calls shorter than this collapse into a group (default 20)",
    )
    args = parser.parse_args()
    if args.pr_timings is not None:
        samples = time_sinks.pr_samples(args.pr_timings, args.days, args.owner)
        print(json.dumps(samples) if args.json else time_sinks.pr_report(samples))
        return
    since = parse_since(args.since) if args.since else None
    if args.compact_hook:
        print(compact_hook(resolve_session(json.load(sys.stdin)["transcript_path"])))
        return
    sessions = args.sessions
    if args.handoff:
        lines, ids = time_sinks.handoff_lines(args.handoff)
        if not args.json:
            print("\n".join([str(args.handoff), *lines, ""]))
        sessions = sessions or ids
    board = None
    if args.board:
        text = sys.stdin.read() if args.board == "-" else Path(args.board).read_text()
        board = json.loads(text)
    for arg in sessions or [None]:
        path = resolve_session(arg)
        session = (parse_codex(path) if is_codex(path) else parse_claude(path)).since(
            since
        )
        if args.prompts:
            print("\n\n".join([str(path), *prompts(session)]))
        elif args.json:
            print(json.dumps(as_json(session, board)))
        elif args.sinks:
            print(time_sinks.report(session), end="\n\n")
        else:
            print(render(session, args.min_seconds))


def prompts(session: Session) -> list[str]:
    return [
        f"{utc(e.start)}\n{e.summary}" for e in session.events if e.kind == "prompt"
    ]


def compact_hook(path: Path) -> str:
    preamble = (
        "This session was just compacted. Below, verbatim, are prompts the owner typed in it:"
        " the first, then the latest that fit, each cut at"
        f" {PROMPT_CAP:,} characters. Where the summary differs from them, they win; where two"
        " conflict, the later one wins. All of them, in full:"
        f" `uv run {Path(__file__).resolve()} {path} --prompts`."
    )
    session = parse_codex(path) if is_codex(path) else parse_claude(path)
    typed = [p for p in prompts(session) if not p.split("\n", 1)[-1].startswith("/")]
    return "\n\n".join([preamble, *fit_prompts(typed, HOOK_LIMIT - len(preamble))])


def as_json(
    session: Session, board: dict | None = None, now: float | None = None
) -> dict:
    """Where the session's time went and its thread's plan on the clock: only what readers use,
    since the plugin reads at most 4 MiB and the events alone outgrow it in a long session."""
    sinks = time_sinks.as_json(session)
    now = plan.ms(datetime.now(UTC)) if now is None else now
    sid = next(iter(time_sinks.UUID_RE.findall(session.path.name)), session.path.stem)
    threads = board["threads"] if board else []
    thread = next((t for t in threads if t["session"] == sid), None)
    needs_you = board["needs_you"] if board else []
    mine = plan.plan(thread, needs_you, plan.strands(session.events), sinks, now)
    return {"sinks": sinks, "plan": {**mine, "thread": thread}}


def fit_prompts(prompts: list[str], budget: int) -> list[str]:
    """The first prompt and as many of the latest as fit in `budget` characters joined by blank
    lines, each cut at PROMPT_CAP, with a line marking where earlier ones were left out."""
    cut = [p if len(p) <= PROMPT_CAP else p[:PROMPT_CAP] + " [cut]" for p in prompts]
    if not cut:
        return []
    marker = f"[{len(cut)} earlier prompts left out]"
    used, latest = 2 + len(cut[0]) + 2 + len(marker), []
    for prompt in reversed(cut[1:]):
        if used + 2 + len(prompt) > budget:
            break
        used += 2 + len(prompt)
        latest.append(prompt)
    left_out = len(cut) - 1 - len(latest)
    return [
        cut[0],
        *([f"[{left_out} earlier prompts left out]"] if left_out else []),
        *latest[::-1],
    ]


# --- Locating the transcript ------------------------------------------------


def resolve_session(arg: str | None) -> Path:
    if arg:
        given = Path(arg).expanduser()
        if given.is_file():
            return given
        matches = find_by_id(arg)
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            listed = "\n".join(f"  {m}" for m in matches)
            sys.exit(f"Multiple transcripts match '{arg}':\n{listed}")
        sys.exit(f"No transcript found for '{arg}'.")

    # A session started from another inherits its variable too. The session
    # running this command has just logged the call, so its transcript is newest.
    ids = (os.environ.get(v) for v in ("CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID"))
    matches = [match for i in ids if i for match in find_by_id(i)]
    if matches:
        return max(matches, key=lambda p: p.stat().st_mtime)
    sys.exit(
        "No transcript for CLAUDE_CODE_SESSION_ID or CODEX_THREAD_ID; pass a "
        "session id or transcript path."
    )


def claude_projects_dir() -> Path:
    return Path.home() / ".claude" / "projects"


def codex_sessions_dir() -> Path:
    return Path.home() / ".codex" / "sessions"


def find_by_id(session_id: str) -> list[Path]:
    claude_matches = list(claude_projects_dir().glob(f"*/{session_id}.jsonl"))
    codex_matches = list(codex_sessions_dir().glob(f"**/rollout-*{session_id}*.jsonl"))
    return claude_matches + codex_matches


def is_codex(path: Path) -> bool:
    for entry in load_jsonl(path, limit=5):
        if entry.get("type") == "session_meta":
            return True
        if "sessionId" in entry:
            return False
    return ".codex" in path.parts


# --- Times and formatting -------------------------------------------------


def parse_since(text: str) -> datetime:
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", text)
    if m:
        now = datetime.now(UTC)
        at = now.replace(
            hour=int(m.group(1)), minute=int(m.group(2)), second=0, microsecond=0
        )
        # Just after midnight a later HH:MM is yesterday's.
        return at if at <= now else at - timedelta(days=1)
    dt = datetime.fromisoformat(text)
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def first_line(text: str, width: int = 140) -> str:
    lines = (line.strip() for line in text.splitlines())
    return next((line for line in lines if line), "")[:width]


# --- Rendering ---------------------------------------------------------


def render(session: Session, min_seconds: int) -> str:
    now = datetime.now(UTC)
    events = session.events
    lines = [header(session)]
    buffer: list[Event] = []

    def flush() -> None:
        if not buffer:
            return
        lines.append(row(buffer[0], now) if len(buffer) == 1 else collapsed_row(buffer))
        buffer.clear()

    for event in events:
        collapsible = (
            event.kind in ("tool", "agent")
            and event.end is not None
            and (event.end - event.start).total_seconds() < min_seconds
        )
        if collapsible:
            last_end = buffer[-1].end if buffer else None
            if last_end is not None and event.start - last_end > IDLE_BREAK:
                flush()
            buffer.append(event)
        else:
            flush()
            lines.append(row(event, now))
    flush()
    return "\n".join(lines)


def header(session: Session) -> str:
    start = session.start
    wall, waiting = session.end - start, session.waiting()
    return (
        f"{session.path}\n"
        f"start {utc(start)}  last event {utc(session.end)}  "
        f"wall {fmt(wall, True)}  waiting {fmt(waiting, True)}  active {fmt(wall - waiting, True)}\n"
    )


def utc(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%SZ")


def row(event: Event, now: datetime) -> str:
    duration = (
        f"running {fmt(now - event.start, True)}"
        if event.end is None
        else fmt(event.end - event.start, True)
    )
    failed = " [failed]" if event.failed else ""
    return f"{event.start.astimezone(UTC):%H:%M:%SZ}  {duration:>14}  {event.kind:<7}  {first_line(event.summary)}{failed}"


def collapsed_row(buffer: list[Event]) -> str:
    counts = Counter(e.summary.split(" ", 1)[0] for e in buffer)
    mix = " ".join(f"{name}×{n}" for name, n in counts.most_common())
    # Only finished calls are buffered; calls can overlap, so take the latest end.
    span = max(e.end for e in buffer if e.end is not None) - buffer[0].start
    failed = sum(e.failed for e in buffer)
    return (
        f"{buffer[0].start.astimezone(UTC):%H:%M:%SZ}  {fmt(span, True):>14}  "
        f"tool     {len(buffer)} calls: {mix}{f' [{failed} failed]' if failed else ''}"
    )


if __name__ == "__main__":
    main()
