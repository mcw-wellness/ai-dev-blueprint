# Skills

Personal skills that plug into Claude Code at `~/.claude/skills/`.

## Install

```bash
cp -r gemini codex-review ~/.claude/skills/
```

Restart Claude Code and the skills will be callable as `/gemini` and `/codex-review`.

## What's here

- **`gemini/`** — Run Google Gemini CLI (`/gemini search|review|brainstorm|ask`). Default model: Gemini 3 Pro. Project-context aware.
- **`codex-review/`** — Run OpenAI Codex CLI for second-opinion code review (`/codex-review ask "question"` or `/codex-review review`).

## Usage in the review flow

See [how-to-review-code.md](../how-to-review-code.md) for how Gemini, Codex, and CodeRabbit combine into the triple-review loop with Opus arbitration.
