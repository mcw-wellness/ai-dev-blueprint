"""Builders for small synthetic JSONL transcripts that mirror real Claude Code and Codex ones."""

import json
from pathlib import Path


def write_jsonl(path: Path, records: list[dict]) -> Path:
    path.write_text("\n".join(json.dumps(r) for r in records) + "\n")
    return path


# --- Claude Code fixtures ---------------------------------------------------


def claude_user(
    ts: str, text: str | list[dict], prompt_source: str | None = "typed"
) -> dict:
    entry = {
        "type": "user",
        "timestamp": ts,
        "message": {"role": "user", "content": text},
    }
    if prompt_source:
        entry["promptSource"] = prompt_source
    return entry


def claude_assistant(ts: str, tool_calls: list[tuple[str, str, dict]]) -> dict:
    content = [
        {"type": "tool_use", "id": call_id, "name": name, "input": tool_input}
        for call_id, name, tool_input in tool_calls
    ]
    return {
        "type": "assistant",
        "timestamp": ts,
        "message": {"role": "assistant", "content": content},
    }


def claude_reply(ts: str, text: str) -> dict:
    return {
        "type": "assistant",
        "timestamp": ts,
        "message": {"role": "assistant", "content": [{"type": "text", "text": text}]},
    }


def claude_tool_result(
    ts: str, call_id: str, text: str, is_error: bool = False
) -> dict:
    block = {"type": "tool_result", "tool_use_id": call_id, "content": text}
    return {
        "type": "user",
        "timestamp": ts,
        "message": {
            "role": "user",
            "content": [{**block, "is_error": True} if is_error else block],
        },
    }


def claude_notification(
    ts: str, tool_use_id: str | None, status: str, task_id: str = "t1"
) -> dict:
    """A task notification; without `tool_use_id` it names only the task, as some do."""
    use = f"<tool-use-id>{tool_use_id}</tool-use-id>" if tool_use_id else ""
    content = (
        f"<task-notification><task-id>{task_id}</task-id>{use}"
        f"<status>{status}</status><summary>done</summary></task-notification>"
    )
    return {
        "type": "user",
        "timestamp": ts,
        "origin": {"kind": "task-notification"},
        "message": {"role": "user", "content": content},
    }


def claude_header(session_id: str = "abc123") -> list[dict]:
    return [
        {"type": "mode", "mode": "normal", "sessionId": session_id},
        {"type": "permission-mode", "permissionMode": "auto", "sessionId": session_id},
    ]


# --- Codex fixtures ----------------------------------------------------------


def codex_session_meta(ts: str, cwd: str = "/work") -> dict:
    return {
        "timestamp": ts,
        "type": "session_meta",
        "payload": {"cwd": cwd, "session_id": "cx1"},
    }


def codex_user_message(ts: str, text: str) -> dict:
    return {
        "timestamp": ts,
        "type": "event_msg",
        "payload": {
            "type": "item_completed",
            "item": {
                "type": "UserMessage",
                "content": [{"type": "text", "text": text}],
            },
        },
    }


def codex_tui_user_message(ts: str, text: str) -> dict:
    return {
        "timestamp": ts,
        "type": "event_msg",
        "payload": {"type": "user_message", "message": text, "images": []},
    }


def codex_task_complete(ts: str) -> dict:
    return {"timestamp": ts, "type": "event_msg", "payload": {"type": "task_complete"}}


def codex_call(ts: str, call_id: str, name: str, cmd: str) -> dict:
    return {
        "timestamp": ts,
        "type": "response_item",
        "payload": {
            "type": "custom_tool_call",
            "call_id": call_id,
            "name": name,
            "input": f'const r = await tools.exec_command({{cmd:"{cmd}"}});',
        },
    }


def codex_call_output(ts: str, call_id: str, output: str) -> dict:
    return {
        "timestamp": ts,
        "type": "response_item",
        "payload": {
            "type": "custom_tool_call_output",
            "call_id": call_id,
            "output": output,
        },
    }


def codex_exec_output(ts: str, call_id: str, *results: dict) -> dict:
    """An exec cell's output as real logs store it: a status line, then one JSON
    text block per tool result. A command that yields before it exits returns its
    `session_id`, one that exits its `exit_code`."""
    blocks = [{"type": "input_text", "text": "Script completed\nOutput:\n"}]
    blocks += [{"type": "input_text", "text": json.dumps(r)} for r in results]
    return {
        "timestamp": ts,
        "type": "response_item",
        "payload": {
            "type": "custom_tool_call_output",
            "call_id": call_id,
            "output": blocks,
        },
    }


def codex_cell_yield(ts: str, call_id: str, cell_id: str, *results: dict) -> dict:
    """An exec cell that yields before its script finishes, with the results it
    has so far; a later wait call names its cell id and receives the rest."""
    status = f"Script running with cell ID {cell_id}\nWall time 10.0 seconds\n"
    blocks = [{"type": "input_text", "text": status}]
    blocks += [{"type": "input_text", "text": json.dumps(r)} for r in results]
    return {
        "timestamp": ts,
        "type": "response_item",
        "payload": {
            "type": "custom_tool_call_output",
            "call_id": call_id,
            "output": blocks,
        },
    }


def codex_wait(ts: str, call_id: str, cell_id: str) -> dict:
    return {
        "timestamp": ts,
        "type": "response_item",
        "payload": {
            "type": "function_call",
            "call_id": call_id,
            "name": "wait",
            "arguments": f'{{"cell_id":"{cell_id}","yield_time_ms":20000}}',
        },
    }


def codex_poll(ts: str, call_id: str, *session_ids: int) -> dict:
    """An exec cell polling yielded commands, one directly or several by mapping
    over their ids, as agents write them."""
    if len(session_ids) == 1:
        script = f'await tools.write_stdin({{session_id:{session_ids[0]},chars:""}});'
    else:
        ids = ",".join(map(str, session_ids))
        script = f'await Promise.all([{ids}].map(id => tools.write_stdin({{session_id:id,chars:""}})));'
    return {
        "timestamp": ts,
        "type": "response_item",
        "payload": {
            "type": "custom_tool_call",
            "call_id": call_id,
            "name": "exec",
            "input": script,
        },
    }


def codex_subagent_activity(
    ts: str, sid: str, kind: str, agent_path: str = "/root/sub", thread: str = "th1"
) -> dict:
    """Real logs: `started` carries the spawning call's id, `completed` a fresh
    `subagent-completed-...` id; only agent_thread_id is shared."""
    item = {
        "type": "SubAgentActivity",
        "id": sid if kind == "started" else f"subagent-completed-{thread}-x",
        "kind": kind,
        "agent_thread_id": thread,
        "agent_path": agent_path,
    }
    return {
        "timestamp": ts,
        "type": "event_msg",
        "payload": {"type": "item_completed", "item": item},
    }


def codex_spawn_call(ts: str, call_id: str) -> dict:
    return {
        "timestamp": ts,
        "type": "response_item",
        "payload": {
            "type": "function_call",
            "call_id": call_id,
            "name": "spawn_agent",
            "arguments": '{"task_name":"sub"}',
        },
    }
