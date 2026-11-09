#!/usr/bin/env python3
"""auto-continue: retype `continue` into Claude Code sessions whose turn died on an API error.

Spec: README.md next to this file.

  auto_continue.py tick                          one pass (launchd runs this every 60 s)
  auto_continue.py resume-in <profile> <sid>     move a session to another profile and open it
"""
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, NamedTuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DELAYS_MIN = [5, 10, 15, 30, 30, 60, 60]  # wait before retry 1, 2, … ; hourly after that
HOURLY = timedelta(minutes=60)
WINDOW = timedelta(hours=12)
AFTER_RESET = timedelta(minutes=2)
STATE_DIR = Path.home() / ".local" / "state" / "auto-continue"


# ---------------------------------------------------------------- pure decision logic

def ts(entry):
    return datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00"))


def text_of(entry):
    content = entry.get("message", {}).get("content")
    if isinstance(content, str):
        return content
    return " ".join(c.get("text") or "" for c in content or [] if isinstance(c, dict))


MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}
RESET_RE = re.compile(
    r"resets (?:(?P<mon>[A-Z][a-z]{2}) (?P<day>\d{1,2}) at )?"
    r"(?P<h>\d{1,2})(?::(?P<m>\d{2}))?(?P<ampm>am|pm) \((?P<tz>[^)]+)\)")


def parse_reset(text, error_at):
    """'resets 8:40am (Europe/Vienna)' / 'resets Nov 2 at 1am (Europe/Vienna)' → aware UTC datetime."""
    m = RESET_RE.search(text)
    if not m:
        return None
    try:
        zone = ZoneInfo(m["tz"])
    except (ZoneInfoNotFoundError, ValueError):
        return None                  # unreadable reset → treated as "needs you", never a guess
    hour = int(m["h"]) % 12 + (12 if m["ampm"] == "pm" else 0)
    minute = int(m["m"] or 0)
    local = error_at.astimezone(zone)
    past = local - timedelta(minutes=5)   # "resets 10pm" logged at 22:00:30 means now, not tomorrow
    if m["mon"]:
        at = local.replace(month=MONTHS[m["mon"]], day=int(m["day"]), hour=hour, minute=minute,
                           second=0, microsecond=0)
        if at < past:
            at = at.replace(year=at.year + 1)
    else:
        at = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if at < past:
            at += timedelta(days=1)
    return at.astimezone(timezone.utc)


def classify(entry):
    """→ ('retry', None) | ('reset', at) | ('quota', None) | ('notify', None)"""
    error = entry.get("error")
    if error == "server_error":
        return "retry", None
    if error == "rate_limit":
        at = parse_reset(text_of(entry), ts(entry))
        if at and at - ts(entry) <= WINDOW:
            return "reset", at
        return "quota", None
    return "notify", None


def is_error(entry):
    return bool(entry and entry.get("isApiErrorMessage"))


def decide(entry, state, now):
    """One session, one tick. Returns (new_state, actions). Actions: send, notify:hourly,
    notify:giveup, notify:error, quota. State is JSON-able (ISO strings)."""
    if not is_error(entry):
        if entry and entry.get("type") == "assistant":
            return None, []          # a real reply: the session recovered
        return state, []             # a turn in progress (e.g. our own `continue`)

    kind, reset_at = classify(entry)
    if state and state["uuid"] != entry["uuid"]:
        if state["kind"] == "retry" and kind == "retry" and not state.get("done"):
            state = dict(state, uuid=entry["uuid"])   # a failed retry: same schedule
        else:
            state = None
    if state is None:
        state = fresh_state(entry, kind, reset_at, now)
        if state.get("done"):
            return state, []
        if kind == "quota":
            return dict(state, done=True), ["quota"]
        if kind == "notify":
            return dict(state, done=True), ["notify:error"]
    if state.get("done"):
        return state, []

    if kind == "reset":
        if now >= datetime.fromisoformat(state["next"]):
            return dict(state, done=True), ["send"]
        return state, []

    first = datetime.fromisoformat(state["first"])
    if now - first >= WINDOW:
        return dict(state, done=True), ["notify:giveup"]
    if now < datetime.fromisoformat(state["next"]):
        return state, []
    attempts = state["attempts"] + 1
    wait = timedelta(minutes=DELAYS_MIN[attempts]) if attempts < len(DELAYS_MIN) else HOURLY
    actions = ["send"] + (["notify:hourly"] if attempts == len(DELAYS_MIN) else [])
    return dict(state, attempts=attempts, next=(now + wait).isoformat()), actions


