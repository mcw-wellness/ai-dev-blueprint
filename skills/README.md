# Skills

Personal skills that plug into Claude Code at `~/.claude/skills/`.

## Install

```bash
cp -r gemini codex-review chrome-troubleshooting ~/.claude/skills/
```

Or symlink them so `git pull` keeps them in sync:

```bash
for s in gemini codex-review cursor chrome-troubleshooting; do
  ln -sf "$(pwd)/$s" ~/.claude/skills/$s
done
```

Restart Claude Code and the skills will be callable as `/gemini`, `/codex-review`, `/cursor`, and `/chrome-troubleshooting`.

## What's here

- **`gemini/`** — Run Google Gemini CLI (`/gemini search|review|brainstorm|ask`). Default model: Gemini 3 Pro. Project-context aware.
- **`codex-review/`** — Run OpenAI Codex CLI for second-opinion code review (`/codex-review ask "question"` or `/codex-review review`).
- **`cursor/`** — Run the Cursor Agent CLI (`/cursor review|brainstorm|ask`) on your paid subscription, using Cursor's own Composer 2.5 model. The third independent reviewer alongside Gemini and Codex. Includes Tailscale-MagicDNS troubleshooting (the usual cause of `cursor-agent` connection failures).
- **`chrome-troubleshooting/`** — Fix "No Chrome extension connected" for `mcp__claude-in-chrome__*` tools (conflict between Claude Desktop and Claude Code native messaging hosts). Rare but painful when it hits.

## Usage in the review flow

See [how-to-review-code.md](../how-to-review-code.md) for how Gemini, Codex, and CodeRabbit combine into the triple-review loop with Opus arbitration.
