# ai-dev-blueprint

My personal blueprint for AI-assisted software development — principles, playbooks, skills, and templates.

Each file is a focused rulebook that can be loaded on demand. Drop the whole thing into `~/.claude/`, or copy the bits you want into a new project.

## What's in here

### Baseline (applies to every step)
- [`philosophy.md`](philosophy.md) — KISS, YAGNI, TDD
- [`spec-anchored.md`](spec-anchored.md) — spec vs finding vs ADR, Q-NNN open questions, documentation structure
- [`tool-usage.md`](tool-usage.md) — when to use Gemini / Codex / CodeRabbit / Perplexity

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

### User-level (symlink, one-time)

```bash
# Clone the blueprint somewhere you'll keep it
git clone git@github.com:kaza/ai-dev-blueprint ~/code/ai-dev-blueprint

# Symlink user-level files into ~/.claude/ so `git pull` updates everywhere
cd ~/.claude
ln -sf ~/code/ai-dev-blueprint/AGENTS.md CLAUDE.md
for f in philosophy spec-anchored tool-usage how-to-*; do
  ln -sf ~/code/ai-dev-blueprint/$f.md .
done

# Skills
ln -sf ~/code/ai-dev-blueprint/skills/gemini skills/
ln -sf ~/code/ai-dev-blueprint/skills/codex-review skills/
```

Now `git pull` in `~/code/ai-dev-blueprint` updates your methodology across every project.

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
