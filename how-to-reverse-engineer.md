# How to reverse-engineer a legacy codebase

When a senior engineer leaves and you inherit code you didn't write, don't panic and don't start porting line-by-line. Start by *understanding*.

This playbook is black-box-first: treat the legacy code as a specification you need to recover, not as scaffolding you need to translate.

## When to use this

- A maintainer has left (retired, resigned, reorganized) and nobody alive fully understands the code.
- You're modernizing a stack (C++ → Python, FORTRAN → Rust, Perl → Go) and behavior must be preserved.
- You're migrating runtimes (on-prem → cloud, monolith → service) and need parity before ripping.
- Original tests are missing, flaky, or testing implementation rather than behavior.

Do NOT use this for greenfield work. Do NOT use this to justify a rewrite that isn't warranted.

## The five steps

### 1. Capture the contract

The legacy code is a **specification in a foreign language**. Your job is to translate the *contract* into a spec in the format from [spec-anchored.md](spec-anchored.md) — not to transliterate C++ into Python.

- Read the code with Claude. Ask for summaries of *behavior*, not mechanics.
- Produce one spec per logical module. "What it does" — function-by-function if needed.
- Document every subtle behavior you don't yet understand as `Q-NNN OPEN` inline. Resolve later via experimentation.
- Mark suspected bugs with `[BUG?]` — they need an explicit decision in step 3.

The spec captures intent. The code is the implementation that leaked.

### 2. Capture the test vectors

The most valuable thing in a legacy system isn't the code — it's the **production I/O**. Before writing a single new line:

- Record a representative sample of production inputs and the outputs the legacy produced for them.
- Sample breadth beats volume: every code path, every edge case you can identify.
- Store captures as test fixtures. These become your TDD vectors.

Without captured I/O you're flying blind. A rewrite without parity tests ships bugs nobody notices until the worst moment.

### 3. Decide: port or rewrite?

A conscious choice, documented as a decision (see [spec-anchored.md](spec-anchored.md) §Spec Decisions vs ADRs).

| Port | Rewrite |
|---|---|
| Codebase small and well-structured | Codebase sprawling or tangled |
| Target stack close to legacy | Target stack fundamentally different |
| You have deep knowledge of both languages | You want a fresh cognitive model |
| Behavior is fully understood | Behavior has unknowns you need to re-learn |

Rewrite is usually the right call when the original maintainer is gone. A port tempts you to preserve accidental complexity; a rewrite forces you to face every decision.

Also decide, for each `[BUG?]` marked in step 1: preserve (document as legacy-bug finding) or fix (document as intentional divergence)? Both are valid. Silent "we'll just not copy it" is not.

### 4. TDD against captured vectors

Now you're in [how-to-develop.md](how-to-develop.md) territory, with one twist: **your tests are the captured vectors**, not imagined cases.

- Write a failing test for one behavior using a real captured input.
- Implement the minimum that makes it pass.
- Repeat until every vector passes.
- You'll discover vectors that surface undocumented behavior. Go back to step 1, update the spec, add a `Q-NNN` if ambiguous, resolve.

At the end of step 4, the new code handles every captured case identically to legacy.

### 5. Shadow-replay validation

Unit tests prove you handle *known* inputs. Production doesn't always send known inputs.

Run both systems in parallel against the same live inputs, diff the outputs, iterate until byte-identical parity (or documented tolerance) is achieved. See [how-to-shadow-replay.md](how-to-shadow-replay.md).

This is the acceptance gate. Nothing ships before parity.

## Common traps

- **"The code IS the spec."** No. The code is one implementation that may contain bugs. The spec captures intent.
- **"We'll just port line-by-line."** Accidental complexity stays; nothing improves. Usually ships slower AND buggier.
- **Preserving legacy bugs silently.** If you preserve a bug, document it as a legacy-bug finding. If you fix it, document the intentional divergence. Both must be explicit.
- **Skipping test vectors.** Without captured I/O, shadow replay isn't possible. You'll ship and find divergence in production.
- **One giant spec.** Split the legacy into logical modules, spec each separately. A 500-line spec nobody reads protects no one.
