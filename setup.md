# Machine & Instance Setup

This blueprint is cloned to the same path relative to `~` on every machine I use: `~/Documents/GitHub/ai-dev-blueprint/`. `~` resolves to the correct home directory on each platform, so every `@~/Documents/GitHub/ai-dev-blueprint/...` include just works.

| Platform | `~` resolves to |
|---|---|
| macOS | `/Users/<user>` |
| WSL | `/home/<user>` |
| Windows native | `C:\Users\<user>` |

**Windows native caveat:** if `@~/...` imports in `CLAUDE.md` don't expand on Windows-native Claude Code, fall back to a full absolute path in that machine's `~/.claude/CLAUDE.md` only (e.g. `@C:/Users/<user>/Documents/GitHub/ai-dev-blueprint/AGENTS.md` — forward slashes). The blueprint's internal `@setup.md` / `@preferences.md` imports are relative and work unchanged.

## Multi-Instance Setup

Each machine runs multiple Claude Code instances with isolated accounts. The env var `CLAUDE_INSTANCE` identifies which one you are. Check it via `echo $CLAUDE_INSTANCE` if needed.

| Instance | Command | Config Dir | Account | Terminal Color |
|---|---|---|---|---|
| eventus | `claude-eventus` | `~/.claude-eventus/` | Eventus work account | Midnight Indigo `#0C1445` |
| tcp | `claude-tcp` | `~/.claude-tcp/` | TCP work account | Royal Plum `#2A0A3D` |
| almir | `claude-almir` | `~/.claude-almir/` | Almir personal account | Graphite `#202028` |
| (default) | `claude` | `~/.claude/` | Default account | Default |

Shared across instances (symlinked): `plugins/`, `skills/`, `chrome/`, `CLAUDE.md`.
Isolated per instance: auth/credentials, sessions, history, project memory, `.claude.json` (MCPs), `settings.json`.

### How the sharing works

Each non-default instance has these symlinks pointing at the default:

```
~/.claude-<name>/CLAUDE.md → ~/.claude/CLAUDE.md
~/.claude-<name>/skills/   → ~/.claude/skills/
~/.claude-<name>/plugins/  → ~/.claude/plugins/
~/.claude-<name>/chrome/   → ~/.claude/chrome/
```

So adopting the blueprint on a new machine only requires touching `~/.claude/` — the other instances inherit automatically once those symlinks exist.

> **Recreating everything on a fresh machine** — launchers, per-profile `settings.json` deltas, the
> Codex homes, and the cross-tool review policy — is a step-by-step procedure in
> [how-to-profiles.md](how-to-profiles.md). This section is the concept; that doc is the checklist.

## Codex Instances

Codex uses the same isolation idea as Claude, keyed by `CODEX_HOME` instead of `CLAUDE_CONFIG_DIR`.

| Instance | Command | Config Dir | Account | Terminal Color |
|---|---|---|---|---|
| almir | `codex-almir` | `~/.codex-almir/` | Personal | Graphite `#202028` (matches claude-almir) |
| vvs | `codex-vvs` | `~/.codex-vvs/` | VVS work | Midnight Indigo `#0C1445` |
| (default) | `codex` | `~/.codex/` | Default | Default |

Each named home sets `cli_auth_credentials_store = "file"` in its `config.toml` so logins stay
isolated. The Codex review policy ([codex-review-policy.md](codex-review-policy.md)) is symlinked
into each home as `AGENTS.md`, so `git pull` in the blueprint updates it everywhere — same pattern as
Claude's `CLAUDE.md`. Named Codex launchers run `codex --yolo`.

## MCP Servers

MCPs are configured **per instance** in each instance's `.claude.json` file (not shared across instances).

Currently installed: none.

Perplexity (`perplexity-ask`) was removed 2026-07-02 — Gemini grounded search superseded it for all web research. Do not re-add it.

Gemini is **not** an MCP. It's the `/gemini` skill (CLI-based) — see [tool-usage.md](tool-usage.md). This is the web-research tool, and it's a **required** link in the chain (CLI-only; no MCP). If an old `~/.claude/settings.json` still carries a `mcpServers.gemini` (or `perplexity-ask`) block, remove it — those are stale.

## Google Drive (all profiles)

Claude talks to Google Drive through a CLI, not an MCP (Almir, 2026-11-22):
`~/Documents/GitHub/kaza/vending-id-austria/apps/cli/drive_cli.py` (docs: that repo's `docs/email-access.md`, section
„Google Drive"). It uploads a local file and prints the link; Markdown and Word become Google Docs. Scope `drive.file`:
it sees only files it created. Sharing a file stays manual in Drive — Almir decides who sees it.

```bash
PY=~/.config/spaetitogo-mail/venv/bin/python; CLI=~/Documents/GitHub/kaza/vending-id-austria/apps/cli/drive_cli.py
$PY $CLI --account almir@software-advantage.com login                          # once per account: browser → Allow
$PY $CLI --account almir@software-advantage.com upload plan.md --name "Titel"  # → https://docs.google.com/…
```

| Account | Status |
|---|---|
| `almir@software-advantage.com` | ✅ works (token in `~/.config/spaetitogo-mail/`, created 2026-11-22) |
| `kazazic@gmail.com` (Almir's private Drive) | ⚠️ blocked: the OAuth app „Claude Mail Access" (Cloud project `careful-isotope-512007-b8`, org software-advantage.com) is **Internal** → `Error 403: org_internal`. To enable: Google Auth Platform → Audience → External, add `kazazic@gmail.com` as test user (needs Almir's password re-check in the console) |

## Gmail: which inbox, which way (Almir, 2026-11-27: „I want you to know how to read my Gmail")

| Mailbox | How Claude reads it |
|---|---|
| `hello@spaetitogo.at`, `hello@own-words.pro` | Gmail API, `vending-id-austria/apps/cli/gmail_cli.py` (read + send; send only with Almir's yes) |
| `almir@software-advantage.com` | Gmail API read-only, token `~/.config/spaetitogo-mail/token-almir@software-advantage.com-readonly.json` (`marketing/accounts/google-admin.md`) |
| **`kazazic@gmail.com`** (private) | **Chrome, via the claude-in-chrome tools**: Almir's Chrome is signed in as account `u/0`. Open a new tab with a search URL, e.g. `https://mail.google.com/mail/u/0/#search/<query>` (Gmail search syntax, URL-encoded), wait ~3–4 s, then `get_page_text`. Read only; close the tab afterwards. The API route is blocked (OAuth app is Internal, see the Drive table above). First used 2026-11-27 to look for a Google Ads invitation |

Why not an MCP: the claude.ai Google Drive / Google Docs connectors need an org owner's approval in the Eventus
claude.ai org (card shows only „Request"); a local Drive MCP would hit the same Internal-app block as the CLI.

To manage MCPs for a specific instance:

```bash
CLAUDE_CONFIG_DIR=~/.claude-<name> claude mcp add <server> ...
CLAUDE_CONFIG_DIR=~/.claude-<name> claude mcp list
CLAUDE_CONFIG_DIR=~/.claude-<name> claude mcp remove <server>
```
