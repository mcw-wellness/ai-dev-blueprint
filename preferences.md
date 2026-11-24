# User Preferences

Character and voice rules live in [soul.md](soul.md) — read that first. This file is operating preferences.

## Operating preferences

- **Quality over throughput.** One correct pass beats three half-versions. If you're unsure, stop and think; don't paper over with fallbacks.

## Git Workflow

- **Merge strategy: prefer a normal merge commit.** When merging a PR (`gh pr merge`) or a branch locally, default to `--merge` (a true merge commit preserving the branch's history).
- **Do NOT squash** (`--squash`) unless the project's local `AGENTS.md` explicitly asks for it. Squashing collapses the review-fix trail (Codex / Fable / CodeRabbit iterations) into a single commit, which hurts blame and rollback.
- Rebase (`--rebase`) is acceptable when the user asks for it, but still not the default.
- If a repo has branch protection that *only* allows squash, note that in the project's `AGENTS.md` and follow it there — don't override the global preference silently.

## Memory Preferences

- **Do NOT use auto-memory (dynamic project memories) without asking first.** Persistent knowledge should live in the **closest `AGENTS.md`** — not in the auto-memory system.
- If something is worth remembering, **suggest where to put it**, at the shallowest depth where it is still true: user root (cross-project), project, a subdirectory or experiment, or a spec/doc file. Let the user decide. A fact narrower than a whole project is not a reason to reach for auto-memory — put it in the `AGENTS.md` next to the thing it describes.
- The auto-memory directory may exist but treat it as a last resort, not a default.

## Output Preferences

- **NEVER use Artifacts.** Not for pages, dashboards, reports, diagrams, docs — nothing. I run
  multiple Claude accounts and there is no reliable way for me to open an artifact URL from the
  account that happens to be publishing it. An artifact link is a dead end, not a deliverable.
- **Write a local file instead**, in the repo (or a sane path I can find), and give me the path.
  Then open it for me — `open <file>` on macOS — or serve it on `localhost` if it needs a server.
- This is not a soft preference. Do not "just this once" publish an artifact because the content
  seems to suit one.
