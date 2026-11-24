# AI tool usage

Which AI handles which job, and why. The short answer: use multiple models for independent review, and let **Fable** arbitrate.

## Roles

| Task | Tool | Why |
|---|---|---|
| Primary coding / driver | Claude Opus | Best at judgment, synthesis, multi-file reasoning |
| **Final review arbitration** | **Fable** | The tiebreaker across all reviewers — not Opus |
| Plan review (pre-code) | Gemini + Codex | Independent second opinions catch bad plans early |
| Code review (post-code) | Gemini + Codex + CodeRabbit | Multi-review; every finding must be addressed or rejected |
| Optional third review + brainstorm | Cursor (`/cursor` skill) | Composer 2.5. **Available and verified working** (2026-08-02). Optional — not in the default loop. |
| Web research / search / brainstorm | Gemini (`/gemini` skill) | **Required** link. CLI-only (no MCP). Default model `pro`. |

## Hard rules

- **Gemini MUST run on a PRO model.** **Never Flash** — too weak for brainstorm/research/visual work; using it is a mistake.
  - **CLI (`/gemini` skill):** `-m pro`. This is the required link for web research.
  - **MCP (`mcp__gemini__*`, where a project has it):** the working Pro model is **`gemini-3.1-pro-preview`**.
    🚨 **`gemini-3-pro-preview` 404s** — the call fails with `MCP error -32603 ... Not Found`. It is
    still listed in the tool's enum, so it looks valid and isn't. Pass `gemini-3.1-pro-preview`
    explicitly rather than relying on the default. (Confirmed 2026-07-29.)
- **Perplexity is removed** — Gemini replaced it for all web research. Do not reinstall or call it.
- **"Ask Codex" / "check with Codex"** always goes through the `/codex-review` skill, never a standalone tool.
- **An agent calling Codex uses the plain default `codex` command** (`codex exec …`), never a profile launcher
  (`codex-vvs`, `codex-almir`). The prompt goes in as an argument or on stdin with `-`; a call that waits on stdin
  hangs forever. (Almir, 2026-11-15: `codex-vvs` had an expired login, two calls hung 30 min, then 401.
  Again 2026-11-20: a review sent to `codex-vvs` died on 401 — no `auth.json` in `~/.codex-vvs/`; Almir: „use codex
  standard not codex-vvs, and document this".)
- **Default code review = Gemini + Codex + CodeRabbit in parallel, in the background**; **Fable** reads all three and arbitrates (not Opus). Cursor is **optional/experimental** — add it when you want a fourth angle; explicit "cursor review" / "check with Cursor" = Cursor only (`/cursor`), skipping the others.
- **Cursor uses Composer 2.5 only** (never `-fast`, never another model family). If `cursor-agent` fails with "Connection lost / exceeded max retries", **check Tailscale first** (MagicDNS breaks its streaming connection) — see the `/cursor` skill's troubleshooting.
- **Never install Python packages into system Python.** Always `python3 -m venv` first.

## Cursor — how to run it

Verified end-to-end 2026-08-02: `cursor-agent` v2026.06.19 at `~/.local/bin/`, logged in, `composer-2.5`
listed as current, a real prompt round-tripped. Full detail in the [`/cursor` skill](skills/cursor/) — this
is just the two commands worth remembering.

```bash
# Review — read-only planning mode, Cursor reads the diff itself
cursor-agent -p --plan --trust --output-format text --model composer-2.5 \
  "Run \`git --no-pager diff\` and review the changes. List real issues with severity, or say it's clean."

# Brainstorm / Q&A — read-only ask mode
cursor-agent -p --mode ask --trust --output-format text --model composer-2.5 "<prompt>"
```

- `--model composer-2.5` is **not optional** — the CLI defaults to `composer-2.5-fast`, which is the wrong model.
- `--plan` and `--mode ask` are both read-only. Plain `-p` has write + shell access; don't use it for review.
- Run it **in the background** (`run_in_background: true`, ~7 min timeout). Composer streams slower than
  Codex and Gemini, and it's the one you don't want to block on.
- Cursor's model list now includes Opus 5 1M, GPT-5.6 Sol and Grok 4.5. **Ignore them.** Composer's own
  perspective is the entire reason Cursor is in the chain; the other families are already covered.

## Why three reviewers

Different models have different blind spots:

- **Gemini** — strong at architectural / diagnostic critique, **and the strongest of the three at
  VISUAL/SPATIAL work** (reading renders and screenshots, 3D geometry, "does this shape do the job").
  Claude cannot see 3D at all, so on anything geometric Gemini Pro is the eyes — send it images.
- **Codex** — strong at subtle bugs and edge cases
- **CodeRabbit** — strong at conventions, lint-class issues, PR-level scope
- **Fable** — reads all three and arbitrates; rejects bad suggestions with written rationale (Opus drives, Fable arbitrates)

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
- [how-to-review-code.md](how-to-review-code.md) — the post-code review loop with Fable arbitration
- [how-to-profiles.md](how-to-profiles.md) — recreate all Claude/Codex profiles on a new machine
- [skills/](skills/) — the actual `/gemini` and `/codex-review` skill definitions
