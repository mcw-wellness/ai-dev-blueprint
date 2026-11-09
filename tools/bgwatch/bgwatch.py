#!/usr/bin/env python3
"""Wait on a background job and end at the first of: done, failed, gone, stuck, too long.

Run it under run_in_background next to the job; it prints one line and exits, which wakes the agent.

    bgwatch.py --pid 1234 --log run.log --done 'ALL DONE' --fail 'Traceback|Error' [--stall-min 15] [--max-min 120]

Exit codes: 0 DONE, 1 FAILED, 2 GONE (process exited without a done line), 3 STUCK (log unchanged for
--stall-min), 4 TOO_LONG (--max-min reached), 5 ENDED (process exited and there was no --done pattern to judge it).
"""
import argparse
import hashlib
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import NamedTuple, Optional

CODES = {"DONE": 0, "FAILED": 1, "GONE": 2, "STUCK": 3, "TOO_LONG": 4, "ENDED": 5}


class Rules(NamedTuple):
    done: Optional[str]
    fail: Optional[str]
    stall_s: Optional[float]
    max_s: Optional[float]


def first_match(pattern: str, text: str) -> Optional[str]:
    for line in text.splitlines():
        if re.search(pattern, line):
            return line.strip()
    return None


def verdict(r: Rules, text: str, alive: bool, idle_s: float, elapsed_s: float):
    """(state, detail) once the wait should end, else None. A fail line beats a done line."""
    if r.fail and (line := first_match(r.fail, text)):
        return "FAILED", line
    if r.done and (line := first_match(r.done, text)):
        return "DONE", line
    if not alive:
        return ("GONE", "process exited without a done line") if r.done else ("ENDED", "process exited")
    if r.stall_s is not None and idle_s >= r.stall_s:
        return "STUCK", f"log unchanged for {idle_s / 60:.0f} min"
    if r.max_s is not None and elapsed_s >= r.max_s:
        return "TOO_LONG", f"still running after {elapsed_s / 60:.0f} min"
    return None


def read_text(path: Path) -> str:
    try:
        return path.read_text(errors="replace")
    except FileNotFoundError:
        return ""


def fingerprint(path: Path) -> str:
    """Changes only when the content changes: a rewrite with the same bytes is not progress."""
    return hashlib.sha1(read_text(path).encode()).hexdigest()


def is_alive(pid: int) -> bool:
    out = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(out) and not out.startswith("Z")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--pid", type=int, help="process to watch")
    p.add_argument("--log", type=Path, help="its output file")
    p.add_argument("--done", help="regex of a line that means success")
    p.add_argument("--fail", help="regex of a line that means failure")
    p.add_argument("--stall-min", type=float, default=15, help="stuck after the log is unchanged this long (default 15)")
    p.add_argument("--max-min", type=float, help="hard limit on the whole wait")
    p.add_argument("--poll-s", type=float, default=10, help=argparse.SUPPRESS)
    a = p.parse_args(argv)
    if a.pid is None and a.log is None:
        p.error("give --pid, --log or both")

    rules = Rules(a.done, a.fail, a.stall_min * 60 if a.log else None, a.max_min * 60 if a.max_min else None)
    start = last_change = time.monotonic()
    last_fp = fingerprint(a.log) if a.log else ""
    while True:
        alive = is_alive(a.pid) if a.pid is not None else True
        text = read_text(a.log) if a.log else ""  # read after the alive check, so a last line before exit counts
        now = time.monotonic()
        fp = fingerprint(a.log) if a.log else ""
        if fp != last_fp:
            last_fp, last_change = fp, now
        v = verdict(rules, text, alive, now - last_change, now - start)
        if v:
            state, detail = v
            print(f"{state}: {detail}")
            return CODES[state]
        time.sleep(a.poll_s)


if __name__ == "__main__":
    sys.exit(main())
