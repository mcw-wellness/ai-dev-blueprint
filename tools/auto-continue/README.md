# auto-continue

A dropped API connection ends a Claude Code turn, and the session then sits idle until someone
notices — usually the next morning ([claude-threads#533](https://github.com/anneschuth/claude-threads/issues/533):
"the fault lasts a second; the loss is the whole night"). This macOS `launchd` agent notices for you.
Idea adapted from Kei's "never wait blind" rules (2026-11-08); built for Terminal.app, no herdr.

## What it does

Every minute it looks at every **live interactive** Claude session in every profile
(`~/.claude`, `~/.claude-*` → `sessions/<pid>.json`). If the session's last turn entry in its
transcript is an API error (`isApiErrorMessage: true`), it acts by the entry's `error` field:

| Error | Example | Action |
|---|---|---|
| `server_error` | sleep mid-response, ENOTFOUND, ECONNRESET, connection lost | Type `continue` into the session's Terminal tab, with backoff |
| `rate_limit` with a reset ≤ 12 h away | "session limit · resets 8:40am (Europe/Vienna)" | One `continue` at reset + 2 min |
| `rate_limit` without a reset, or reset > 12 h away | out of credits, Fable limit, weekly limit | Notify + write other profiles' quota to `quota.txt`; copy a `resume-in` command to the clipboard. **Never switches account on its own** |
| `authentication_failed`, anything else | login expired | Notify once |

**Backoff** (minutes after the error): +5, +10, +15, +30, +30, +60, +60 (~3.5 h), then hourly until
12 h after the first error. One notification when it goes hourly, one when it gives up. A successful
turn (an assistant reply that isn't an error) resets everything. A failed retry is just another
error entry — it continues the same schedule, it doesn't restart it.

Errors already older than 12 h when first seen are ignored (no notification flood on install).

## Moving a session to another profile

```bash
auto-continue resume-in <profile> <session-id>
```

Copies the transcript into that profile's `projects/` folder and starts `claude-<profile> --resume
<id>` there. Profiles are separate accounts — you decide where work may go.

## Install

```bash
tools/auto-continue/install.sh      # launchd agent com.almir.auto-continue, ticks every 60 s
```

State and log: `~/.local/state/auto-continue/`. Uninstall: `launchctl bootout gui/$(id -u)/com.almir.auto-continue`.

**First run:** the first tick (right at install) asks Terminal for its window count, so macOS's
"allow `python3` to control Terminal?" prompt appears while you're there — not at 3 a.m. Refused →
a notification and a non-zero exit every tick until allowed.

Tests: `cd tools/auto-continue && python3 -m unittest`.

## Limits

- Terminal.app only (it finds the tab by its tty). Not iTerm or Ghostty.
- If you're mid-typing in that tab when a retry fires, `continue` is appended to your text.
- After a long outage the agent resumes its old plan — it may redo a step you already handled by hand.
- Lid closed = Mac asleep; nothing runs.
