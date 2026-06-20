# AI tool usage

Which AI handles which job, and why. The short answer: use multiple models for independent review, and let Opus arbitrate.

## Roles

| Task | Tool | Why |
|---|---|---|
| Primary coding + final arbitration | Claude Opus | Best at judgment, synthesis, multi-file reasoning |
| Plan review (pre-code) | Gemini + Codex | Independent second opinions catch bad plans early |
| Code review (post-code) | Gemini + Codex + Cursor (+ CodeRabbit on PRs) | Multi-review; every finding must be addressed or rejected |
| Third independent review + brainstorm | Cursor (`/cursor` skill) | Composer 2.5 on your paid subscription. Runs in parallel with Gemini + Codex. |
| Research / search / brainstorm | Gemini (`/gemini` skill) | Default model: `pro` (Gemini 3 Pro). Project-context aware. |
| Quick factual lookup | `perplexity_ask` (MCP) | Acceptable fallback for lightweight searches |

## Hard rules

- **Do NOT use `perplexity_research`** — too expensive and inferior to Gemini for deep work.
- **"Ask Codex" / "check with Codex"** always goes through the `/codex-review` skill, never a standalone tool.
- **Default code review = Gemini + Codex + Cursor in parallel, in the background**; Opus reads all three and arbitrates. Explicit "cursor review" / "check with Cursor" = Cursor only (`/cursor`), skipping the others.
- **Cursor uses Composer 2.5 only** (never `-fast`, never another model family) — it's the one model not already covered by `/gemini` and `/codex-review`. If `cursor-agent` fails with "Connection lost / exceeded max retries", **check Tailscale first** (MagicDNS breaks its streaming connection) — see the `/cursor` skill's troubleshooting.
- **Never install Python packages into system Python.** Always `python3 -m venv` first.

## Why three reviewers

Different models have different blind spots:

- **Gemini** — strong at architectural / diagnostic critique
- **Codex** — strong at subtle bugs and edge cases
- **CodeRabbit** — strong at conventions, lint-class issues, PR-level scope
- **Opus (me)** — reads all three and arbitrates; rejects bad suggestions with written rationale

### Proof in practice

A recent triple-review on a real PR caught issues that would have slipped through any single reviewer:

**Codex found:**
- "Base-class fields are authoritative" — an invariant violation
- "Int narrowing + zero-fallback" — a silent numeric bug
- "All trades visible always" — a visibility/scope error
- "Trade timestamps use consumer state" — a data-model mix-up

**Gemini found:**
- The architectural and diagnostic issues Codex glossed over

Neither model alone would have caught both buckets. Running them in parallel and then arbitrating is what makes the loop worth the cost.

Running all three is mandatory for real features. Fast track (bug fixes) drops to one. See [how-to-review-code.md](how-to-review-code.md) for the full flow.

## See also

- [how-to-review-spec.md](how-to-review-spec.md) — the pre-code plan review flow
- [how-to-review-code.md](how-to-review-code.md) — the post-code review loop with Opus arbitration
- [skills/](skills/) — the actual `/gemini` and `/codex-review` skill definitions
