"""The synthetic session the E2E harness resumes: finished turns as `claude` writes them to its transcript."""

import time
import uuid
from pathlib import Path

FAILED = "Exit code 1\nplatform darwin\ncollected 3 items\nFAILED tests/t.py::test_pack - assert 2 == 3\n1 failed, 2 passed"

# Earlier turns, each answered by a verdict the reply does not open with.
EARLIER = {
    "blocked?": "Not done: the audit waits on review.",
    "now?": "Running: the audit, done ~06:10Z.",
}


def session(cwd: Path, sid: str, reply: str) -> list[dict]:
    """Finished turns: two answered by other verdicts, then the owner's `status?`, a passing and a failing shell call,
    and `reply`."""
    lines: list[dict] = []

    def add(kind: str, message: dict, **extra: object) -> None:
        t = time.gmtime(time.time() - 60 + len(lines))
        at = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", t)
        parent = lines[-1]["uuid"] if lines else None
        ids = {"parentUuid": parent, "uuid": str(uuid.uuid4()), "sessionId": sid}
        where = {"cwd": str(cwd), "version": "2.1.311", "isSidechain": False}
        line = {"type": kind, "message": message, "timestamp": at, **extra}
        lines.append({**ids, **where, **line})

    def say(content: dict, stop: str) -> None:
        msg = {
            "id": f"msg_{uuid.uuid4().hex}",
            "role": "assistant",
            "content": [content],
        }
        end = {"stop_reason": stop, "usage": {"input_tokens": 1, "output_tokens": 1}}
        add("assistant", {**msg, "type": "message", "model": "claude-opus-5-5", **end})

    def bash(command: str, description: str, output: str, error: bool) -> None:
        tid = f"toolu_{uuid.uuid4().hex[:24]}"
        call = {"command": command, "description": description}
        say({"type": "tool_use", "id": tid, "name": "Bash", "input": call}, "tool_use")
        result = {"type": "tool_result", "tool_use_id": tid, "is_error": error}
        content = {"role": "user", "content": [{**result, "content": output}]}
        ok = {"stdout": output, "stderr": "", "interrupted": False, "isImage": False}
        add("user", content, toolUseResult=f"Error: {output}" if error else ok)

    for prompt, answer in [*EARLIER.items(), ("status?", None)]:
        add("user", {"role": "user", "content": prompt}, promptId=str(uuid.uuid4()))
        if answer:
            say({"type": "text", "text": answer}, "end_turn")
    bash("git status --short", "Show working tree status", "", False)
    bash("uv run pytest -q tests/t.py", "Run the band tests", FAILED, True)
    say({"type": "text", "text": reply}, "end_turn")
    return lines
