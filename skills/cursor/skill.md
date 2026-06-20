---
name: cursor
description: Run the Cursor Agent CLI (cursor-agent) for code review or brainstorming using Cursor's own Composer model on your paid subscription. Third independent reviewer alongside Gemini and Codex.
user-invocable: true
argument-hint: "[review|brainstorm|ask] <prompt or flags>"
allowed-tools:
  - Bash
  - Read
---

# Cursor Agent CLI Skill

Use the locally installed Cursor Agent CLI (`cursor-agent`, symlinked as `agent` at `~/.local/bin/`) for code review and brainstorming. Authenticated via the user's **paid Cursor subscription** (`cursor-agent status` → logged in, Pro tier). A third independent vantage point alongside `/gemini` and `/codex-review`.

## Defaults

- **Binary:** `cursor-agent` (alias `agent`). Non-interactive only.
- **Model:** **ALWAYS `--model composer-2.5`** — Cursor's own model. Two hard rules:
  - **Never `composer-2.5-fast`** (the CLI default). The user wants the real model, not the fast variant. Always pass `--model composer-2.5` explicitly so you don't get the `-fast` default.
  - **Never override to another family** (GPT-5.x, Claude, Gemini, Kimi). Those are already covered by `/codex-review` and `/gemini`. Cursor's value here is Composer's *own* perspective. If a newer Composer (>2.5) appears in `cursor-agent --list-models`, prefer it; otherwise `composer-2.5`.
- **Non-interactive flags:** `-p --output-format text --trust`.
  - `-p` / `--print` — print to stdout, no TUI.
  - `--trust` — trust the workspace (required in headless/`-p` mode).
  - `--output-format text` — plain text (use `json` only if a caller needs to parse).
- **Read-only by default.** `-p` mode has write + shell access unless constrained. For review/brainstorm we never want edits — always use `--plan` (review) or `--mode ask` (brainstorm/Q&A), both read-only.
- **Timeout:** 7 min (`timeout: 420000`) — Composer streams slower than Codex/Gemini. Prefer `run_in_background: true`.

Canonical invocations:
```bash
# Review (read-only planning mode — Cursor reads the diff itself)
cursor-agent -p --plan --trust --output-format text --model composer-2.5 "<review prompt>"

# Brainstorm / Q&A (read-only ask mode)
cursor-agent -p --mode ask --trust --output-format text --model composer-2.5 "<prompt>"
```

## How it fits the review flow

| When | What runs |
|---|---|
| **Default code review** (real feature/PR) | **All three in parallel, in the background**: `/gemini` + `/codex-review` + `/cursor`. Opus reads all three and arbitrates. |
| **Explicit "cursor review" / "check with Cursor"** | **Cursor only** — skip Gemini and Codex. |
| Brainstorming | On request, or as a third voice alongside `/gemini brainstorm`. |

Run the three reviewers concurrently (each `run_in_background: true`), then synthesize. Don't block on Cursor — it's the slowest of the three. See [how-to-review-code.md](../../how-to-review-code.md).

## Subcommands

### 1. `review` — code / diff review (read-only)

Cursor reads the diff itself via shell in `--plan` mode. Tell it which diff:

```bash
# Uncommitted
cursor-agent -p --plan --trust --output-format text --model composer-2.5 \
  "Run \`git --no-pager diff\` and review the changes. Focus on <areas>. List real issues with severity, or say it's clean. Be concise." 

# Against a base branch
cursor-agent -p --plan --trust --output-format text --model composer-2.5 \
  "Run \`git --no-pager diff main...HEAD\` and review it. ..."

# A specific commit
cursor-agent -p --plan --trust --output-format text --model composer-2.5 \
  "Run \`git --no-pager show <sha>\` and review that diff. ..."
```

`--plan` keeps it strictly read-only (analyze + propose, no edits). Don't drop `--plan` for reviews.

### 2. `brainstorm` — ideation (read-only)

