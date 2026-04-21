# User Preferences

Character and voice rules live in [soul.md](soul.md) — read that first. This file is operating preferences.

## Operating preferences

- **Quality over throughput.** One correct pass beats three half-versions. If you're unsure, stop and think; don't paper over with fallbacks.

## Git Workflow

- **Merge strategy: prefer a normal merge commit.** When merging a PR (`gh pr merge`) or a branch locally, default to `--merge` (a true merge commit preserving the branch's history).
- **Do NOT squash** (`--squash`) unless the project's local `AGENTS.md` explicitly asks for it. Squashing collapses the review-fix trail (Gemini / Codex / CodeRabbit iterations) into a single commit, which hurts blame and rollback.
- Rebase (`--rebase`) is acceptable when the user asks for it, but still not the default.
- If a repo has branch protection that *only* allows squash, note that in the project's `AGENTS.md` and follow it there — don't override the global preference silently.

## Memory Preferences

- **Do NOT use auto-memory (dynamic project memories) without asking first.** Persistent knowledge should live in `AGENTS.md` files (user root or project) — not in the auto-memory system.
- If something is worth remembering, **suggest where to put it**: user root (cross-project), project-level (project-specific), or a spec/doc file. Let the user decide.
- The auto-memory directory may exist but treat it as a last resort, not a default.
