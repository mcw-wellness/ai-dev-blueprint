# ai-dev-blueprint

My personal blueprint for AI-assisted software development — principles, playbooks, skills, and templates.

Each file is a focused rulebook that can be loaded on demand. Drop the whole thing into `~/.claude/`, or copy the bits you want into a new project.

## What's in here

### Baseline (applies to every step)
- [`philosophy.md`](philosophy.md) — KISS, YAGNI, TDD
- [`spec-anchored.md`](spec-anchored.md) — spec vs finding vs ADR, Q-NNN open questions, documentation structure
- [`tool-usage.md`](tool-usage.md) — when to use Gemini / Codex / CodeRabbit / Perplexity

### Machine & personal config (auto-loaded via `AGENTS.md`)
- [`setup.md`](setup.md) — multi-machine paths, multi-instance Claude Code layout, MCP servers
- [`preferences.md`](preferences.md) — Git workflow, memory preferences

### Playbooks (read on demand)
- [`how-to-develop.md`](how-to-develop.md) — the 8-step loop + fast track for bug fixes
- [`how-to-review-spec.md`](how-to-review-spec.md) — pre-code plan review (Gemini + Codex)
- [`how-to-review-code.md`](how-to-review-code.md) — Gemini + Codex + CodeRabbit, Opus arbitrates
- [`how-to-write-tests.md`](how-to-write-tests.md) — 15 rules, Given/When/Then, DAMP > DRY
- [`how-to-run-experiments.md`](how-to-run-experiments.md) — scientific method, hardware-friendly
- [`how-to-reverse-engineer.md`](how-to-reverse-engineer.md) — legacy code → spec → new code
- [`how-to-shadow-replay.md`](how-to-shadow-replay.md) — signal-equivalence validation

### Drop-in assets
- [`AGENTS.md`](AGENTS.md) — switchboard auto-loaded by Claude Code, Cursor, Aider, Codex CLI
- [`project-level/`](project-level/) — per-project starters (AGENTS.md, spec, ADR, experiment, settings)
- [`skills/`](skills/) — personal Claude Code skills (`/gemini`, `/codex-review`)

## Why two tiers

The blueprint splits between **user-level** (how you work) and **project-level** (what each project is):

| Tier | Contents | Source of truth | Update model |
|---|---|---|---|
| **User-level** | Philosophy, playbooks, tool preferences, test rules, review loop | This repo (symlinked into `~/.claude/`) | `git pull` updates every project automatically |
| **Project-level** | Purpose, architecture, tech stack, **deviations** from the blueprint | Each project's own `AGENTS.md` | Edit per-project |

User-level methodology is stable and universal. Project-level context is volatile and specific. Mixing them creates churn in places that should be stable.

## How to adopt

### User-level (one-time per machine)

The blueprint is designed to be cloned to the **same path relative to `~`** on every machine (macOS, WSL, Windows native). `~` expands to the right home directory on each. See [`setup.md`](setup.md) for the platform path table and the Windows-native fallback.

```bash
# 1. Clone the blueprint (same relative path on every machine)
git clone git@github.com:kaza/ai-dev-blueprint ~/Documents/GitHub/ai-dev-blueprint

# 2. Point ~/.claude/CLAUDE.md at the blueprint's AGENTS.md
echo '@~/Documents/GitHub/ai-dev-blueprint/AGENTS.md' > ~/.claude/CLAUDE.md

# 3. Symlink skills so `git pull` keeps them in sync
for s in gemini codex-review chrome-troubleshooting; do
  ln -sf ~/Documents/GitHub/ai-dev-blueprint/skills/$s ~/.claude/skills/$s
done
```

`AGENTS.md` already `@`-imports `setup.md`, `preferences.md`, and the playbook links, so those load automatically — no per-file symlinks needed for the `.md` playbooks.

### Multi-instance (if you run more than one Claude Code account on the same machine)

See [`setup.md`](setup.md) for the convention. In short, per-instance config dirs (`~/.claude-<name>/`) symlink `CLAUDE.md`, `skills/`, `plugins/`, `chrome/` back to the default `~/.claude/`:

```bash
for instance in eventus tcp almir; do
  for item in CLAUDE.md skills plugins chrome; do
    ln -sf ~/.claude/$item ~/.claude-$instance/$item
  done
done
```

After that, **you only adopt the blueprint into `~/.claude/`** — the other instances inherit via the symlinks.

### Updating across machines

`git pull` in `~/Documents/GitHub/ai-dev-blueprint` updates methodology, setup, preferences, skills — everywhere, on every machine. Nothing else to sync.

### Project-level (copy, then edit)

For each new project:

```bash
cp ~/code/ai-dev-blueprint/project-level/project-AGENTS.md.template /path/to/project/AGENTS.md
mkdir -p /path/to/project/.claude
cp ~/code/ai-dev-blueprint/project-level/settings.template.json /path/to/project/.claude/settings.json
```

Then edit `/path/to/project/AGENTS.md`:
- Fill in Purpose, Architecture, Project structure
- Document any **deviations** from the blueprint (e.g., "Fast track disabled — all PRs go through full triple review due to production cutover stakes")

Per-project specs, ADRs, and experiments use the other starters in [project-level/](project-level/) — copy into the project repo, fill in, commit.

## The stack

| Role | Tool |
|---|---|
| Primary driver + final arbitration | Claude Opus |
| Plan review (pre-code) | Gemini + Codex |
| Code review (post-code) | Gemini + Codex + CodeRabbit |
| PR review | CodeRabbit (GitHub-native) |
| Quick lookup / research | Gemini CLI, Perplexity (fallback) |

Every material finding from any reviewer is either fixed or explicitly rejected with a written rationale. That loop is what makes this different from "just let one model do it."

## License

MIT. Steal what's useful.
