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
| eventus | `claude-eventus` | `~/.claude-eventus/` | Eventus work account | Midnight (blue) |
| tcp | `claude-tcp` | `~/.claude-tcp/` | TCP work account | Aubergine (purple) |
| almir | `claude-almir` | `~/.claude-almir/` | Almir personal account | Lead (gray) |
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

## MCP Servers

MCPs are configured **per instance** in each instance's `.claude.json` file (not shared across instances).

Currently installed:
- **perplexity-ask** (`server-perplexity-ask`) — Perplexity search. Only exposes `perplexity_ask` (cheap). Do NOT use `perplexity_research` — expensive and inferior to Gemini.

Gemini is **not** an MCP. It's the `/gemini` skill (CLI-based) — see [tool-usage.md](tool-usage.md).

To manage MCPs for a specific instance:

```bash
CLAUDE_CONFIG_DIR=~/.claude-<name> claude mcp add <server> ...
CLAUDE_CONFIG_DIR=~/.claude-<name> claude mcp list
CLAUDE_CONFIG_DIR=~/.claude-<name> claude mcp remove <server>
```