```bash
cursor-agent -p --mode ask --trust --output-format text --model composer-2.5 \
  "Brainstorm <N> concise approaches to <topic>. One short paragraph each. <constraints>."
```

### 3. `ask` — general Q&A (read-only)

```bash
cursor-agent -p --mode ask --trust --output-format text --model composer-2.5 "<question>"
```

## Instructions for the agent running this skill

1. **Parse args** → `review` (diff/PR/commit), `brainstorm` (ideation), or `ask` (default Q&A).
2. **Always** pass `--model composer-2.5`, `-p`, `--trust`, `--output-format text`, and the read-only mode (`--plan` for review, `--mode ask` for brainstorm/ask). Never `-fast`, never another model family.
3. Run with `timeout: 420000`; prefer `run_in_background: true` (Composer is slow). Poll the output file until populated.
4. **Verify the run actually produced a review** before presenting it. If the output is only retry/connection noise (see Troubleshooting), it did NOT run — do not present an empty review as success. Diagnose, don't fabricate.
5. Present Cursor's output, then (in the default 3-way flow) arbitrate across Gemini + Codex + Cursor. If Cursor finds actionable issues, Claude applies the fix — never Cursor.

## Troubleshooting — FIRST check Tailscale

**The user runs Tailscale frequently.** Tailscale MagicDNS is the #1 cause of `cursor-agent` failing on this machine.

**Failure signature** (any of these = the agent stream never connected):
```
Connection lost, reconnecting to https://agentn.global.api5.cursor.sh (attempt 1/2/3)...
RetriableError: [internal] Failed to run step, exceeded max retries
Error: Something went wrong. Please try again.
```

**Root cause (confirmed by Cursor support + reproduced here):** DNS routed through **Tailscale MagicDNS intermittently fails to resolve Cursor's hosts** (`api.cursor.sh` / `agentn.global.api5.cursor.sh`). Short one-shot calls (`curl`, DNS lookups) succeed in brief good windows, but **streaming inference needs a sustained connection** and dies. This is protocol-agnostic (fails on HTTP/2 *and* HTTP/1.1) and host-agnostic. The Cursor **desktop app keeps working** because Chromium uses a different resolver path than the Node CLI — so "app works, CLI doesn't" is the tell-tale sign, NOT proof that the CLI is fine.

**When `cursor-agent` fails, do this in order:**

1. **Confirm Tailscale is up and MagicDNS is on:**
   ```bash
   pgrep -fl Tailscale
   /Applications/Tailscale.app/Contents/MacOS/Tailscale status 2>/dev/null | head
   ```
2. **Disable MagicDNS without disconnecting Tailscale** (cleanest fix — keeps the tailnet up):
   ```bash
   /Applications/Tailscale.app/Contents/MacOS/Tailscale set --accept-dns=false
   ```
   Then retry the agent. Re-enable later with `--accept-dns=true` if needed.
3. **Or quit Tailscale entirely** and retry — proves it conclusively.
4. **Or pin a public resolver** (`1.1.1.1` / `8.8.8.8`) above the Tailscale entry so streaming DNS stays stable.
5. **Tell the user before toggling their VPN** — that's their network. Recommend the command; let them run it, or get an explicit OK. Disabling Tailscale DNS / quitting Tailscale is the user's call.

**If Tailscale is already off and it still fails:** check NordVPN (also seen on this machine) the same way, then suspect an intermittent Cursor server-side issue (Composer 2.5 has had degraded-performance incidents) — retry later. Quick sanity probes:
```bash
curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 https://api2.cursor.sh/   # 200 = host reachable
cursor-agent status                                                              # confirms auth
```
Reachable host + valid auth + still failing stream = DNS/VPN or server-side, not config.

## Overriding defaults

Only on explicit user request:
- `--mode plan` is the review default; `--plan` is shorthand. Don't switch to write mode for reviews.
- `--output-format json` / `stream-json` — only if a caller parses the output.
- A different model — **don't.** The user's rule is Composer-only (non-fast). Honor it unless they explicitly name another model this turn.