def fresh_state(entry, kind, reset_at, now):
    at = ts(entry)
    state = {"uuid": entry["uuid"], "kind": kind, "first": at.isoformat(), "attempts": 0}
    if now - at > WINDOW:
        return dict(state, done=True)   # stale when first seen: stay quiet
    if kind == "reset":
        state["next"] = (reset_at + AFTER_RESET).isoformat()
    elif kind == "retry":
        state["next"] = (at + timedelta(minutes=DELAYS_MIN[0])).isoformat()
    return state


# ---------------------------------------------------------------- reading Claude's files

def last_turn_entry(path):
    """Last user/assistant line of the main conversation (skips system, cost, subagent lines)."""
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        f.seek(max(0, f.tell() - 512 * 1024))
        lines = f.read().splitlines()
    for raw in reversed(lines):
        try:
            entry = json.loads(raw)
        except ValueError:
            continue                 # the first, cut-off line of the tail window
        if not isinstance(entry, dict):
            continue
        if entry.get("type") in ("user", "assistant") and not entry.get("isSidechain") \
                and not entry.get("isMeta"):
            return entry
    return None


def profiles(home=Path.home()):
    return sorted(p for p in [home / ".claude", *home.glob(".claude-*")] if (p / "sessions").is_dir())


def profile_name(path):
    return "default" if path.name == ".claude" else path.name.removeprefix(".claude-")


def live_sessions(profile, alive):
    for f in (profile / "sessions").glob("*.json"):
        try:
            s = json.loads(f.read_text())
        except ValueError:
            continue
        if s.get("kind") != "interactive" or not alive(s.get("pid")):
            continue
        transcripts = list((profile / "projects").glob(f"*/{s['sessionId']}.jsonl"))
        if transcripts:
            yield s, transcripts[0]


# ---------------------------------------------------------------- side effects

class Effects(NamedTuple):
    send: Callable[[str, str], bool]
    notify: Callable[[str, str], None]
    quota: Callable[[], str]
    clipboard: Callable[[str], None]
    tty_of: Callable[[int], str]
    alive: Callable[[int], bool]


def osa(script):
    return subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=30)


def terminal_send(tty, text):
    r = osa(f'''tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "{tty}" then
        -- Claude Code reads a burst of typed text as a paste, where Return is a line break, not
        -- a send (2026-11-08, fullscreen + agent-tooling). So the text first, then Return alone.
        do script "{text}" in t
        delay 0.5
        do script "" in t
        return "sent"
      end if
    end repeat
  end repeat
  return "no tab"
end tell''')
    log(f"send {text!r} → {tty}: {r.stdout.strip() or r.stderr.strip()}")
    return r.stdout.strip() == "sent"


def notify(title, body):
    q = lambda s: s.replace("\\", "\\\\").replace('"', '\\"')
    osa(f'display notification "{q(body)}" with title "{q(title)}"')
    log(f"notify {title}: {body}")


def quota_table():
    script = Path(__file__).resolve().parents[2] / "skills" / "ai-usage" / "ai-usage.py"
    r = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, timeout=120)
    return r.stdout or r.stderr


def tty_from_ps(line):
    """`ps -o stat=,tty=,comm=` → the tty, only if the process is claude in its tty's foreground."""
    parts = line.split(None, 2)
    if len(parts) < 3 or "+" not in parts[0] or "claude" not in parts[2] or parts[1] == "??":
        return ""
    return f"/dev/{parts[1]}"


def tty_of(pid):
    out = subprocess.run(["ps", "-o", "stat=,tty=,comm=", "-p", str(pid)],
                         capture_output=True, text=True).stdout.strip()
    return tty_from_ps(out)


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (ProcessLookupError, TypeError, ValueError):
        return False
    except PermissionError:
        return True


REAL = Effects(send=terminal_send, notify=notify, quota=quota_table,
               clipboard=lambda t: subprocess.run(["pbcopy"], input=t, text=True),
               tty_of=tty_of, alive=alive)


