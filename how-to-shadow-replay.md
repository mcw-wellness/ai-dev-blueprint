# How to validate with shadow replay

When migrating a legacy system to a new implementation, the only verification that matters is **black-box parity**: for the same inputs, both systems produce the same outputs.

Unit tests prove you handle inputs you imagined. Production sends inputs you didn't imagine. Shadow replay forces you to reckon with the latter.

## When to use this

- Replacing a legacy system whose outputs are consumed by other code you don't want to break.
- Migrating stacks (language, runtime, infrastructure) where behavior must be preserved.
- Rebuilding a subsystem after the original author is gone and institutional knowledge is incomplete.
- Any case where "it passes our tests" is not sufficient evidence that the new code is safe to ship.

Do NOT use this when:

- The new system is intentionally a behavior change — then you want divergence, not parity.
- You don't have access to production I/O — then shadow replay isn't available; you're in unit-test territory.

## The mechanism

1. **Record production I/O** — capture real inputs to the legacy system plus the legacy outputs they produced.
2. **Replay through both systems** — feed the same inputs through legacy and new in parallel, collect outputs from both.
3. **Diff** — compare outputs byte-for-byte (or field-by-field with documented tolerance).
4. **Iterate** — any divergence is a finding: bug in new? fix. Bug in legacy? document as intentional divergence.
5. **Gate** — no production cutover until the diff is empty (or every remaining divergence is explicit and approved).

## Recording the inputs

- **Breadth over volume.** A representative hour of diverse traffic beats a week of the same query pattern.
- **Raw bytes at the source.** Post-processed logs can hide differences that matter.
- **Timestamps, identifiers, and any side-channel data** the legacy system might use. Anything that could influence output.
- **Low-traffic edge cases** (error paths, retries, weird clients) — breadth is the point.
- **Minimum duration:** enough to cover a full business cycle — a day, a week, a month for time-series systems.

## Replaying

- Replay is offline. Both systems read the captured input; no live production traffic needed.
- Run both against the **exact same input**. Any non-determinism in the replay infrastructure (timestamps, random seeds) must be controlled.
- Collect both sets of outputs to disk. They're the evidence.

## Diffing

- **Default:** byte-identical outputs.
- Deviations must be **explicit and documented tolerances**. Examples:
  - Float rounding to same precision
  - Reordering where order isn't part of the contract
  - Equivalent encodings (`"1.0"` vs `"1"`)
- Every tolerance is a risk. Each one needs written justification.

## What to do with divergences

Every divergence falls into one bucket:

| Bucket | Action |
|---|---|
| **Bug in new** | Fix the new implementation. Add a regression test using the captured input. |
| **Bug in legacy** | Document as a legacy-bug finding. Decide: preserve (for rollback safety) or fix (with downstream migration plan)? Either is valid — explicit is the point. |
| **Acceptable tolerance** | Document the tolerance with rationale. Narrow the range as tightly as possible. |

No divergence is dismissed as "probably fine." Every one gets categorized and written down.

## The legacy-bug registry

Legacy systems accumulate bugs that nobody wants to preserve but can't afford to remove (downstream dependencies compensate for them). When you find one:

```
specs/legacy-bugs/
├── README.md
├── 001-negative-prices-returned-as-zero.md
└── 002-weekend-timestamps-shifted-utc-plus-one.md
```

Each entry documents:
- What legacy does (vs what it should do)
- What downstream code depends on the buggy behavior
- Whether the new code preserves or fixes the bug
- If fixed: what downstream mitigation is required before cutover

## Gating production cutover

The acceptance gate is:

> For every captured input, `legacy(x) == new(x)` — exact, or with explicit tolerance.

No exceptions. No "we'll fix it after cutover." Either parity holds (including documented divergences), or you're not ready to ship.

## Why black-box, not line-by-line?

Line-by-line comparison between legacy and new doesn't scale and doesn't tell you about correctness. Two implementations can pass line-by-line review and still disagree on outputs; two implementations can look nothing alike and produce identical outputs.

You don't care HOW the new system gets the answer. You care THAT it matches. Shadow replay tests what you care about.

## The cost

- **Recording infrastructure** — one-time setup. A few days of engineering, usually.
- **Replay harness** — a week or two to build, reusable across future migrations.
- **Diff iteration** — weeks to months depending on legacy behavioral complexity.

This is the expensive part. It's also what makes the migration ship without incidents.
