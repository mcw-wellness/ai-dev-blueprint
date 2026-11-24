"""Parse a Claude Code transcript (`~/.claude/projects/*/<id>.jsonl`) into a timeline session."""

import re
import sys
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path
from typing import Any

from timeline_model import Event, Session, load_jsonl, parse_ts, result_text

# Immediate results that mean "launched in the background; real completion
# arrives later as a task-notification" in a Claude Code transcript.
BACKGROUND_MARKERS = (
    "Async agent launched successfully",
    "Command running in background with ID",
)
# A notification names the task and usually the call: the task id is what the launch result
# printed (an agent's agentId, a shell's ID), and the only name some notifications carry.
NOTIFICATION_TAG_RE = re.compile(r"<(task-id|tool-use-id|status)>(.*?)</\1>", re.S)
LAUNCH_ID_RE = re.compile(r"(?:agentId:|with ID:) (\w+)")
# Claude Code wraps a paste in pasted_content tags and logs a slash command as
# command-message, command-name and command-args tags.
PASTE_TAG_RE = re.compile(r"</?pasted_content\b[^>]*>")
COMMAND_TAG_RE = re.compile(r"<command-(name|args)>(.*?)</command-\1>", re.S)


def claude_prompt(text: str) -> str:
    """A prompt as typed: paste tags removed, a slash command as `/name args`."""
    command = dict(COMMAND_TAG_RE.findall(text)) if text.startswith("<command-") else {}
    if "name" in command:
        text = f"{command['name']} {command.get('args', '')}"
    return PASTE_TAG_RE.sub("", text).strip()


def owner_text(entry: dict[str, Any]) -> str | None:
    """The owner's message in a transcript entry, typed or a reply-button press; None for anything else.

    Tool results, sidechains, cross-session (`peer`), task-notification and hook messages carry no
    human origin; a button press is the agent-tooling plugin's `asUser` origin. The one reader of
    "what the owner said" for both this timeline and the audit's `--quote` check.
    """
    origin = entry.get("origin") or {}
    if entry.get("type") == "attachment":
        attachment = entry.get("attachment", {})
        if attachment.get("type") == "queued_command" and (
            attachment.get("origin", {}).get("kind") == "human"
        ):
            return claude_prompt(result_text(attachment.get("prompt")))
        return None
    if entry.get("type") != "user" or entry.get("isSidechain"):
        return None
    text = result_text(entry.get("message", {}).get("content"))
    if (
        entry.get("promptSource") in ("typed", "queued")
        or origin.get("kind") == "human"
        or (origin.get("kind") == "plugin" and origin.get("asUser") is True)
        or text.startswith("<command-name>")
    ):
        return claude_prompt(text)
    return None


PICK_RE = re.compile(r"re 🔴\d+: ")


def owner_pick(entry: dict[str, Any]) -> str | None:
    """A reply-button pick (`re 🔴9: <reply>; …`), the only plugin submission that is the owner's own words.

    The same plugin also submits run-chip output and "Explain 🔴n" with agent-written titles, and typed
    prompts reach history.jsonl, so only a pick needs the transcript.
    """
    origin = entry.get("origin") or {}
    text = owner_text(entry) if origin.get("asUser") is True else None
    return text if text and PICK_RE.match(text) else None


def is_background(text: str) -> bool:
    return any(text.startswith(marker) for marker in BACKGROUND_MARKERS)


def content_blocks(entry: dict[str, Any]) -> list[dict[str, Any]]:
    content = entry.get("message", {}).get("content")
    return content if isinstance(content, list) else []


def claude_notifications(
    entries: Iterable[dict[str, Any]],
) -> dict[str, tuple[datetime, str]]:
    """tool_use id and task id -> (completion time, status) for background calls, from
    <task-notification> messages that report a backgrounded call's real finish.
    One that arrives while the session is idle is a user message; one that
    arrives mid-turn is a queued-command attachment."""
    out: dict[str, tuple[datetime, str]] = {}
    for entry in entries:
        if (
            entry.get("type") == "user"
            and entry.get("origin", {}).get("kind") == "task-notification"
        ):
            text = result_text(entry.get("message", {}).get("content"))
        elif entry.get("type") == "attachment":
            attachment = entry.get("attachment", {})
            if attachment.get("type") != "queued_command":
                continue
            text = result_text(attachment.get("prompt"))
        else:
            continue
        tags = dict(NOTIFICATION_TAG_RE.findall(text))
        ts = parse_ts(entry.get("timestamp"))
        if "status" in tags and ts:
            for key in (tags.get("tool-use-id"), tags.get("task-id")):
                if key:
                    out.setdefault(key, (ts, tags["status"]))
    return out


