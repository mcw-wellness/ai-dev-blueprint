"""Parse a Codex rollout (`~/.codex/sessions/**/rollout-*.jsonl`) into a timeline session."""

import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from timeline_model import Event, Session, load_jsonl, parse_ts, result_text

# A command that yields before it exits returns a session_id; later exec cells
# poll it with write_stdin, by that id or in a list of ids, until a cell with an
# exit result no longer reports it running. A cell can yield too; each wait
# call naming its cell id receives its newer results.
SESSION_ID_RE = re.compile(r'"session_id":\s*(\d+)')
CELL_YIELD_RE = re.compile(r"Script running with cell ID (\d+)")
CELL_ARG_RE = re.compile(r'"cell_id":\s*"?(\d+)')
ESCAPES = {'\\"': '"', "\\n": " ", "\\t": " ", "\\\\": "\\"}


def unescape(text: str) -> str:
    for escaped, plain in ESCAPES.items():
        text = text.replace(escaped, plain)
    return text


def codex_tool_detail(payload: dict[str, Any]) -> str:
    if payload.get("name") == "exec":
        match = re.search(
            r'cmd\s*:\s*"((?:[^"\\]|\\.)*)"', str(payload.get("input", ""))
        )
        if match:
            return unescape(match.group(1))[:100]
    args = payload.get("arguments")
    if isinstance(args, str) and args:
        return args[:100]
    return str(payload.get("input", ""))[:100]


def output_text(output: Any) -> str:
    """An exec cell's output is a status line, then one JSON text block per
    result, so a session_id inside a command's own output is escaped."""
    if isinstance(output, list):
        return "\n".join(str(b.get("text", "")) for b in output if isinstance(b, dict))
    return str(output)


def parse_codex(path: Path) -> Session:
    entries = list(load_jsonl(path))

    start = end = None
    waits: list[tuple[datetime, datetime]] = []
    last_assistant_end: datetime | None = None
    calls: dict[str, tuple[datetime, str, str]] = {}
    outputs: dict[str, datetime] = {}
    polls: dict[str, str] = {}  # call id -> script of a cell that polls sessions
    launched: dict[int, str] = {}  # running session id -> call id that launched it
    exits: dict[str, datetime] = {}  # call id -> when its last yielded work ended
    cells: dict[str, str] = {}  # yielded cell id -> call id that started it
    waits_on: dict[str, str] = {}  # wait call id -> the cell id it names
    reported: dict[str, set[int]] = {}  # yielded cell's call id -> sessions so far
    # A subagent starts under its spawning call's id and completes under a new
    # id; its agent_thread_id links the two.
    sub_started: dict[str, tuple[datetime, str, str]] = {}
    sub_completed: dict[str, datetime] = {}
    events: list[Event] = []

    for entry in entries:
        ts = parse_ts(entry.get("timestamp"))
        if ts is None:
            continue
        start = ts if start is None else start
        end = ts

        if entry.get("type") == "response_item":
            payload = entry.get("payload", {})
            payload_type = payload.get("type")
            call_id = payload.get("call_id")
            if payload_type in ("function_call", "custom_tool_call") and call_id:
                calls[call_id] = (
                    ts,
                    payload.get("name", "tool"),
                    codex_tool_detail(payload),
                )
                script = str(payload.get("input") or payload.get("arguments") or "")
                if "write_stdin" in script:
                    polls[call_id] = script
                if payload.get("name") == "wait" and (
                    cell := CELL_ARG_RE.search(script)
                ):
                    waits_on[call_id] = cell.group(1)
            elif (
                payload_type in ("function_call_output", "custom_tool_call_output")
                and call_id
            ):
                outputs[call_id] = ts
                # A wait's results belong to the call whose cell it waits on.
                source = cells.pop(waits_on.get(call_id, ""), call_id)
                text = output_text(payload.get("output"))
                running = reported.pop(source, set())
                running |= {int(n) for n in SESSION_ID_RE.findall(text)}
                for session in running:
                    launched.setdefault(session, source)
                if yielded := CELL_YIELD_RE.match(text):
                    cells[yielded.group(1)] = source
                    reported[source] = running
                    continue
                if source != call_id:
                    exits[source] = ts
                script = polls.get(source, "") if '"exit_code":' in text else ""
                for session in [s for s in launched if s not in running]:
                    if re.search(rf"(session_id\W{{1,3}}|[\[,]\s*){session}\b", script):
                        exits[launched.pop(session)] = ts
        elif entry.get("type") == "event_msg":
            # Interactive sessions log prompts as `user_message` events; exec and
            # app-server sessions as completed `UserMessage` items.
            payload = entry.get("payload", {})
            event_type = payload.get("type")
            item = payload.get("item", {}) if event_type == "item_completed" else {}
            item_type = item.get("type")
            if event_type == "user_message" or item_type == "UserMessage":
                text = (
                    str(payload.get("message", ""))
                    if event_type == "user_message"
                    else result_text(item.get("content"))
                )
                if last_assistant_end is not None and ts > last_assistant_end:
                    waits.append((last_assistant_end, ts))
                last_assistant_end = None
                events.append(Event(ts, ts, "prompt", text.strip()))
            elif event_type == "task_complete":
                last_assistant_end = ts
            elif item_type == "SubAgentActivity":
                thread = item.get("agent_thread_id", "")
                if item.get("kind") == "started" and item.get("id"):
                    sub_started[item["id"]] = (ts, thread, item.get("agent_path", ""))
                elif item.get("kind") == "completed":
                    sub_completed.setdefault(thread, ts)

    # A call whose command or cell yielded ends when the last of them finishes.
    unfinished = set(launched.values()) | set(cells.values())
    for call_id, (call_start, name, detail) in calls.items():
        if call_id in sub_started:
            agent_start, thread, agent_path = sub_started[call_id]
            summary = agent_path or call_id
            events.append(
                Event(agent_start, sub_completed.get(thread), "agent", summary[:140])
            )
        else:
            summary = f"{name} {detail}".strip()
            call_end = (
                None
                if call_id in unfinished
                else exits.get(call_id, outputs.get(call_id))
            )
            events.append(Event(call_start, call_end, "tool", summary[:140]))

    if start is None or end is None:
        sys.exit(f"{path}: no timestamped events found.")
    return Session(path, start, end, waits, sorted(events, key=lambda e: e.start))
