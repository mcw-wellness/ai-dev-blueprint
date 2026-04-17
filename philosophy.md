# Philosophy

Three principles govern every step of the blueprint.

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

## Why these three

Each principle compounds against the natural drift of software complexity:

- KISS fights over-engineering
- YAGNI fights scope creep
- TDD fights regressions

Miss any one and the codebase eventually becomes unmaintainable. Hold all three and it stays cheap to change for years.
