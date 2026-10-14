---
name: ai-usage
description: Show remaining Claude Code and Codex quota across every local profile — % of the 5-hour, weekly and per-model limits used, when each resets, which account is logged in where, and when each login expires. Use when asked about usage, quota, limits, tokens left, resets, "how much do I have left", or which account a profile is logged into.
user-invocable: true
allowed-tools:
  - Bash
---

# AI usage across profiles

Run:

```bash
python3 ~/.claude/skills/ai-usage/ai-usage.py
```

It discovers every Claude profile (`~/.claude`, `~/.claude-*`) and Codex profile (`~/.codex`,
`~/.codex-*`) on this machine and, per profile, prints: logged-in email and plan, login expiry,
and each limit's % used with its reset time (session 5h, weekly, per-model weekly such as Fable,
Codex primary/secondary windows, credits, extra usage).

## Answering

- Answer the question asked from the output — don't paste the whole dump. A table per product
  (profile · account · used % · resets · login expiry) is usually right.
- Surface what needs action: a limit ≥ 90% or reached, an expired or missing login, a login
  expiring within a week.
- Point out profiles that share one account (same email) — they share one quota, so "switching
  profile" to escape a limit won't work.
- "Token consumption" here means % of each limit used; raw per-token counts are not available
  from this script.

## Behaviour and limits

- **Read-only.** It never refreshes tokens — refreshing would rotate them out from under the CLI.
  An expired access token is reported with the fix (run `claude` / `codex` in that profile once).
- **Unofficial endpoints** (`api.anthropic.com/api/oauth/usage`, `chatgpt.com/backend-api/wham/usage`)
  — the same ones `/usage` and CodexBar use. If they change, the script prints `ERROR` for the
  profile and exits 1; report that rather than guessing numbers.
- **macOS only** for Claude: credentials are read from the Keychain item
  `Claude Code-credentials[-<sha256(config dir)[:8]>]`. Codex homes need
  `cli_auth_credentials_store = "file"` (credentials in `auth.json`).
- First run may trigger a Keychain access prompt per profile — "Always Allow".
