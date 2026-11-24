@soul.md
@setup.md
@preferences.md

# Core principles

These apply to every task. If a suggestion violates one, call it out.

- **KISS** — simplest thing that works.
- **YAGNI** — only what's asked for.
- **TDD** — tests first, code second (experiments excepted).
- **Spec-anchored** — no code without a spec.
- **Fail loud** — never swallow an exception. A `catch`/`except` that logs and carries on hides
  the very failure it was meant to survive, and the system then lies about being healthy.
  Swallowing is undesired by default and requires my **explicit approval**, recorded in a
  comment naming the reason. Otherwise: let it propagate, or stop the affected work.

# Status updates

Whenever you give me a duration or ETA (how long something will take, when it'll finish, when you'll wake up to check), include the **current local time** so I can compute the actual finish time. Run `date` to get it — don't guess from memory.

Format: `ETA ~10 min (now 11:14, finishes ~11:24)`. Without the anchor, "10 min" is useless if I read the message late.

# Long waits

When waiting on a long job (an experiment run, a Codex/Gemini review, a build), wait with `bgwatch`, never blind. If it ends as failed, gone, stuck or too long, tell Almir in the very next message.

`bgwatch` is [tools/bgwatch/bgwatch.py](tools/bgwatch/bgwatch.py); run it under `run_in_background`, its `--help` has the usage.

# Playbooks

**Hard gate — read the relevant playbook before you propose anything.** Not just before coding. Proposing a title, directory structure, success criteria, or plan *is* acting. If you haven't read the playbook yet, your proposal is uninformed by the rules and will be wrong.

| Doing this | Read this |
|---|---|
| Starting a feature or fixing a bug | [how-to-develop.md](how-to-develop.md) |
| Reviewing a plan (before coding) | [how-to-review-spec.md](how-to-review-spec.md) |
| Reviewing code (after coding) | [how-to-review-code.md](how-to-review-code.md) |
| Writing tests | [how-to-write-tests.md](how-to-write-tests.md) |
| Running or creating an experiment (incl. hardware) | [how-to-run-experiments.md](how-to-run-experiments.md) |
| Reverse-engineering legacy code | [how-to-reverse-engineer.md](how-to-reverse-engineer.md) |
| Validating parity with a legacy system | [how-to-shadow-replay.md](how-to-shadow-replay.md) |
| Running a Ralph project (autonomous loop over multiple specs) | [how-to-ralph-project.md](how-to-ralph-project.md) |

Reference (read when needed):
- [spec-anchored.md](spec-anchored.md) — spec vs finding vs ADR, documentation structure
- [tool-usage.md](tool-usage.md) — which AI for which task
- [how-to-profiles.md](how-to-profiles.md) — recreate all Claude/Codex profiles on a new machine
- [codex-review-policy.md](codex-review-policy.md) — the Codex-side review chain (synced into each Codex home)
- [philosophy.md](philosophy.md) — the *why* behind the principles

# Experiment triggers

Phrases like "let's create an experiment", "investigate", "let's try", "test whether", "I have a hypothesis", "bakeoff" are hard triggers to open [how-to-run-experiments.md](how-to-run-experiments.md) **and** the project's `experiments/CLAUDE.md` (or `AGENTS.md`) **before** proposing a title, scope, or directory layout. Experiments are the highest-structure mode — the playbook defines the scaffold, not you.
