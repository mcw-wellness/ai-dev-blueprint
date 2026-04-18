# Philosophy

Four principles govern every step of the blueprint.

## KISS — Keep It Simple, Stupid

Simplest thing that works. No clever abstractions, no "just in case" code.

If you find yourself designing for a hypothetical future need, stop. Build what's needed now. The future will clarify what was actually required.

## YAGNI — You Aren't Gonna Need It

Don't build what isn't asked for. Delete the TODO, don't implement it.

Every line of code is a liability: it must be read, maintained, tested, debugged, and eventually removed. Code you don't write is code you don't have to pay for.

## TDD — Test-Driven Development

Tests first, code second. A feature without tests is not done.

1. Write a failing test that describes the behavior
2. Write the minimum code that makes it pass
3. Refactor — keep tests green
4. Repeat

**Exception: experiments.** See [how-to-run-experiments.md](how-to-run-experiments.md) — you can't write tests for a behavior you haven't discovered yet.

## AI-testability

Code must be runnable and verifiable by an AI agent — **even in experiments**.

Every change produces machine-readable output. Stdout, JSON, a log line, a return value — something an AI can read and reason about. A result that only lives in a chart on a screen or a "does this feel right?" is not a result; it's a handoff.

Experiments are exempt from TDD, not from AI-testability. You can't test-first a behavior you haven't discovered, but the observation loop is still structured — the AI runs the experiment, reads the output, decides what it means.

Only hardware and external-world boundaries are legitimate handoff points. Everywhere else, the AI does the running, the looking, and the reasoning. See [preferences.md](preferences.md) §Working with me.

## Why these four

Each principle compounds against the natural drift of software complexity:

- KISS fights over-engineering
- YAGNI fights scope creep
- TDD fights regressions
- AI-testability fights silent failures and human-in-the-loop handoffs

Miss any one and the codebase eventually becomes unmaintainable. Hold all four and it stays cheap to change for years.