def claude_tool_detail(tool_input: dict[str, Any]) -> str:
    for key in ("description", "command", "file_path", "pattern", "prompt", "query"):
        value = tool_input.get(key)
        if isinstance(value, str) and value:
            return value[:100]
    return ""


def claude_event(
    start: datetime,
    end: datetime | None,
    name: str,
    tool_input: dict[str, Any],
    failed: bool = False,
) -> Event:
    if name == "Agent":
        summary = tool_input.get("description") or tool_input.get("name") or "agent"
        subtype = tool_input.get("subagent_type")
        if subtype:
            summary = f"{summary} ({subtype})"
        kind = "agent"
    else:
        detail = claude_tool_detail(tool_input)
        summary = f"{name} {detail}".strip()
        kind = "tool"
    command = tool_input.get("command") if name == "Bash" else None
    return Event(start, end, kind, summary[:140], str(command or "")[:500], failed)


def parse_claude(path: Path) -> Session:
    entries = list(load_jsonl(path))
    notifications = claude_notifications(entries)

    start = end = None
    waits: list[tuple[datetime, datetime]] = []
    last_assistant_end: datetime | None = None
    open_calls: dict[str, tuple[datetime, str, dict[str, Any]]] = {}
    events: list[Event] = []

    for entry in entries:
        ts = parse_ts(entry.get("timestamp"))
        if ts is None:
            continue
        start = ts if start is None else start
        end = ts

        entry_type = entry.get("type")
        if entry_type == "assistant":
            last_assistant_end = ts
            for block in content_blocks(entry):
                if block.get("type") == "tool_use":
                    open_calls[block["id"]] = (
                        ts,
                        block.get("name", ""),
                        block.get("input") or {},
                    )
        elif entry_type == "attachment":
            # A prompt typed while a turn is running arrives as a queued command.
            text = owner_text(entry)
            if text is not None:
                events.append(Event(ts, ts, "prompt", text))
        elif entry_type == "user":
            # Typed prompts carry a promptSource, "queued" when typed mid-turn;
            # slash commands carry a human origin or only their <command-name>, a button press
            # the plugin's asUser origin (owner_text).
            text = owner_text(entry)
            if text is not None:
                if (
                    entry.get("promptSource") != "queued"
                ):  # a queued prompt does not end a wait
                    if last_assistant_end is not None and ts > last_assistant_end:
                        waits.append((last_assistant_end, ts))
                    last_assistant_end = None
                events.append(Event(ts, ts, "prompt", text))
                continue
            for block in content_blocks(entry):
                if block.get("type") != "tool_result":
                    continue
                call_id = block.get("tool_use_id")
                if not isinstance(call_id, str):
                    continue
                call = open_calls.get(call_id)
                if call is None:
                    continue
                call_start, name, tool_input = call
                text = result_text(block.get("content"))
                if is_background(text):
                    ids = [call_id, *LAUNCH_ID_RE.findall(text)]
                    note = next(
                        (notifications[i] for i in ids if i in notifications), None
                    )
                    if note is None:
                        continue  # not resolved yet; stays open -> reported as running
                    call_end, status = note
                    failed = status != "completed"  # failed, killed or stopped
                else:
                    call_end, failed = ts, block.get("is_error") is True
                del open_calls[call_id]
                events.append(
                    claude_event(call_start, call_end, name, tool_input, failed)
                )

    for call_start, name, tool_input in open_calls.values():
        events.append(claude_event(call_start, None, name, tool_input))

    if start is None or end is None:
        sys.exit(f"{path}: no timestamped events found.")
    return Session(path, start, end, waits, sorted(events, key=lambda e: e.start))
