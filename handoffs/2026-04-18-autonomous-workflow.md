# Handoff — autonomous workflow design

**Date started:** 2026-04-18
**Status:** In design, pre-pilot. No code/spec work started yet.

## What was done earlier this session (already committed + pushed to main)

1. **Skills unified.** `gemini`, `codex-review`, `chrome-troubleshooting` now live in `blueprint/skills/` and symlinked from `~/.claude/skills/`. Live `~/.claude/skills/` dirs backed up at `~/.claude/backups/pre-blueprint-2026-04-18/skills/`.
2. **Product-name sanitization.** Gemini skill examples — `TickDB` → "legacy message queue", `validus` → `payments-service` / `legacy-system`.
3. **Multi-machine + multi-instance.** New `setup.md` (platform paths, instance table, MCPs — perplexity-ask only, no Gmail/Calendar) and `preferences.md` (Git workflow, memory preferences, **Working-with-me character directives**). `AGENTS.md` now `@`-imports both.
4. **AI-testability principle** added to `philosophy.md` as a fourth peer to KISS/YAGNI/TDD. Cross-referenced with preferences §Working-with-me.
5. **Live CLAUDE.md swap.** `~/.claude/CLAUDE.md` is now a one-liner: `@~/Documents/GitHub/ai-dev-blueprint/AGENTS.md`. Old CLAUDE.md + `development-process.md` backed up at `~/.claude/backups/pre-blueprint-2026-04-18/`.

Commits ahead of the starting point: `93db00b`, `d4f78d4`, `d27e48f`, `5d72425`. All pushed to `origin/main` at `github.com/kaza/ai-dev-blueprint`.

## What we're designing

A minimum-viable **autonomous software-dev workflow** that combines:
- User's existing strength: **spec-anchored development with triple-AI review** (Gemini + Codex + CodeRabbit, Opus arbitrating)
- Claw-code / OmX inspiration: **async chat interface, verified loops, parallel agents, status routing**

Pilot target: **`~/Documents/GitHub/vending-id-austria`** (passport app, includes Android — harder is fine).
Secondary future target: `~/Documents/GitHub/MCW-Practice-Management-Software` (greenfield feature; deferred until workflow proven on passport).

## User's sharpened principles (DO NOT re-derive these)

1. **KISS + YAGNI the process itself.** Start minimum, grow as needed. Underengineer, don't overengineer.
2. **Specs are iterative, not locked.** "Upfront I know I don't know what to build." Unknowns discovered during implementation are normal, not a failure.
3. **Redo is cheaper than stall.** Don't over-escalate. A wasted implementation pass is far cheaper than a stalled overnight run.
4. **Hardware is a cost, not a checkpoint.** Agent's job is to find workarounds — stubs, mocks, recorded video, emulator fakes — *before* escalating.
5. **When human around → human decides. Overnight / auto mode → Opus defaults to KISS+YAGNI, documents the decision, moves on. Human reviews next day.**

## Minimum viable process (agreed)

```
ROADMAP.md  — list of specs with status (draft / ready / in-flight / done)
  ↓
One spec at a time. Human + AI draft. Triple-review when "mostly there".
Human says "kick it off" when comfortable. No formal gate.
  ↓
Implementation loop (overnight or anytime):
  - TDD + triple code review on the diff
  - On unknown in spec → Opus picks KISS/YAGNI, documents in DECISIONS.md, continues
  - On reviewer severity disagreement → pick harsher, document, continue
  - On hardware/external blocker → try stubs / mocks / recorded video first
  - Stop only when genuinely stuck (no progress in ~5 iters)
  ↓
Morning: human reads DECISIONS.md, approves or revises. Revisions become new spec work.
```

That's the whole thing. Do not add DAGs, phases, formal gates, parallelism, structured escalation protocols, etc. until we've piloted this and discover we need them.

## Punted (decide when we hit, not now)

- **"Human around" vs. "auto mode" signal.** Proposed: `--auto` flag on kickoff. Not decided.
- **Escalation channel format.** Proposed: one-line message to Claude Code Remote with worktree link. Not decided.

## Next concrete step

Sketch a 5–10 line `ROADMAP.md` for `~/Documents/GitHub/vending-id-austria` — what specs remain to finish the passport app. See if the "list of specs" shape fits the real project **before** designing anything else.

## Reference projects that informed the discussion (already disciplined, already running)

- **`~/Documents/GitHub/eventus/poc-market-data-ingestion/.claude/worktrees/peaceful-tesla`**
  Worktree-per-feature; branches named `claude/<name>`; spec multi-pass review (v1 → v2 → v2.1) with Codex/Gemini/CodeRabbit finding counts per pass; `Prime Directive: C++ is ground truth`; GAPS.md catalog, F-NNN finding IDs.

- **`~/Documents/GitHub/eventus/validus/packages/vault`**
  No `.claude/` automation; human-paced retro-spec discipline. `SESSION-HANDOFF.md` for resumable multi-session work; `REVIEW-NOTES.md` consolidates 58 findings (F-001..F-058) with severity + source + module. Characterization tests (Feathers) locking behavior before changes.

Both provide real patterns to borrow (F-NNN tracking, worktree isolation, SESSION-HANDOFF resumability, Prime Directives). Keep as references; don't copy wholesale.

## Reference articles (context, not re-read material)

- Christine Vallaure "soft agents" (Medium) — persona files, lazy context loading, session-briefing discipline. Worth stealing: session-briefing resumability.
- claw-code / OmX (oh-my-codex) / clawhip (Sigrid Jin, LinkedIn) — async Discord interface, `$team` parallel agents, `$ralph` verified loop, notification routing daemon. Worth stealing: async chat, verified loop predicate, notification routing.

Both demos overclaim. The discussion pushed back hard on "one hour to rebuild Claude Code" framing — it was a port with existing spec, not greenfield development. Spec-anchored triple-review remains the non-negotiable strength that claw-code skips.

---

## For the Claude Code session picking this up on the next machine

1. You have just `@`-imported `AGENTS.md` (including `setup.md` and `preferences.md`) via the user's CLAUDE.md. Character directives, Git/memory preferences, AI-testability principle — all loaded. Don't restate them.
2. **Read this handoff file.** Confirm you've read it in one sentence.
3. Ask: *"Ready to sketch ROADMAP.md for vending-id-austria, or something else first?"* — that's the agreed next step.
4. Do not re-derive the principles above. Do not propose DAGs, formal gates, or structured escalation protocols. The user explicitly requested underengineering.

If the user wants to revisit a prior decision, they'll say so. Otherwise, pick up from "sketch ROADMAP.md for the passport app."
