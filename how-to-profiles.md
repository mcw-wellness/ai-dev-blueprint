# How to recreate my AI-tool profiles on a new machine

The goal: stand up **all my Claude Code and Codex profiles** on a fresh machine from this repo
alone, with the same launch behaviour (skip-permissions, verbose, per-profile terminal colour) and
the same cross-tool review policy. `setup.md` covers the *concept* of multi-instance isolation; this
doc is the *recreate-from-scratch procedure*.

> **Secrets never live in this repo.** Every `settings.json` / env value below that looks like a key
> or token is a `<PLACEHOLDER>`. The real values live only in the per-profile config on each machine
> and must never be committed. If you see a real key in a file that's tracked by git, that's a bug —
> rotate it.

---

## The profile matrix (source of truth)

Each profile = an isolated config home + a launcher script in `~/bin/`. Launchers only differ by
three variables: **tool**, **name/home**, **terminal colour**.

### Claude Code — 3 named instances + default

A 3-colour palette (dark-theme aligned) covers all profiles; colour = identity, so each Codex
profile reuses its human's colour.

| Name | Launcher | Config home (`CLAUDE_CONFIG_DIR`) | Account | Colour (hex / 16-bit RGB) |
|---|---|---|---|---|
| eventus | `claude-eventus` | `~/.claude-eventus/` | Eventus work | Midnight Indigo `#0C1445` `{3084,5140,17733}` |
| tcp | `claude-tcp` | `~/.claude-tcp/` | TCP work | Royal Plum `#2A0A3D` `{10794,2570,15677}` |
| almir | `claude-almir` | `~/.claude-almir/` | Personal | Graphite `#202028` `{8224,8224,10280}` |
| (default) | `claude` | `~/.claude/` | Default | terminal default |

Every named Claude launcher runs: `caffeinate -i claude --dangerously-skip-permissions --verbose`.
`caffeinate -i` holds the Mac awake (screen may sleep, Wi-Fi stays up) for as long as the session
is open; Claude Code's own caffeinate only covers active turns, so idle sessions slept on battery.
Lid close still sleeps.

### Codex — 2 named instances + default

| Name | Launcher | Config home (`CODEX_HOME`) | Account | Colour (hex / 16-bit RGB) |
|---|---|---|---|---|
| almir | `codex-almir` | `~/.codex-almir/` | Personal | Graphite `#202028` `{8224,8224,10280}` (matches claude-almir) |
| vvs | `codex-vvs` | `~/.codex-vvs/` | VVS work | Midnight Indigo `#0C1445` `{3084,5140,17733}` |
| (default) | `codex` | `~/.codex/` | Default | terminal default |

Every named Codex launcher runs: `codex --yolo`.

`--dangerously-skip-permissions` (Claude) and `--yolo` (Codex) are **intentional** — these are
developer machines and I keep planning + video-recording + the full autonomous loop. Don't strip
them.

---

## Step 1 — the launcher scripts

All five launchers are the same script with three variables filled in. Generate them with this
helper (paste into a shell on the new machine):

```bash
mkdir -p ~/bin

# mk-launcher <tool> <name> <R> <G> <B>
#   tool = claude | codex ; name = profile name ; R/G/B = 16-bit terminal colour
mk-launcher() {
  local tool="$1" name="$2" r="$3" g="$4" b="$5"
  local path="$HOME/bin/${tool}-${name}"
  {
    echo '#!/bin/bash'
    echo "# ${tool} - ${name} instance"
    echo "osascript -e 'tell application \"Terminal\" to set background color of selected tab of front window to {${r}, ${g}, ${b}}' 2>/dev/null"
    if [ "$tool" = claude ]; then
      echo "CLAUDE_CONFIG_DIR=\"\$HOME/.claude-${name}\" CLAUDE_INSTANCE=\"${name}\" exec caffeinate -i claude --dangerously-skip-permissions --verbose \"\$@\""
    else
      echo "CODEX_HOME=\"\$HOME/.codex-${name}\" exec codex --yolo \"\$@\""
    fi
  } > "$path"
  chmod +x "$path"
  echo "wrote $path"
}

mk-launcher claude eventus 3084  5140  17733   # Midnight Indigo #0C1445
mk-launcher claude tcp     10794 2570  15677   # Royal Plum      #2A0A3D
mk-launcher claude almir   8224  8224  10280   # Graphite        #202028
mk-launcher codex  almir   8224  8224  10280   # Graphite        #202028
mk-launcher codex  vvs     3084  5140  17733   # Midnight Indigo #0C1445
```

