# How to develop a feature

For every feature or change:

1. **Spec first** — Create or update the spec. No code without a spec. See [spec-anchored.md](spec-anchored.md).
2. **Plan** — Design the implementation before coding. Use Claude Code's plan mode (`/plan`) or write a plan in chat. Break into small, testable steps. Any `Q-NNN OPEN` that blocks the feature must be answered at this stage.
3. **Review plan** — Run the plan past Gemini and Codex before writing code. See [how-to-review-spec.md](how-to-review-spec.md).
4. **Decide** — Evaluate suggestions from reviewers. Accept what makes sense, reject what doesn't. Claude decides, user approves.
5. **Implement** — Write tests first ([how-to-write-tests.md](how-to-write-tests.md)), then code to make them pass. KISS — simplest thing that works.
6. **Review code** — Triple review: Gemini + Codex + CodeRabbit, with Opus arbitrating. See [how-to-review-code.md](how-to-review-code.md).
7. **Done** — Tests pass, reviewers happy, spec updated if needed.
8. **Lessons learned** — Update spec with what didn't work, workarounds, surprises. Only the unexpected.

## Fast Track (bug fixes and small changes)

For simple bug fixes and minor changes that don't alter feature behavior:

1. **Reproduce** — Write a failing test that demonstrates the bug.
2. **Fix** — Make the test pass. KISS.
3. **Review** — Quick review with one reviewer (CodeRabbit or Codex). Skip full triple review.
4. **Done** — Tests pass, no spec update needed (behavior unchanged).

**When to use fast track:** The fix doesn't change any spec's "What it does" section. If it does → full process.

**Project override:** A project's `AGENTS.md` can disable fast track and require the full triple-review loop for all PRs. When the stakes are high (production cutover, regulated system), this is the right call.
