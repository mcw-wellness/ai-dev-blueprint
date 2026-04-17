# How to review code (post-implementation)

After tests pass, before the PR merges: **three independent reviewers** read the code, **Opus arbitrates** their findings, and every finding is either fixed or explicitly rejected with written rationale.

This is the heart of the blueprint. Running the loop costs tokens and minutes; skipping it costs incidents and regressions.

## The three reviewers

| Reviewer | Strength | Command |
|---|---|---|
| **CodeRabbit** | Conventions, lint-class issues, PR-scope concerns | `/coderabbit:review` |
| **Gemini** | Architecture, diagnostics, missing abstractions | `/gemini review` |
| **Codex** | Subtle bugs, edge cases, correctness invariants | `/codex-review review` |

Each has blind spots the others cover. Running a single reviewer leaves gaps that only surface in production. See [tool-usage.md](tool-usage.md) for concrete Codex-vs-Gemini evidence.

## The loop

### 1. Commit the draft

Tests pass locally. Code complete. Commit and open a PR (CodeRabbit reacts to PRs; the other two work on local diffs as well).

### 2. Run all three (parallel)

Kick all three off. They run independently.

```bash
# CodeRabbit on the PR
/coderabbit:review

# Gemini on the local diff
/gemini review

# Codex on the local diff
/codex-review review
```

### 3. Collect findings

Each reviewer emits a list of findings. Copy them into one place. Label each with `[CR]`, `[GM]`, `[CX]` so you know who flagged what — you'll refer back during arbitration and when writing the PR description.

### 4. Opus arbitrates

Claude reads all three lists and categorizes each finding:

| Category | What it means | What to do |
|---|---|---|
| **Must-fix** | Real bug, invariant violation, spec mismatch, regression risk | Fix in this PR |
| **Worth-fixing** | Improves code quality without changing behavior | Fix in this PR, or follow-up — your call |
| **Reject** | Bad suggestion: missing context, wrong assumption, premature abstraction | One-line rationale, attached to the PR |

**Arbitration is not consensus.** Two reviewers flagging one thing while a third doesn't isn't a vote. Each finding stands on its merits. Sometimes one reviewer is right and the others missed it. Sometimes all three are wrong.

The user signs off the categorization. Claude recommends, user decides.

### 5. Fix or document

For every **must-fix** and kept **worth-fixing**:

1. **Write a regression test first.** It should fail against current code, pass after the fix. *Every review finding that results in a code fix MUST have a corresponding automated test that would have caught it.* No exceptions.
2. Apply the fix.
3. Tests green.

For every **reject**: paste the rationale in the PR description (or chat, for non-PR reviews). The rationale is the record — future readers need to know why the suggestion was declined.

### 6. Re-review

After fixes, re-run the reviewers on the *final* code. This catches regressions introduced by the fixes and verifies the fixes actually addressed the finding.

If new findings appear, go to step 4. The loop converges — usually one re-review is enough. On round three, step back: you're probably missing a structural issue.

### 7. Merge

Tests green. Reviewers either happy or documented-rejected. Spec updated if behavior changed.

## Fast track — when one reviewer is enough

**Full triple-reviewer loop** is required for anything touching feature behavior, public APIs, data models, or security-sensitive code.

**Fast track** (one reviewer, usually CodeRabbit or Codex) is acceptable for pure bug fixes that don't change a spec's "What it does" section. See [how-to-develop.md](how-to-develop.md).

**Never skip all three.** Project-level `AGENTS.md` can disable fast track when the stakes demand it (production cutover, regulated systems, safety-critical code).

## Tool outage policy

If a reviewer is unavailable (API outage, rate limit, tool broken):

- Retry in 15 minutes
- If still down, wait up to an hour
- If still down and the PR is not urgent, wait and merge later
- If the PR is urgent (production incident, security fix), proceed with available reviewers and document in the PR: "Skipped [reviewer] due to [outage]. Will run retroactively."

Never skip a reviewer silently.

## Why this works

Single-model review is faster but brittle. One perspective has systematic blind spots. Triple review with arbitration is slower per PR but cuts defect rate substantially.

The loop is also **self-improving**: when reviewers disagree and arbitration picks a winner, the rationale feeds into the next round. Over time you learn which model tends to be right for which class of problem, and adjust accordingly.