Ensure `~/bin` is on `PATH` (add `export PATH="$HOME/bin:$PATH"` to `~/.zshrc` if it isn't). On WSL
the `osascript` line is a harmless no-op; swap in a terminal-specific colour command if you want
colours there.

---

## Step 2 — Claude instances

For each named instance (`eventus`, `tcp`, `almir`):

```bash
for name in eventus tcp almir; do
  mkdir -p ~/.claude-$name
  # Share CLAUDE.md, skills, plugins, chrome from the default home (see setup.md)
  for item in CLAUDE.md skills plugins chrome; do
    ln -sf ~/.claude/$item ~/.claude-$name/$item
  done
done
```

Then per instance:
1. **Log in:** `claude-<name>` once, complete the browser auth for that account.
2. **Write `settings.json`** — this file is **per-instance, not symlinked**. Copy the shared base
   below and layer the per-instance delta. Fill every `<PLACEHOLDER>`.

**Shared base (all Claude instances):**
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "statusLine": { "type": "command", "command": "bash ~/.claude/statusline-command.sh" },
  "extraKnownMarketplaces": {
    "claude-plugins-official": { "source": { "source": "github", "repo": "anthropics/claude-plugins-official" } }
  },
  "enabledPlugins": { "claude-md-management@claude-plugins-official": true, "coderabbit@claude-plugins-official": true },
  "alwaysThinkingEnabled": true,
  "voice": { "enabled": true, "mode": "hold" },
  "voiceEnabled": true,
  "skipDangerousModePermissionPrompt": true
}
```

**Per-instance deltas:**

| Instance | Adds / overrides |
|---|---|
| **eventus** | `env`: `EVENTUS_DATA_REPO=/…/eventus/ai-support-agent-knowledge`, `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN=<PLACEHOLDER>`. Marketplaces `eventus-poc` (`EventusSystems/poc-claude-plugin`) + `snakeo-co-commands` (`SnakeO/claude-co-commands`). `tui:"fullscreen"`, `autoCompactEnabled:true`, `agentPushNotifEnabled:true`, `remoteControlAtStartup:false` |
| **tcp** | `model:"opus[1m]"`. Marketplace `tcp-marketplace` (`tcp-advisors/tcp-claude-plugins`) + plugin `tcp-feature-db@tcp-marketplace`. `tui:"fullscreen"`, `showThinkingSummaries:true` |
| **almir** | `permissions.defaultMode:"auto"`, `model:"opus[1m]"`, `skipAutoPermissionPrompt:true`. Plugins add `stripe` + `frontend-design`; **disable** `claude-md-management`. `tui:"fullscreen"` |
| **(default `~/.claude`)** | `permissions.defaultMode:"bypassPermissions"` (+ explicit allow list). This is the home the named instances symlink `CLAUDE.md`/`skills`/`plugins`/`chrome` from — set it up first. |

> The default `~/.claude/CLAUDE.md` is a single line: `@~/Documents/GitHub/ai-dev-blueprint/AGENTS.md`.
> That's the whole hookup — every instance inherits the blueprint through the symlinked `CLAUDE.md`.

---

## Step 3 — Codex instances

Codex isolates by `CODEX_HOME` (the same idea as `CLAUDE_CONFIG_DIR`). For each (`almir`, `vvs`):

```bash
for name in almir vvs; do
  mkdir -p ~/.codex-$name
  # Sync the cross-tool review policy from the blueprint (see Step 4)
  ln -sf ~/Documents/GitHub/ai-dev-blueprint/codex-review-policy.md ~/.codex-$name/AGENTS.md
done
```

Then per home:
1. **Log in isolated:** `codex-<name>` once. Each home's `config.toml` must contain
   `cli_auth_credentials_store = "file"` so logins don't bleed across homes.
2. **`config.toml`** — minimal per home:
   ```toml
   # Keep this profile's login isolated from other Codex homes.
   cli_auth_credentials_store = "file"
   # model / reasoning inherit sensible defaults; add [projects."…"] trust entries as you go.
   ```
   The **default** `~/.codex/config.toml` is the heavy one (model `gpt-5.6-sol`, reasoning `high`,
   the ChatGPT-desktop plugins/MCP). The named homes stay lean.

---

## Step 4 — the cross-tool review policy (the important asymmetry)

The two tools review through **different** chains — this is deliberate, and it's what the profiles
encode. Keep both in sync from the blueprint:

- **Claude** reviews with **Gemini + Codex + CodeRabbit** (+ optional Cursor), and **Fable
  arbitrates**. Source: `tool-usage.md` / `how-to-review-code.md` (auto-loaded via `AGENTS.md`).
- **Codex** reviews with **Gemini + Fable**, runs Claude read-only through the authenticated
  `claude-eventus` instance using Fable, and **Fable arbitrates (never Opus)**. Source:
  [`codex-review-policy.md`](codex-review-policy.md), symlinked into each `~/.codex*/AGENTS.md`
  (Step 3).

**Fable is the final arbiter across both tools.** Opus is the primary driver, not the arbiter.

---

## Step 5 — the shared toolchain (must exist on every machine)

| Tool | Role | Install / auth |
|---|---|---|
| **Gemini CLI** | **Web research + independent review — required.** CLI-only (no MCP). | `/gemini` skill wraps the CLI; auth via `gemini` login or `GEMINI_API_KEY`. |
| **Codex CLI** | Independent reviewer + second driver | `brew install`/npm; `codex login` per home. |
| **coreutils** (`gtimeout`) | 45-min hard limit on Codex/Gemini calls | `brew install coreutils`. |
| **CodeRabbit CLI** | Convention/lint-class review | local `coderabbit review --light --committed --base main`. |
| **Cursor** (`/cursor`) | **Optional** third reviewer — reintroducing, experimental. | Composer 2.5 only. Not required in the default loop. |
| ~~Perplexity~~ | **Removed** — Gemini replaced it for all web research. | Do not reinstall. |

---

## Verify

```bash
echo $CLAUDE_INSTANCE            # inside a claude-<name> session → the name
claude-eventus --version         # each launcher resolves + auth works
codex-almir --version
gemini --version                 # web-research link is live
```

Per-profile: launch it, confirm the terminal colour, confirm the account, confirm skip-permissions
is active (no permission prompts), and — for Codex homes — confirm `~/.codex-<name>/AGENTS.md`
resolves to the blueprint policy.

## Related
- [`setup.md`](setup.md) — the isolation concept + platform path table
- [`tool-usage.md`](tool-usage.md) — which AI for which task (the Claude-side policy)
- [`codex-review-policy.md`](codex-review-policy.md) — the Codex-side policy (symlinked into each home)