def log(line):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with open(STATE_DIR / "log", "a") as f:
        f.write(f"{datetime.now().isoformat(timespec='seconds')} {line}\n")


# ---------------------------------------------------------------- one tick

def tick(profile_dirs, state_path, now, fx):
    states = json.loads(state_path.read_text()) if state_path.exists() else {}
    seen = set()
    for profile in profile_dirs:
        for s, transcript in live_sessions(profile, fx.alive):
            sid = s["sessionId"]
            seen.add(sid)
            new, actions = decide(last_turn_entry(transcript), states.get(sid), now)
            label = f"{profile_name(profile)} · {Path(s.get('cwd', '?')).name}"
            for a in actions:
                run_action(a, fx, s, profile, label, transcript)
            if new is None:
                states.pop(sid, None)
            else:
                states[sid] = new
            save(state_path, states)  # per session: a crash later can't undo this backoff
    save(state_path, {k: v for k, v in states.items() if k in seen})   # drop ended sessions


def save(state_path, states):
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(states, indent=1))


def run_action(action, fx, s, profile, label, transcript):
    error = text_of(last_turn_entry(transcript))[:120]
    if action == "send":
        tty = fx.tty_of(s["pid"])
        if not (tty and fx.send(tty, "continue")):
            fx.notify("auto-continue: could not type into Terminal",
                      f"{label}: no Terminal tab on {tty or 'any tty'}, or no Automation permission")
    elif action == "notify:hourly":
        fx.notify("auto-continue: still failing after 3.5 h",
                  f"{label}: retrying hourly for up to 12 h. {error}")
    elif action == "notify:giveup":
        fx.notify("auto-continue: gave up after 12 h", f"{label}: {error}")
    elif action == "notify:error":
        fx.notify("auto-continue: needs you", f"{label}: {error}")
    elif action == "quota":
        path = STATE_DIR / "quota.txt"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(fx.quota())
        cmd = f"{Path(__file__).resolve()} resume-in <profile> {s['sessionId']}"
        fx.clipboard(cmd)
        fx.notify("auto-continue: out of quota",
                  f"{label}: {error} — other profiles in {path}; resume-in command copied")


# ---------------------------------------------------------------- moving a session

def prepare_resume(home, target, sid):
    """Copy the transcript of `sid` into profile `target`; return the command that opens it there."""
    target_dir = home / (".claude" if target == "default" else f".claude-{target}")
    if not target_dir.is_dir():
        raise SystemExit(f"no profile {target_dir}")
    found = [p for p in home.glob(f".claude*/projects/*/{sid}.jsonl")
             if not p.is_relative_to(target_dir)]
    if not found:
        raise SystemExit(f"no transcript for session {sid}")
    src = max(found, key=lambda p: p.stat().st_mtime)
    dest = target_dir / "projects" / src.parent.name / src.name
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return ["claude" if target == "default" else f"claude-{target}", "--resume", sid]


def ensure_terminal_permission():
    """First tick after install: trigger macOS's 'allow python3 to control Terminal?' prompt now,
    while someone is at the screen, rather than on the first real retry at 3 a.m."""
    marker = STATE_DIR / "terminal-permission-ok"
    if marker.exists():
        return
    r = osa('tell application "Terminal" to count windows')
    if r.returncode != 0:
        notify("auto-continue: no permission to control Terminal",
               "System Settings → Privacy & Security → Automation → allow python3 → Terminal")
        raise SystemExit(f"Terminal automation refused: {r.stderr.strip()}")
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    marker.write_text("ok\n")
    log("Terminal automation permission ok")


def main(argv):
    if argv[:1] == ["tick"]:
        ensure_terminal_permission()
        try:
            tick(profiles(), STATE_DIR / "state.json", datetime.now(timezone.utc), REAL)
        except Exception as e:
            notify("auto-continue crashed", f"{type(e).__name__}: {e} — see {STATE_DIR}/launchd.err")
            raise                    # fail loud: launchd logs the traceback
    elif argv[:1] == ["resume-in"] and len(argv) == 3:
        cmd = prepare_resume(Path.home(), argv[1], argv[2])
        os.execvp(cmd[0], cmd)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
