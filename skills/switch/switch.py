#!/usr/bin/env python3
"""Move the running Claude session to another profile: `switch.py <profile>`.

Copies this session's transcript into the target profile (the same step as auto-continue's
`resume-in`) and opens it there in a new Terminal window, whole conversation included.
The old window stays open; close it once the new one is running.
"""
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

BLUEPRINT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BLUEPRINT / "tools" / "auto-continue"))
from auto_continue import prepare_resume  # noqa: E402


def ps(field, pid):
    out = subprocess.run(["ps", "-o", f"{field}=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return out or None


def find_session(pid, parent_of, comm_of, sessions_dir: Path):
    """Walk up from `pid` to the claude process that has a session file; return that file's JSON."""
    while pid and pid > 1:
        comm = comm_of(pid) or ""
        f = sessions_dir / f"{pid}.json"
        if Path(comm).name == "claude" and f.exists():
            return json.loads(f.read_text())
        pid = parent_of(pid)
    raise SystemExit("not running inside a Claude session")


def shell_command(cwd, cmd):
    return f"cd {shlex.quote(cwd)} && " + " ".join(shlex.quote(c) for c in cmd)


def main(argv):
    if len(argv) != 1:
        raise SystemExit(__doc__)
    target = argv[0].removeprefix("claude-")
    config = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude"))
    current = config.name.removeprefix(".claude-") if config.name != ".claude" else "default"
    if target == current:
        raise SystemExit(f"this session is already on {target}")
    s = find_session(os.getppid(), lambda p: int(ps("ppid", p) or 0), lambda p: ps("comm", p),
                     config / "sessions")
    cmd = prepare_resume(Path.home(), target, s["sessionId"])
    line = shell_command(s["cwd"], cmd).replace("\\", "\\\\").replace('"', '\\"')
    r = subprocess.run(["osascript", "-e", f'tell application "Terminal" to do script "{line}"'],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"could not open a Terminal window: {r.stderr.strip()}")
    print(f"opened session {s['sessionId']} on {target} in a new Terminal window")


if __name__ == "__main__":
    main(sys.argv[1:])
