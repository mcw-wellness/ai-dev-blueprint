# How to write tests

[`how-to-develop.md`](how-to-develop.md) says **when** to write tests (first, before code). This doc defines **how** to write them.

## Core Philosophy

Based on the Google SWE Book:
- [Testing Overview](https://abseil.io/resources/swe-book/html/ch12.html)
- [Test Doubles](https://abseil.io/resources/swe-book/html/ch13.html)

## Rule 1: Test Behaviors, Not Methods

A test should verify what the code does for the user, not mirror internal structure. One method may need multiple tests (multiple behaviors). Multiple methods may need one test (one behavior spanning them).

```
// BAD — one test per method, testing internals
test("calculateTotal()")
test("applyDiscount()")
test("formatPrice()")

// GOOD — one test per behavior the user cares about
test("order with coupon shows discounted total at checkout")
test("order without coupon shows full price")
test("expired coupon is rejected with clear message")
```

## Rule 2: Test State, Not Interactions

Assert on outcomes (return values, database state, UI output), not on whether specific internal functions were called or in what order.

Exception: interaction testing is acceptable when the side effect IS the behavior (e.g., verifying an external API was called in an integration test).

## Rule 3: DAMP > DRY

Tests should be Descriptive And Meaningful Phrases. Repeating setup code across tests is fine if it makes each test self-contained and readable. A reader should understand a test without jumping to shared helpers.

## Rule 4: No Logic in Tests

No `if`, `else`, loops, ternaries, string concatenation, or conditional assertions in test bodies. If you need branching, write separate tests.

## Rule 5: Given / When / Then Structure

Every test has three clearly separated phases:

1. **Given** — set up the preconditions
2. **When** — perform the single action under test
3. **Then** — assert on outcomes

## Rule 6: Make Tests Complete and Concise

- Include all relevant setup in the test body (complete)
- Only set fields that affect the behavior under test (concise)
- Use factory defaults for everything else

## Rule 7: Test Names Should Be Sentences

A test name should describe the behavior, not the method. Pattern: "[unit] [does something] [when/given condition]".

## Rule 8: Prefer Real Implementations Over Mocks

Use real implementations wherever practical. Only use test doubles when:

- The real implementation is slow (network, disk, heavy computation)
- The real implementation is nondeterministic (time, randomness, external services)
- The real implementation is unavailable in the test environment

When you must mock, prefer fakes > stubs > mocks.

## Rule 9: Don't Overuse Mocks

Signs you're over-mocking:

- Mock setup is longer than the test itself
- You're mocking things you own
- You're asserting on mock call arguments rather than outcomes

## Rule 10: Tests Must Be Deterministic

No dependency on wall-clock time, execution order, external services, random data, or shared mutable state between tests.

## Rule 11: Make Tests Hermetic

Each test sets up everything it needs, runs in isolation, and cleans up after itself. Must produce the same result whether run alone, in a suite, or in parallel.

## Rule 12: Tests Should Be Fast

- Unit tests: < 2 seconds per test
- Never `sleep()` in a test — use polling with short intervals or event-driven waits
- Slow tests should be classified differently (integration) and run in a separate suite

## Rule 13: Unchanging Tests

The ideal test is written once and never changed unless the behavior it covers changes. If refactoring internals breaks your tests, they're testing implementation, not behavior.

## Rule 14: One Assertion Per Behavior (Not Per Test)

Multiple asserts in one test are fine when they verify different facets of one behavior. Multiple asserts verifying different behaviors should be separate tests.

## Rule 15: Test Public APIs, Not Internal Details

Test through the same interface your callers use. If a function is private/internal, test it through the public function that calls it.

## Rule 16: The Beyoncé Rule — "If you liked it, you should have put a test on it"

From Google's SWE Book. If a behaviour matters, it has a test, and **CI is the
source of truth** for what's protected.

A change that passes CI is allowed to ship. If it broke a behaviour that had **no
test**, the burden is on whoever owned that behaviour for never testing it — not on
the author of the change. The fix is to add the missing test, not to blame the
change.

Practical takeaway: **put a test on anything you want kept.** Untested behaviour is
fair game to break — that's the deal. This is also why "tests first" matters: the
test is how you stake your claim on a behaviour before someone else's change can
quietly remove it.

## Test Types

| Type | What it tests | Dependencies | Speed |
|------|---------------|--------------|-------|
| Unit | Business logic in isolation | All external deps mocked/faked | < 2s per test |
| Integration | Components working together, real I/O | Real database, file system, etc. | 2-30s per test |
| UI / Component | Rendering, interaction, accessibility | DOM environment, usually mocked backend | Medium |
| End-to-end | Full user workflows through the real system | Everything real | Slow |

Sizing guidance: ~80% unit, ~15% integration, ~5% end-to-end.

## Test Data

1. Use factories — never construct test objects by hand with all fields
2. Override only relevant fields — let factory defaults handle the rest
3. Use deterministic IDs — predictable test data is easier to debug
4. Clean up after tests — use shared cleanup utilities

## Hard Rules

1. Never commit with failing tests — all tests pass before merge
2. No feature is complete without tests
3. Never dismiss failures as "pre-existing" — fix or escalate
4. No arbitrary timeouts — fix root causes of slowness
5. No `eslint-disable` / `lint:ignore` — fix the issue or split the test
6. Keep test files short (under 600 lines) — split into focused files
7. Don't duplicate test utilities — use shared helpers
8. Run fast checks first — lint → typecheck → unit → integration

## References

- https://abseil.io/resources/swe-book/html/ch11.html
- https://abseil.io/resources/swe-book/html/ch12.html
- https://abseil.io/resources/swe-book/html/ch13.html
- https://abseil.io/resources/swe-book/html/ch14.html
