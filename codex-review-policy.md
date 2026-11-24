# User-level review policy (Codex)

*Canonical source for Codex's cross-tool review chain. Symlink this into each Codex home:*
*`ln -sf ~/Documents/GitHub/ai-dev-blueprint/codex-review-policy.md ~/.codex-<name>/AGENTS.md`.*
*The Claude-side equivalent lives in [`tool-usage.md`](tool-usage.md) — the two chains differ on*
*purpose; keep both accurate.*

- Use Fable for architecture, plan, and code reviews. Do not use Gemini for reviews (cost, Almir 2026-11-24).
- Run every Claude review read-only through the authenticated `claude-eventus`
  Claude Code instance using Fable.
- Use Fable for final review arbitration. Do not use Opus for reviews.
- For non-trivial code changes, run CodeRabbit locally with
  `coderabbit review --light --committed --base main` as a supplementary review.
- Do not require the CodeRabbit GitHub app or its PR comment when the local CLI
  review is available.
- Treat reviewer output as advisory: verify every finding against the code, and
  let a fresh Fable pass arbitrate conflicts and false positives.
- Web research goes through Gemini (CLI). Perplexity is removed — do not use it.

# Runtime rules (Almir, 2026-08-18)

- **NEVER enable fast mode** (`/fast`). It burns the weekly quota several times faster for the same
  work — two Codex seats were drained in one day on 2026-08-17/18 with it on. If the status line shows
  `fast`, run `/fast` once to turn it off and say so in the next message. It is a per-session toggle,
  not a config key, so check the status line, not `config.toml`.
- Reasoning effort and model stay as briefed; do not change either without an explicit instruction.
